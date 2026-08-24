// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { sql } from 'drizzle-orm'
import type { ConversationService } from '@modules/conversations/conversation-service.js'
import type { ConversationRunnerDeps, RunConversationResult } from '@modules/agent/conversation-runner.js'
import type { ModelGateway, ModelResponse } from '@modules/model/types.js'
import { estimateCost, type PricingTable } from '@shared/model-pricing.js'
import { estimateGodModeCost } from './estimate.js'
import { chooseIsolation, forkWorkerTree, listCopyChanges, promoteChangedFiles } from './isolation.js'
import { parseReviewJson } from './review.js'
import { validateRoster } from './roster.js'
import { harvestInsights, tallyVotes } from './vote.js'
import type { GodModeStore } from './store.js'
import type {
  GodModeDecision,
  GodModeIsolation,
  GodModeParticipant,
  GodModeRun,
  GodModeRunStatus,
  GodModeTimelineKey,
} from './types.js'

export class GodModeBusyError extends Error {
  constructor(message = 'A God Mode run is already active on this conversation') {
    super(message)
    this.name = 'GodModeBusyError'
  }
}

export class GodModeConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GodModeConfigError'
  }
}

export class GodModeCeilingError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GodModeCeilingError'
  }
}

export interface StartGodModeInput {
  conversationId: string
  userMessageId: number
  userText: string
  sourceWorkingDirectory: string | null
  orchestration: 'solo' | 'auto' | 'deep'
  liveKeys: Set<string>
  limits: { min: number; max: number }
  pricing?: PricingTable
  averageCostByKey?: Record<string, number>
}

export interface GodModeOrchestrator {
  start(input: StartGodModeInput): Promise<GodModeRun>
  cancel(runId: string): Promise<void>
  cancelActive(conversationId: string): Promise<GodModeRun | null>
  retryPromote(runId: string): Promise<void>
  get(runId: string): GodModeRun | null
  listForConversation(conversationId: string): GodModeRun[]
  hasActiveRun(conversationId: string): boolean
}

function isoNow(): string {
  return new Date().toISOString()
}

function responseText(resp: ModelResponse): string {
  return resp.content
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
}

function lastAssistantText(conversations: ConversationService, childId: string | null): string | null {
  if (!childId) return null
  const child = conversations.get(childId)
  if (!child) return null
  for (let i = child.messages.length - 1; i >= 0; i--) {
    if (child.messages[i]!.role === 'assistant') return child.messages[i]!.content
  }
  return null
}

function resolveWorkerAgentId(
  parent: { agentId: string | null } | null,
  registry: ConversationRunnerDeps['agentRegistry'],
): string | null {
  if (parent?.agentId) return parent.agentId
  const list = typeof registry?.list === 'function' ? registry.list() : []
  if (!Array.isArray(list)) return null
  const enabled = list.filter((a: { enabled?: boolean }) => a.enabled !== false)
  const primary = enabled.find((a: { tier?: string }) => a.tier === 'primary')
  return primary?.id ?? enabled[0]?.id ?? null
}

function describeWorktreeDiff(workspacePath: string): string {
  const parts: string[] = []
  for (const args of [['diff'], ['diff', '--cached']]) {
    try {
      const out = execFileSync('git', args, {
        cwd: workspacePath,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      if (out.trim()) parts.push(out)
    } catch { /* workspace may not be a git dir */ }
  }
  let untracked = ''
  try {
    untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard'], {
      cwd: workspacePath,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    })
  } catch { /* ignore */ }
  for (const rel of untracked.split('\n').map((l) => l.trim()).filter(Boolean)) {
    try {
      const body = readFileSync(join(workspacePath, rel), 'utf-8')
      parts.push(`Untracked: ${rel}\n${body}`)
    } catch {
      parts.push(`Untracked: ${rel}`)
    }
  }
  return parts.join('\n') || '(no file changes)'
}

function describeChanges(
  participant: GodModeParticipant,
  isolation: GodModeIsolation,
  destDir: string | null,
): string {
  const ws = participant.workspacePath
  if (!ws || !existsSync(ws)) return '(no workspace)'
  if (isolation === 'worktree') return describeWorktreeDiff(ws)
  if (isolation === 'copy') {
    if (!destDir) return '(no dest to compare)'
    const changed = listCopyChanges(ws, destDir)
    return changed.join('\n') || '(no file changes)'
  }
  return '(transcript only)'
}

function buildReviewPrompt(
  reviewer: GodModeParticipant,
  others: GodModeParticipant[],
  isolation: GodModeIsolation,
  destDir: string | null,
): string {
  const peers = others.map((o) => [
    `Slot ${o.slotId} (${o.providerId}/${o.modelId})`,
    `Summary: ${o.summary ?? '(none)'}`,
    `Changes:\n${describeChanges(o, isolation, destDir)}`,
  ].join('\n')).join('\n\n')

  return [
    `You are reviewing peer God Mode workers. Your slot is ${reviewer.slotId}.`,
    'Do not vote for yourself. voteFor must be another slot id.',
    'Peer results:',
    peers,
    'Reply with a single JSON object matching {voteFor, scores, uniqueInsights, risks, summary}.',
    'scores are integers 1-5 for quality, completeness, and risk.',
  ].join('\n\n')
}

export function failInFlightGodRuns(db: any): number {
  const rows = db.all(sql`
    SELECT id FROM god_mode_runs
    WHERE status IN ('preparing', 'racing', 'reviewing', 'deciding', 'promoting')
  `) as Array<{ id: string }>
  if (rows.length === 0) return 0
  const completedAt = isoNow()
  db.run(sql`
    UPDATE god_mode_runs
    SET status = 'failed', error = 'process restarted', completed_at = ${completedAt}
    WHERE status IN ('preparing', 'racing', 'reviewing', 'deciding', 'promoting')
  `)
  return rows.length
}

export function createGodModeOrchestrator(deps: {
  store: GodModeStore
  conversations: ConversationService
  runConversation: (conversationId: string, deps: ConversationRunnerDeps) => Promise<RunConversationResult>
  runConversationDeps: ConversationRunnerDeps
  gateway: ModelGateway
  logger: { info: Function; warn: Function; error: Function }
}): GodModeOrchestrator {
  const { store, conversations, runConversation: runChild, runConversationDeps, gateway, logger } = deps

  function isCancelled(runId: string): boolean {
    return store.getRun(runId)?.status === 'cancelled'
  }

  function note(runId: string, phase: GodModeRunStatus, key: GodModeTimelineKey, slotId: string | null = null): void {
    store.appendTimeline(runId, { at: isoNow(), phase, key, slotId })
  }

  function cancelChildSessions(childRunId: string | null): void {
    if (!childRunId) return
    const supervisor = runConversationDeps.supervisor
    if (!supervisor?.cancel || !runConversationDeps.db) return
    try {
      const rows = runConversationDeps.db.all(sql`
        SELECT id FROM agent_sessions
        WHERE conversation_id = ${childRunId} AND status = 'running'
      `) as Array<{ id: string }>
      for (const row of rows) supervisor.cancel(row.id)
    } catch (err) {
      logger.warn({ err, childRunId }, 'God Mode: failed to cancel child session')
    }
  }

  function cancelUnfinished(runId: string, reason: string): void {
    for (const p of store.listParticipants(runId)) {
      if (p.status !== 'running' && p.status !== 'pending') continue
      cancelChildSessions(p.childRunId)
      store.updateParticipant(p.id, { status: 'failed', error: reason, completedAt: isoNow() })
    }
  }

  function rollup(runId: string, startedAt: number, status: GodModeRun['status'], error: string | null): void {
    const parts = store.listParticipants(runId)
    const totalTokens = parts.reduce((sum, p) => sum + p.tokensIn + p.tokensOut, 0)
    const totalCostUsd = parts.reduce((sum, p) => sum + p.costUsd, 0)
    store.updateRun(runId, {
      status,
      totalTokens,
      totalCostUsd,
      durationMs: Date.now() - startedAt,
      error,
      completedAt: isoNow(),
    })
    if (status === 'completed') note(runId, 'completed', 'completed')
    else if (status === 'failed') note(runId, 'failed', 'failed')
    else if (status === 'cancelled') note(runId, 'cancelled', 'cancelled')
  }

  async function harvestTranscript(sessionId: string | undefined): Promise<string> {
    const eventStore = runConversationDeps.eventStore
    if (!eventStore || !sessionId) return ''
    try {
      const events = await eventStore.getByTypes(sessionId, ['LlmResponse'])
      const parts: string[] = []
      for (const e of events) {
        const text = String((e.payload as { response?: { content?: unknown } })?.response?.content ?? '').trim()
        if (text) parts.push(text)
      }
      return parts.join('\n\n')
    } catch {
      return ''
    }
  }

  async function reviewSurvivors(
    survivors: GodModeParticipant[],
    isolation: GodModeIsolation,
    destDir: string | null,
    runId: string,
  ): Promise<void> {
    await Promise.all(survivors.map(async (reviewer) => {
      if (isCancelled(runId)) return
      const others = survivors.filter((s) => s.slotId !== reviewer.slotId)
      const prompt = buildReviewPrompt(reviewer, others, isolation, destDir)
      try {
        const resp = await gateway.complete({
          provider: reviewer.providerId,
          model: reviewer.modelId,
          messages: [{ role: 'user', content: prompt }],
          metadata: {
            conversationId: reviewer.childRunId ?? undefined,
            origin: 'team',
            autonomous: true,
          },
        })
        const extraIn = resp.usage?.inputTokens ?? 0
        const extraOut = resp.usage?.outputTokens ?? 0
        const extraCost = estimateCost(reviewer.providerId, reviewer.modelId, {
          inputTokens: extraIn,
          outputTokens: extraOut,
          costUsd: resp.usage?.costUsd,
        }, runConversationDeps.pricingOverrides)
        const latest = store.listParticipants(runId).find((p) => p.id === reviewer.id) ?? reviewer
        store.updateParticipant(reviewer.id, {
          tokensIn: latest.tokensIn + extraIn,
          tokensOut: latest.tokensOut + extraOut,
          costUsd: latest.costUsd + extraCost,
        })
        const verdict = parseReviewJson(responseText(resp))
        if (!verdict) return
        store.updateParticipant(reviewer.id, {
          voteFor: verdict.voteFor,
          scores: verdict.scores,
          uniqueInsights: verdict.uniqueInsights,
          risks: verdict.risks,
          reviewSummary: verdict.summary,
        })
      } catch (err) {
        logger.warn({ err, slotId: reviewer.slotId, runId }, 'God Mode: review call failed (vote discarded)')
      }
    }))
  }

  async function promoteWinner(run: GodModeRun, winner: GodModeParticipant): Promise<string | null> {
    if (run.isolation === 'none' || !winner.workspacePath || !run.sourceWorkingDirectory) return null
    if (run.isolation !== 'worktree' && run.isolation !== 'copy') return null
    try {
      promoteChangedFiles({
        workspacePath: winner.workspacePath,
        destDir: run.sourceWorkingDirectory,
        isolation: run.isolation,
      })
      return null
    } catch (err) {
      return `promote failed: ${err instanceof Error ? err.message : String(err)}`
    }
  }

  return {
    get(runId: string): GodModeRun | null {
      return store.getRun(runId)
    },

    listForConversation(conversationId: string): GodModeRun[] {
      return store.listRunsForConversation(conversationId)
    },

    hasActiveRun(conversationId: string): boolean {
      return store.hasActiveRun(conversationId)
    },

    async cancel(runId: string): Promise<void> {
      const run = store.getRun(runId)
      if (!run || run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled') return
      store.updateRun(runId, { status: 'cancelled', error: 'cancelled', completedAt: isoNow() })
      cancelUnfinished(runId, 'cancelled')
    },

    async cancelActive(conversationId: string): Promise<GodModeRun | null> {
      const active = store.listRunsForConversation(conversationId).find((r) =>
        r.status !== 'completed' && r.status !== 'failed' && r.status !== 'cancelled',
      )
      if (!active) return null
      store.updateRun(active.id, { status: 'cancelled', error: 'cancelled', completedAt: isoNow() })
      cancelUnfinished(active.id, 'cancelled')
      return store.getRun(active.id)
    },

    async retryPromote(runId: string): Promise<void> {
      const run = store.getRun(runId)
      if (!run?.winnerParticipantId) return
      const winner = store.listParticipants(runId).find((p) => p.id === run.winnerParticipantId)
      if (!winner) return
      const error = await promoteWinner(run, winner)
      store.updateRun(runId, { error })
      if (error) throw new Error(error)
    },

    async start(input: StartGodModeInput): Promise<GodModeRun> {
      if (store.hasActiveRun(input.conversationId)) throw new GodModeBusyError()

      const config = store.getConfig()
      const validated = validateRoster(config, { min: input.limits.min, max: input.limits.max, liveKeys: input.liveKeys })
      if (!validated.ok) throw new GodModeConfigError(validated.error)

      const estimate = estimateGodModeCost(validated.config.participants, {
        pricing: input.pricing,
        averageCostByKey: input.averageCostByKey,
      })
      if (config.costCeilingUsd != null && estimate > config.costCeilingUsd) {
        throw new GodModeCeilingError(
          `Estimated cost ${estimate.toFixed(4)} exceeds ceiling ${config.costCeilingUsd}`,
        )
      }

      const isolation = chooseIsolation(input.sourceWorkingDirectory)
      const run = store.insertRun({
        conversationId: input.conversationId,
        userMessageId: input.userMessageId,
        status: 'preparing',
        chairParticipantId: validated.config.chairParticipantId,
        participantsSnapshot: validated.config.participants,
        isolation,
        sourceWorkingDirectory: input.sourceWorkingDirectory,
      })
      note(run.id, 'preparing', 'started')
      const startedAt = Date.now()

      const pending = validated.config.participants.map((spec) =>
        store.insertParticipant({
          runId: run.id,
          slotId: spec.id,
          providerId: spec.providerId,
          modelId: spec.modelId,
          status: 'pending',
        }),
      )

      const live: GodModeParticipant[] = []
      for (const p of pending) {
        const key = `${p.providerId}/${p.modelId}`
        if (!input.liveKeys.has(key)) {
          store.updateParticipant(p.id, { status: 'skipped' })
        } else {
          live.push(p)
        }
      }
      if (live.length < input.limits.min) {
        rollup(run.id, startedAt, 'failed', 'not enough live models')
        return store.getRun(run.id)!
      }

      const forked: GodModeParticipant[] = []
      for (const p of live) {
        if (isolation === 'none' || !input.sourceWorkingDirectory) {
          forked.push(p)
          continue
        }
        try {
          const tree = forkWorkerTree({
            sourceDir: input.sourceWorkingDirectory,
            runId: run.id,
            slotId: p.slotId,
          })
          store.updateParticipant(p.id, { workspacePath: tree.workspacePath })
          forked.push({ ...p, workspacePath: tree.workspacePath })
        } catch (err) {
          store.updateParticipant(p.id, {
            status: 'failed',
            error: err instanceof Error ? err.message : String(err),
            completedAt: isoNow(),
          })
        }
      }

      if (forked.length === 0) {
        rollup(run.id, startedAt, 'failed', 'not enough live models')
        return store.getRun(run.id)!
      }

      const parent = conversations.get(input.conversationId)
      const workerAgentId = resolveWorkerAgentId(parent, runConversationDeps.agentRegistry)

      const racing: GodModeParticipant[] = []
      for (const p of forked) {
        try {
          const child = conversations.createSubConversation({
            title: `God ${p.modelId}`,
            goalDescription: input.userText,
            parentConversationId: input.conversationId,
            initialStatus: 'idle',
            agentId: workerAgentId ?? undefined,
          })
          conversations.update(child.id, {
            providerId: p.providerId,
            modelId: p.modelId,
            godMode: false,
            workingDirectories: p.workspacePath ? [p.workspacePath] : [],
            orchestration: input.orchestration,
            agentId: workerAgentId,
          })
          store.updateParticipant(p.id, { childRunId: child.id, status: 'running' })
          racing.push({ ...p, childRunId: child.id, status: 'running' })
        } catch (err) {
          store.updateParticipant(p.id, {
            status: 'failed',
            error: err instanceof Error ? err.message : String(err),
            completedAt: isoNow(),
          })
        }
      }

      if (racing.length === 0) {
        rollup(run.id, startedAt, 'failed', 'not enough live models')
        return store.getRun(run.id)!
      }

      if (isCancelled(run.id)) return store.getRun(run.id)!
      store.updateRun(run.id, { status: 'racing' })
      note(run.id, 'racing', 'racing')
      const ceiling = config.costCeilingUsd
      let abortRemaining = false

      await Promise.all(racing.map(async (p) => {
        if (abortRemaining || isCancelled(run.id)) {
          store.updateParticipant(p.id, {
            status: 'failed',
            error: abortRemaining ? 'cancelled: cost ceiling' : 'cancelled',
            completedAt: isoNow(),
          })
          return
        }
        const slotStart = Date.now()
        try {
          const result = await runChild(p.childRunId!, runConversationDeps)
          if (isCancelled(run.id)) return
          const child = conversations.get(p.childRunId!)
          const last = child?.messages.slice().reverse().find((m) => m.role === 'assistant')
          const harvested = await harvestTranscript(result.sessionId)
          const summary = harvested || last?.content || null
          const costUsd = child?.totalCostUsd ?? 0
          const tokensIn = last?.tokensIn || child?.tokensUsed || 0
          const tokensOut = last?.tokensOut ?? 0

          if (result.parked) {
            store.updateParticipant(p.id, {
              status: 'running',
              error: 'parked',
              tokensIn,
              tokensOut,
              costUsd,
              durationMs: Date.now() - slotStart,
              summary,
            })
            return
          }
          if (!result.ran) {
            store.updateParticipant(p.id, {
              status: 'failed',
              error: result.error || result.reason || 'error',
              tokensIn,
              tokensOut,
              costUsd,
              durationMs: Date.now() - slotStart,
              summary,
              completedAt: isoNow(),
            })
            note(run.id, 'racing', 'worker-failed', p.slotId)
            return
          }

          store.updateParticipant(p.id, {
            status: 'completed',
            tokensIn,
            tokensOut,
            costUsd,
            durationMs: Date.now() - slotStart,
            summary,
            completedAt: isoNow(),
          })
          note(run.id, 'racing', 'worker-done', p.slotId)
        } catch (err) {
          const child = p.childRunId ? conversations.get(p.childRunId) : null
          store.updateParticipant(p.id, {
            status: 'failed',
            tokensIn: child?.tokensUsed ?? 0,
            costUsd: child?.totalCostUsd ?? 0,
            durationMs: Date.now() - slotStart,
            error: err instanceof Error ? err.message : String(err),
            completedAt: isoNow(),
          })
          note(run.id, 'racing', 'worker-failed', p.slotId)
        }
        if (ceiling != null && store.sumCost(run.id) > ceiling) {
          abortRemaining = true
          for (const other of store.listParticipants(run.id)) {
            if (other.id === p.id || other.status !== 'running') continue
            cancelChildSessions(other.childRunId)
          }
        }
      }))

      if (isCancelled(run.id)) return store.getRun(run.id)!

      const afterRace = store.listParticipants(run.id)
      const survivors = afterRace.filter((p) => p.status === 'completed')
      if (survivors.length === 0) {
        rollup(run.id, startedAt, 'failed', 'all workers failed')
        return store.getRun(run.id)!
      }

      let winnerSlotId: string
      let tieBroken = false
      let decision: GodModeDecision

      if (survivors.length === 1) {
        winnerSlotId = survivors[0]!.slotId
        tieBroken = false
        decision = {
          method: 'sole-survivor',
          winnerSlotId,
          tieBroken: false,
          chairSlotId: config.chairParticipantId,
          votes: [],
          counts: {},
        }
      } else {
        store.updateRun(run.id, { status: 'reviewing' })
        note(run.id, 'reviewing', 'reviewing')
        await reviewSurvivors(survivors, isolation, input.sourceWorkingDirectory, run.id)
        if (isCancelled(run.id)) return store.getRun(run.id)!

        const reviewed = store.listParticipants(run.id).filter((p) => p.status === 'completed')
        const votes = reviewed.map((p) => ({ slotId: p.slotId, voteFor: p.voteFor }))
        const completedAtBySlot: Record<string, string> = {}
        for (const p of reviewed) {
          if (p.completedAt) completedAtBySlot[p.slotId] = p.completedAt
        }
        const tallied = tallyVotes(votes, config.chairParticipantId, completedAtBySlot)
        winnerSlotId = tallied.winnerSlotId ?? ''
        tieBroken = tallied.tieBroken
        let method: GodModeDecision['method'] = tallied.method === 'none'
          ? 'earliest-completed'
          : tallied.method
        if (!winnerSlotId) {
          const chair = reviewed.find((p) => p.slotId === config.chairParticipantId)
          if (chair) {
            winnerSlotId = chair.slotId
            tieBroken = true
            method = 'chair'
          } else {
            const earliest = [...reviewed].sort((a, b) =>
              (a.completedAt ?? '\uffff').localeCompare(b.completedAt ?? '\uffff'),
            )[0]
            winnerSlotId = earliest?.slotId ?? reviewed[0]!.slotId
            tieBroken = true
            method = 'earliest-completed'
          }
        }
        decision = {
          method,
          winnerSlotId,
          tieBroken,
          chairSlotId: config.chairParticipantId,
          votes: reviewed.map((p) => ({ fromSlotId: p.slotId, voteFor: p.voteFor })),
          counts: tallied.counts,
        }
      }

      const winner = store.listParticipants(run.id).find((p) => p.slotId === winnerSlotId)
      if (!winner) {
        rollup(run.id, startedAt, 'failed', 'no winner')
        return store.getRun(run.id)!
      }

      if (isCancelled(run.id)) return store.getRun(run.id)!

      const insights = harvestInsights(
        store.listParticipants(run.id).map((p) => ({ slotId: p.slotId, uniqueInsights: p.uniqueInsights })),
        winner.slotId,
      )

      store.updateRun(run.id, {
        status: 'deciding',
        winnerParticipantId: winner.id,
        tieBroken,
        insights,
        decision,
      })
      note(run.id, 'deciding', 'decided', winner.slotId)
      if (isCancelled(run.id)) return store.getRun(run.id)!
      store.updateRun(run.id, { status: 'promoting' })
      note(run.id, 'promoting', 'promoting')
      if (isCancelled(run.id)) return store.getRun(run.id)!

      const latest = store.getRun(run.id)!
      const promoteError = await promoteWinner(latest, winner)

      const winnerText = winner.summary ?? lastAssistantText(conversations, winner.childRunId) ?? ''
      if (winnerText) {
        conversations.addMessage(input.conversationId, {
          role: 'assistant',
          content: winnerText,
          model: winner.modelId,
          provider: winner.providerId,
        })
      }

      rollup(run.id, startedAt, 'completed', promoteError)
      logger.info({ runId: run.id, winnerSlotId: winner.slotId }, 'God Mode run completed')
      return store.getRun(run.id)!
    },
  }
}

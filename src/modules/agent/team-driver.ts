// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// F2 T10 — the team-session driver. This loop used to be a fire-and-forget IIFE
// inside the approve route, which meant exactly one thing could ever start a
// team session: a user pressing Approve in this process. A restart left every
// in-flight session dead (status 'running' with nobody iterating it), and a
// resume after a restart only flipped the row back to 'running' — the F1-era
// wedge. Extracted here, the same loop is reachable from three places:
// the approve route, the resume route, and the boot scan.
//
// The in-memory fast paths are untouched: a live driver still parks on the
// checkpoint resolver, and a resume in the same process still resolves it
// directly. Persistence is what makes the OTHER cases possible.

import { createRunSeq, orchestratorEventToOrchestration } from '@shared/orchestration-events.js'
import { WS_TOPICS } from '@shared/ws-topics.js'
import type { OrchestrationBroadcaster } from './orchestration-broadcaster.js'
import type { ExecuteTeamResumeOptions, OrchestratorEvent, RunAgentProgress, TeamConfig } from './orchestrator.js'
import type { TeamResumeState, TeamSession } from './team-session-service.js'

/** The orchestration sink, plus the seq continuity a re-drive needs. */
export interface TeamOrchestrationSink extends OrchestrationBroadcaster {
  /** Highest seq already persisted for this run; a re-drive continues above it. */
  latestSeq?(runId: string): number
}

/** Exactly what the driver needs — narrower than the full services it is given. */
export interface TeamDriverDeps {
  teamSessions: {
    get(id: string): TeamSession | null
    setStatus(id: string, status: TeamSession['status']): void
    complete(id: string, totalTokens: number, totalCostUsd: number): void
    listByStatus(status: TeamSession['status']): TeamSession[]
    getResumeState(id: string): TeamResumeState
  }
  orchestrator: {
    executeTeam(
      config: TeamConfig,
      parentConversationId: string,
      goalDescription: string,
      teamSessionId: string,
      onProgress?: (e: RunAgentProgress) => void,
      resumeFrom?: ExecuteTeamResumeOptions,
    ): AsyncGenerator<OrchestratorEvent>
  }
  bus?: { emit(subject: string, data: unknown): void }
  broadcaster?: TeamOrchestrationSink
  /**
   * Direct WS push. The `team:*` colon subjects are legacy bus traffic with NO
   * transport to the browser, so the team panel only updates live because of
   * these frames.
   */
  wsBroadcast?: (topic: string, message: unknown) => void
  logger?: { info(obj: unknown, msg?: string): void; warn(obj: unknown, msg?: string): void }
}

/**
 * Sessions being driven by THIS process. Guards the overlap the three entry
 * points create — a boot scan racing a user's resume, or a double-click on
 * Approve — where two drivers on one session would double-run its members and
 * interleave its events.
 */
const activeDrivers = new Map<string, Promise<void>>()

export function hasActiveTeamDriver(teamSessionId: string): boolean {
  return activeDrivers.has(teamSessionId)
}

/** Test hook — a restart is modelled by dropping this process's driver registry. */
export function __resetTeamDriversForTest(): void {
  activeDrivers.clear()
}

/**
 * Drive a team session to completion, persisting and broadcasting every event.
 * Fire-and-forget from a route's perspective; the returned promise never
 * rejects (every failure is turned into a team_failed transition) and is
 * awaitable by callers that need to know when the run settled.
 */
export function driveTeam(
  teamSessionId: string,
  deps: TeamDriverDeps,
  opts?: ExecuteTeamResumeOptions,
): Promise<void> {
  const existing = activeDrivers.get(teamSessionId)
  if (existing) {
    deps.logger?.warn({ teamSessionId }, 'team driver already running for this session — ignoring the second drive')
    return existing
  }

  const run = driveTeamLoop(teamSessionId, deps, opts).finally(() => {
    activeDrivers.delete(teamSessionId)
  })
  activeDrivers.set(teamSessionId, run)
  return run
}

async function driveTeamLoop(
  id: string,
  deps: TeamDriverDeps,
  opts?: ExecuteTeamResumeOptions,
): Promise<void> {
  const { teamSessions, orchestrator, bus, broadcaster, wsBroadcast } = deps

  // Seq continuity: a re-driven session's events must sort AFTER the ones an
  // earlier process already persisted, or the replayed tree interleaves.
  const nextSeq = createRunSeq(broadcaster?.latestSeq?.(id) ?? 0)

  const failRun = (error: string): void => {
    teamSessions.setStatus(id, 'failed')
    const failure = { type: 'team_failed', error }
    bus?.emit(`team:${id}:event`, failure)
    wsBroadcast?.(WS_TOPICS.teamEvent(id), { event: 'team', data: failure })
    broadcaster?.emit({
      runId: id, nodeId: id, parentId: null, seq: nextSeq(),
      payload: { type: 'run_completed', status: 'failed', totalTokens: 0, totalCostUsd: 0 },
    })
  }

  const session = teamSessions.get(id)
  if (!session) {
    deps.logger?.warn({ teamSessionId: id }, 'team driver asked to drive an unknown session')
    return
  }

  let config: TeamConfig
  try {
    config = JSON.parse(session.config)
  } catch (err) {
    deps.logger?.warn({ err, teamSessionId: id }, 'team session config is not valid JSON — failing the run')
    failRun('Team session config could not be parsed')
    return
  }

  const goal = session.goalDescription ?? ''
  // A resumed or boot-revived session is 'paused'/'running' in the DB; the
  // approve route already set 'running'. Asserting it here keeps the row
  // honest for every entry point rather than only the one that knew.
  if (session.status !== 'running') teamSessions.setStatus(id, 'running')

  // Live per-subagent progress → normalized OrchestrationEvent → WS. Subagent
  // nodes nest under their phase node (emitted by the generator's
  // phase_started); falls back to the run root when the phase is unknown.
  const onProgress = (e: RunAgentProgress) => {
    if (!broadcaster) return
    const nodeId = `conv:${e.conversationId}`
    const parentId = e.phase ? `phase:${e.phase}` : null
    if (e.kind === 'node_started') {
      broadcaster.emit({
        runId: id, nodeId, parentId, seq: nextSeq(),
        payload: { type: 'node_started', kind: 'subagent', label: e.agentId, agentId: e.agentId, conversationId: e.conversationId },
      })
    } else if (e.kind === 'node_progress') {
      broadcaster.emit({
        runId: id, nodeId, parentId, seq: nextSeq(),
        payload: { type: 'node_progress', turn: e.turn, tokens: e.tokens },
      })
    } else {
      broadcaster.emit({
        runId: id, nodeId, parentId, seq: nextSeq(),
        payload: { type: 'tool_result', toolId: e.toolId, status: e.status === 'error' ? 'error' : 'success' },
      })
    }
  }

  try {
    for await (const event of orchestrator.executeTeam(config, session.parentConversationId, goal, id, onProgress, opts)) {
      bus?.emit(`team:${id}:event`, event) // legacy bus emit (kept for existing subscribers)
      wsBroadcast?.(WS_TOPICS.teamEvent(id), { event: 'team', data: event })
      // Normalized OrchestrationEvent → direct WS broadcast. These are not bus
      // events at all, so they never pass through the bus→WS bridge.
      const normalized = orchestratorEventToOrchestration(id, event, nextSeq())
      if (normalized) broadcaster?.emit(normalized)
      if (event.type === 'team_completed') {
        const completedEvent = event as Extract<OrchestratorEvent, { type: 'team_completed' }>
        teamSessions.complete(id, completedEvent.totalTokens, completedEvent.totalCostUsd)
      }
      if (event.type === 'team_failed') {
        teamSessions.setStatus(id, 'failed')
      }
    }
  } catch (err: any) {
    failRun(err?.message ?? String(err))
  }
}

/**
 * Boot scan (F2 T8's `agentPostBoot` hook point). A session left 'running' by
 * a crash has nobody iterating it, so it is re-driven from its persisted
 * cursor; the phase it died in re-runs, minus the members that had finished.
 *
 * Two sessions are deliberately NOT driven:
 *  - status 'paused' — a durable wait on a human. The resume route continues it.
 *  - status 'running' with the cursor at a checkpoint — the process died
 *    between recording the gate and pausing on it. Driving it would walk past
 *    an approval nobody answered, so it is parked instead.
 *
 * Returns how many sessions were handed to a driver.
 */
export function reviveTeamSessions(deps: TeamDriverDeps): number {
  let revived = 0
  let orphans: TeamSession[]
  try {
    orphans = deps.teamSessions.listByStatus('running')
  } catch (err) {
    deps.logger?.warn({ err }, 'Boot recovery: could not read running team sessions')
    return 0
  }

  for (const session of orphans) {
    try {
      if (session.phaseStatus === 'awaiting_checkpoint') {
        deps.teamSessions.setStatus(session.id, 'paused')
        deps.logger?.info({ teamSessionId: session.id }, 'Boot recovery: team session died at a checkpoint — parked for approval')
        continue
      }
      if (hasActiveTeamDriver(session.id)) continue

      const state = deps.teamSessions.getResumeState(session.id)
      void driveTeam(session.id, deps, state)
      revived++
      deps.logger?.info(
        { teamSessionId: session.id, startAtPhase: state.startAtPhase },
        'Boot recovery: re-driving an orphaned team session from its phase cursor',
      )
    } catch (err) {
      deps.logger?.warn({ err, teamSessionId: session.id }, 'Boot recovery: re-drive of one team session failed — continuing with the rest')
    }
  }
  return revived
}

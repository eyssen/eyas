// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Headless OpenCode task (opencode_run). EYAS creates one OpenCode session in
// the task folder, sends the prompt with EYAS's recalled memory as its
// `system` text — the same fenced <eyas-memory> block every other model gets,
// from the one recall service (ctx.memoryRecall), sized for the window of the
// model OpenCode runs by the same budgetForWindow as every other prompt — and
// returns the answer and the diffs as the opencode_run result. The prompt and
// the memory leave EYAS past the model gateway, for whatever model OpenCode
// runs, so they are masked first by the privacy policy's one function (remote).
// The session is bound, in process, to the task's conversation and user and to
// the plugin key of the server EYAS spawned (memory-bridge.ts): OpenCode's
// memory_search / memory_expand then read that conversation's project, and
// its completed tool results are recorded like any run's tool output (only
// with memory.l0.captureToolResults on). An attached external server has no
// key, so no binding: no EYAS memory tools, no capture.
// It also answers every tool permission the session asks for: the sidecar
// runs with every tool set to "ask" (isolation.ts), and each
// `permission.asked` of this task's session (or a subagent session it
// spawned) goes through the EYAS security gate, one validateToolCall per
// request, then gets 'once' or 'reject'. No gate means 'reject' (fail
// closed). Requests of other sessions (an operator's TUI) are left alone.
// The model and reasoning variant come from the OpenCode settings: the
// variant is sent only when OpenCode lists it for that model, and the result
// reports what actually ran (read back from OpenCode's reply).
// The OpenCode session is unbound and deleted at the end: EYAS keeps the record.

import type { Logger } from 'pino'
import { isAbsolute, resolve } from 'node:path'
import { z } from 'zod'
import { createPermissionBridge, type GateDecision, type PermissionBridgeDeps } from '@modules/model/permission-bridge.js'
import { resolveCliCwd } from '@modules/model/cli-runtime/workspaces.js'
import { generateId } from '@shared/crypto.js'
import type { MemoryRecall } from '@modules/memory/v2/assemble.js'
import type { PrivacyService } from '@modules/privacy/service.js'
import { BASELINE_WINDOW, budgetForWindow, tokensToChars } from '@modules/prompt-wizard/token-budget.js'
import type { OpencodeClient } from './opencode-client.js'
import type { OpencodeSessionBindings } from './memory-bridge.js'
import { isUnderRoot } from './path-guard.js'
import { mapOpencodePermission, OpencodePermissionRequestSchema } from './permission-gate.js'
import type {
  DeveloperTaskInput,
  DeveloperTaskResult,
  OpencodeEffectiveModel,
  OpencodeEvent,
  OpencodeModelCatalog,
  OpencodeModelRef,
  OpencodeSessionBinding,
} from './types.js'

const DEFAULT_TIMEOUT_MS = 180_000
/** How long to wait for the event stream before sending the prompt. */
const EVENT_STREAM_WAIT_MS = 5_000

/** The part of ctx.securityGate the task needs. */
export interface OpencodeSecurityGate {
  validateToolCall(
    toolName: string,
    input: Record<string, unknown>,
    /**
     * `workingDirectories`: the task's folders (another conversation's
     * workspace is refused against them); `homeDir`: the EYAS-owned HOME the
     * sidecar runs under (`~`/`$HOME` are judged there too).
     */
    ctx?: { conversationId?: string; agentId?: string; workingDirectories?: readonly string[]; homeDir?: string },
  ): GateDecision | Promise<GateDecision>
  autonomyPolicy?: PermissionBridgeDeps['autonomy']
}

export interface DeveloperAgentDeps {
  getClient: () => Promise<OpencodeClient>
  /**
   * The recall service (ctx.memoryRecall), read per task: the memory module
   * may start after this one. Absent: the task runs without recalled memory.
   */
  getRecall?: () => MemoryRecall | undefined
  /**
   * memory.index.budgetChars: the recall block's size at the 100k baseline
   * window, scaled to the task model's window (recallBudgetForWindow).
   * Absent: the shipped default.
   */
  recallBudgetChars?: () => number | undefined
  /**
   * The privacy service (ctx.privacy), read per task: the privacy module may
   * start after this one. Absent: the privacy module is off, and the prompt
   * and memory go out unchanged — as a prompt does with no egress filter.
   */
  getPrivacy?: () => Pick<PrivacyService, 'redactToolOutput'> | undefined
  /** The EYAS security gate (ctx.securityGate). Absent: every permission is rejected. */
  getSecurityGate?: () => OpencodeSecurityGate | undefined
  /** The task folder (default: the shared CLI cwd resolver). */
  resolveCwd?: (input: DeveloperTaskInput) => string
  /**
   * The EYAS-owned OpenCode home (cliHome('opencode')) — the HOME its shell
   * and file tools run under (isolation.ts). Handed to the gate so `~` and
   * `$HOME` in a permission request are judged where they really point.
   */
  home?: string
  /**
   * The session bindings the memory routes read (memory-bridge.ts). Absent:
   * sessions are not bound, and OpenCode's memory tools read global memory only.
   */
  sessions?: Pick<OpencodeSessionBindings, 'bind' | 'unbind'>
  /**
   * The plugin key of the server the task runs on (OpencodeRunner.serveTokenId),
   * read after the server is up. null: an attached external server, which has
   * no EYAS memory tools.
   */
  getServeTokenId?: () => string | null
  /**
   * Records one event of a bound session (memory-bridge.ts
   * captureOpencodeToolEvent: completed tool parts, flag-gated). Absent: nothing is captured.
   */
  captureToolEvent?: (event: OpencodeEvent, binding: OpencodeSessionBinding) => void
  logger: Logger
  eventStreamWaitMs?: number
}

/** Session ids whose parent is one of ours (a subagent spawned by the task). */
const SessionInfoEventSchema = z.object({
  info: z.object({ id: z.string().min(1), parentID: z.string().optional() }),
})

/** The session a `message.part.updated` part belongs to. */
const PartSessionEventSchema = z.object({
  part: z.object({ sessionID: z.string().min(1) }),
})

/**
 * The task folder: the requested cwd (which must lie inside the conversation's
 * folders when it has any), else the first folder, else the conversation's
 * own workspace — through the one CLI cwd resolver, never the EYAS install
 * root.
 */
export function resolveTaskCwd(input: DeveloperTaskInput): string {
  const roots = (input.workingDirectories ?? []).filter((p) => typeof p === 'string' && p.trim().length > 0)
  const requested = input.cwd?.trim()
  if (requested && roots.length > 0 && !isUnderRoot(requested, roots)) {
    throw new Error('cwd is outside the conversation working directories')
  }
  return resolveCliCwd({
    metadata: {
      conversationId: input.conversationId,
      runId: input.runId,
      workingDirectories: requested ? [requested] : roots,
    },
  })
}

/** The task folder first, then the conversation's folders: absolute, de-duplicated. */
export function taskRoots(directory: string, workingDirectories: readonly string[] | undefined): string[] {
  const out: string[] = []
  for (const raw of [directory, ...(workingDirectories ?? [])]) {
    if (typeof raw !== 'string' || !raw.trim() || !isAbsolute(raw.trim())) continue
    const abs = resolve(raw.trim())
    if (!out.includes(abs)) out.push(abs)
  }
  return out
}

/** What a task sends to session.prompt: nothing (OpenCode's defaults), a model, or a model and one of its variants. */
interface ModelChoice {
  model?: OpencodeModelRef
  variant?: string
}

/** OpenCode's model list as one task read it: null when it was not needed, or `failed` when it could not be read. */
interface CatalogRead {
  catalog: OpencodeModelCatalog | null
  failed: boolean
  error?: unknown
}

function findModel(catalog: OpencodeModelCatalog, model: OpencodeModelRef) {
  return catalog.providers.find((p) => p.id === model.providerID)?.models.find((m) => m.id === model.modelID)
}

/**
 * The window of the model a task runs, as OpenCode's own model list gives
 * it. null when unknown: no model chosen (OpenCode then runs its own default,
 * which EYAS learns only from the reply), a model the list does not name or
 * gives no limit for, or no list.
 */
export function opencodeModelWindow(catalog: OpencodeModelCatalog | null, model: OpencodeModelRef | null | undefined): number | null {
  if (!catalog || !model) return null
  return findModel(catalog, model)?.contextWindow ?? null
}

/**
 * The recall block's cap for a task: memory.index.budgetChars (the size at
 * the 100k baseline window) scaled to the model's window by budgetForWindow,
 * exactly as the prompt assembler sizes the recall of every other model. An
 * unknown window counts as the baseline, as an unresolved delivery profile
 * does (prompt-wizard/delivery-profile.ts budgetWindowOf).
 */
export function recallBudgetForWindow(contextWindow: number | null, baselineChars: number | undefined): number {
  const budget = budgetForWindow(contextWindow ?? BASELINE_WINDOW, { memoryRecallChars: baselineChars })
  return tokensToChars(budget.memoryRecall)
}

export function createDeveloperAgent(deps: DeveloperAgentDeps) {
  const resolveCwd = deps.resolveCwd ?? resolveTaskCwd
  const streamWaitMs = deps.eventStreamWaitMs ?? EVENT_STREAM_WAIT_MS

  /**
   * OpenCode's model list, read at most once per task and only when
   * something needs it: a variant to check against the chosen model, or
   * recalled memory to size for that model's window. No model chosen needs
   * neither. The request carries nothing of the task.
   */
  async function readCatalog(oc: OpencodeClient, input: DeveloperTaskInput, sizeRecall: boolean): Promise<CatalogRead> {
    if (!input.model) return { catalog: null, failed: false }
    if (!input.variant?.trim() && !sizeRecall) return { catalog: null, failed: false }
    try {
      return { catalog: await oc.listProviders(), failed: false }
    } catch (error) {
      return { catalog: null, failed: true, error }
    }
  }

  /**
   * The model and variant to send. No model: nothing is sent and OpenCode
   * uses its own default (a variant alone means nothing). A variant is sent
   * only when OpenCode lists it for that model; otherwise — including when
   * the list cannot be read — it is dropped with a warning and the model runs
   * at its default, rather than EYAS reporting a variant that never applied.
   */
  function chooseModel(input: DeveloperTaskInput, read: CatalogRead): ModelChoice {
    const model = input.model ?? undefined
    if (!model) return {}
    const variant = input.variant?.trim()
    if (!variant) return { model }
    if (!read.catalog) {
      deps.logger.warn({ err: read.error, model, variant }, 'OpenCode task: model list unavailable — reasoning variant dropped, the model runs at its default')
      return { model }
    }
    const offered = findModel(read.catalog, model)?.variants.map((v) => v.id) ?? []
    if (!offered.includes(variant)) {
      deps.logger.warn({ model, variant, offered }, 'OpenCode task: the model does not offer this reasoning variant — dropped, the model runs at its default')
      return { model }
    }
    return { model, variant }
  }

  /**
   * The task's recalled memory: the fenced <eyas-memory> block for this
   * prompt in this conversation, or '' when there is none. `memoryTools`:
   * the session will be bound, so OpenCode's plugin offers memory_search /
   * memory_expand under those names and the block carries the same drill
   * hint as every other run's; without them (an attached external server)
   * it carries none and more of the best matches in full. `contextWindow`:
   * the window of the model OpenCode runs (null: unknown), which sizes the
   * block like every other model's. Never throws: a recall failure costs the
   * task its memory, not its run.
   */
  async function recallFor(
    recall: MemoryRecall | undefined,
    input: DeveloperTaskInput,
    memoryTools: boolean,
    contextWindow: number | null,
  ): Promise<string> {
    if (!recall) return ''
    try {
      const budgetChars = recallBudgetForWindow(contextWindow, deps.recallBudgetChars?.())
      // No room for the block is no recall, as in the prompt assembler.
      if (budgetChars <= 0) return ''
      const out = await recall({
        conversationId: input.conversationId,
        turnText: input.prompt,
        budgetChars,
        profile: { providerId: 'opencode', modelId: input.model?.modelID ?? null, toolAddressing: null, drillDown: memoryTools },
        turnId: generateId(),
        audience: 'owner',
      })
      return out?.content ?? ''
    } catch (err) {
      deps.logger.warn({ err, conversationId: input.conversationId }, 'OpenCode task: memory recall failed — running without it')
      return ''
    }
  }

  /**
   * The task prompt and the recalled memory as they leave EYAS: for the
   * OpenCode sidecar and on to whatever model it runs, which EYAS cannot see
   * — so the destination is remote and the one mask function applies, exactly
   * as to the same memory in any other model's prompt. A scan that throws
   * fails the task; nothing is sent unmasked.
   */
  function maskOutbound(input: DeveloperTaskInput, recalled: string): { prompt: string; system: string } {
    const privacy = deps.getPrivacy?.()
    if (!privacy) return { prompt: input.prompt, system: recalled }
    try {
      return privacy.redactToolOutput('opencode_run', { prompt: input.prompt, system: recalled }, {
        transport: 'opencode',
        conversationId: input.conversationId,
        runId: input.runId,
        agentId: input.agentId,
      }).value
    } catch (err) {
      deps.logger.error({ err, conversationId: input.conversationId }, 'OpenCode task: privacy scan failed — the task was not sent')
      throw new Error('privacy scan failed — the task was not sent to OpenCode')
    }
  }

  return {
    async run(input: DeveloperTaskInput): Promise<DeveloperTaskResult> {
      const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS
      let sessionId: string | null = null
      let client: OpencodeClient | null = null
      let binding: OpencodeSessionBinding | null = null
      let effective: OpencodeEffectiveModel | undefined
      try {
        const directory = resolveCwd(input)
        const server = await deps.getClient()
        // The server's plugin key, read once it runs: the session is bound to it.
        const tokenId = deps.sessions ? (deps.getServeTokenId?.() ?? null) : null
        client = server.forDirectory(directory)
        const oc = client
        const recall = deps.getRecall?.()
        // One read of OpenCode's model list: the variant is checked against
        // it and the recall is sized for the chosen model's window.
        const catalog = await readCatalog(oc, input, recall !== undefined)
        const choice = chooseModel(input, catalog)
        if (recall && catalog.failed) {
          deps.logger.warn({ err: catalog.error, model: choice.model }, 'OpenCode task: model list unavailable — recalled memory sized for the baseline window')
        }
        const window = opencodeModelWindow(catalog.catalog, choice.model)
        // Masked before anything of the task reaches the sidecar (the session title too).
        const outbound = maskOutbound(input, await recallFor(recall, input, tokenId !== null, window))
        effective = { model: choice.model ?? null, variant: choice.variant ?? null }
        const session = await oc.createSession({ title: outbound.prompt.slice(0, 80) })
        sessionId = session.id
        // In process only: what this session's memory calls act for.
        if (tokenId && deps.sessions) {
          binding = deps.sessions.bind(tokenId, session.id, {
            conversationId: input.conversationId,
            userId: input.userId,
            ...(input.turnId ? { turnId: input.turnId } : {}),
            ...(input.runId ? { runId: input.runId } : {}),
            ...(input.agentId ? { agentId: input.agentId } : {}),
            model: choice.model ? `${choice.model.providerID}/${choice.model.modelID}` : null,
          })
        }

        // ── Permission answering ──────────────────────────────────────────
        const gate = deps.getSecurityGate?.()
        // The opencode_run call that started this task already passed the
        // executor's gate and approval step (red tier, requiresApproval), so
        // each nested call is decided by the gate verdict, as for an attended
        // Claude Code turn; an escalation still queues an approval row.
        const bridge = gate
          ? createPermissionBridge({
              validateToolCall: gate.validateToolCall,
              autonomy: gate.autonomyPolicy,
              autonomous: false,
              ctx: {
                conversationId: input.conversationId,
                agentId: input.agentId,
                runId: input.runId,
                // The task's folders: the gate refuses another conversation's
                // workspace (and the workspaces root) against them.
                workingDirectories: taskRoots(directory, input.workingDirectories),
                ...(deps.home ? { homeDir: deps.home } : {}),
              },
              logger: deps.logger,
            })
          : null
        if (!bridge) deps.logger.warn({ sessionId }, 'OpenCode task: no security gate — every permission request is rejected (fail-closed)')

        const own = new Set<string>([session.id])
        const answered = new Set<string>()
        const replies: Promise<void>[] = []
        const signal = new AbortController()

        const answer = async (raw: unknown): Promise<void> => {
          const parsed = OpencodePermissionRequestSchema.safeParse(raw)
          if (!parsed.success) return
          const req = parsed.data
          if (!own.has(req.sessionID) || answered.has(req.id)) return
          answered.add(req.id)
          let reply: 'once' | 'reject' = 'reject'
          if (bridge) {
            try {
              const { name, input: gateInput } = mapOpencodePermission(req, directory)
              const verdict = await bridge(name, gateInput, { toolUseID: req.tool?.callID ?? req.id, signal: signal.signal })
              reply = verdict.behavior === 'allow' ? 'once' : 'reject'
            } catch (err) {
              deps.logger.warn({ err, permission: req.permission }, 'OpenCode task: permission check failed — rejected')
            }
          }
          try {
            await oc.replyPermission(req.sessionID, req.id, reply)
          } catch (err) {
            deps.logger.warn({ err, permission: req.permission, reply }, 'OpenCode task: permission reply failed')
          }
        }

        let markConnected: () => void = () => undefined
        const connected = new Promise<void>((resolve) => { markConnected = resolve })
        const sub = oc.subscribeEvents(signal.signal, (event: OpencodeEvent) => {
          markConnected()
          const props = event.properties ?? {}
          if (event.type === 'permission.asked') {
            replies.push(answer(props))
            return
          }
          if (event.type === 'session.created' || event.type === 'session.updated') {
            const info = SessionInfoEventSchema.safeParse(props)
            if (info.success && info.data.info.parentID && own.has(info.data.info.parentID)) own.add(info.data.info.id)
          }
          // A tool part of this task (or a subagent it spawned): recorded
          // like any run's tool output, when the owner opted in.
          if (event.type === 'message.part.updated' && binding && deps.captureToolEvent) {
            const part = PartSessionEventSchema.safeParse(props)
            if (part.success && own.has(part.data.part.sessionID)) {
              try {
                deps.captureToolEvent(event, binding)
              } catch (err) {
                deps.logger.debug({ err, sessionId }, 'OpenCode task: tool capture failed (ignored)')
              }
            }
          }
        })
        // A stream that cannot open means nobody answers the permission
        // requests, so the task would only hang: fail it instead.
        const streamFailed = sub.then(
          () => 'ended' as const,
          (err: unknown) => {
            if (signal.signal.aborted) return 'ended' as const
            throw err
          },
        )
        // A failure after the race below is already settled is not an error of
        // its own: the replies simply stop (the timeout aborts the session).
        streamFailed.catch(() => undefined)
        const waited = await Promise.race([
          connected.then(() => 'connected' as const),
          streamFailed,
          new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), streamWaitMs)),
        ])
        if (waited === 'timeout') deps.logger.warn({ sessionId }, 'OpenCode task: event stream sent nothing yet — continuing')

        const timer = setTimeout(() => {
          signal.abort()
          // An unanswered permission would otherwise keep the session waiting.
          oc.abort(session.id).catch(() => undefined)
        }, timeoutMs)
        let text = ''
        try {
          const result = await oc.prompt(session.id, {
            parts: [{ type: 'text', text: outbound.prompt }],
            ...(choice.model ? { model: choice.model } : {}),
            ...(choice.variant ? { variant: choice.variant } : {}),
            // Recalled memory rides as system text, never as a user-role
            // message the task would read as its own words.
            ...(outbound.system ? { system: outbound.system } : {}),
          })
          text = result.text
          // What actually ran, when OpenCode's reply names it (it also names
          // its own default model); otherwise what was sent.
          if (result.model) effective = { model: result.model, variant: result.variant ?? null }
        } finally {
          clearTimeout(timer)
          signal.abort()
          await sub.catch(() => undefined)
          await Promise.allSettled(replies)
        }

        // The summary and the diffs are the opencode_run result: the calling
        // run records them as that call's tool output, like any tool's.
        const diffs = await oc.diff(session.id).catch(() => [])
        return {
          ok: true,
          sessionId,
          summary: text || 'OpenCode finished with no text part.',
          diffs,
          effective,
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        deps.logger.warn({ err, sessionId }, 'OpenCode developer task failed')
        return { ok: false, sessionId, summary: '', diffs: [], ...(effective ? { effective } : {}), error: message }
      } finally {
        if (binding) deps.sessions?.unbind(binding.sessionId)
        // EYAS keeps the record; the OpenCode copy is not needed any more.
        if (client && sessionId) {
          await client.deleteSession(sessionId).catch((err: unknown) => {
            deps.logger.debug({ err, sessionId }, 'OpenCode session delete failed')
          })
        }
      }
    },
  }
}

export type DeveloperAgent = ReturnType<typeof createDeveloperAgent>

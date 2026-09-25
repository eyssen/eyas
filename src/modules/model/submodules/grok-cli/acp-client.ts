// Part of eYssen. See LICENSE file for full copyright and licensing details.

/**
 * Minimal Agent Client Protocol (ACP) client for the ACP CLIs — `grok agent
 * stdio` and `kimi acp`. The process is always launched through its profile
 * (acp-profiles.ts): EYAS-owned home, allowlisted env, managed config.
 *
 * Implements only the JSON-RPC methods EYAS needs over NDJSON stdio.
 * Intentionally does NOT depend on @agentclientprotocol/sdk (that package
 * pulls zod/v4, which conflicts with EYAS's zod 3 pin).
 *
 * Protocol reference: https://agentclientprotocol.com
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { createInterface } from 'node:readline'
import type { StopReason, StreamEvent } from '../../types.js'
import { normalizeStopReason } from '../../stop-reason.js'
import type { CliIsolationError, CliIsolationViolation } from '../../cli-runtime/isolation.js'
import { CliModelIdError } from '../../cli-model-id.js'
import {
  acpConfigValues,
  findAcpConfigOption,
  parseAcpConfigOptions,
  parseAcpSessionNew,
  parseAcpSessionUpdate,
  type AcpConfigOption,
  type AcpSessionModels,
} from './acp-events.js'
import {
  hasAcpImages,
  readAcpPromptCapabilities,
  stubAcpImages,
  type AcpContentBlock,
  type AcpPromptCapabilities,
} from './acp-prompt.js'
import { createAcpServerHandler, type AcpCanUseTool, type AcpMemoryPathCheck } from './acp-governance.js'
import type { NativeCapability } from '@modules/tools/cli-exposure.js'
import { createAcpToolStream, normalizeAcpUsage, type AcpBridgeOutcomes } from './acp-stream.js'
import { openSessionStoreRun, type AcpCliProfile } from './acp-profiles.js'
import { createAcpTripwire, createAcpVerifier, type AcpVerifier } from './acp-verify.js'
import { fenceSystemPrompt, type AcpSessionClosedInfo, type AcpSystemPromptChannel } from './acp-system-prompt.js'
import { createTurnWatchdog, type CliTurnTimeouts } from '../../cli-turn-watchdog.js'
import { cliOutputCapFor } from '../../cli-output-cap.js'

const PROTOCOL_VERSION = 1
/** How long a capped turn waits for the CLI to confirm the session/cancel. */
const CANCEL_GRACE_MS = 15_000
/** How long the runner waits for the CLI to exit before the session store is purged. */
const EXIT_GRACE_MS = 3_000
/** Which EYAS cap ended a turn early: the tool-call cap, or an isolated completion's output cap. */
type AcpCapStop = Extract<StopReason, 'max_turns' | 'max_tokens'>
/** The limit each cap stands for, as the refusal of a call the CLI asks about after it names it. */
const CAP_LIMIT: Readonly<Record<AcpCapStop, string>> = {
  max_turns: 'tool-call limit reached',
  max_tokens: 'output limit reached',
}

/** ACP session/new mcpServers entry (stdio transport). */
export interface AcpMcpServerConfig {
  name: string
  command: string
  args: string[]
  env?: Array<{ name: string; value: string }>
}

export interface GrokAcpRunOptions {
  /**
   * How the CLI is launched: the resolved executable, the argv, the
   * allowlisted env and the EYAS-owned home with its session store
   * (acp-profiles.ts). Shared by Grok and Kimi; there is no other way to
   * spawn one.
   */
  profile: AcpCliProfile
  /**
   * The provider's display name for user-facing error text ('Grok CLI',
   * 'Kimi Code CLI'). Default: the profile's provider id.
   */
  providerLabel?: string
  /** Session cwd (cli-runtime resolveCliCwd): never process.cwd(). */
  cwd: string
  /**
   * The folders the CLI's client-fs requests are jailed to (the conversation
   * folders that pass the folder check, and the cwd). Default [cwd].
   */
  roots?: readonly string[]
  /**
   * An isolated completion: EYAS answers every permission and fs request
   * with a refusal, the first tool call ends the turn (tool cap 0) and the
   * answer is bounded by maxTokens. The caller passes no MCP servers.
   */
  isolated?: boolean
  /**
   * The fail-closed checks around the session: preflight before the spawn,
   * the session/new check and the runtime tripwire. Default: the profile's
   * verifier (acp-verify.ts). There is no way to run without one.
   */
  verifier?: AcpVerifier
  /** Deterministic memory-path check for client-fs requests (default: the path policy). */
  checkMemoryPath?: AcpMemoryPathCheck
  model?: string
  /**
   * The whole turn as ACP content blocks, conversation history and images
   * included (acp-prompt.ts buildAcpPrompt): every run opens a fresh ACP
   * session (session/new) and EYAS never loads or resumes one. Images are
   * sent only when the CLI's initialize advertises image input; otherwise
   * each one becomes the shared text stub.
   */
  prompt: readonly AcpContentBlock[]
  /**
   * What the CLI's initialize said it accepts in a prompt, reported on every
   * run (true or false), so the model catalog's Vision flag follows the CLI.
   * An observer: a throw here never affects the turn.
   */
  onPromptCapabilities?: (caps: AcpPromptCapabilities) => void
  /** The EYAS system prompt of the turn; where it goes is systemPromptChannel. */
  systemPrompt?: string
  /**
   * How the system prompt reaches the model (acp-system-prompt.ts). Default
   * 'prompt': fenced, as the first text block of session/prompt — the
   * channel every CLI honours. 'meta' sends it as session/new
   * _meta.systemPromptOverride; 'meta+prompt' sends both.
   */
  systemPromptChannel?: AcpSystemPromptChannel
  /**
   * A line appended to the _meta override only, never to the fenced copy:
   * the marker the provider looks for in the CLI's session record.
   */
  systemPromptMarker?: string
  /**
   * Awaited once the session is over — after the CLI exited, before its
   * session store is purged — with the session id and whether the model
   * answered. Not called when no session was opened. Grok's system prompt
   * check reads the CLI's record here: the override appears in it only once
   * the first model request is built, so nothing before the prompt can prove
   * it. A throw is logged; the purge still runs.
   */
  onSessionClosed?: (info: AcpSessionClosedInfo) => void | Promise<void>
  /**
   * Tool-call cap for the turn. When the CLI starts one call more, EYAS
   * sends session/cancel and the turn ends with stopReason 'max_turns',
   * keeping the partial answer. Absent or <= 0: no cap.
   */
  maxTurns?: number
  /**
   * The request's maxTokens. Enforced only for an isolated completion
   * (cli-output-cap.ts): once the answer passes maxTokens × 4 characters,
   * EYAS sends session/cancel and the turn ends with stopReason
   * 'max_tokens', the answer clipped to the cap. A turn with tools ignores it.
   */
  maxTokens?: number
  signal?: AbortSignal
  /**
   * How long the CLI may go quiet (model.cli): idleMs while no tool call is
   * open, toolMs while one is. Every line the CLI sends starts the clock
   * over; there is no whole-turn limit. A turn that times out fails with a
   * TimeoutError ('timeout'). Default: the documented defaults
   * (cli-turn-watchdog.ts).
   */
  turnTimeouts?: Partial<CliTurnTimeouts>
  logger?: { debug?: (o: unknown, msg?: string) => void; warn?: (o: unknown, msg?: string) => void }
  /**
   * EYAS governance gate for ACP permission requests and fs servicing.
   * Absent = fail-closed (every permission/fs request is refused). A refusal
   * settles the call's tool row with its outcome (denied, waiting on a
   * human, skipped), and a call waiting on a human raises approval_required.
   */
  canUseTool?: AcpCanUseTool
  /**
   * What the CLI's own tools may do this turn (agent/tool-scope.ts
   * nativeCapabilitiesFor of the request's tool scope): a permission request
   * needing any other capability, and a client-fs write without 'write', are
   * refused before the gate is asked. Absent: every capability.
   */
  nativeCapabilities?: ReadonlySet<NativeCapability>
  /**
   * Refusals of EYAS tools the CLI called through the MCP bridge (the bridge
   * binding's onToolOutcome), carried into this turn: they settle the tool
   * row and raise approval_required the same way.
   */
  bridgeOutcomes?: AcpBridgeOutcomes
  /** ACP `plan` session updates (agent todo list) — fed to the orchestration tree. */
  onPlan?: (entries: Array<{ content?: string; status?: string }>) => void
  /**
   * EYAS tools exposed to the host CLI via MCP stdio children.
   * When omitted, session/new still sends `mcpServers: []` (protocol-required).
   */
  mcpServers?: AcpMcpServerConfig[]
  /**
   * Session config options to set (configId → value), each with
   * session/set_config_option after session/new and before session/prompt —
   * e.g. Grok's `reasoning_effort`. An option the session does not offer is
   * not sent; a value the CLI refuses leaves the session's own value. Either
   * way the turn runs, and the result's appliedConfig says what the session
   * really ran with.
   */
  sessionConfig?: Readonly<Record<string, string>>
  /**
   * The model the session runs, chosen inside the session for a CLI whose
   * argv takes none (Kimi: `kimi acp` ignores --model). Called once with the
   * session/new models state, after the session check passed and before any
   * config option or prompt; it returns the ACP model id to run, or undefined
   * to keep the session's own, and may throw CliModelIdError. The id is sent
   * with session/set_model (ACP, unstable) only when it differs from the
   * current one; a refusal ends the turn with CliModelIdError before the
   * prompt, so a pinned model never silently turns into another. The result's
   * resolvedModelId then names the selected id.
   */
  sessionModel?: (models: AcpSessionModels | null) => string | undefined
  /**
   * The kernel file sandbox of this turn (grok-cli/sandbox-profile.ts).
   * Called once the home is prepared and the preflight passed, right before
   * the spawn, with the resolved executable; its env is added to the spawn
   * only (never to the preflight's inspect run) and it is released when the
   * CLI has exited, however the turn ends. Absent: no sandbox.
   */
  prepareSandbox?: (ctx: { executable: string }) => AcpSpawnSandbox
}

/** A turn's kernel sandbox selection: spawn variables and their release. */
export interface AcpSpawnSandbox {
  readonly env: Readonly<Record<string, string>>
  release(): void
}

/** A session config id EYAS may set: a plain identifier. */
const CONFIG_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/
/** A session config value EYAS may send: short, printable, never flag-like. */
const CONFIG_VALUE_RE = /^[A-Za-z0-9][A-Za-z0-9._:/@+[\]-]{0,199}$/

/**
 * A session/set_model id EYAS may send: short, printable, never flag-like.
 * Unlike a config value it may carry a comma (Kimi's `<model key>,thinking`).
 */
const SESSION_MODEL_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:/@+[\],-]{0,199}$/

/** The option ids the runner reads the session's model from. */
const MODEL_OPTION = { id: 'model', category: 'model' } as const

/** The well-formed entries of a sessionConfig, in order; anything else is dropped. */
function sessionConfigEntries(config: Readonly<Record<string, string>> | undefined): Array<[string, string]> {
  if (!config) return []
  return Object.entries(config).filter(([id, value]) => CONFIG_ID_RE.test(id) && typeof value === 'string' && CONFIG_VALUE_RE.test(value))
}

/** The model a session runs, as it reports it: the model option, else the models state. */
function sessionModelOf(options: readonly AcpConfigOption[], models: AcpSessionModels | null): string | undefined {
  return findAcpConfigOption(options, MODEL_OPTION)?.currentValue ?? models?.currentModelId
}

/**
 * A `--model` the CLI does not offer is not an error to grok: the session
 * silently runs its default instead (grok 1.0.41 fixture
 * acp-config-options.json, modelFlag). Refused here, after session/new and
 * before any model request, so a pinned model never turns into another one.
 * When the CLI lists no models there is nothing to check against.
 */
function assertModelOffered(
  requested: string | undefined,
  options: readonly AcpConfigOption[],
  models: AcpSessionModels | null,
  label: string,
): void {
  if (!requested) return
  const option = findAcpConfigOption(options, MODEL_OPTION)
  const offered = option?.values.length ? option.values : models?.availableModels.map((m) => m.modelId) ?? []
  if (offered.length === 0 || offered.includes(requested)) return
  const running = sessionModelOf(options, models)
  throw new CliModelIdError(requested, `${label} does not offer it${running ? ` (the session would run ${running})` : ''}`)
}

/**
 * Leading text that a CLI reads as one of its own slash commands. grok
 * 1.0.40 runs a prompt starting with an ACP command locally, without the
 * model: "/always-approve on" switches the session to always-approve even
 * with the requirements.toml bypass lock (A1 spike, always-approve-lock
 * fixture). Invisible format characters are included, since a CLI may strip
 * them before it looks for the slash.
 */
const LEADING_COMMAND_RE = /^[\s\u200B-\u200D\u2060\uFEFF]*\//

/**
 * Make sure a prompt text can never be taken for a CLI slash command: a text
 * that starts with one (after whitespace) is wrapped in a neutral frame, so
 * the slash is no longer leading (non-leading command text has no effect —
 * the same fixture). Every text EYAS sends in session/prompt passes here.
 */
export function neutralizeAcpCommandText(text: string): string {
  return LEADING_COMMAND_RE.test(text) ? `<message>\n${text}\n</message>` : text
}

export interface GrokAcpRunResult {
  text: string
  /** Canonical: uncached prompt tokens (acp-stream.ts normalizeAcpUsage). */
  inputTokens: number
  /** Canonical: every generated token, reasoning included. */
  outputTokens: number
  cacheReadTokens?: number
  cacheCreationTokens?: number
  /** Informational: the part of outputTokens spent on reasoning. */
  reasoningTokens?: number
  /** false: the CLI reported no usage for this turn (e.g. a capped turn it did not confirm). */
  usageReported: boolean
  /**
   * 'max_turns' when EYAS's tool-call cap ended the turn; 'max_tokens' when
   * an isolated completion's output cap did (the text is then clipped to it).
   */
  stopReason: StopReason
  /**
   * The model the session ran, as the CLI reported it (its model option, else
   * its models state) — never the id EYAS asked for. Absent: not reported.
   */
  resolvedModelId?: string
  /**
   * Every session config option's value as the CLI last reported it
   * (session/new, each set_config_option answer, config_option_update): what
   * the session really ran with. Absent: the CLI reports no config options.
   */
  appliedConfig?: Record<string, string>
}

type JsonRpcId = number | string

interface Pending {
  resolve: (value: unknown) => void
  reject: (err: Error) => void
}

interface PromptResponse {
  stopReason?: string
  /** The ACP usage object; read tolerantly (acp-stream.ts normalizeAcpUsage). */
  usage?: unknown
  /** grok 1.0.40 reports the turn's usage here instead (A1 fixture session-prompt-result.json). */
  _meta?: { usage?: unknown }
}

/** The prompt race's marker for a session the tripwire stopped. */
const TRIPPED: unique symbol = Symbol('tripped')

/** session/update kinds only the model produces: seeing one means a model request was made. */
const MODEL_UPDATE_KINDS: ReadonlySet<string> = new Set([
  'agent_message_chunk',
  'agent_thought_chunk',
  'plan',
  'tool_call',
  'tool_call_update',
])

/** A timer promise that never keeps the process alive; `clear` settles nothing, it only stops the timer. */
function delay(ms: number): { promise: Promise<null>; clear: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined
  const promise = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms)
    timer.unref?.()
  })
  return { promise, clear: () => clearTimeout(timer) }
}

/**
 * Run one ACP prompt turn (Grok or Kimi, chosen by the profile), yielding
 * EYAS StreamEvents. The final return value carries the text and usage; the
 * provider wraps it into `done`. Every run is a fresh session (continuity is
 * EYAS replay only), and the CLI's session store in the EYAS home is purged
 * when the run ends, however it ends.
 */
export async function* runGrokAcpPrompt(opts: GrokAcpRunOptions): AsyncGenerator<StreamEvent, GrokAcpRunResult> {
  const { profile } = opts
  const providerId = profile.providerId
  // What error text calls the CLI: its display name, never another CLI's.
  const label = opts.providerLabel?.trim() || providerId
  // An isolated completion runs no tool at all: its first tool call ends the turn.
  const toolCap = opts.isolated
    ? 0
    : typeof opts.maxTurns === 'number' && opts.maxTurns > 0 ? Math.floor(opts.maxTurns) : undefined
  // An isolated completion's answer is bounded by its maxTokens (null otherwise).
  const outputCap = cliOutputCapFor({ isolated: opts.isolated, maxTokens: opts.maxTokens })
  const roots = opts.roots ?? [opts.cwd]
  const verifier = opts.verifier ?? createAcpVerifier(profile, { logger: opts.logger })

  // Resolve and prepare before anything runs: a missing binary or a tampered
  // EYAS home stops the turn here, and the managed files are current.
  const executable = await profile.resolveExecutable()
  profile.ensureHome()
  const args = profile.buildArgs({ model: opts.model })
  // The model the CLI was told to run on its argv (Grok). Kimi's argv carries
  // none: its model is chosen inside the session, so there is nothing to hold
  // the session to here.
  const modelFlag = args.indexOf('--model')
  const argvModel = opts.model && modelFlag >= 0 && args[modelFlag + 1] === opts.model ? opts.model : undefined
  // Fail closed before the spawn: a CLI that would load host config, MCP
  // servers, hooks or rules, or could approve its own tool calls, never runs.
  await verifier.preflight({ executable, cwd: opts.cwd, roots })

  // The kernel sandbox the CLI applies to itself at start (Grok's profile).
  const sandbox = opts.prepareSandbox?.({ executable })
  let proc: ChildProcess
  try {
    proc = spawn(executable, args, {
      cwd: opts.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      // The profile's allowlisted env — never a spread of the server's own —
      // plus this turn's sandbox selection.
      env: sandbox ? profile.env({ ...sandbox.env }) : profile.env(),
    })
  } catch (err) {
    sandbox?.release()
    throw err
  }
  const endSessionStoreRun = openSessionStoreRun(profile, opts.logger)
  const endStoreRun = (): void => {
    endSessionStoreRun()
    sandbox?.release()
  }

  let exitedFlag = false
  const exited = new Promise<void>((resolve) => {
    proc.once('exit', () => { exitedFlag = true; resolve() })
    // A failed spawn emits 'error' and never 'exit'.
    proc.once('error', () => { exitedFlag = true; resolve() })
  })
  let processError: Error | null = null

  if (!proc.stdin || !proc.stdout) {
    try { proc.kill() } catch { /* ignore */ }
    endStoreRun()
    throw new Error(`Failed to open stdio pipes for ${label} (${args.join(' ')})`)
  }
  // A write after the CLI died must not surface as an unhandled stream error.
  proc.stdin.on('error', () => { /* the exit handler reports the failure */ })

  proc.stderr?.on('data', (chunk: Buffer) => {
    opts.logger?.debug?.({ stderr: chunk.toString('utf8').slice(0, 500) }, `${providerId} ACP stderr`)
  })

  const abortController = new AbortController()
  const onAbort = () => abortController.abort()
  if (opts.signal) {
    if (opts.signal.aborted) abortController.abort()
    else opts.signal.addEventListener('abort', onAbort, { once: true })
  }
  // The turn watchdog: the CLI is stopped only when it goes quiet — past
  // idleMs with no tool call open, past toolMs while one is — never after a
  // fixed whole-turn time. Its TimeoutError is what the turn then fails with.
  const watchdog = createTurnWatchdog({
    ...opts.turnTimeouts,
    label,
    abort: (reason) => abortController.abort(reason),
  })

  type QueueItem =
    | { kind: 'event'; event: StreamEvent }
    | { kind: 'end'; result: GrokAcpRunResult }
    | { kind: 'error'; error: Error }

  const queue: QueueItem[] = []
  let wake: (() => void) | null = null
  let closed = false
  const notifyWaiters = () => {
    const w = wake
    wake = null
    if (w) w()
  }
  const push = (item: QueueItem) => {
    if (closed) return
    queue.push(item)
    notifyWaiters()
  }
  const wait = () =>
    new Promise<void>((resolve) => {
      if (queue.length > 0 || closed) resolve()
      else wake = resolve
    })

  let fullText = ''
  let inputTokens = 0
  let outputTokens = 0
  let cacheTokens: Pick<GrokAcpRunResult, 'cacheReadTokens' | 'cacheCreationTokens' | 'reasoningTokens'> = {}
  let usageReported = false
  let stopReason: StopReason = 'end'
  let nextId = 1
  // The session's config options as the CLI last reported them, and its models state.
  let configOptions: AcpConfigOption[] = []
  let sessionModels: AcpSessionModels | null = null
  const configResult = (): Pick<GrokAcpRunResult, 'resolvedModelId' | 'appliedConfig'> => {
    const resolved = sessionModelOf(configOptions, sessionModels)
    return {
      ...(resolved ? { resolvedModelId: resolved } : {}),
      ...(configOptions.length > 0 ? { appliedConfig: acpConfigValues(configOptions) } : {}),
    }
  }
  // Tool rows, their outcomes and approvals (acp-stream.ts).
  const tools = createAcpToolStream()
  const emit = (events: readonly StreamEvent[]) => {
    for (const event of events) {
      // An open tool row puts the watchdog on the tool budget until it settles.
      watchdog.observe(event)
      push({ kind: 'event', event })
    }
  }
  const pending = new Map<JsonRpcId, Pending>()

  const killProc = () => {
    try {
      if (!proc.killed) proc.kill('SIGTERM')
    } catch { /* ignore */ }
  }
  abortController.signal.addEventListener('abort', killProc, { once: true })

  const failPending = (err: Error) => {
    for (const [, p] of pending) p.reject(err)
    pending.clear()
  }
  proc.on('error', (err) => {
    processError = err
    failPending(err)
  })
  proc.once('exit', (code, signal) => {
    // Nothing answers the requests still in flight once the CLI is gone.
    failPending(new Error(`${label} exited (${signal ?? `code ${code}`})`))
  })

  const write = (msg: Record<string, unknown>) => {
    if (!proc.stdin || proc.stdin.destroyed) return
    proc.stdin.write(JSON.stringify(msg) + '\n')
  }

  const request = <T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> => {
    const id = nextId++
    return new Promise<T>((resolve, reject) => {
      if (abortController.signal.aborted) {
        reject(new Error('aborted'))
        return
      }
      if (exitedFlag) {
        reject(processError ?? new Error(`${label} is not running`))
        return
      }
      pending.set(id, {
        resolve: (v) => resolve(v as T),
        reject,
      })
      write({ jsonrpc: '2.0', id, method, params: params ?? {} })
    })
  }

  const respond = (id: JsonRpcId, result: unknown) => {
    write({ jsonrpc: '2.0', id, result })
  }

  const respondError = (id: JsonRpcId, message: string) => {
    write({ jsonrpc: '2.0', id, error: { code: -32000, message } })
  }

  // ── Caps: tool calls, and an isolated completion's output ────────────
  // Both caps are enforced here, as data: neither the CLI's own turn limit
  // nor its output limit is reachable over ACP (an undocumented
  // _meta.maxTurns was ignored). Every distinct tool call counts — main
  // session and subagents alike, whether it first shows up as a tool_call or
  // as a permission request — and one call more than the cap ends the turn
  // with 'max_turns'. An answer longer than an isolated completion's
  // maxTokens × 4 characters ends it with 'max_tokens'. Either way the
  // session is cancelled and the partial answer kept.
  let sessionId: string | null = null
  /** The model produced something this turn (onSessionClosed's modelAnswered). */
  let modelAnswered = false
  const seenToolCalls = new Set<string>()
  const droppedToolCalls = new Set<string>()
  /** The cap that ended the turn, if one did. */
  let capped: AcpCapStop | null = null
  let onCapped: () => void = () => {}
  const capReached = new Promise<void>((resolve) => { onCapped = resolve })
  const capTurn = (stop: AcpCapStop) => {
    if (capped) return
    capped = stop
    opts.logger?.debug?.(
      { provider: providerId, stop, cap: stop === 'max_turns' ? toolCap : outputCap?.limitChars },
      `acp: ${CAP_LIMIT[stop]} — cancelling the session`,
    )
    if (sessionId) write({ jsonrpc: '2.0', method: 'session/cancel', params: { sessionId } })
    onCapped()
  }
  /** Why a call the CLI asked about after a cap did not run. */
  const capReason = (): string => `turn ended: ${CAP_LIMIT[capped ?? 'max_turns']}`
  const noteToolCall = (toolCallId: unknown) => {
    if (typeof toolCallId !== 'string' || !toolCallId || seenToolCalls.has(toolCallId)) return
    seenToolCalls.add(toolCallId)
    if (toolCap !== undefined && seenToolCalls.size > toolCap) capTurn('max_turns')
  }

  // ── Tripwire ─────────────────────────────────
  // A governed native tool call that starts or finishes without one of
  // EYAS's decisions means the CLI is approving on its own (a flipped
  // always-approve, an unasked tool). The session is cancelled and the turn
  // ends with CliIsolationError; nothing the CLI says after it is used.
  const tripwire = createAcpTripwire(verifier.tripwirePolicy)
  let tripped: CliIsolationError | null = null
  let onTripped: () => void = () => {}
  const tripReached = new Promise<void>((resolve) => { onTripped = resolve })
  const trip = (violations: CliIsolationViolation[]) => {
    if (tripped || violations.length === 0) return
    tripped = verifier.fail(violations)
    if (sessionId) write({ jsonrpc: '2.0', method: 'session/cancel', params: { sessionId } })
    onTripped()
  }

  // A permission decision that lands after the turn was cancelled is
  // answered 'cancelled', whatever the gate said (ACP: every pending
  // request_permission of a cancelled turn gets the cancelled outcome).
  // JSON-RPC id of a pending permission request → the call it is about.
  const permissionIds = new Map<JsonRpcId, string | undefined>()
  const respondGoverned = (id: JsonRpcId, result: unknown) => {
    const wasPermission = permissionIds.has(id)
    const toolCallId = permissionIds.get(id)
    permissionIds.delete(id)
    const cancelled = (capped || tripped) && wasPermission
    // Cancelled by a cap: the call never runs, whatever the gate said.
    if (cancelled && !tripped && toolCallId) emit(tools.refuse({ toolCallId, outcome: 'skipped', reason: capReason() }))
    respond(id, cancelled ? { outcome: { outcome: 'cancelled' } } : result)
  }

  // Permission + fs server requests carry authority — governed, fail-closed.
  const handleServerRequest = createAcpServerHandler({
    canUseTool: opts.canUseTool,
    respond: respondGoverned,
    respondError,
    logger: opts.logger,
    roots,
    isolated: opts.isolated,
    checkMemoryPath: opts.checkMemoryPath,
    pathsForToolCall: (toolCallId) => tripwire.pathsOf(toolCallId),
    nativeCapabilities: opts.nativeCapabilities,
    describeToolCall: (toolCallId) => tripwire.describe(toolCallId),
    onDecision: (info) => {
      if (info.toolCallId) tripwire.noteDecision(info.toolCallId)
      // A refusal settles the call's row with its outcome when the CLI
      // reports it; a call waiting on a human is shown as such at once.
      if (info.behavior !== 'allow' && !tripped) {
        emit(tools.refuse({
          ...(info.toolCallId ? { toolCallId: info.toolCallId } : {}),
          outcome: info.outcome ?? 'denied',
          reason: info.reason ?? 'refused by EYAS',
          ...(info.approvalId !== undefined ? { approvalId: info.approvalId } : {}),
          ...(info.toolName ? { toolName: info.toolName } : {}),
        }))
      }
    },
    onFsServed: (path) => tripwire.noteFsServed(path),
  })

  const handleSessionUpdate = (params: unknown) => {
    const update = (params as { update?: { sessionUpdate?: unknown; toolCallId?: unknown } } | null)?.update
    if (MODEL_UPDATE_KINDS.has(String(update?.sessionUpdate))) modelAnswered = true
    if (tripped) return
    // Everything below reads the validated form of the update (acp-events.ts):
    // the tripwire first, then the stream mapping.
    const parsed = parseAcpSessionUpdate(params)
    if (parsed.ok) {
      trip(tripwire.observe(parsed.event))
      if (tripped) return
    }
    // The cap counts every tool call the CLI starts, a malformed one included.
    if (update?.sessionUpdate === 'tool_call') noteToolCall(update.toolCallId)
    if (!parsed.ok) {
      opts.logger?.debug?.({ provider: providerId, error: parsed.error }, 'acp: malformed session/update ignored')
      return
    }
    const event = parsed.event

    switch (event.kind) {
      case 'agent_message_chunk': {
        if (!event.text) return
        // An isolated completion keeps only the answer that fits its output
        // cap; the chunk that passes it is cut there and ends the turn.
        const text = outputCap ? outputCap.take(event.text) : event.text
        if (text) {
          fullText += text
          emit([{ type: 'text', text }])
        }
        if (outputCap?.reached) capTurn('max_tokens')
        return
      }
      case 'agent_thought_chunk':
        // Nothing the model says after the output cap is part of the turn.
        if (event.text && capped !== 'max_tokens') emit([{ type: 'thinking', text: event.text }])
        return
      case 'plan':
        opts.onPlan?.(event.entries)
        return
      case 'tool_call':
        if (capped) {
          // A call past the cap never becomes a tool row: it does not run.
          droppedToolCalls.add(event.toolCallId)
          return
        }
        emit(tools.update(event))
        return
      case 'tool_call_update':
        if (droppedToolCalls.has(event.toolCallId)) return
        emit(tools.update(event))
        return
      case 'config_option_update':
        // The CLI changed an option (a set, or on its own): the complete list.
        configOptions = event.configOptions
        return
      default:
        return
    }
  }

  const handleIncoming = async (raw: string) => {
    let msg: any
    try {
      msg = JSON.parse(raw)
    } catch {
      return
    }

    // Response to our request
    if (msg.id != null && (msg.result !== undefined || msg.error !== undefined) && !msg.method) {
      const p = pending.get(msg.id)
      if (!p) return
      pending.delete(msg.id)
      if (msg.error) {
        p.reject(new Error(msg.error.message ?? JSON.stringify(msg.error)))
      } else {
        p.resolve(msg.result)
      }
      return
    }

    // Server request or notification
    const method = msg.method as string | undefined
    if (!method) return

    if (method === 'session/update') {
      handleSessionUpdate(msg.params ?? {})
      return
    }

    if (method === 'session/request_permission') {
      modelAnswered = true
      const toolCallId = msg.params?.toolCall?.toolCallId
      noteToolCall(toolCallId)
      const callId = typeof toolCallId === 'string' && toolCallId ? toolCallId : undefined
      if (capped || tripped) {
        // Answered by EYAS (cancelled): a decision, for the tripwire too.
        if (callId) {
          tripwire.noteDecision(callId)
          if (!tripped) emit(tools.refuse({ toolCallId: callId, outcome: 'skipped', reason: capReason() }))
        }
        if (msg.id != null) respond(msg.id, { outcome: { outcome: 'cancelled' } })
        return
      }
      if (msg.id != null) permissionIds.set(msg.id, callId)
    } else if ((capped || tripped) && (method === 'fs/read_text_file' || method === 'fs/write_text_file')) {
      if (msg.id != null) respondError(msg.id, tripped ? 'turn cancelled: isolation check failed' : `turn cancelled: ${CAP_LIMIT[capped ?? 'max_turns']}`)
      return
    }

    if (await handleServerRequest(method, msg.id ?? null, msg.params)) return

    // Unknown server request — reject so the agent doesn't hang
    if (msg.id != null) {
      respondError(msg.id, `Unsupported method: ${method}`)
    }
  }

  const rl = createInterface({ input: proc.stdout })
  rl.on('line', (line) => {
    // Every line the CLI sends (an update, an answer, a request) is activity.
    watchdog.touch()
    void handleIncoming(line)
  })

  // Set inside a callback; typed via `as` so the finally below is not narrowed to null.
  let cancelGrace = null as { promise: Promise<null>; clear: () => void } | null

  // EYAS tools the bridge refused during this turn settle their rows here too.
  const stopBridgeOutcomes = opts.bridgeOutcomes?.subscribe((outcome) => {
    if (!tripped) emit(tools.bridgeOutcome(outcome))
  })

  const runPromise = (async () => {
    try {
      if (abortController.signal.aborted) throw new Error('aborted')

      const initialized = await request('initialize', {
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: {
          fs: { readTextFile: true, writeTextFile: true },
        },
        clientInfo: { name: 'EYAS', version: '1.0.0' },
      })
      // Images go to the model only when the CLI says it takes them; the
      // report keeps the catalog's Vision flag in step with the CLI.
      const promptCaps = readAcpPromptCapabilities(initialized)
      try {
        opts.onPromptCapabilities?.(promptCaps)
      } catch (err) {
        opts.logger?.warn?.({ provider: providerId, err: String(err) }, 'acp: prompt-capability observer failed')
      }

      // Some agents expect an explicit initialized notification.
      write({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} })

      // Always a fresh session. EYAS never sends session/load: the prompt
      // carries the whole conversation from EYAS's own store, so a CLI-side
      // session store is never a source of context.
      // Grok CLI ≥0.2.x requires `mcpServers` on session/new (JSON-RPC -32602
      // "Invalid params" / "missing field mcpServers" if omitted). Empty list
      // is valid; when tool bridge is wired we pass the eyas stdio MCP server.
      const newParams: Record<string, unknown> = {
        cwd: opts.cwd,
        mcpServers: opts.mcpServers ?? [],
      }
      // The system prompt: as the override ('meta'), fenced in the prompt
      // ('prompt', the default every CLI honours), or both.
      const system = opts.systemPrompt?.trim() ? opts.systemPrompt : undefined
      const channel: AcpSystemPromptChannel = opts.systemPromptChannel ?? 'prompt'
      if (system && channel !== 'prompt') {
        newParams._meta = {
          systemPromptOverride: opts.systemPromptMarker ? `${system}\n\n${opts.systemPromptMarker}` : system,
        }
      }
      const created = await request<{ sessionId?: unknown }>('session/new', newParams)
      if (typeof created?.sessionId !== 'string' || !created.sessionId) {
        throw new Error(`${label}: session/new returned no session id`)
      }
      sessionId = created.sessionId
      // The mode the session starts in must be one that asks.
      verifier.checkSessionNew(created)

      // What the session runs: its model and config options, read back.
      const opened = parseAcpSessionNew(created)
      configOptions = opened.configOptions
      sessionModels = opened.models
      assertModelOffered(argvModel, configOptions, sessionModels, label)

      // The model chosen in-session (Kimi), before the options that depend on
      // it. Sent only after the session check above passed, so it only ever
      // reaches a CLI running in its verified EYAS home.
      if (opts.sessionModel) {
        const wanted = opts.sessionModel(sessionModels)
        if (wanted !== undefined && wanted !== sessionModelOf(configOptions, sessionModels)) {
          if (!SESSION_MODEL_ID_RE.test(wanted)) throw new CliModelIdError(wanted, 'not a valid model name')
          try {
            await request('session/set_model', { sessionId, modelId: wanted })
          } catch (err) {
            if (abortController.signal.aborted || tripped || exitedFlag) throw err
            throw new CliModelIdError(wanted, `${label} refused to switch to it (${err instanceof Error ? err.message : String(err)})`.slice(0, 500))
          }
          // The switch is the session's model from now on (Kimi answers it
          // with an empty result and no update).
          sessionModels = { availableModels: sessionModels?.availableModels ?? [], currentModelId: wanted }
        }
      }

      // Session options (Grok's reasoning effort) before the prompt: each
      // answer is the complete, updated option list.
      for (const [configId, value] of sessionConfigEntries(opts.sessionConfig)) {
        if (!findAcpConfigOption(configOptions, { id: configId })) {
          opts.logger?.debug?.({ provider: providerId, configId }, 'acp: the session offers no such config option — not set')
          continue
        }
        try {
          const updated = await request<{ configOptions?: unknown }>('session/set_config_option', { sessionId, configId, value })
          const next = parseAcpConfigOptions(updated?.configOptions)
          if (next) configOptions = next
        } catch (err) {
          if (abortController.signal.aborted || tripped || exitedFlag) throw err
          opts.logger?.warn?.({ provider: providerId, configId, value, err: err instanceof Error ? err.message : String(err) },
            'acp: the CLI refused a session config value — the session keeps its own')
        }
      }

      if (!promptCaps.image && hasAcpImages(opts.prompt)) {
        opts.logger?.debug?.({ provider: providerId }, 'acp: the CLI takes no image input — images sent as text stubs')
      }
      const conversation = promptCaps.image ? opts.prompt : stubAcpImages(opts.prompt)
      // The fenced system prompt is the first text block, on its own.
      const blocks: readonly AcpContentBlock[] = system && channel !== 'meta'
        ? [{ type: 'text', text: fenceSystemPrompt(system) }, ...conversation]
        : conversation
      const prompt = request<PromptResponse>('session/prompt', {
        sessionId,
        // Every text block passes the slash-command check, not only the first.
        prompt: blocks.map((b) =>
          b.type === 'text'
            ? { type: 'text', text: neutralizeAcpCommandText(b.text) }
            : { type: 'image', mimeType: b.mimeType, data: b.data }),
      })
      // Observed below; a capped turn may stop waiting for it.
      prompt.catch(() => {})

      let response: PromptResponse | null
      try {
        const settled = await Promise.race([
          prompt,
          capReached.then(() => {
            cancelGrace = delay(CANCEL_GRACE_MS)
            return Promise.race([prompt, cancelGrace.promise])
          }),
          tripReached.then((): typeof TRIPPED => TRIPPED),
        ])
        if (tripped) throw tripped
        response = settled === TRIPPED ? null : settled
      } catch (err) {
        // A tripped session ends as an isolation failure, whatever the CLI
        // answered after the cancel.
        if (tripped) throw tripped
        // After the cap the CLI may answer the cancelled prompt with an
        // error, or die; the turn still ends as a capped turn.
        if (!capped || opts.signal?.aborted) throw err
        response = null
      }

      // Canonical counts (uncached input, reasoning inside output); a
      // response without usage leaves the turn marked unreported.
      const usage = normalizeAcpUsage(response?.usage) ?? normalizeAcpUsage(response?._meta?.usage)
      if (usage) {
        usageReported = true
        const { inputTokens: inTokens, outputTokens: outTokens, ...cache } = usage
        inputTokens = inTokens
        outputTokens = outTokens
        cacheTokens = cache
        if (inputTokens > 0 || outputTokens > 0) modelAnswered = true
      }
      // A turn a cap ended ends on that cap, whatever the CLI answered to the cancel.
      stopReason = capped ?? normalizeStopReason('acp', response?.stopReason)

      // Calls EYAS refused that the CLI never settled did not run: their rows
      // close with the refusal before the turn ends.
      emit(tools.finish())
      push({
        kind: 'end',
        result: {
          text: fullText,
          inputTokens,
          outputTokens,
          ...cacheTokens,
          usageReported,
          stopReason,
          ...configResult(),
        },
      })
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      if (tripped) {
        push({ kind: 'error', error: tripped })
      } else if (abortController.signal.aborted) {
        // Stopped by the watchdog: its TimeoutError ('timeout'), not an abort.
        push({ kind: 'error', error: watchdog.errorFor(new Error(`${label} ACP request aborted`)) })
      } else {
        push({ kind: 'error', error })
      }
    } finally {
      cancelGrace?.clear()
      closed = true
      notifyWaiters()
      failPending(new Error('ACP connection closed'))
      try { rl.close() } catch { /* ignore */ }
      try { proc.stdin?.end() } catch { /* ignore */ }
      killProc()
    }
  })()

  try {
    while (true) {
      if (queue.length === 0) await wait()
      const item = queue.shift()
      if (!item) {
        if (closed) break
        continue
      }
      if (item.kind === 'event') {
        yield item.event
      } else if (item.kind === 'error') {
        yield { type: 'error', error: item.error }
        throw item.error
      } else {
        return item.result
      }
    }
    return {
      text: fullText,
      inputTokens,
      outputTokens,
      ...cacheTokens,
      usageReported,
      stopReason,
      ...configResult(),
    }
  } finally {
    stopBridgeOutcomes?.()
    watchdog.dispose()
    opts.signal?.removeEventListener('abort', onAbort)
    closed = true
    killProc()
    await runPromise.catch(() => {})
    // Let the CLI finish writing before its session store is removed, so
    // nothing it flushes on the way out survives the purge.
    if (!exitedFlag) {
      const grace = delay(EXIT_GRACE_MS)
      await Promise.race([exited, grace.promise])
      grace.clear()
      if (!exitedFlag) {
        try { proc.kill('SIGKILL') } catch { /* ignore */ }
        const last = delay(EXIT_GRACE_MS)
        await Promise.race([exited, last.promise])
        last.clear()
      }
    }
    // The CLI's record of the session is complete now and still on disk:
    // the last moment to read it (Grok's system prompt check).
    if (sessionId && opts.onSessionClosed) {
      try {
        await opts.onSessionClosed({ sessionId, modelAnswered })
      } catch (err) {
        opts.logger?.warn?.({ provider: providerId, err: String(err) }, 'acp: session-closed observer failed')
      }
    }
    endStoreRun()
  }
}

// ─── Model discovery probe ─────────────────────

/** How long a whole discovery probe may take (spawn, session/new, every model switch). */
const PROBE_TIMEOUT_MS = 60_000
/** At most this many models are switched to; a longer list is cut, never trusted whole. */
const PROBE_MAX_MODELS = 64

export interface AcpProbeOptions {
  /** The provider's launch profile: the same executable, env and EYAS home as every turn. */
  profile: AcpCliProfile
  /** Display name for error text ('Grok CLI'). Default: the provider id. */
  providerLabel?: string
  /** The session cwd: an empty EYAS scratch folder, never process.cwd(). */
  cwd: string
  /** The fail-closed checks (preflight, session/new). Default: the profile's verifier. */
  verifier?: AcpVerifier
  /**
   * 'model': switch the probe session to every model it offers
   * (session/set_config_option model) and read each one's options back;
   * 'none': session/new only.
   */
  enumerate: 'model' | 'none'
  timeoutMs?: number
  logger?: GrokAcpRunOptions['logger']
}

export interface AcpProbeModel {
  modelId: string
  name?: string
  /** Context window the CLI reports for the model. */
  contextTokens?: number
  /** The model's default effort, when the CLI's models state names one. */
  defaultEffort?: string
  /**
   * The session's config options with this model selected; null when the
   * model could not be selected (its options are then unknown, not empty).
   */
  configOptions: AcpConfigOption[] | null
}

export interface AcpProbeResult {
  /** The CLI's version from initialize (agentInfo.version, else Grok's _meta.agentVersion). */
  cliVersion: string | null
  /** The model a fresh session runs: the CLI's own default. */
  defaultModelId: string | null
  /** Every model the session offers, in the CLI's order. */
  models: AcpProbeModel[]
}

/** The CLI's version as initialize reports it; null when it names none. */
function agentVersionOf(initialized: unknown): string | null {
  const result = initialized as { agentInfo?: { version?: unknown } | null; _meta?: { agentVersion?: unknown } | null } | null
  const version = result?.agentInfo?.version ?? result?._meta?.agentVersion
  return typeof version === 'string' && /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/.test(version) ? version : null
}

/**
 * Discover what an ACP CLI offers, without a model call and without sending a
 * prompt: initialize, session/new (no MCP servers), then — for 'model' — each
 * model the session offers is selected with session/set_config_option and its
 * options (Grok's reasoning_effort with its values) are read back; the
 * process is then ended. It runs through the provider's launch profile and
 * passes the same fail-closed checks as a turn (preflight before the spawn,
 * the session/new check), and the CLI's session store is purged afterwards.
 * Every request the CLI makes of EYAS (permissions, files) is refused: a
 * probe runs nothing. Throws when the CLI cannot be run, fails a check or
 * opens no session — a failed probe is never "no models".
 */
export async function runAcpProbe(opts: AcpProbeOptions): Promise<AcpProbeResult> {
  const { profile } = opts
  const providerId = profile.providerId
  const label = opts.providerLabel?.trim() || providerId
  const verifier = opts.verifier ?? createAcpVerifier(profile, { logger: opts.logger })

  const executable = await profile.resolveExecutable()
  profile.ensureHome()
  // The same gate as a turn: a CLI that would load host config, MCP servers
  // or hooks, or approve on its own, is never started — not even to list models.
  await verifier.preflight({ executable, cwd: opts.cwd, roots: [opts.cwd] })

  const proc: ChildProcess = spawn(executable, profile.buildArgs({}), {
    cwd: opts.cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: profile.env(),
  })
  const endStoreRun = openSessionStoreRun(profile, opts.logger)

  let exitedFlag = false
  const exited = new Promise<void>((resolve) => {
    proc.once('exit', () => { exitedFlag = true; resolve() })
    proc.once('error', () => { exitedFlag = true; resolve() })
  })
  let failure: Error | null = null
  let nextId = 1
  const pending = new Map<JsonRpcId, Pending>()
  const failAll = (err: Error): void => {
    failure ??= err
    for (const [, p] of pending) p.reject(err)
    pending.clear()
  }
  proc.on('error', (err) => failAll(err))
  proc.once('exit', (code, signal) => failAll(new Error(`${label} exited (${signal ?? `code ${code}`})`)))
  proc.stdin?.on('error', () => { /* the exit handler reports it */ })
  proc.stderr?.on('data', (chunk: Buffer) => {
    opts.logger?.debug?.({ stderr: chunk.toString('utf8').slice(0, 500) }, `${providerId} ACP probe stderr`)
  })

  const write = (msg: Record<string, unknown>): void => {
    if (!proc.stdin || proc.stdin.destroyed) return
    proc.stdin.write(JSON.stringify(msg) + '\n')
  }
  const request = <T = unknown>(method: string, params: Record<string, unknown>): Promise<T> => {
    const id = nextId++
    return new Promise<T>((resolve, reject) => {
      if (failure || exitedFlag) {
        reject(failure ?? new Error(`${label} is not running`))
        return
      }
      pending.set(id, { resolve: (v) => resolve(v as T), reject })
      write({ jsonrpc: '2.0', id, method, params })
    })
  }

  const rl = proc.stdout ? createInterface({ input: proc.stdout }) : null
  rl?.on('line', (line) => {
    let msg: any
    try {
      msg = JSON.parse(line)
    } catch {
      return
    }
    if (msg?.id != null && !msg.method && (msg.result !== undefined || msg.error !== undefined)) {
      const p = pending.get(msg.id)
      if (!p) return
      pending.delete(msg.id)
      if (msg.error) p.reject(new Error(String(msg.error.data ?? msg.error.message ?? 'request failed').slice(0, 300)))
      else p.resolve(msg.result)
      return
    }
    // A probe runs nothing: every request the CLI makes of EYAS is refused.
    if (msg?.id != null && typeof msg.method === 'string') {
      if (msg.method === 'session/request_permission') write({ jsonrpc: '2.0', id: msg.id, result: { outcome: { outcome: 'cancelled' } } })
      else write({ jsonrpc: '2.0', id: msg.id, error: { code: -32000, message: 'EYAS model discovery runs no tools' } })
    }
  })

  const timeout = setTimeout(() => {
    failAll(new Error(`${label}: model discovery timed out`))
    try { proc.kill('SIGTERM') } catch { /* ignore */ }
  }, opts.timeoutMs ?? PROBE_TIMEOUT_MS)
  timeout.unref?.()

  try {
    if (!proc.stdin || !proc.stdout) throw new Error(`Failed to open stdio pipes for ${label}`)
    const initialized = await request('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } },
      clientInfo: { name: 'EYAS', version: '1.0.0' },
    })
    write({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} })

    const created = await request('session/new', { cwd: opts.cwd, mcpServers: [] })
    const opened = parseAcpSessionNew(created)
    if (!opened.sessionId) throw new Error(`${label}: session/new returned no session id`)
    verifier.checkSessionNew(created)

    const modelOption = findAcpConfigOption(opened.configOptions, MODEL_OPTION)
    const listed = opened.models?.availableModels ?? []
    const ids = (modelOption?.values.length ? modelOption.values : listed.map((m) => m.modelId)).slice(0, PROBE_MAX_MODELS)
    const defaultModelId = sessionModelOf(opened.configOptions, opened.models) ?? null

    const models: AcpProbeModel[] = []
    for (const modelId of ids) {
      const hints = listed.find((m) => m.modelId === modelId)
      let options: AcpConfigOption[] | null = null
      if (modelId === defaultModelId) {
        options = opened.configOptions
      } else if (opts.enumerate === 'model' && modelOption) {
        try {
          const updated = await request<{ configOptions?: unknown }>('session/set_config_option', {
            sessionId: opened.sessionId,
            configId: modelOption.id,
            value: modelId,
          })
          const next = parseAcpConfigOptions(updated?.configOptions)
          // Only a session that really switched says anything about this model.
          options = next && findAcpConfigOption(next, MODEL_OPTION)?.currentValue === modelId ? next : null
        } catch (err) {
          if (failure) throw err
          opts.logger?.debug?.({ provider: providerId, modelId, err: err instanceof Error ? err.message : String(err) }, 'acp probe: model could not be selected')
        }
      }
      models.push({
        modelId,
        ...(hints?.name ? { name: hints.name } : {}),
        ...(hints?.contextTokens ? { contextTokens: hints.contextTokens } : {}),
        ...(hints?.defaultEffort ? { defaultEffort: hints.defaultEffort } : {}),
        configOptions: options,
      })
    }
    return { cliVersion: agentVersionOf(initialized), defaultModelId, models }
  } finally {
    clearTimeout(timeout)
    failAll(new Error('ACP probe closed'))
    try { rl?.close() } catch { /* ignore */ }
    try { proc.stdin?.end() } catch { /* ignore */ }
    try { if (!proc.killed) proc.kill('SIGTERM') } catch { /* ignore */ }
    if (!exitedFlag) {
      const grace = delay(EXIT_GRACE_MS)
      await Promise.race([exited, grace.promise])
      grace.clear()
      if (!exitedFlag) {
        try { proc.kill('SIGKILL') } catch { /* ignore */ }
        const last = delay(EXIT_GRACE_MS)
        await Promise.race([exited, last.promise])
        last.clear()
      }
    }
    endStoreRun()
  }
}

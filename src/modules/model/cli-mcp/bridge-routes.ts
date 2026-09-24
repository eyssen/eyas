// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { existsSync } from 'node:fs'
import { extname, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context, Hono } from 'hono'
import type { Logger } from 'pino'
import { z } from 'zod'
import type { ModelRequestMetadata, RequestOrigin } from '../types.js'
import {
  createPermissionBridge,
  isAutonomousRequest,
  type BridgeDecisionOutcome,
  type BridgePermissionResult,
  type PermissionBridgeDeps,
} from '../permission-bridge.js'
import type { ToolRegistry } from '@modules/tools/tool-registry.js'
import { toolsetDenial, type createToolExecutor, type RenderableResult } from '@modules/tools/tool-executor.js'
import type { ToolContext, ToolImplementation } from '@modules/tools/types.js'
import { parseWorkingDirectories } from '@modules/tools/working-directories.js'
import { selectBridgeTools } from '@modules/tools/cli-exposure.js'
import { nativeCapabilitiesFor, scopeAllowlist, type ToolScope } from '@modules/agent/tool-scope.js'
import type { ToolOutputContext } from '@modules/privacy/service.js'

/**
 * The CLI-MCP tool bridge: how a host CLI speaking ACP (Grok, Kimi) reaches
 * EYAS tools. The CLI spawns stdio-mcp-server as an MCP child; the child
 * proxies tools/list and tools/call to the two routes below.
 *
 * Authentication is the bridge's own, not a session: every provider turn
 * issues a random secret bound SERVER-SIDE to that turn's identity
 * (conversation, agent, project, turn, run, origin). The child only presents
 * the secret; nothing it sends can change who a call acts for. auth/routes.ts
 * exempts exactly these two paths from session auth for that reason.
 *
 * Governance is the one every CLI tool call gets: the host CLI asks no
 * permission for an MCP tool (grok 1.0.40 fixture mcp-dispatch.json), so each
 * tools/call goes through the shared permission bridge
 * (model/permission-bridge.ts) — the same verdict, approval queue and
 * do-not-repeat ledger as Claude Code's canUseTool and the agent runner's
 * own loop — before the executor runs it as an already-gated call.
 */
export const CLI_MCP_TOOLS_LIST_PATH = '/api/v1/internal/cli-mcp/tools/list'
export const CLI_MCP_TOOLS_CALL_PATH = '/api/v1/internal/cli-mcp/tools/call'
export const BRIDGE_SECRET_HEADER = 'x-eyas-bridge-secret'

/**
 * A bridge secret stops working once it has gone this long unused, even when
 * nobody revoked it (a crashed turn). Measured from its last use, not from
 * its issue: a CLI turn has no whole-turn time limit (it is stopped only when
 * it goes quiet, model/cli-turn-watchdog.ts), so a long, busy turn never
 * loses its tools. The provider revokes the secret when the turn ends.
 */
export const BRIDGE_SECRET_TTL_MS = 2 * 60 * 60 * 1000

/**
 * Who a bridge secret acts for. Stored with the secret, in this process only:
 * the stdio child never carries identity, and a request body cannot override
 * it. H9 (toolScope), G3 (onToolOutcome), B (workingDirectories) and the
 * approval parity (origin, autonomous, idempotencyLedger) add their fields
 * to this record. D5 adds none: every answer goes through the
 * executor's renderForModel, which masks memory-bearing output for a remote
 * destination with the identity read from here (bridgeOutputContext).
 */
export interface BridgeBinding {
  conversationId?: string
  agentId?: string
  teamSessionId?: string
  userId?: string
  projectId?: string | null
  turnId?: string
  /**
   * The supervised run the turn belongs to: every approval a bridged call
   * queues carries it, so the run can be woken when an operator decides.
   */
  runId?: string
  /**
   * How the turn entered EYAS, as its construction site labelled it
   * (metadata.origin). Carried into the permission bridge's log lines; the
   * verdict itself follows `autonomous`.
   */
  origin?: RequestOrigin
  /**
   * Whether nobody attends the turn (a scheduled or team run, a pipeline, an
   * unlabelled request) — isAutonomousRequest of the request metadata, taken
   * when the secret is issued. An attended turn (interactive chat, a channel)
   * runs every gate-allowed call, as on the API and Claude Code paths; an
   * autonomous one also answers to the autonomy ladder. Absent = autonomous
   * (fail-closed).
   */
  autonomous?: boolean
  /**
   * A resumed run's do-not-repeat ledger (metadata.idempotencyLedger): a
   * bridged call its predecessors already executed is refused instead of
   * firing its side effect again. Stored as a copy.
   */
  idempotencyLedger?: ReadonlySet<string>
  /**
   * The folders the turn's CLI works in (absolute; the provider's jail
   * roots). Bridged file tools resolve against them, and the security gate's
   * memory-path policy uses them to refuse another conversation's workspace.
   * Server-side like the rest: a tools/call body can never name them.
   */
  workingDirectories?: string[]
  /**
   * The turn's effective provider+model (H4, from the request metadata). A
   * bridged tool that creates a sub-conversation (run_specialist,
   * assign_task) stores it, so a specialist without a model of its own runs
   * on the delegating turn's model. Server-side like the rest.
   */
  modelBinding?: { providerId: string; modelId: string }
  /**
   * The tools the turn was offered (tool-scope.ts requestToolScope of the
   * provider request: its tool names, Solo's delegation family removed).
   * tools/list serves exactly these minus the CLI's host-native tools
   * (selectBridgeTools), and every tools/call runs with that set as its
   * ToolContext.allowedTools, so the executor refuses anything else. Absent:
   * every registered tool except the host-native ones. Server-side like the
   * rest: a tools/call body can never widen it.
   */
  toolScope?: ToolScope
  /**
   * Observer for every bridged call EYAS refused (G3): the provider settles
   * the CLI's tool row with the real outcome and, for a call waiting on a
   * human, raises approval_required with the queued approval's id (and hands
   * it to the runner's park sink). Set by the provider that issued the
   * secret, in this process only; a throw never changes what the CLI is
   * answered.
   */
  onToolOutcome?: (outcome: BridgeToolOutcome) => void
}

/** How EYAS refused one bridged EYAS tool call (BridgeBinding.onToolOutcome). */
export interface BridgeToolOutcome {
  /** The EYAS tool name the CLI called. */
  toolName: string
  /**
   * 'denied': refused outright; 'approval_required': the call waits on a
   * human; 'skipped': a resumed run's ledger knows it as already executed.
   */
  outcome: BridgeDecisionOutcome
  reason: string
  /** The queued approval row (approval_required only, when one was created). */
  approvalId?: number
}

/**
 * The security gate as the bridge consumes it (ctx.securityGate): the same
 * two members the CLI providers hand to the shared permission bridge.
 */
export interface BridgeSecurityGate {
  validateToolCall: PermissionBridgeDeps['validateToolCall']
  autonomyPolicy?: PermissionBridgeDeps['autonomy']
}

const activeBindings = new Map<string, { binding: Readonly<BridgeBinding>; lastUsedAt: number }>()

function purgeExpired(now: number): void {
  for (const [secret, entry] of activeBindings) {
    if (now - entry.lastUsedAt > BRIDGE_SECRET_TTL_MS) activeBindings.delete(secret)
  }
}

/** Issue a per-turn bridge secret and bind it, server-side, to `binding`. */
export function issueBridgeSecret(binding: BridgeBinding): string {
  // This secret is the only thing standing between a local process and the tool
  // bridge, so it comes from the CSPRNG rather than Math.random(), whose output
  // is predictable from a handful of observed values. 24 bytes = 192 bits, and
  // no part of it encodes the clock.
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  const secret = `eyas-mcp-${Buffer.from(bytes).toString('base64url')}`
  const now = Date.now()
  purgeExpired(now)
  const stored: BridgeBinding = { ...binding }
  // A copy: the issuer keeps no handle on the list the bridge will use.
  if (binding.workingDirectories) stored.workingDirectories = [...binding.workingDirectories]
  if (binding.modelBinding) stored.modelBinding = Object.freeze({ ...binding.modelBinding })
  if (binding.idempotencyLedger) stored.idempotencyLedger = new Set(binding.idempotencyLedger)
  if (binding.toolScope) {
    stored.toolScope = Object.freeze({
      ...(binding.toolScope.include ? { include: Object.freeze([...binding.toolScope.include]) as string[] } : {}),
      exclude: Object.freeze([...binding.toolScope.exclude]) as string[],
    })
  }
  activeBindings.set(secret, { binding: Object.freeze(stored), lastUsedAt: now })
  return secret
}

export function revokeBridgeSecret(secret: string): void {
  activeBindings.delete(secret)
}

/**
 * The binding a live secret acts for; undefined when unknown, revoked or
 * expired. A live lookup is a use: it starts the secret's TTL over.
 */
export function getBridgeBinding(secret: string): Readonly<BridgeBinding> | undefined {
  const entry = activeBindings.get(secret)
  if (!entry) return undefined
  const now = Date.now()
  if (now - entry.lastUsedAt > BRIDGE_SECRET_TTL_MS) {
    activeBindings.delete(secret)
    return undefined
  }
  entry.lastUsedAt = now
  return entry.binding
}

/**
 * The bridge binding for one provider turn, taken from the request metadata:
 * its identity, its origin and the resulting interactive/autonomous
 * classification, and a resumed run's do-not-repeat ledger.
 * `workingDirectories` are the folders the provider actually runs the turn
 * in (its cwd and jail roots); without them the metadata's conversation
 * folders are used, and none at all leaves the binding without folders.
 */
export function bridgeBindingFromMetadata(
  metadata: ModelRequestMetadata | undefined,
  workingDirectories?: readonly string[],
): BridgeBinding {
  const absolute = (raw: unknown): string[] => parseWorkingDirectories(raw).filter((p) => isAbsolute(p))
  const fromMetadata = absolute(metadata?.workingDirectories)
  const folders = workingDirectories
    ? absolute([...workingDirectories])
    : fromMetadata.length > 0
      ? fromMetadata
      : absolute(metadata?.workingDirectory ? [metadata.workingDirectory] : [])
  return {
    conversationId: metadata?.conversationId,
    agentId: metadata?.agentId,
    teamSessionId: metadata?.teamSessionId,
    userId: metadata?.userId,
    projectId: metadata?.projectId,
    turnId: metadata?.turnId,
    runId: metadata?.runId,
    ...(metadata?.origin ? { origin: metadata.origin } : {}),
    // The one classification every provider's permission bridge applies.
    autonomous: isAutonomousRequest(metadata),
    ...(metadata?.idempotencyLedger?.size ? { idempotencyLedger: new Set(metadata.idempotencyLedger) } : {}),
    ...(folders.length > 0 ? { workingDirectories: folders } : {}),
    ...(metadata?.modelBinding ? { modelBinding: { ...metadata.modelBinding } } : {}),
  }
}

/** Strip brackets and a port from one forwarded address token. */
function normalizeAddress(raw: string): string {
  let v = raw.trim().replace(/^"|"$/g, '').toLowerCase()
  if (v.startsWith('[')) {
    const end = v.indexOf(']')
    v = end > 0 ? v.slice(1, end) : v.slice(1)
  } else if (v.split(':').length === 2) {
    v = v.split(':')[0] // IPv4 with a port
  }
  return v
}

function isLoopbackAddress(raw: string): boolean {
  const v = normalizeAddress(raw)
  return v === '::1' || v === 'localhost' || v.startsWith('127.') || v.startsWith('::ffff:127.')
}

/**
 * Defense in depth when EYAS binds to 0.0.0.0: a request that arrived through
 * a proxy carries forwarding headers, and every address in them must be
 * loopback. The stdio child connects directly and sends none. The secret is
 * still the gate; this only refuses what visibly came from elsewhere.
 */
function isLoopbackRequest(c: Context): boolean {
  const xff = c.req.header('x-forwarded-for')
  if (xff !== undefined && !xff.split(',').every((hop) => isLoopbackAddress(hop))) return false
  const realIp = c.req.header('x-real-ip')
  if (realIp !== undefined && !isLoopbackAddress(realIp)) return false
  const forwarded = c.req.header('forwarded')
  if (forwarded !== undefined) {
    for (const m of forwarded.matchAll(/for=("[^"]*"|[^;,\s]+)/gi)) {
      if (!isLoopbackAddress(m[1])) return false
    }
  }
  return true
}

/** The binding this request may act for, or null (→ 401 from the bridge). */
function authorize(c: Context): Readonly<BridgeBinding> | null {
  const secret = c.req.header(BRIDGE_SECRET_HEADER)
  if (!secret) return null
  const binding = getBridgeBinding(secret)
  if (!binding) return null
  if (!isLoopbackRequest(c)) return null
  return binding
}

/**
 * The EYAS tools a binding's CLI is offered: its turn's tool scope over the
 * registry, minus the tools the CLI's own granted built-ins stand in for
 * (tools/cli-exposure.ts) — git_status stays on offer to a turn whose scope
 * withholds the CLI's shell.
 */
function bridgeToolsFor(registry: ToolRegistry, binding: Readonly<BridgeBinding>): ToolImplementation[] {
  const registered = registry.list()
  if (!binding.toolScope) return selectBridgeTools(registered)
  return selectBridgeTools(
    registered,
    scopeAllowlist(binding.toolScope, registered.map((t) => t.name)),
    nativeCapabilitiesFor(binding.toolScope),
  )
}

/** The ToolContext of a bridged call: built from the binding, never from the request. */
function toolContextFromBinding(
  binding: Readonly<BridgeBinding>,
  logger: Logger,
  allowedTools: ReadonlySet<string>,
): ToolContext {
  const folders = binding.workingDirectories?.length ? [...binding.workingDirectories] : undefined
  return {
    conversationId: binding.conversationId ?? '',
    userId: binding.userId ?? 'cli-mcp',
    agentId: binding.agentId,
    teamSessionId: binding.teamSessionId,
    projectId: binding.projectId,
    turnId: binding.turnId,
    runId: binding.runId,
    // The executor's gate (memory-path policy) and the file tools' jail.
    ...(folders ? { workingDirectory: folders[0], workingDirectories: folders } : {}),
    ...(binding.modelBinding ? { modelBinding: { ...binding.modelBinding } } : {}),
    logger,
    // What the CLI was offered is all it may run: the executor refuses any
    // other name (a host-native tool, one outside the turn's scope).
    allowedTools,
    // The bridge already put this call through the shared permission bridge
    // (gatedByPermissionBridge): the executor enforces CASL for the agent
    // actor and the toolset without judging the call a second time.
    actor: { kind: 'agent', role: 'agent' },
    securityPipelineHandled: true,
  }
}

/**
 * Who a bridged answer is sent for, for the executor's renderForModel: the
 * binding's identity, never the request's. A CLI is never a local
 * destination, and nothing in a tools/call body can say otherwise.
 */
function bridgeOutputContext(binding: Readonly<BridgeBinding>): ToolOutputContext {
  return {
    transport: 'mcp-bridge',
    conversationId: binding.conversationId,
    runId: binding.runId,
    agentId: binding.agentId,
    turnId: binding.turnId,
  }
}

/**
 * Tell the binding's observer how EYAS refused a call (denied, waiting on a
 * human with the queued row, or a do-not-repeat skip). A throwing observer is
 * logged and never changes the answer.
 */
function reportRefusal(binding: Readonly<BridgeBinding>, outcome: BridgeToolOutcome, logger: Logger): void {
  if (!binding.onToolOutcome) return
  try {
    binding.onToolOutcome(outcome)
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err), tool: outcome.toolName }, 'cli-mcp: tool-outcome observer failed (ignored)')
  }
}

/** Why a bridged call is refused when no security gate is wired. */
const NO_GATE_REASON = 'security gate unavailable (fail-closed)'

/**
 * Put one bridged call through the shared permission bridge — the Cap 7
 * pipeline Claude Code's canUseTool and the ACP permission requests run:
 * only a gate 'allow' can allow; an escalation queues an approval (a prior
 * human grant for this exact call lets it through once); an autonomous turn
 * also answers to the autonomy ladder; and a resumed run's ledger refuses a
 * call its predecessors already executed. Every refusal reaches the
 * binding's observer with its outcome. No gate wired: refused (fail-closed).
 */
async function gatedByPermissionBridge(opts: {
  binding: Readonly<BridgeBinding>
  gate: BridgeSecurityGate | undefined
  toolName: string
  args: Record<string, unknown>
  signal: AbortSignal
  logger: Logger
}): Promise<BridgePermissionResult> {
  const { binding, gate, toolName, args, logger } = opts
  if (!gate) {
    const message = `Tool call denied: ${NO_GATE_REASON}`
    reportRefusal(binding, { toolName, outcome: 'denied', reason: message }, logger)
    return { behavior: 'deny', message }
  }
  const canUseTool = createPermissionBridge({
    validateToolCall: (name, input, ctx) => gate.validateToolCall(name, input, ctx),
    autonomy: gate.autonomyPolicy,
    autonomous: binding.autonomous !== false,
    // Stamped onto every approval queued here (runId wakes the parked run);
    // the folders feed the gate's memory-path policy.
    ctx: {
      conversationId: binding.conversationId,
      agentId: binding.agentId,
      runId: binding.runId,
      ...(binding.workingDirectories?.length ? { workingDirectories: [...binding.workingDirectories] } : {}),
    },
    ledger: binding.idempotencyLedger,
    onDecision: (decision) => reportRefusal(binding, {
      toolName: decision.toolName,
      outcome: decision.outcome,
      reason: decision.reason,
      ...(decision.outcome === 'approval_required' && decision.approvalId !== undefined ? { approvalId: decision.approvalId } : {}),
    }, logger),
    logger: typeof logger.child === 'function'
      ? logger.child({ transport: 'mcp-bridge', origin: binding.origin ?? 'unlabelled', autonomous: binding.autonomous !== false, runId: binding.runId })
      : logger,
  })
  return canUseTool(toolName, args, { toolUseID: `cli-mcp:${toolName}`, signal: opts.signal })
}

/** tools/call body. Unknown keys (a legacy `context`) are stripped, never read. */
const ToolCallBodySchema = z.object({
  name: z.string().min(1).max(256),
  arguments: z.record(z.unknown()).optional(),
})

/**
 * Register internal CLI-MCP proxy routes (bridge secret + loopback check, no
 * session). Mounted once from the tools module onStart.
 */
export function registerCliMcpBridgeRoutes(deps: {
  http: Hono
  toolRegistry: ToolRegistry
  /**
   * The EYAS executor: execute() runs the call, renderForModel() writes the
   * answer — masking memory-bearing output, which leaves through the CLI to
   * its vendor and never passes the gateway's egress filter.
   */
  toolExecutor: Pick<ReturnType<typeof createToolExecutor>, 'execute' | 'renderForModel'>
  /**
   * The EYAS security gate (ctx.securityGate), resolved per call: the
   * security-gate module registers after tools. Every bridged call is judged
   * through it by the shared permission bridge; none wired refuses every
   * call (fail-closed).
   */
  getSecurityGate: () => BridgeSecurityGate | undefined
  logger: Logger
}): void {
  const { http, toolRegistry, toolExecutor, getSecurityGate, logger } = deps

  // Literal paths (= CLI_MCP_TOOLS_*_PATH): the auth-coverage contract test
  // scans route registrations textually.
  http.get('/api/v1/internal/cli-mcp/tools/list', (c) => {
    const binding = authorize(c)
    if (!binding) return c.json({ error: 'unauthorized' }, 401)
    const exposed = bridgeToolsFor(toolRegistry, binding)
    // Logged because the alternative is archaeology: when a model says a tool
    // "is not wired", this line is the difference between knowing and guessing.
    logger?.debug?.(
      { count: exposed.length, names: exposed.map((t) => t.name) },
      'cli-mcp: serving tool list',
    )
    const tools = exposed.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    }))
    return c.json({ tools })
  })

  http.post('/api/v1/internal/cli-mcp/tools/call', async (c) => {
    const binding = authorize(c)
    if (!binding) return c.json({ error: 'unauthorized' }, 401)
    const raw = await c.req.json().catch(() => undefined)
    const parsed = ToolCallBodySchema.safeParse(raw)
    if (!parsed.success) {
      return c.json({ error: 'invalid request', issues: parsed.error.issues.map((i) => i.message) }, 400)
    }
    const { name } = parsed.data
    const args = parsed.data.arguments ?? {}

    const out = bridgeOutputContext(binding)
    const answer = (result: RenderableResult) => {
      const { text, isError } = toolExecutor.renderForModel(name, result, out)
      return c.json({ content: [{ type: 'text', text }], isError })
    }

    if (!toolRegistry.has(name)) return answer({ success: false, error: `Tool not found: ${name}` })

    // The same set tools/list served. A call outside it (a host-native tool,
    // one the turn was not offered) is refused before the gate is asked, as
    // the agent runner does, so it never queues an approval; the refusal
    // reaches the turn's tool row like any other.
    const offered = new Set(bridgeToolsFor(toolRegistry, binding).map((t) => t.name))
    const outsideToolset = toolsetDenial(offered, name)
    if (outsideToolset) {
      const error = `Tool call denied: ${outsideToolset}`
      reportRefusal(binding, { toolName: name, outcome: 'denied', reason: error }, logger)
      return answer({ success: false, error })
    }
    try {
      const verdict = await gatedByPermissionBridge({
        binding,
        gate: getSecurityGate(),
        toolName: name,
        args,
        signal: c.req.raw.signal,
        logger,
      })
      if (verdict.behavior === 'deny') return answer({ success: false, error: verdict.message })
      const result = await toolExecutor.execute(name, args, toolContextFromBinding(binding, logger, offered))
      // Gated already, the executor refuses only for CASL or the toolset.
      if (!result.success && result.errorCode === 'DENIED') {
        reportRefusal(binding, { toolName: name, outcome: 'denied', reason: result.error ?? 'denied' }, logger)
      }
      return answer(result)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      logger.warn({ err: message, tool: name }, 'cli-mcp bridge tool call failed')
      return answer({ success: false, error: message })
    }
  })

  logger.info('CLI MCP bridge routes registered at /api/v1/internal/cli-mcp/*')
}

/**
 * Absolute path of the stdio MCP server, next to this module: the .ts source
 * under `bun src/main.ts`, the .js sibling in a build (`bun run build` emits
 * dist/stdio-mcp-server.js beside dist/main.js). No install-root guessing.
 */
export function resolveStdioMcpServerPath(): string {
  const self = fileURLToPath(import.meta.url)
  return fileURLToPath(new URL(`./stdio-mcp-server${extname(self)}`, import.meta.url))
}

/**
 * Loopback URL the stdio child uses to reach this server. A wildcard bind
 * address is not connectable, so it becomes 127.0.0.1; an IPv6 literal gets
 * its brackets.
 */
export function resolveBridgeBaseUrl(server: { host?: string; port: number }): string {
  const host = (server.host ?? '').trim()
  const connectable = host === '' || host === '0.0.0.0' || host === '::' || host === '[::]' ? '127.0.0.1' : host
  const literal = connectable.includes(':') && !connectable.startsWith('[') ? `[${connectable}]` : connectable
  return `http://${literal}:${server.port}`
}

/**
 * The ACP `mcpServers` entry for one turn. The child runs under the same
 * runtime as EYAS itself (process.execPath) and carries only the URL and the
 * secret — its identity lives in the server-side binding.
 */
export function buildAcpMcpServerConfig(opts: {
  baseUrl: string
  secret: string
}): {
  name: string
  command: string
  args: string[]
  env: Array<{ name: string; value: string }>
} {
  return {
    name: 'eyas',
    command: process.execPath,
    args: [resolveStdioMcpServerPath()],
    env: [
      { name: 'EYAS_MCP_BRIDGE_URL', value: opts.baseUrl },
      { name: 'EYAS_MCP_BRIDGE_SECRET', value: opts.secret },
    ],
  }
}

/** Result of the boot self-test, published as ctx.cliMcpBridge. */
export interface CliMcpBridgeHealth {
  healthy: boolean
  error?: string
  /** Number of tools the bridge served to the probe (healthy only). */
  toolCount?: number
  /** The check could not run yet (setup incomplete) — not a fault. */
  deferred?: boolean
  checkedAt: string
}

const ToolListResponseSchema = z.object({
  tools: z.array(z.object({ name: z.string() }).passthrough()),
})

/**
 * Prove the bridge answers through the FULL middleware stack (setup guard,
 * session-auth catch-all, bridge auth): issue a probe secret and request
 * tools/list with app.request, exactly as the stdio child would. Also checks
 * that the stdio server file the CLI will spawn exists.
 */
export async function selfTestCliMcpBridge(
  app: Pick<Hono, 'request'>,
  opts: { serverPath?: string } = {},
): Promise<CliMcpBridgeHealth> {
  const checkedAt = new Date().toISOString()
  const serverPath = opts.serverPath ?? resolveStdioMcpServerPath()
  if (!existsSync(serverPath)) {
    return { healthy: false, error: `stdio MCP server not found at ${serverPath}`, checkedAt }
  }
  const secret = issueBridgeSecret({ userId: 'cli-mcp-self-test' })
  try {
    const res = await app.request(CLI_MCP_TOOLS_LIST_PATH, { headers: { [BRIDGE_SECRET_HEADER]: secret } })
    const text = await res.text()
    if (res.status !== 200) {
      return { healthy: false, error: `tools/list returned HTTP ${res.status}: ${text.slice(0, 200)}`, checkedAt }
    }
    let body: unknown
    try {
      body = JSON.parse(text)
    } catch {
      return { healthy: false, error: 'tools/list returned a non-JSON body', checkedAt }
    }
    const parsed = ToolListResponseSchema.safeParse(body)
    if (!parsed.success) {
      return { healthy: false, error: 'tools/list returned an unexpected body', checkedAt }
    }
    return { healthy: true, toolCount: parsed.data.tools.length, checkedAt }
  } catch (err) {
    return { healthy: false, error: err instanceof Error ? err.message : String(err), checkedAt }
  } finally {
    revokeBridgeSecret(secret)
  }
}

/**
 * Boot wrapper around selfTestCliMcpBridge: defers while setup is incomplete
 * (the setup guard answers 503 to every API path then, and no CLI turn can
 * run), logs a warning on failure.
 */
export async function checkCliMcpBridge(deps: {
  http: Pick<Hono, 'request'>
  logger: Pick<Logger, 'info' | 'warn'>
  setupComplete?: () => boolean
  serverPath?: string
}): Promise<CliMcpBridgeHealth> {
  if (deps.setupComplete && !deps.setupComplete()) {
    deps.logger.info('CLI tool bridge self-test deferred until setup is complete')
    return { healthy: false, deferred: true, error: 'setup incomplete', checkedAt: new Date().toISOString() }
  }
  const health = await selfTestCliMcpBridge(deps.http, { serverPath: deps.serverPath })
  if (health.healthy) {
    deps.logger.info({ toolCount: health.toolCount }, 'CLI tool bridge self-test passed')
  } else {
    deps.logger.warn(
      { error: health.error },
      'CLI tool bridge self-test failed — Grok/Kimi turns cannot reach EYAS tools (memory, board, …)',
    )
  }
  return health
}

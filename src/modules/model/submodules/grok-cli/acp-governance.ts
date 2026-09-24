// Part of eYssen. See LICENSE file for full copyright and licensing details.

/**
 * Governance for ACP server→client requests (Grok and Kimi CLIs).
 *
 * Permission requests are mapped onto the canonical tool vocabulary the EYAS
 * security gate classifies (Bash=red, Write/Edit=yellow, ...) and answered
 * fail-closed: no wired gate means no approval. An allow is only ever
 * answered with the CLI's allow_once option — never a standing allow_always
 * grant, never an option picked by its name — so EYAS stays the approver of
 * every later call.
 *
 * Before the gate is asked, the turn's tool scope has its say
 * (tools/cli-exposure.ts): a tool whose kind or name needs a native
 * capability the agent's tool list does not grant (write, shell, web) is
 * refused outright — no approval, no gate call. A request that says nothing
 * about what the tool does (kimi sends no kind) is refused the same way while
 * the scope withholds write or shell, since those are what a CLI asks about.
 *
 * File requests the CLI delegates to EYAS (fs/read_text_file,
 * fs/write_text_file) go through, in order:
 *   0. the tool scope: a write needs the write capability;
 *   1. the jail: the path must resolve — symlinks followed, including for a
 *      file that does not exist yet — inside the turn's folders (roots);
 *      no roots means no file access at all;
 *   2. the deterministic memory-path policy (memory outside EYAS, EYAS's own
 *      data, another conversation's workspace);
 *   3. one gate decision per operation: a path already covered by this
 *      turn's permission decision for the same tool call is served without
 *      asking the gate again; only a read or write nobody asked about (a CLI
 *      that reads without a permission request) calls the gate itself.
 * An isolated completion refuses every permission and file request.
 *
 * Every refusal is reported (onDecision) with how the call ends — refused,
 * waiting on a human with its queued approval, or a do-not-repeat skip — so
 * the CLI's tool row shows the real outcome (acp-stream.ts).
 */

import { constants as fsConstants } from 'node:fs'
import { mkdir, open } from 'node:fs/promises'
import { dirname, isAbsolute, resolve } from 'node:path'
import { z } from 'zod'
import { realpathBestEffort } from '@shared/fs-realpath.js'
import { getPathPolicy } from '@shared/memory-sovereignty/path-policy.js'
import { resolveToolPath } from '@modules/tools/builtin/path-utils.js'
import {
  ALL_NATIVE_CAPABILITIES,
  acpToolCapabilities,
  nativeCapabilityDenial,
  type NativeCapability,
} from '@modules/tools/cli-exposure.js'
import { resolveCliRoots } from '../../cli-runtime/workspaces.js'
import {
  createPermissionBridge,
  type BridgeDecision,
  type BridgeDecisionOutcome,
  type PermissionBridgeDeps,
} from '../../permission-bridge.js'
import { toolCallPaths } from './acp-verify.js'

export type AcpPermissionDecision =
  | { behavior: 'allow' }
  | {
      behavior: 'deny'
      message: string
      /**
       * How the refused call ends for its tool row (default 'denied'): it
       * waits on a human ('approval_required', with the queued approvalId),
       * or it was already executed on the original run ('skipped').
       */
      outcome?: BridgeDecisionOutcome
      approvalId?: number
    }

/** The call a gate decision is about, when the CLI named it. */
export interface AcpToolCallContext {
  /** The ACP toolCallId of a permission request; absent for a client-fs operation nobody asked about. */
  toolCallId?: string
}

/** Gate callback the provider builds from the shared permission bridge (createAcpCanUseTool). */
export type AcpCanUseTool = (
  toolName: string,
  input: Record<string, unknown>,
  ctx?: AcpToolCallContext,
) => Promise<AcpPermissionDecision>

/**
 * The ACP gate callback over the shared permission bridge — the same Cap 7
 * policy Claude Code's canUseTool runs. The bridge's decision observer says
 * how a refusal ended (refused, waiting on a human with the queued approval,
 * a do-not-repeat skip); that travels on the returned decision, so the CLI's
 * tool row settles with the real outcome and an approval shows up in the chat.
 */
export function createAcpCanUseTool(deps: Omit<PermissionBridgeDeps, 'onDecision'>, signal: AbortSignal): AcpCanUseTool {
  const decisions = new Map<string, BridgeDecision>()
  const bridge = createPermissionBridge({ ...deps, onDecision: (d) => { decisions.set(d.toolUseId, d) } })
  let seq = 0
  return async (toolName, input, ctx) => {
    // One key per call, so the observer's report is this call's.
    const key = `${ctx?.toolCallId ?? 'acp'}#${++seq}`
    try {
      const verdict = await bridge(toolName, input, { toolUseID: key, signal })
      if (verdict.behavior === 'allow') return verdict
      const decision = decisions.get(key)
      return decision
        ? { ...verdict, outcome: decision.outcome, ...(decision.approvalId !== undefined ? { approvalId: decision.approvalId } : {}) }
        : verdict
    } finally {
      decisions.delete(key)
    }
  }
}

/**
 * The deterministic memory-path check (the security gate's checkMemoryPath
 * when wired, else the process-wide path policy). A non-null result is a deny
 * with its reason.
 */
export type AcpMemoryPathCheck = (
  toolName: string,
  input: Record<string, unknown>,
  ctx: { workingDirectories: string[]; homeDir?: string },
) => { reason: string } | null | Promise<{ reason: string } | null>

/**
 * The security gate's memory-path check (gate.checkMemoryPath, reached
 * through the providers' governance): a deny decision, logged as one
 * security_events row, or null when the path is fine. Without a wired gate
 * the handler asks the process-wide path policy directly (same verdict, no
 * audit row).
 */
export type GateMemoryPathCheck = (
  toolName: string,
  input: Record<string, unknown>,
  ctx?: { workingDirectories?: string[]; conversationId?: string; agentId?: string; homeDir?: string },
) => unknown

/**
 * Adapt the gate's checkMemoryPath to the handler's shape. Anything but null,
 * undefined or an explicit allow is a deny. Absent check: undefined (the
 * handler then uses the path policy).
 */
export function acpMemoryPathCheckFrom(
  check: GateMemoryPathCheck | undefined,
  ids: { conversationId?: string; agentId?: string; homeDir?: string },
): AcpMemoryPathCheck | undefined {
  if (!check) return undefined
  return async (toolName, input, ctx) => {
    const homeDir = ctx.homeDir ?? ids.homeDir
    const verdict = (await check(toolName, input, {
      workingDirectories: ctx.workingDirectories,
      ...ids,
      ...(homeDir ? { homeDir } : {}),
    })) as { decision?: unknown; reason?: unknown } | null | undefined
    if (verdict === null || verdict === undefined || verdict.decision === 'allow') return null
    return { reason: typeof verdict.reason === 'string' && verdict.reason ? verdict.reason : 'memory-path policy' }
  }
}

export interface AcpToolCallInfo {
  toolCallId?: string
  kind?: string
  title?: string
  rawInput?: Record<string, unknown>
}

export interface AcpPermissionOption {
  optionId: string
  kind?: string
  name?: string
}

/**
 * One EYAS decision on a tool: every answered permission request (with its
 * toolCallId), and every gate refusal of a client-fs operation nobody asked
 * permission for (no toolCallId).
 */
export interface AcpDecisionInfo {
  toolCallId?: string
  behavior: 'allow' | 'deny' | 'cancelled'
  /** A refusal only: how the call ends for its tool row ('denied' unless the gate said otherwise). */
  outcome?: BridgeDecisionOutcome
  /** A refusal only: why. */
  reason?: string
  /** The queued approval row, when outcome is 'approval_required'. */
  approvalId?: number
  /** The gate name of the tool (Bash, Read, Write, …). */
  toolName?: string
}

/**
 * ACP tool-call kind → canonical gate tool name. `delete` deliberately maps to
 * Bash (red tier): destructive calls must land on the strictest classification.
 */
const KIND_TO_TOOL: Record<string, string> = {
  execute: 'Bash',
  delete: 'Bash',
  edit: 'Write',
  move: 'Write',
  read: 'Read',
  search: 'Grep',
  fetch: 'WebFetch',
}

/** Reserved gate name for ACP tool calls whose kind has no canonical mapping.
 * Deliberately NOT a real tool name: the security gate treats unclassified
 * names as fail-closed (escalate), never green. */
export const ACP_UNMAPPED_TOOL = 'AcpUnmappedTool'

export function mapAcpToolCall(toolCall: AcpToolCallInfo): { name: string; input: Record<string, unknown>; mapped: boolean } {
  const mapped = toolCall.kind ? KIND_TO_TOOL[toolCall.kind] : undefined
  // kind/title are agent-controlled. The title must NEVER become the gate
  // name — a title colliding with a green-tier tool would self-classify the
  // call. Unmapped kinds resolve to the reserved name and escalate.
  return {
    name: mapped ?? ACP_UNMAPPED_TOOL,
    // Surface the raw kind/title to the LLM judge + audit log without
    // letting them influence classification.
    input: { ...(toolCall.rawInput ?? {}), _acp: { kind: toolCall.kind, title: toolCall.title } },
    mapped: Boolean(mapped),
  }
}

/**
 * Pick the ACP option for the gate's verdict, by option kind only: an allow is
 * the allow_once option, a deny the reject_once option. Anything else — only
 * a standing allow_always / reject_always on offer, no options at all — is
 * answered cancelled (fail closed).
 */
export function chooseAcpOption(
  options: AcpPermissionOption[],
  behavior: 'allow' | 'deny',
): { outcome: 'selected'; optionId: string } | { outcome: 'cancelled' } {
  const pick = options.find((o) => o.kind === (behavior === 'allow' ? 'allow_once' : 'reject_once'))
  return pick ? { outcome: 'selected', optionId: pick.optionId } : { outcome: 'cancelled' }
}

/**
 * The folders a turn's CLI may touch through EYAS's client fs: every stored
 * conversation folder that still passes the CLI folder check (the same one
 * resolveCliCwd applies), plus the session cwd itself. One resolver for every
 * CLI provider (cli-runtime resolveCliRoots): Claude Code's memory-policy hook
 * and permission bridge judge against the same folders.
 */
export const resolveAcpRoots = resolveCliRoots

/** Default memory-path check: the process-wide path policy (deterministic, no audit row). */
export const policyMemoryPathCheck: AcpMemoryPathCheck = (toolName, input, ctx) => {
  const hit = getPathPolicy().evaluateToolInput(toolName, input, {
    workingDirectories: ctx.workingDirectories,
    ...(ctx.homeDir ? { homeDir: ctx.homeDir } : {}),
  })
  if (!hit) return null
  return {
    reason: hit.kind === 'foreign-memory'
      ? `memory outside EYAS (${hit.label})`
      : `EYAS keeps this location to itself (${hit.label})`,
  }
}

const PathField = z.string().min(1).max(4096).refine((p) => !p.includes('\0'), 'path contains a null byte')

const FsReadParamsSchema = z.object({
  path: PathField,
  line: z.number().int().positive().nullable().optional(),
  limit: z.number().int().nonnegative().nullable().optional(),
}).passthrough()

const FsWriteParamsSchema = z.object({
  path: PathField,
  content: z.string().max(64 * 1024 * 1024),
}).passthrough()

/**
 * The CLI's own name of the tool a permission request is about (grok 1.0.40:
 * toolCall._meta['x.ai/tool'].name), read tolerantly: any other shape is no
 * name, never a failed request.
 */
const CliToolMetaSchema = z.object({
  _meta: z.object({
    'x.ai/tool': z.object({ name: z.string().min(1).max(256) }).passthrough(),
  }).passthrough(),
}).passthrough()

function cliToolNameOf(toolCall: unknown): string | undefined {
  const parsed = CliToolMetaSchema.safeParse(toolCall)
  return parsed.success ? parsed.data._meta['x.ai/tool'].name : undefined
}

const PermissionParamsSchema = z.object({
  toolCall: z.object({
    toolCallId: z.string().min(1).max(512).optional(),
    kind: z.string().max(64).optional(),
    title: z.string().max(4096).optional(),
    rawInput: z.record(z.unknown()).nullable().optional(),
    locations: z.array(z.object({ path: z.string().optional() }).passthrough()).nullable().optional(),
  }).passthrough(),
  options: z.array(z.object({
    optionId: z.string().min(1).max(256),
    kind: z.string().max(64).optional(),
    name: z.string().max(512).optional(),
  }).passthrough()).max(32),
}).passthrough()

/**
 * The ACP read_text_file window: `line` is the 1-based first line, `limit`
 * the number of lines. Without either, the whole text.
 */
export function sliceTextLines(text: string, line?: number | null, limit?: number | null): string {
  if (!line && (limit === undefined || limit === null)) return text
  const lines = text.split('\n')
  const start = line && line > 1 ? line - 1 : 0
  const end = typeof limit === 'number' ? start + limit : undefined
  return lines.slice(start, end).join('\n')
}

type FsOp = 'read' | 'write'

/** Which file operations a permission decision for a gate tool covers. */
function opsFor(toolName: string): FsOp[] {
  if (toolName === 'Read' || toolName === 'Grep') return ['read']
  if (toolName === 'Write') return ['read', 'write']
  return []
}

export interface AcpServerHandlerDeps {
  /** Absent gate = fail-closed: every permission request is refused and no file is served. */
  canUseTool?: AcpCanUseTool
  respond: (id: number | string, result: unknown) => void
  respondError: (id: number | string, message: string) => void
  logger?: { warn?: (o: unknown, msg?: string) => void; debug?: (o: unknown, msg?: string) => void }
  /** The folders client-fs requests are jailed to. Empty or absent: every fs request is refused. */
  roots?: readonly string[]
  /** An isolated completion: every permission and fs request is refused. */
  isolated?: boolean
  /** Deterministic memory-path check (default: the path policy). */
  checkMemoryPath?: AcpMemoryPathCheck
  /** Paths the session already named for a tool call (tool_call locations), for decision coverage. */
  pathsForToolCall?: (toolCallId: string) => readonly string[]
  /**
   * What the native tools may do this turn (agent/tool-scope.ts
   * nativeCapabilitiesFor of the turn's tool scope). A permission request
   * needing a capability outside it, and a client-fs write without 'write',
   * are refused before the gate is asked. Absent: every capability.
   */
  nativeCapabilities?: ReadonlySet<NativeCapability>
  /**
   * What the session already said about a tool call (the first tool_call's
   * tool name, the kind of a later update): kimi's permission request
   * carries no kind of its own, and grok's names only a display title.
   */
  describeToolCall?: (toolCallId: string) => { name?: string; kind?: string }
  /**
   * Called once per answered permission request, before the answer is sent,
   * and once per gate refusal of a client-fs operation (no toolCallId).
   */
  onDecision?: (info: AcpDecisionInfo) => void
  /** Called after a client-fs request was served (absolute, symlink-resolved path). */
  onFsServed?: (path: string, op: FsOp) => void
}

/**
 * Handles ACP server→client requests that carry authority (permissions, fs).
 * Returns true when the method was handled, false for anything else.
 */
export function createAcpServerHandler(deps: AcpServerHandlerDeps) {
  const { canUseTool, respond, respondError, logger } = deps
  const roots = [...(deps.roots ?? [])].filter((r) => typeof r === 'string' && isAbsolute(r))
  const checkMemoryPath = deps.checkMemoryPath ?? policyMemoryPathCheck
  const granted = deps.nativeCapabilities ?? ALL_NATIVE_CAPABILITIES

  /**
   * The tool scope's refusal of a native tool call, or null. The call's
   * kind (its own, else the session's last word on it) and the CLI's names
   * for it decide which capabilities it needs; one that is not granted
   * refuses it. A call nobody said anything about needs write and shell.
   */
  const scopeRefusal = (toolCall: { toolCallId?: string; kind?: string; title?: string }, raw: unknown, gateName: string): string | null => {
    const known = toolCall.toolCallId ? deps.describeToolCall?.(toolCall.toolCallId) : undefined
    const kind = toolCall.kind?.trim() || known?.kind?.trim() || undefined
    const metaName = cliToolNameOf(raw)
    const needed = acpToolCapabilities({ kind, names: [metaName, known?.name] })
    // The row's reason names the tool as the CLI does, when it says.
    const label = metaName ?? known?.name ?? (toolCall.title?.trim() ? toolCall.title.trim().slice(0, 80) : gateName)
    const missing = needed.find((cap) => !granted.has(cap))
    if (missing) return nativeCapabilityDenial(missing, label)
    if (needed.length === 0 && kind === undefined) {
      const withheld = (['write', 'shell'] as const).find((cap) => !granted.has(cap))
      if (withheld) return `${nativeCapabilityDenial(withheld, label)} (the CLI did not say what this tool does)`
    }
    return null
  }

  /** Symlink-resolved path → what this turn's permission decisions allow on it. */
  const coverage = new Map<string, { deny: boolean; ops: Set<FsOp> }>()

  const canonical = (path: string): string => {
    const abs = isAbsolute(path) ? path : resolve(roots[0] ?? '/', path)
    try {
      return realpathBestEffort(abs)
    } catch {
      return resolve(abs)
    }
  }

  const cover = (paths: Iterable<string>, allow: boolean, ops: FsOp[]): void => {
    for (const p of paths) {
      const key = canonical(p)
      const entry = coverage.get(key) ?? { deny: false, ops: new Set<FsOp>() }
      if (!allow) entry.deny = true
      else for (const op of ops) entry.ops.add(op)
      coverage.set(key, entry)
    }
  }

  const coverageOf = (absPath: string, op: FsOp): 'allow' | 'deny' | 'none' => {
    const entry = coverage.get(absPath)
    if (!entry) return 'none'
    if (entry.deny) return 'deny'
    return entry.ops.has(op) ? 'allow' : 'none'
  }

  const decide = async (name: string, input: Record<string, unknown>, ctx?: AcpToolCallContext): Promise<AcpPermissionDecision> => {
    if (!canUseTool) {
      logger?.warn?.({ tool: name }, 'ACP: no security gate wired — refusing (fail-closed)')
      return { behavior: 'deny', message: 'no security gate wired (fail-closed)' }
    }
    try {
      return await (ctx ? canUseTool(name, input, ctx) : canUseTool(name, input))
    } catch (err) {
      return { behavior: 'deny', message: err instanceof Error ? err.message : String(err) }
    }
  }

  /** The decision info of a refusal: its outcome (default 'denied'), reason and approval. */
  const refusalInfo = (decision: Extract<AcpPermissionDecision, { behavior: 'deny' }>): Pick<AcpDecisionInfo, 'outcome' | 'reason' | 'approvalId'> => ({
    outcome: decision.outcome ?? 'denied',
    reason: decision.message,
    ...(decision.approvalId !== undefined ? { approvalId: decision.approvalId } : {}),
  })

  const memoryDenial = async (toolName: string, path: string): Promise<string | null> => {
    try {
      const hit = await checkMemoryPath(toolName, { path }, { workingDirectories: [...roots] })
      return hit ? hit.reason : null
    } catch (err) {
      // A check that cannot answer is a deny.
      return `memory-path check failed: ${err instanceof Error ? err.message : String(err)}`
    }
  }

  /**
   * The jail, the memory-path policy and one gate decision for a client-fs
   * operation. Returns the resolved path, or the refusal reason.
   */
  const authorizeFs = async (
    op: FsOp,
    path: string,
    gateInput: (abs: string) => Record<string, unknown>,
  ): Promise<{ ok: true; path: string } | { ok: false; reason: string }> => {
    if (deps.isolated) return { ok: false, reason: 'isolated completion: no file access' }
    const toolName = op === 'read' ? 'Read' : 'Write'
    const capability: NativeCapability = op === 'read' ? 'read' : 'write'
    if (!granted.has(capability)) {
      const reason = nativeCapabilityDenial(capability, toolName)
      deps.onDecision?.({ behavior: 'deny', toolName, outcome: 'denied', reason })
      return { ok: false, reason }
    }
    if (roots.length === 0) return { ok: false, reason: 'no conversation folder to work in' }
    const jailed = resolveToolPath(path, undefined, roots)
    if (!jailed.ok) return { ok: false, reason: jailed.error }
    const memory = await memoryDenial(toolName, jailed.absolute)
    if (memory) return { ok: false, reason: memory }
    const covered = coverageOf(jailed.absolute, op)
    if (covered === 'deny') return { ok: false, reason: 'EYAS refused this tool call' }
    if (covered === 'none') {
      // Nobody asked about this operation (the CLI reads or writes without a
      // permission request): the gate decides it, once.
      const decision = await decide(toolName, gateInput(jailed.absolute))
      cover([jailed.absolute], decision.behavior === 'allow', [op])
      if (decision.behavior === 'deny') {
        deps.onDecision?.({ behavior: 'deny', toolName, ...refusalInfo(decision) })
        return { ok: false, reason: decision.message }
      }
    }
    return { ok: true, path: jailed.absolute }
  }

  return async (method: string, id: number | string | null, params: any): Promise<boolean> => {
    if (method === 'session/request_permission') {
      if (id == null) return true
      const parsed = PermissionParamsSchema.safeParse(params)
      if (!parsed.success) {
        logger?.warn?.({ issue: parsed.error.issues[0]?.message }, 'ACP: malformed permission request — cancelled')
        const toolCallId = typeof params?.toolCall?.toolCallId === 'string' ? params.toolCall.toolCallId : undefined
        deps.onDecision?.({ toolCallId, behavior: 'cancelled', outcome: 'denied', reason: 'malformed permission request' })
        respond(id, { outcome: { outcome: 'cancelled' } })
        return true
      }
      const { toolCall, options } = parsed.data
      const info: AcpToolCallInfo = {
        toolCallId: toolCall.toolCallId,
        kind: toolCall.kind,
        title: toolCall.title,
        rawInput: toolCall.rawInput ?? undefined,
      }
      const { name, input } = mapAcpToolCall(info)
      const outOfScope = deps.isolated ? null : scopeRefusal(toolCall, params?.toolCall, name)
      const decision: AcpPermissionDecision = deps.isolated
        ? { behavior: 'deny', message: 'isolated completion: no tools' }
        : outOfScope
          ? { behavior: 'deny', message: outOfScope }
          : await decide(name, input, { toolCallId: toolCall.toolCallId })
      const outcome = chooseAcpOption(options, decision.behavior)
      if (decision.behavior === 'allow' && outcome.outcome === 'cancelled') {
        logger?.warn?.({ tool: name, options: options.map((o) => o.kind) }, 'ACP: no allow_once option offered — answered cancelled')
      }
      const allowed = decision.behavior === 'allow' && outcome.outcome === 'selected'
      const paths = new Set<string>(toolCallPaths({ rawInput: toolCall.rawInput, locations: toolCall.locations }))
      if (toolCall.toolCallId) for (const p of deps.pathsForToolCall?.(toolCall.toolCallId) ?? []) paths.add(p)
      cover(paths, allowed, opsFor(name))
      deps.onDecision?.({
        toolCallId: toolCall.toolCallId,
        behavior: allowed ? 'allow' : outcome.outcome === 'selected' ? 'deny' : 'cancelled',
        ...(allowed
          ? {}
          : {
              toolName: name,
              // A gate allow the CLI offered no allow-once option for is still a refusal.
              ...(decision.behavior === 'deny'
                ? refusalInfo(decision)
                : { outcome: 'denied' as const, reason: 'the CLI offered no allow-once option (fail-closed)' }),
            }),
      })
      respond(id, { outcome })
      return true
    }

    if (method === 'fs/read_text_file') {
      if (id == null) return true
      const parsed = FsReadParamsSchema.safeParse(params)
      if (!parsed.success) {
        respondError(id, 'fs read refused: invalid request')
        return true
      }
      const verdict = await authorizeFs('read', parsed.data.path, (abs) => ({ path: abs }))
      if (!verdict.ok) {
        respondError(id, `fs read denied: ${verdict.reason}`)
        return true
      }
      try {
        // No final symlink: the path was resolved above, a link swapped in
        // since then is refused rather than followed.
        const handle = await open(verdict.path, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0))
        let text: string
        try {
          text = await handle.readFile({ encoding: 'utf8' })
        } finally {
          await handle.close()
        }
        respond(id, { content: sliceTextLines(text, parsed.data.line, parsed.data.limit) })
        deps.onFsServed?.(verdict.path, 'read')
      } catch (err) {
        respondError(id, err instanceof Error ? err.message : String(err))
      }
      return true
    }

    if (method === 'fs/write_text_file') {
      if (id == null) return true
      const parsed = FsWriteParamsSchema.safeParse(params)
      if (!parsed.success) {
        respondError(id, 'fs write refused: invalid request')
        return true
      }
      const { content } = parsed.data
      const verdict = await authorizeFs('write', parsed.data.path, (abs) => ({ path: abs, content }))
      if (!verdict.ok) {
        respondError(id, `fs write denied: ${verdict.reason}`)
        return true
      }
      try {
        await mkdir(dirname(verdict.path), { recursive: true })
        const handle = await open(
          verdict.path,
          fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_TRUNC | (fsConstants.O_NOFOLLOW ?? 0),
          0o644,
        )
        try {
          await handle.writeFile(content, { encoding: 'utf8' })
        } finally {
          await handle.close()
        }
        respond(id, {})
        deps.onFsServed?.(verdict.path, 'write')
      } catch (err) {
        respondError(id, err instanceof Error ? err.message : String(err))
      }
      return true
    }

    return false
  }
}

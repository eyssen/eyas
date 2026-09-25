// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { z } from 'zod'
import type { Context, Hono, MiddlewareHandler } from 'hono'
import type { Logger } from 'pino'
import { requirePermission } from '@modules/permissions/middleware'
import type { CliRunner } from '@modules/studio/cli-runner.js'
import { ensureConversationWorkspace, isSafeWorkspaceSegment } from '@modules/model/cli-runtime/workspaces.js'
import {
  conversationWorkspaceAccess,
  folderRefusedNotice,
  parseWorkingDirectories,
  screenStoredWorkingDirectories,
} from '@modules/tools/working-directories.js'
import type { ConversationService } from '@modules/conversations/conversation-service.js'
import { doctorOpencode } from './doctor.js'
import { normalizeOpencodeSettings } from './settings-store.js'
import {
  OPENCODE_ID_PATTERN,
  OPENCODE_MODEL_ID_MAX,
  OPENCODE_VARIANT_MAX,
  type OpencodeModelCatalog,
  type OpencodeModelRef,
  type OpencodeSessionBinding,
  type OpencodeSessionCaller,
  type OpencodeSettings,
} from './types.js'
import type { PtyManager } from './pty-manager.js'
import type { OpencodeRunner } from './opencode-runner.js'
import type { OpencodeSessionBindings } from './memory-bridge.js'
import { isSessionProof, type PluginTokenRegistry, type ProvenPluginCall } from './plugin-tokens.js'
import type { ToolAbility, ToolActor, ToolContext } from '@modules/tools/types.js'
import type { createToolExecutor } from '@modules/tools/tool-executor.js'
import type { ToolOutputContext } from '@modules/privacy/service.js'
import { resolveTuiFolders } from './path-guard.js'
import { OPENCODE_SUBJECT, OPENCODE_TERMINAL_ACTION } from './permissions.js'

const opencodeId = (max: number) => z.string().trim().min(1).max(max).regex(OPENCODE_ID_PATTERN)

/** A program the PTY manager starts: file, arguments and the complete environment. */
type TuiCommand = { file: string; args: string[]; env: Record<string, string> }

/** Unknown keys (such as the retired isolatedConfig) are dropped; a wrong type is a 400. */
const settingsPatch = z.object({
  enabled: z.boolean().optional(),
  cliPath: z.string().nullable().optional(),
  attachUrl: z.string().nullable().optional(),
  maxPtySessions: z.number().int().optional(),
  defaultCols: z.number().int().optional(),
  defaultRows: z.number().int().optional(),
  /** OpenCode model of headless tasks; null = OpenCode's default. */
  model: z.object({
    providerID: opencodeId(OPENCODE_MODEL_ID_MAX),
    modelID: opencodeId(OPENCODE_MODEL_ID_MAX),
  }).strict().nullable().optional(),
  /** Reasoning variant of that model; null = the model's default. */
  variant: opencodeId(OPENCODE_VARIANT_MAX).nullable().optional(),
})

function sameModel(a: OpencodeModelRef | null | undefined, b: OpencodeModelRef | null | undefined): boolean {
  return (a?.providerID ?? null) === (b?.providerID ?? null) && (a?.modelID ?? null) === (b?.modelID ?? null)
}

/** GET /api/v1/opencode/models: the running server's models, or why there are none. */
export type OpencodeModelsResponse = OpencodeModelCatalog & { running: boolean }

/**
 * GET /api/v1/opencode/access: what the caller's own CASL ability allows on
 * the OpenCode page, so the web shows a control only to someone the server
 * would let use it (it never decides by role name itself).
 */
export interface OpencodeAccessResponse {
  /** Open and attach to an interactive terminal (manage OpenCode). */
  terminal: boolean
  /** Change the settings (manage OpenCode). */
  settings: boolean
}

/**
 * POST /sessions. The folders are never the request's: they are the named
 * conversation's own (see the route). An id that cannot be a conversation's
 * workspace folder name is a 400; unknown keys (a retired
 * `workingDirectories` list included) are dropped. Both kinds — the OpenCode
 * TUI and a plain login shell — are for a caller who may manage OpenCode.
 */
const sessionBody = z.object({
  conversationId: z.string().min(1).max(128).refine(isSafeWorkspaceSegment, 'not a conversation id'),
  cwd: z.string().max(4_096).optional(),
  kind: z.enum(['tui', 'shell']).default('tui'),
  cols: z.number().int().min(8).max(400).optional(),
  rows: z.number().int().min(4).max(200).optional(),
})

/** The conversations module's ownership rule and the stored conversation (ctx.conversations). */
export type OpencodeConversationsAccess = Pick<ConversationService, 'get' | 'ownsConversation'>

/**
 * POST /memory/search: memory_search's arguments. `sessionId` is for a
 * signed-in caller only; a plugin call's session is the one its proof names
 * (a different one here is refused). Unknown keys are dropped.
 */
const memorySearchBody = z.object({
  query: z.string().trim().min(1).max(4_000),
  /** Clamped to 1..20 rather than refused: the model sees the EYAS tool's own unbounded argument. */
  limit: z.number().finite().optional().transform((v) => (v === undefined ? undefined : Math.min(Math.max(Math.trunc(v), 1), 20))),
  sessionId: z.string().min(1).max(200).optional(),
})

/** POST /memory/expand: memory_expand's argument (and, for a signed-in caller, a session id). */
const memoryExpandBody = z.object({
  id: z.string().trim().min(1).max(1_024),
  sessionId: z.string().min(1).max(200).optional(),
})

function userIdOf(c: { get: (key: never) => unknown }): string {
  const value = (c.get as (key: string) => unknown)('userId')
  return typeof value === 'string' ? value : ''
}

/** The Hono context key of a redeemed plugin proof (its key's tokenId and its session). */
const PLUGIN_CALL = 'opencodePluginCall'

/** The memory tools the plugin may run through these routes: nothing else. */
const PLUGIN_MEMORY_TOOLS: ReadonlySet<string> = new Set(['memory_search', 'memory_expand'])

/** The part of ctx.tools the memory routes use: the one executor, which also masks memory output. */
export interface OpencodeToolsAccess {
  registry: { has(name: string): boolean }
  executor: Pick<ReturnType<typeof createToolExecutor>, 'execute' | 'renderForModel'>
}

export function createOpencodeRoutes(
  app: Hono,
  deps: {
    runner: CliRunner
    load(): OpencodeSettings
    save(s: OpencodeSettings): void
    pty: PtyManager
    opencode: OpencodeRunner
    /** ctx.tools, read per call: the registered memory tools and the executor that runs them. */
    getTools: () => OpencodeToolsAccess | undefined
    /**
     * The live plugin keys: a bearer is a plugin call only as a fresh, unused
     * proof for one session, made with the key of a process that still runs.
     */
    pluginTokens: Pick<PluginTokenRegistry, 'redeem'>
    /** What each EYAS-created OpenCode session acts for (in process only). */
    sessions: Pick<OpencodeSessionBindings, 'lookup'>
    /**
     * ctx.conversations, read per call: whether the caller may open a
     * conversation (its own ownsConversation rule) and the conversation's
     * stored folders. Absent: every terminal request is refused (fail closed).
     */
    getConversations: () => OpencodeConversationsAccess | undefined
    /** How an OpenCode terminal is started (isolation.ts buildTuiCommand). */
    resolveTuiCommand: () => TuiCommand | Promise<TuiCommand>
    /**
     * How a plain shell is started (isolation.ts buildShellCommand): the
     * terminal's filtered environment, never the server's process.env.
     */
    resolveShellCommand: () => TuiCommand | Promise<TuiCommand>
    logger?: Logger
  },
): void {
  // Actions (permissions.ts): read = the page and the caller's own terminals'
  // list and close; create = headless use (the memory API below); manage =
  // settings and opening or attaching to a terminal.
  app.get('/api/v1/opencode/status', requirePermission('read', OPENCODE_SUBJECT), async (c) => {
    const status = await doctorOpencode(deps.runner, deps.load(), {
      serverUrl: deps.opencode.serverUrl(),
      serverVersion: deps.opencode.serverVersion(),
    })
    return c.json(status)
  })

  app.get('/api/v1/opencode/access', requirePermission('read', OPENCODE_SUBJECT), (c) => {
    const ability = (c.get as (key: string) => unknown)('ability') as { can?: (action: string, subject: string) => boolean } | undefined
    const can = (action: string) => ability?.can?.(action, OPENCODE_SUBJECT) === true
    return c.json({ terminal: can(OPENCODE_TERMINAL_ACTION), settings: can('manage') } satisfies OpencodeAccessResponse)
  })

  app.get('/api/v1/opencode/settings', requirePermission('read', OPENCODE_SUBJECT), (c) => {
    return c.json(deps.load())
  })

  app.put('/api/v1/opencode/settings', requirePermission('manage', OPENCODE_SUBJECT), async (c) => {
    const body = await c.req.json().catch(() => undefined)
    const parsed = settingsPatch.safeParse(body)
    if (!parsed.success) {
      return c.json({ error: 'invalid settings payload', issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) }, 400)
    }
    const current = deps.load()
    const patch = parsed.data
    const merged: Partial<OpencodeSettings> = { ...current, ...patch }
    // Another model starts at its own default variant unless the patch names one:
    // the old model's variant may not exist on the new one.
    if (patch.model !== undefined && patch.variant === undefined && !sameModel(patch.model, current.model)) {
      merged.variant = null
    }
    const next = normalizeOpencodeSettings(merged)
    deps.save(next)
    return c.json(next)
  })

  // The models and reasoning variants of the running OpenCode server. Read
  // only: it never starts a server (that happens with the first session or
  // task), so an idle install answers running:false and the page says so.
  app.get('/api/v1/opencode/models', requirePermission('read', OPENCODE_SUBJECT), async (c) => {
    const client = deps.opencode.client()
    if (!client) return c.json({ running: false, providers: [], defaults: {} } satisfies OpencodeModelsResponse)
    try {
      const catalog = await client.listProviders()
      return c.json({ running: true, ...catalog } satisfies OpencodeModelsResponse)
    } catch (err) {
      deps.logger?.warn({ err }, 'OpenCode model list failed')
      return c.json({ error: 'OpenCode model list unavailable', code: 'OPENCODE_MODELS_UNAVAILABLE' }, 502)
    }
  })

  // Any terminal — the OpenCode TUI or a plain shell — needs manage
  // OpenCode, checked before the body is read or anything is looked up. A
  // plain shell runs as the EYAS server's OS user with no folder jail and no
  // approval step; in the TUI the person at the keyboard approves OpenCode's
  // tool calls themselves (the security gate answers only EYAS-started
  // headless tasks) and OpenCode has no kernel sandbox, so it is effectively
  // the same shell. The owner's and an admin's by default.
  app.post('/api/v1/opencode/sessions', requirePermission(OPENCODE_TERMINAL_ACTION, OPENCODE_SUBJECT), async (c) => {
    const body = await c.req.json().catch(() => ({}))
    const parsed = sessionBody.safeParse(body)
    if (!parsed.success) return c.json({ error: 'invalid session payload' }, 400)
    const settings = normalizeOpencodeSettings(deps.load())
    if (!settings.enabled) return c.json({ error: 'OpenCode is disabled' }, 409)
    const userId = userIdOf(c)
    if (!userId) return c.json({ error: 'unauthorized' }, 401)

    // The terminal belongs to one conversation the caller may open, by the
    // conversations module's own rule (ownsConversation: the owner, or for a
    // team/delegation child the nearest human owner up its chain — no admin
    // override, as on every conversation route). Anything else is a 404,
    // never a hint that the conversation exists, and no workspace folder is
    // created for it.
    const conversations = deps.getConversations()
    if (!conversations) {
      deps.logger?.warn('OpenCode terminal refused: the conversations module is not available')
      return c.json({ error: 'conversations unavailable' }, 503)
    }
    const conversationId = parsed.data.conversationId
    const conversation = conversations.ownsConversation(conversationId, userId) ? conversations.get(conversationId) : null
    if (!conversation) return c.json({ error: 'not found' }, 404)

    let cwd: string
    let workingDirectories: string[]
    // Stored folders a protection rule refuses now: left out, and the user is told.
    let notices: Array<{ code: 'folderRefused'; params: { path: string; reason: string } }> = []
    try {
      // The conversation's own EYAS workspace (never the install root).
      const fallback = ensureConversationWorkspace(conversation.id)
      // The folders are the conversation's stored Folders — the ones every
      // other CLI run of it works in — read here, never taken from the
      // request, else its own workspace. A requested cwd must lie inside
      // them.
      const stored = parseWorkingDirectories(conversation.workingDirectories)
      const roots = stored.length > 0 ? stored : [fallback]
      // Every folder — the requested cwd too — passes the screening of every
      // other CLI run (K2), and a conversation workspace is one only of this
      // conversation or of its owner's own conversations (the caller's: only
      // an owner gets this far), as written and after realpath. So a folder
      // stored before that rule, or a symlink, cannot open another user's
      // workspace: it is left out, and the user is told.
      const mayUseWorkspace = conversationWorkspaceAccess(conversation.id, userId, (cid, uid) => conversations.ownsConversation(cid, uid))
      const folders = resolveTuiFolders({
        requested: parsed.data.cwd,
        workingDirectories: roots,
        fallback,
        screen: (raw) => screenStoredWorkingDirectories(raw, { mayUseWorkspace }),
      })
      cwd = folders.cwd
      workingDirectories = folders.workingDirectories
      notices = folders.refused.map((r) => {
        const { code, params } = folderRefusedNotice(r)
        return { code, params }
      })
      if (folders.refused.length > 0) {
        deps.logger?.warn({ conversationId, kind: parsed.data.kind, refused: folders.refused.map((r) => r.code) }, 'OpenCode terminal: stored folder refused — left out')
      }
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 400)
    }

    if (parsed.data.kind === 'tui') {
      try {
        await deps.opencode.ensureServer()
      } catch (err) {
        return c.json({ error: err instanceof Error ? err.message : String(err) }, 503)
      }
    }

    let cmd: TuiCommand
    try {
      cmd = parsed.data.kind === 'tui' ? await deps.resolveTuiCommand() : await deps.resolveShellCommand()
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 503)
    }

    try {
      const rec = deps.pty.create(
        {
          userId,
          conversationId,
          kind: parsed.data.kind,
          cwd,
          workingDirectories,
          cols: parsed.data.cols ?? settings.defaultCols,
          rows: parsed.data.rows ?? settings.defaultRows,
        },
        cmd,
      )
      return c.json({
        ...rec,
        wsPath: `/api/v1/opencode/terminal/${rec.id}`,
        notices,
      })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 400)
    }
  })

  // Listing and closing act only on the caller's own terminals (another
  // user's id is the same 404 as a missing one). Neither opens or reaches a
  // terminal, so read is enough: someone who lost manage OpenCode can still
  // close a terminal left over from before, never attach to it.
  app.get('/api/v1/opencode/sessions', requirePermission('read', OPENCODE_SUBJECT), (c) => {
    const userId = userIdOf(c)
    return c.json({ sessions: deps.pty.listForUser(userId) })
  })

  app.delete('/api/v1/opencode/sessions/:id', requirePermission('read', OPENCODE_SUBJECT), (c) => {
    const id = c.req.param('id')
    const userId = userIdOf(c)
    const rec = deps.pty.get(id)
    if (!rec || rec.userId !== userId) return c.json({ error: 'not found' }, 404)
    deps.pty.destroy(id)
    return c.json({ ok: true })
  })

  // ── EYAS memory for OpenCode (the plugin's memory_search / memory_expand) ──
  //
  // Auth: a plugin call — a bearer that is a session proof (plugin-tokens.ts):
  // made with the key of an OpenCode process EYAS runs now, fresh, not used
  // before, for exactly one session — else a signed-in caller with create
  // OpenCode (headless use: the agent role, and the owner and admins through
  // manage; not the user role by default). The auth module lets exactly these
  // two paths through its deny-by-default check for a valid proof only
  // (delegated-bearer.ts); here the proof is used up. A forged, stale,
  // replayed or dead-key proof is a 401, a CASL denial a 403.
  const requirePluginOrCreate: MiddlewareHandler = async (c, next) => {
    const auth = c.req.header('authorization') ?? ''
    const bearer = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
    if (isSessionProof(bearer)) {
      const proven = deps.pluginTokens.redeem(bearer)
      if (!proven) return c.json({ text: 'Error: this OpenCode memory call is not proven for its session', isError: true }, 401)
      ;(c.set as (key: string, value: unknown) => void)(PLUGIN_CALL, proven)
      await next()
      return
    }
    return requirePermission('create', OPENCODE_SUBJECT)(c, next)
  }

  /**
   * Run one EYAS memory tool for the plugin, through the one executor (its
   * gate, CASL, drill budget, access log) and its renderForModel (the privacy
   * mask for a remote destination — OpenCode can run any model). A plugin
   * call acts for the one session its proof names — a body naming another
   * session is refused (403) — and gets that session's binding when it was
   * bound under the same key: the bound conversation's project, its turn's
   * drill budget. A signed-in caller names a session in the body and gets its
   * binding only as the bound user. Anything else — a session EYAS did not
   * bind (an OpenCode terminal's), one bound under another key, a signed-in
   * caller who is not the bound user, no session — reads global memory only.
   */
  async function runMemoryTool(c: Context, toolName: string, args: Record<string, unknown>, bodySessionId: string | undefined) {
    const get = c.get as (key: string) => unknown
    const proven = get(PLUGIN_CALL) as ProvenPluginCall | undefined
    if (proven && bodySessionId !== undefined && bodySessionId !== proven.sessionId) {
      return c.json({ text: 'Error: an OpenCode memory call may act only for its own session', isError: true }, 403)
    }
    const tools = deps.getTools()
    if (!tools || !tools.registry.has(toolName)) {
      return c.json({ text: 'Error: EYAS memory is not ready yet — try again shortly', isError: true }, 503)
    }
    const caller: OpencodeSessionCaller = proven
      ? { kind: 'plugin', tokenId: proven.tokenId }
      : { kind: 'user', userId: userIdOf(c) }
    const binding = deps.sessions.lookup(proven ? proven.sessionId : bodySessionId, caller)
    const actor: ToolActor = caller.kind === 'plugin'
      ? { kind: binding ? 'agent' : 'external', role: 'agent' }
      : {
          kind: binding ? 'user' : 'external',
          role: typeof get('role') === 'string' ? (get('role') as string) : 'guest',
          ...(get('ability') ? { ability: get('ability') as ToolAbility } : {}),
        }
    const toolCtx = memoryToolContext(binding, actor, caller.kind === 'user' ? caller.userId : 'opencode-plugin', deps.logger)
    const out: ToolOutputContext = binding
      ? {
          transport: 'opencode',
          conversationId: binding.conversationId,
          ...(binding.runId ? { runId: binding.runId } : {}),
          ...(binding.agentId ? { agentId: binding.agentId } : {}),
          ...(binding.turnId ? { turnId: binding.turnId } : {}),
        }
      : { transport: 'opencode' }
    try {
      const result = await tools.executor.execute(toolName, args, toolCtx)
      return c.json(tools.executor.renderForModel(toolName, result, out))
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      deps.logger?.warn({ err: message, tool: toolName }, 'OpenCode memory tool call failed')
      return c.json(tools.executor.renderForModel(toolName, { success: false, error: message }, out))
    }
  }

  // Literal paths (= plugin-source.ts OPENCODE_MEMORY_*_PATH): the auth-coverage
  // contract test scans route registrations textually.
  app.post('/api/v1/opencode/memory/search', requirePluginOrCreate, async (c) => {
    const parsed = memorySearchBody.safeParse(await c.req.json().catch(() => undefined))
    if (!parsed.success) return c.json({ text: 'Error: invalid memory_search arguments', isError: true }, 400)
    const { sessionId, ...args } = parsed.data
    return runMemoryTool(c, 'memory_search', args, sessionId)
  })

  app.post('/api/v1/opencode/memory/expand', requirePluginOrCreate, async (c) => {
    const parsed = memoryExpandBody.safeParse(await c.req.json().catch(() => undefined))
    if (!parsed.success) return c.json({ text: 'Error: invalid memory_expand arguments', isError: true }, 400)
    const { sessionId, ...args } = parsed.data
    return runMemoryTool(c, 'memory_expand', args, sessionId)
  })
}

/**
 * The ToolContext of one plugin memory call: built from the binding, never
 * from the request. Bound: the conversation (its project lock), its turn (the
 * shared drill budget), run and agent. Unbound: an 'external' caller with no
 * conversation, which the memory tools answer from global memory only.
 */
function memoryToolContext(
  binding: OpencodeSessionBinding | null,
  actor: ToolActor,
  callerUserId: string,
  logger: Logger | undefined,
): ToolContext {
  const log = (logger ?? SILENT) as unknown as Logger
  if (!binding) {
    return { conversationId: '', userId: callerUserId, logger: log, actor, allowedTools: PLUGIN_MEMORY_TOOLS }
  }
  return {
    conversationId: binding.conversationId,
    userId: binding.userId,
    ...(binding.agentId ? { agentId: binding.agentId } : {}),
    ...(binding.turnId ? { turnId: binding.turnId } : {}),
    ...(binding.runId ? { runId: binding.runId } : {}),
    logger: log,
    actor,
    allowedTools: PLUGIN_MEMORY_TOOLS,
  }
}

const noop = (): void => undefined
const SILENT = { trace: noop, debug: noop, info: noop, warn: noop, error: noop, fatal: noop, child: () => SILENT }

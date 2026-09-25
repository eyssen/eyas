// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { existsSync, mkdirSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { installPathPolicy, resetPathPolicyForTests } from '@shared/memory-sovereignty/path-policy.js'
import { createSovereigntyFixture, type SovereigntyFixture } from '../../helpers/memory-sovereignty-fixture.js'
import { createTestDb } from '../../helpers/test-db'
import { createConversationService, type ConversationService } from '@modules/conversations/conversation-service'
import { createOpencodeRoutes } from '@modules/opencode/routes'
import { normalizeOpencodeSettings } from '@modules/opencode/settings-store'
import type { OpencodeSettings, PtySessionRecord } from '@modules/opencode/types'
import type { PtyManager } from '@modules/opencode/pty-manager'
import type { OpencodeRunner } from '@modules/opencode/opencode-runner'
import { OPENCODE_PERMISSIONS, OPENCODE_SUBJECT } from '@modules/opencode/permissions'
import { buildAbilityForRole } from '@modules/permissions/roles'
import { createPermissionRegistry } from '@modules/permissions/registry'
import type { RoleId } from '@modules/permissions/types'

/** The real CASL registry with the OpenCode subject as the module registers it. */
const permissions = createPermissionRegistry()
permissions.registerSubject(OPENCODE_SUBJECT, OPENCODE_PERMISSIONS)

const testDb = createTestDb('opencode-routes')
let db: ReturnType<typeof testDb.open>
let conversations: ConversationService

beforeEach(() => {
  db = testDb.open()
  conversations = createConversationService(db)
})
afterEach(() => testDb.cleanup())

/** A stored conversation with a fixed id (the fixture's workspaces are named by id). */
function conversation(id: string, userId: string, opts: { folders?: unknown; parent?: string } = {}): void {
  const now = new Date().toISOString()
  const folders = opts.folders === undefined ? null : JSON.stringify(opts.folders)
  db.run(sql`INSERT INTO conversations (id, user_id, parent_conversation_id, working_directories, created_at, updated_at)
    VALUES (${id}, ${userId}, ${opts.parent ?? null}, ${folders}, ${now}, ${now})`)
}

type Caller = { id: string; role?: RoleId }

/**
 * The routes as `caller`, under the real CASL middleware and the module's
 * own defaults. The caller is the owner unless a test names another role:
 * every terminal needs manage OpenCode.
 */
function app(opts: { caller?: Caller; settings?: { settings: OpencodeSettings }; conversations?: ConversationService | null } = {}) {
  const store = opts.settings ?? { settings: normalizeOpencodeSettings({}) }
  const caller = opts.caller ?? { id: 'u1', role: 'owner' }
  const created: Array<{ userId: string; conversationId: string; kind: string; cwd?: string; workingDirectories?: string[] }> = []
  const commands: Array<{ file: string; args: string[]; env: Record<string, string> }> = []
  const ensureServer = vi.fn(async () => ({}))
  const shellCommand = { file: '/bin/sh', args: ['-l'], env: { PATH: '/usr/bin', HOME: '/eyas-owned/opencode' } }
  const live = new Map<string, PtySessionRecord>()
  const destroyed: string[] = []
  const pty = {
    create: (
      input: { userId: string; conversationId: string; kind: 'tui' | 'shell'; cwd?: string; workingDirectories?: string[] },
      cmd: { file: string; args: string[]; env: Record<string, string> },
    ) => {
      created.push(input)
      commands.push(cmd)
      const rec = { id: `pty${created.length}`, userId: input.userId, conversationId: input.conversationId, kind: input.kind, cwd: input.cwd ?? '', cols: 80, rows: 24, pid: 1, state: 'running', createdAt: 0, lastActivityAt: 0 } satisfies PtySessionRecord
      live.set(rec.id, rec)
      return rec
    },
    get: (id: string) => live.get(id),
    listForUser: (userId: string) => [...live.values()].filter((r) => r.userId === userId),
    destroy: (id: string) => {
      destroyed.push(id)
      live.delete(id)
    },
  } as unknown as PtyManager
  const hono = new Hono()
  hono.onError((err, c) => c.json({ error: err.message }, ((err as { status?: number }).status ?? 500) as 403))
  hono.use('*', async (c, next) => {
    const set = c.set as (k: string, v: unknown) => void
    set('userId', caller.id)
    set('role', caller.role ?? 'owner')
    // The owner and an admin may manage OpenCode: the conversation rule still applies.
    set('ability', buildAbilityForRole(caller.role ?? 'owner', permissions))
    await next()
  })
  const access = opts.conversations === undefined ? conversations : opts.conversations
  createOpencodeRoutes(hono, {
    runner: { which: async () => null, run: async () => ({ code: 0, stdout: '', stderr: '' }) },
    load: () => store.settings,
    save: (s) => { store.settings = s },
    pty,
    opencode: { ensureServer } as unknown as OpencodeRunner,
    getTools: () => undefined,
    pluginTokens: { redeem: () => null },
    sessions: { lookup: () => null },
    getConversations: () => access ?? undefined,
    resolveTuiCommand: () => ({ file: 'opencode', args: [], env: {} }),
    resolveShellCommand: () => shellCommand,
  })
  const open = async (body: Record<string, unknown>) => {
    const res = await hono.request('/api/v1/opencode/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    return {
      status: res.status,
      body: await res.json() as { error?: string; notices?: Array<{ code: string; params: { path: string; reason: string } }> },
    }
  }
  return { hono, open, created, commands, ensureServer, live, destroyed }
}

describe('opencode routes', () => {
  it('opens a shell session in the conversation workspace when no folder is given', async () => {
    conversation('conv-route-1', 'u1')
    const { open, created } = app({ caller: { id: 'u1', role: 'owner' } })
    const res = await open({ conversationId: 'conv-route-1', kind: 'shell' })
    expect(res.status).toBe(200)
    expect(created[0]?.cwd).toBe(join(process.env.EYAS_WORKSPACES_DIR!, 'conv-route-1'))
  })

  it('(−) a `user` gets 403 for the OpenCode TUI and for a shell, before anything is looked up or started', async () => {
    conversation('conv-route-2', 'u1')
    const { open, created, ensureServer } = app({ caller: { id: 'u1', role: 'user' } })
    const tui = await open({ conversationId: 'conv-route-2', kind: 'tui' })
    const shell = await open({ conversationId: 'conv-route-2', kind: 'shell' })
    const defaultKind = await open({ conversationId: 'conv-route-2' })
    // The same answer for an id that does not exist, and for a malformed body:
    // the terminal right is checked first.
    const ghost = await open({ conversationId: 'conv-route-ghost', kind: 'tui' })
    const malformed = await open({ conversationId: '../../outside', kind: 'tui' })
    expect([tui.status, shell.status, defaultKind.status, ghost.status, malformed.status]).toEqual([403, 403, 403, 403, 403])
    expect(tui.body).toEqual(ghost.body)
    expect(shell.body).toEqual(tui.body)
    expect(tui.body.error).toBe('Forbidden: cannot manage OpenCode')
    expect(created).toHaveLength(0)
    expect(ensureServer).not.toHaveBeenCalled()
    expect(existsSync(join(process.env.EYAS_WORKSPACES_DIR!, 'conv-route-ghost'))).toBe(false)
  })

  it('(−) the agent role (create OpenCode: headless use) and a guest open no terminal either', async () => {
    conversation('conv-route-agent', 'agent-1')
    for (const role of ['agent', 'guest'] as const) {
      const { open, created } = app({ caller: { id: 'agent-1', role } })
      expect((await open({ conversationId: 'conv-route-agent', kind: 'tui' })).status, role).toBe(403)
      expect((await open({ conversationId: 'conv-route-agent', kind: 'shell' })).status, role).toBe(403)
      expect(created, role).toHaveLength(0)
    }
  })

  it('(+) the owner and an admin open the OpenCode TUI and a shell in their own conversation', async () => {
    for (const role of ['owner', 'admin'] as const) {
      const id = `conv-route-${role}`
      conversation(id, `${role}-1`)
      const { open, created, ensureServer } = app({ caller: { id: `${role}-1`, role } })
      const tui = await open({ conversationId: id, kind: 'tui' })
      const shell = await open({ conversationId: id, kind: 'shell' })
      expect([tui.status, shell.status], role).toEqual([200, 200])
      expect(ensureServer, role).toHaveBeenCalledOnce()
      expect(created.map((c) => [c.userId, c.kind]), role).toEqual([[`${role}-1`, 'tui'], [`${role}-1`, 'shell']])
    }
  })

  it('(+/−) listing and closing act on the caller\'s own terminals only; a `user` (read) may close a leftover one, never another user\'s', async () => {
    const now = { cols: 80, rows: 24, pid: 1, state: 'running' as const, createdAt: 0, lastActivityAt: 0, cwd: '' }
    const asUser = app({ caller: { id: 'u1', role: 'user' } })
    // A terminal opened before the caller lost the right, and one of another user.
    asUser.live.set('mine', { id: 'mine', userId: 'u1', conversationId: 'c1', kind: 'tui', ...now })
    asUser.live.set('theirs', { id: 'theirs', userId: 'u2', conversationId: 'c2', kind: 'shell', ...now })
    const listed = await asUser.hono.request('/api/v1/opencode/sessions')
    expect(listed.status).toBe(200)
    expect(((await listed.json()) as { sessions: Array<{ id: string }> }).sessions.map((r) => r.id)).toEqual(['mine'])
    const other = await asUser.hono.request('/api/v1/opencode/sessions/theirs', { method: 'DELETE' })
    const ghost = await asUser.hono.request('/api/v1/opencode/sessions/nope', { method: 'DELETE' })
    expect([other.status, ghost.status]).toEqual([404, 404])
    expect(await other.json()).toEqual(await ghost.json())
    expect((await asUser.hono.request('/api/v1/opencode/sessions/mine', { method: 'DELETE' })).status).toBe(200)
    expect(asUser.destroyed).toEqual(['mine'])
    // A guest has no OpenCode right at all.
    const guest = app({ caller: { id: 'u2', role: 'guest' } })
    guest.live.set('theirs', { id: 'theirs', userId: 'u2', conversationId: 'c2', kind: 'shell', ...now })
    expect((await guest.hono.request('/api/v1/opencode/sessions/theirs', { method: 'DELETE' })).status).toBe(403)
    expect(guest.destroyed).toEqual([])
  })

  it('GET /access reports the caller\'s own CASL answer: terminals and settings for the owner and an admin, neither for a user', async () => {
    const answers: Record<string, unknown> = {}
    for (const role of ['owner', 'admin', 'user'] as const) {
      const res = await app({ caller: { id: 'u1', role } }).hono.request('/api/v1/opencode/access')
      answers[role] = [res.status, await res.json()]
    }
    expect(answers).toEqual({
      owner: [200, { terminal: true, settings: true }],
      admin: [200, { terminal: true, settings: true }],
      user: [200, { terminal: false, settings: false }],
    })
    // Without read OpenCode (a guest, and the agent role) there is nothing to show.
    expect((await app({ caller: { id: 'g1', role: 'guest' } }).hono.request('/api/v1/opencode/access')).status).toBe(403)
    expect((await app({ caller: { id: 'a1', role: 'agent' } }).hono.request('/api/v1/opencode/access')).status).toBe(403)
  })

  it('(+) the shell starts with the command the module builds (filtered environment), never the server\'s process.env', async () => {
    conversation('conv-route-3', 'u1')
    vi.stubEnv('EYAS_MASTER_KEY', 'route-test-master-key')
    try {
      const { open, commands } = app({ caller: { id: 'u1', role: 'admin' } })
      expect((await open({ conversationId: 'conv-route-3', kind: 'shell' })).status).toBe(200)
      expect(commands[0]).toEqual({ file: '/bin/sh', args: ['-l'], env: { PATH: '/usr/bin', HOME: '/eyas-owned/opencode' } })
      expect(JSON.stringify(commands[0])).not.toContain('route-test-master-key')
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('refuses a conversation id that is not a safe folder name', async () => {
    const { open, created } = app()
    const res = await open({ conversationId: '../../outside', kind: 'shell' })
    expect(res.status).toBe(400)
    expect(created).toHaveLength(0)
  })

  it('drops the retired isolatedConfig key from a settings update', async () => {
    const store = { settings: normalizeOpencodeSettings({}) }
    const { hono } = app({ settings: store })
    const res = await hono.request('/api/v1/opencode/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isolatedConfig: false, maxPtySessions: 2 }),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body).not.toHaveProperty('isolatedConfig')
    expect(body.maxPtySessions).toBe(2)
    expect(store.settings).not.toHaveProperty('isolatedConfig')
  })
})

describe('OpenCode terminal — only for a conversation the caller may open', () => {
  let f: SovereigntyFixture

  beforeEach(() => {
    f = createSovereigntyFixture()
    f.stubInstanceEnv()
    installPathPolicy(f.policy)
    // conv-1 (u1) and conv-2 (u2) are the fixture's two workspaces; conv-3 is u2's second one.
    conversation('conv-1', 'u1')
    conversation('conv-2', 'u2')
    conversation('conv-3', 'u2')
  })
  afterEach(() => {
    resetPathPolicyForTests()
    vi.unstubAllEnvs()
    f.cleanup()
  })

  it('(+) the owner opens a terminal (TUI and shell) in the conversation\'s own workspace', async () => {
    const { open, created, ensureServer } = app({ caller: { id: 'u1', role: 'owner' } })
    const tui = await open({ conversationId: 'conv-1', kind: 'tui' })
    const shell = await open({ conversationId: 'conv-1', kind: 'shell' })
    expect([tui.status, shell.status]).toEqual([200, 200])
    expect(ensureServer).toHaveBeenCalledOnce()
    expect(created.map((c) => [c.userId, c.conversationId, c.kind, c.cwd])).toEqual([
      ['u1', 'conv-1', 'tui', f.ownWorkspace],
      ['u1', 'conv-1', 'shell', f.ownWorkspace],
    ])
  })

  it('(−) another user\'s conversation id is a 404 for the TUI and the shell: nothing starts, nothing is revealed', async () => {
    const { open, created, ensureServer } = app({ caller: { id: 'u2', role: 'admin' } })
    const tui = await open({ conversationId: 'conv-1', kind: 'tui' })
    const shell = await open({ conversationId: 'conv-1', kind: 'shell', cwd: f.ownWorkspace })
    // Same answer as an id that does not exist at all.
    const ghost = await open({ conversationId: 'conv-ghost', kind: 'tui' })
    expect([tui.status, shell.status, ghost.status]).toEqual([404, 404, 404])
    expect(tui.body).toEqual(ghost.body)
    expect(shell.body).toEqual(ghost.body)
    expect(created).toHaveLength(0)
    expect(ensureServer).not.toHaveBeenCalled()
    // No workspace folder is made for an id the caller may not open.
    expect(existsSync(join(f.workspacesRoot, 'conv-ghost'))).toBe(false)
  })

  it('(−) an admin gets no override: another user\'s conversation is a 404, the admin\'s own opens', async () => {
    conversation('conv-admin', 'admin-1')
    const { open, created } = app({ caller: { id: 'admin-1', role: 'admin' } })
    expect((await open({ conversationId: 'conv-1', kind: 'tui' })).status).toBe(404)
    expect((await open({ conversationId: 'conv-1', kind: 'shell' })).status).toBe(404)
    expect(created).toHaveLength(0)
    expect((await open({ conversationId: 'conv-admin', kind: 'shell' })).status).toBe(200)
    expect(created[0]?.conversationId).toBe('conv-admin')
  })

  it('(+) a team/delegation child stamped \'system\' opens for its human owner only (the conversations module\'s own rule)', async () => {
    conversation('conv-child', 'system', { parent: 'conv-1' })
    const owner = app({ caller: { id: 'u1', role: 'admin' } })
    expect((await owner.open({ conversationId: 'conv-child', kind: 'shell' })).status).toBe(200)
    expect((await owner.open({ conversationId: 'conv-child', kind: 'tui' })).status).toBe(200)
    const other = app({ caller: { id: 'u2', role: 'admin' } })
    expect((await other.open({ conversationId: 'conv-child', kind: 'shell' })).status).toBe(404)
    expect(other.created).toHaveLength(0)
  })

  it('(−) a forged folder cannot select another conversation\'s workspace: a cwd outside the conversation\'s folders is a 400', async () => {
    const { open, created } = app({ caller: { id: 'u2', role: 'admin' } })
    const tui = await open({ conversationId: 'conv-3', kind: 'tui', cwd: f.ownWorkspace })
    const shell = await open({ conversationId: 'conv-3', kind: 'shell', cwd: join(f.ownWorkspace, 'sub') })
    // A folder list in the body is not the conversation's: it is ignored, so it cannot widen the cwd check.
    const listed = await open({ conversationId: 'conv-3', kind: 'tui', cwd: f.ownWorkspace, workingDirectories: [f.ownWorkspace] })
    expect([tui.status, shell.status, listed.status]).toEqual([400, 400, 400])
    expect(created).toHaveLength(0)
  })

  it('(−) a folder list in the body is ignored: the terminal opens in the conversation\'s own folders', async () => {
    const { open, created } = app({ caller: { id: 'u2', role: 'admin' } })
    const tui = await open({ conversationId: 'conv-3', kind: 'tui', workingDirectories: [f.ownWorkspace] })
    const shell = await open({ conversationId: 'conv-3', kind: 'shell', workingDirectories: [f.ownWorkspace] })
    expect([tui.status, shell.status]).toEqual([200, 200])
    const own = join(f.workspacesRoot, 'conv-3')
    expect(created.map((c) => c.cwd)).toEqual([own, own])
    expect(created.map((c) => c.workingDirectories)).toEqual([[own], [own]])
  })

  it('(−) without the conversations module no terminal opens (fail closed)', async () => {
    const { open, created } = app({ caller: { id: 'u1', role: 'owner' }, conversations: null })
    const res = await open({ conversationId: 'conv-1', kind: 'shell' })
    expect(res.status).toBe(503)
    expect((await open({ conversationId: 'conv-1', kind: 'tui' })).status).toBe(503)
    expect(created).toHaveLength(0)
  })
})

describe('OpenCode terminal — a stored folder in another user\'s workspace is never the terminal\'s', () => {
  let f: SovereigntyFixture

  beforeEach(() => {
    f = createSovereigntyFixture()
    f.stubInstanceEnv()
    installPathPolicy(f.policy)
    // conv-1 is u1's; conv-2 is u2's (the fixture's two workspaces); conv-4 is u2's second one.
    conversation('conv-1', 'u1')
  })
  afterEach(() => {
    resetPathPolicyForTests()
    vi.unstubAllEnvs()
    f.cleanup()
  })

  it('(−) a folder stored before the ownership rule (u1\'s workspace on u2\'s conversation) is left out of the TUI and the shell, with a notice', async () => {
    conversation('conv-2', 'u2', { folders: [f.ownWorkspace] })
    const { open, created } = app({ caller: { id: 'u2', role: 'admin' } })
    const tui = await open({ conversationId: 'conv-2', kind: 'tui' })
    const asked = await open({ conversationId: 'conv-2', kind: 'tui', cwd: f.ownWorkspace })
    const shell = await open({ conversationId: 'conv-2', kind: 'shell', cwd: f.ownWorkspace })
    expect([tui.status, asked.status, shell.status]).toEqual([200, 200, 200])
    expect(created.map((c) => c.cwd)).toEqual([f.otherWorkspace, f.otherWorkspace, f.otherWorkspace])
    for (const c of created) expect(c.workingDirectories).toEqual([f.otherWorkspace])
    for (const res of [tui, asked, shell]) {
      expect(res.body.notices).toEqual([{ code: 'folderRefused', params: { path: f.ownWorkspace, reason: 'otherWorkspace' } }])
    }
  })

  it('(−) a symlink into another user\'s workspace is judged where it leads', async () => {
    const project = join(f.root, 'projects', 'app')
    mkdirSync(project, { recursive: true })
    mkdirSync(join(f.root, 'links'), { recursive: true })
    const link = join(f.root, 'links', 'shortcut')
    symlinkSync(f.ownWorkspace, link)
    conversation('conv-2', 'u2', { folders: [link, project] })
    const { open, created } = app({ caller: { id: 'u2', role: 'admin' } })
    const res = await open({ conversationId: 'conv-2', kind: 'tui', cwd: link })
    expect(res.status).toBe(200)
    expect(created[0]?.cwd).toBe(project)
    expect(res.body.notices?.map((n) => [n.params.path, n.params.reason])).toEqual([[link, 'otherWorkspace']])
  })

  it('(+) the workspace of another conversation of the same owner, and a team child\'s parent workspace, stay usable', async () => {
    conversation('conv-4', 'u1', { folders: [f.ownWorkspace] })
    conversation('conv-child', 'system', { parent: 'conv-1', folders: [f.ownWorkspace] })
    const { open, created } = app({ caller: { id: 'u1', role: 'owner' } })
    const sibling = await open({ conversationId: 'conv-4', kind: 'tui' })
    const child = await open({ conversationId: 'conv-child', kind: 'tui' })
    expect([sibling.status, child.status]).toEqual([200, 200])
    expect(created.map((c) => c.cwd)).toEqual([f.ownWorkspace, f.ownWorkspace])
    expect([sibling.body.notices, child.body.notices]).toEqual([[], []])
  })
})

describe('OpenCode terminal folders are screened like every CLI run (K2)', () => {
  let f: SovereigntyFixture

  beforeEach(() => {
    f = createSovereigntyFixture()
    f.stubInstanceEnv()
    installPathPolicy(f.policy)
  })
  afterEach(() => {
    resetPathPolicyForTests()
    vi.unstubAllEnvs()
    f.cleanup()
  })

  /** conv-1 of u1 with `folders` stored; the body names only the cwd. */
  function tuiApp(folders?: unknown) {
    conversation('conv-1', 'u1', { folders })
    const { open, created, ensureServer } = app({ caller: { id: 'u1' } })
    return { open: (body: Record<string, unknown>) => open({ conversationId: 'conv-1', kind: 'tui', ...body }), created, ensureServer }
  }

  it('(−) a stored folder that contains a vault is not the TUI\'s folder: the conversation workspace is, and the user is told why', async () => {
    const documents = join(f.home, 'Documents')
    mkdirSync(join(documents, 'Vault', '.obsidian'), { recursive: true })
    const { open, created } = tuiApp([documents])
    const res = await open({ cwd: documents })
    expect(res.status).toBe(200)
    expect(created[0]?.cwd).toBe(f.ownWorkspace)
    expect(created[0]?.workingDirectories).toEqual([f.ownWorkspace])
    expect(res.body.notices).toEqual([{ code: 'folderRefused', params: { path: documents, reason: 'containsVault' } }])
  })

  it('(−) a stored folder that holds the EYAS data dir is left out; an allowed one of the same list is used', async () => {
    const project = join(f.root, 'projects', 'app')
    mkdirSync(project, { recursive: true })
    const { open, created } = tuiApp([f.repo, project])
    const res = await open({ cwd: f.repo })
    expect(res.status).toBe(200)
    expect(created[0]?.cwd).toBe(project)
    expect(created[0]?.workingDirectories).toEqual([project])
    expect(res.body.notices?.map((n) => n.params.reason)).toEqual(['containsEyasData'])
  })

  it('(−) a stored home folder is left out: the terminal opens in the conversation workspace, never the home', async () => {
    const { open, created } = tuiApp([f.home])
    const res = await open({ cwd: f.home })
    expect(res.status).toBe(200)
    expect(created[0]?.cwd).toBe(f.ownWorkspace)
    expect(res.body.notices?.map((n) => n.params.reason)).toEqual(['home'])
    const alone = await open({})
    expect(alone.status).toBe(200)
    expect(created[1]?.cwd).toBe(f.ownWorkspace)
    expect(alone.body.notices?.map((n) => n.params.reason)).toEqual(['home'])
  })

  it('(−) a client asking for the home folder of a conversation without it gets a 400, never the home', async () => {
    const { open, created } = tuiApp()
    const res = await open({ cwd: f.home })
    expect(res.status).toBe(400)
    expect(created).toHaveLength(0)
  })

  it('(−) a cwd outside the conversation\'s folders is still refused', async () => {
    const project = join(f.root, 'projects', 'app')
    mkdirSync(project, { recursive: true })
    const { open, created } = tuiApp([project])
    const res = await open({ cwd: join(f.root, 'elsewhere') })
    expect(res.status).toBe(400)
    expect(created).toHaveLength(0)
  })

  it('(+) an ordinary project folder is the TUI\'s folder, with no notice', async () => {
    const project = join(f.root, 'projects', 'app')
    mkdirSync(join(project, '.claude'), { recursive: true })
    const { open, created, ensureServer } = tuiApp([project])
    const res = await open({ cwd: project })
    expect(res.status).toBe(200)
    expect(ensureServer).toHaveBeenCalledOnce()
    expect(created[0]?.cwd).toBe(project)
    expect(res.body.notices).toEqual([])
  })

  it('(+) a named stored folder works, and with no cwd the terminal opens in the first allowed one', async () => {
    const project = join(f.root, 'projects', 'app')
    mkdirSync(project, { recursive: true })
    const { open, created } = tuiApp([{ name: 'App', path: project }])
    const res = await open({})
    expect(res.status).toBe(200)
    expect(created[0]?.cwd).toBe(project)
    expect(res.body.notices).toEqual([])
  })
})

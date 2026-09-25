// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// The OpenCode CASL subject (permissions.ts): read = the page, create =
// headless use, manage = settings and the interactive terminals. The user
// role lost create in 0.8.32 (it opened the OpenCode TUI). Built-in role
// grants are not stored — every request rebuilds its ability from the
// registered defaults — so existing installs take the new default at their
// next start with nothing to migrate; these tests pin that down, and fail if
// grants ever start being stored (then the change needs a migration).
// Headless `opencode_run` is authorized on the tool path, never by this
// subject, so colleagues keep delegating to OpenCode in anyone's conversation.

import { describe, expect, it, vi } from 'vitest'
import { sql } from 'drizzle-orm'
import { createMemoryDb } from '../../helpers/test-db'
import { OPENCODE_PERMISSIONS, OPENCODE_SUBJECT, OPENCODE_TERMINAL_ACTION } from '@modules/opencode/permissions'
import { opencodeModule } from '@modules/opencode/index'
import { createOpencodeTools } from '@modules/opencode/tools'
import { normalizeOpencodeSettings } from '@modules/opencode/settings-store'
import type { DeveloperAgent } from '@modules/opencode/developer-agent'
import { permissionsModule } from '@modules/permissions/index'
import { buildAbilityForRole } from '@modules/permissions/roles'
import { createPermissionRegistry, type PermissionRegistry } from '@modules/permissions/registry'
import { ROLES, type RoleId } from '@modules/permissions/types'
import { createToolRegistry } from '@modules/tools/tool-registry'
import { createToolExecutor } from '@modules/tools/tool-executor'
import type { ToolActor, ToolContext } from '@modules/tools/types'
import type { ModuleContext } from '@core/types'

const silent: any = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), trace: vi.fn(), fatal: vi.fn(), child: () => silent }

/** A boot as the module loader runs it: the permissions module, then OpenCode's onRegister. */
async function boot(db: ReturnType<typeof createMemoryDb>, registry: PermissionRegistry = createPermissionRegistry()) {
  const ctx = { db, logger: silent, permissions: registry } as unknown as ModuleContext
  await permissionsModule.onRegister!(ctx)
  await permissionsModule.onStart!(ctx)
  await opencodeModule.onRegister!(ctx)
  return registry
}

function matrix(registry: PermissionRegistry): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const role of ROLES) {
    const ability = buildAbilityForRole(role, registry)
    out[role] = OPENCODE_PERMISSIONS.actions.filter((action) => ability.can(action, OPENCODE_SUBJECT))
  }
  return out
}

describe('OpenCode permissions — what each role may do', () => {
  it('owner and admin: everything (manage covers read and create); user: read only; agent: create only; guest: nothing', async () => {
    const registry = await boot(createMemoryDb())
    expect(matrix(registry)).toEqual({
      owner: ['read', 'create', 'manage'],
      admin: ['read', 'create', 'manage'],
      user: ['read'],
      agent: ['create'],
      guest: [],
    })
  })

  it('a terminal needs manage — the right the plain shell already needed', () => {
    expect(OPENCODE_TERMINAL_ACTION).toBe('manage')
    expect(OPENCODE_PERMISSIONS.defaults.user).not.toContain('create')
  })
})

describe('OpenCode permissions — the new default reaches every install without a migration', () => {
  it('fresh install: the permissions module stores role names only, no grants', async () => {
    const db = createMemoryDb()
    await boot(db)
    const tables = (db.all(sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`) as { name: string }[]).map((t) => t.name)
    // opencode_settings is the module's own settings row, not a grant.
    expect(tables).toEqual(['opencode_settings', 'roles'])
    const columns = (db.all(sql`PRAGMA table_info(roles)`) as { name: string }[]).map((c) => c.name)
    expect(columns).toEqual(['id', 'name', 'description', 'is_system', 'created_at'])
    expect((db.all(sql`SELECT id FROM roles ORDER BY id`) as { id: string }[]).map((r) => r.id)).toEqual(['admin', 'agent', 'guest', 'owner', 'user'])
  })

  it('upgraded install: a user who could open the TUI before cannot after the next start; owner and admin keep it', async () => {
    const db = createMemoryDb()
    db.run(sql`CREATE TABLE users (id TEXT PRIMARY KEY, role TEXT NOT NULL, status TEXT NOT NULL)`)
    db.run(sql`INSERT INTO users (id, role, status) VALUES ('u-user', 'user', 'active'), ('u-admin', 'admin', 'active'), ('u-owner', 'owner', 'active')`)
    // The previous release's registration, as the running server had it.
    const before = createPermissionRegistry()
    before.registerSubject(OPENCODE_SUBJECT, { actions: ['read', 'create', 'manage'], defaults: { owner: ['manage'], admin: ['manage'], user: ['read', 'create'], agent: ['create'], guest: [] } })
    expect(buildAbilityForRole('user', before).can('create', OPENCODE_SUBJECT)).toBe(true)
    // The restart: a new registry from this release's module, the same database.
    const after = await boot(db)
    const roleOf = (id: string) => (db.all(sql`SELECT role FROM users WHERE id = ${id}`) as { role: RoleId }[])[0].role
    const can = (id: string, action: string) => buildAbilityForRole(roleOf(id), after).can(action, OPENCODE_SUBJECT)
    expect([can('u-user', 'read'), can('u-user', 'create'), can('u-user', 'manage')]).toEqual([true, false, false])
    expect([can('u-admin', 'manage'), can('u-owner', 'manage')]).toEqual([true, true])
  })

  it('re-run: a second start seeds nothing twice and changes no answer', async () => {
    const db = createMemoryDb()
    const first = matrix(await boot(db))
    // The same process registering again is refused and ignored (index.ts try/catch).
    const registry = createPermissionRegistry()
    await boot(db, registry)
    await opencodeModule.onRegister!({ db, logger: silent, permissions: registry } as unknown as ModuleContext)
    expect(registry.getRegisteredSubjects().filter((s) => s.subject === OPENCODE_SUBJECT)).toHaveLength(1)
    expect(matrix(registry)).toEqual(first)
    expect((db.all(sql`SELECT COUNT(*) AS n FROM roles`) as { n: number }[])[0].n).toBe(5)
  })
})

describe('headless OpenCode tasks are unchanged by the terminal rule', () => {
  function executorWith(run: DeveloperAgent['run']) {
    const registry = createPermissionRegistry()
    registry.registerSubject(OPENCODE_SUBJECT, OPENCODE_PERMISSIONS)
    const tools = createToolRegistry()
    for (const tool of createOpencodeTools({
      getRunner: () => undefined,
      getSettings: () => normalizeOpencodeSettings({}),
      getAgent: () => ({ run } as unknown as DeveloperAgent),
    })) tools.register(tool)
    return createToolExecutor(tools, {
      authorization: {
        getSecurityGate: () => undefined,
        getAbilityForRole: (role) => buildAbilityForRole(role as RoleId, registry),
      },
    })
  }

  /** The agent runner's call: the gate and approval already ran for it (securityPipelineHandled). */
  function ctx(actor: ToolActor): ToolContext {
    return { conversationId: 'conv-1', userId: 'u1', agentId: 'dev', logger: silent, actor, securityPipelineHandled: true } as ToolContext
  }

  it('(+) a colleague\'s opencode_run runs for the agent role (background runs) and in a `user`\'s interactive conversation', async () => {
    const run = vi.fn(async () => ({ text: 'done' }))
    const executor = executorWith(run as unknown as DeveloperAgent['run'])
    const registry = createPermissionRegistry()
    registry.registerSubject(OPENCODE_SUBJECT, OPENCODE_PERMISSIONS)
    const asAgent = await executor.execute('opencode_run', { prompt: 'fix the test' }, ctx({ kind: 'agent', role: 'agent' }))
    const asUser = await executor.execute('opencode_run', { prompt: 'fix the test' }, ctx({ kind: 'user', role: 'user', ability: buildAbilityForRole('user', registry) }))
    expect([asAgent.success, asUser.success]).toEqual([true, true])
    expect(run).toHaveBeenCalledTimes(2)
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ prompt: 'fix the test', conversationId: 'conv-1', userId: 'u1' }))
  })

  it('(−) the tool path still decides: a guest (no execute Tool) is refused before OpenCode is reached', async () => {
    const run = vi.fn(async () => ({ text: 'done' }))
    const executor = executorWith(run as unknown as DeveloperAgent['run'])
    const res = await executor.execute('opencode_run', { prompt: 'x' }, ctx({ kind: 'user', role: 'guest' }))
    expect(res.success).toBe(false)
    expect(res.errorCode).toBe('DENIED')
    expect(run).not.toHaveBeenCalled()
  })
})

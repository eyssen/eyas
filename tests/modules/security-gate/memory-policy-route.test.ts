// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// B13 — GET /api/v1/security/memory-policy, the Security page's 'Memory
// outside EYAS' card: what the path policy protects on this host, the kernel
// file sandbox of each switched-on CLI provider, and the last 24 hours of
// memory-path refusals and unsandboxed-shell escalations. Absolute host
// paths, so owner/admin (read SecurityEvent) only. Everything runs against a
// throw-away instance layout, never the real home.

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { createMemoryDb } from '../../helpers/test-db'
import { securityGateModule } from '@modules/security-gate/index.js'
import { createSecurityGateRoutes } from '@modules/security-gate/routes.js'
import { buildMemoryPolicyReport, countMemoryPolicyRefusals } from '@modules/security-gate/memory-policy-report.js'
import { DEFAULT_CONFIG } from '@modules/security-gate/types.js'
import { buildAbilityForRole } from '@modules/permissions/roles'
import { createPermissionRegistry } from '@modules/permissions/registry'
import { resetPathPolicyForTests } from '@shared/memory-sovereignty/path-policy.js'
import { memoryPathFailClosedReason } from '@shared/memory-sovereignty/deny-reason.js'
import { UNSANDBOXED_SHELL_REASON } from '@shared/cli-sandbox.js'
import type { FileSandboxInfo } from '@modules/model/cli-runtime/sandbox/index.js'
import type { ModelGateway } from '@modules/model/types'
import { createSovereigntyFixture, type SovereigntyFixture } from '../../helpers/memory-sovereignty-fixture'
import { auxOk, createFakeAuxiliaryModel } from '../../helpers/fake-auxiliary-model'

const noopLogger = { info() {}, warn() {}, error() {}, debug() {} }

let fx: SovereigntyFixture
let ownerStore: string
beforeAll(() => {
  fx = createSovereigntyFixture()
  ownerStore = join(fx.root, 'journal')
  mkdirSync(ownerStore, { recursive: true })
  writeFileSync(join(ownerStore, 'today.md'), 'owner journal\n')
})
afterEach(() => {
  resetPathPolicyForTests()
  vi.unstubAllEnvs()
})
afterAll(() => {
  fx.cleanup()
})

type Role = 'owner' | 'admin' | 'user' | 'agent' | 'guest'

interface ProviderRow { id: string; enabled: boolean }

/**
 * The wired module: onRegister installs the configured path policy and the
 * gate; onStart mounts the routes on ctx.http behind a CASL ability for
 * `role`, with the switched-on providers read from ctx.providerConfig.
 */
async function wiredModule(role: Role, providers?: ProviderRow[]) {
  fx.stubInstanceEnv()
  const registry = createPermissionRegistry()
  const http = new Hono()
  http.use('*', async (c, next) => {
    ;(c as any).set('ability', buildAbilityForRole(role, registry))
    ;(c as any).set('userId', 'op')
    ;(c as any).set('role', role)
    await next()
  })
  const model = { listProviders: () => [{ id: 'mock' }], async complete() { throw new Error('no direct model call') }, async *stream() { /* unused */ } } as unknown as ModelGateway
  const ctx = {
    db: createMemoryDb(),
    model,
    auxiliaryModel: createFakeAuxiliaryModel(auxOk('{"verdict":"ALLOW","reason":"fine"}')),
    permissions: registry,
    logger: noopLogger,
    config: { database: { path: fx.databasePath }, security: { foreignMemoryPaths: [ownerStore, 'relative/notes'] } },
    http,
    bus: { emit() {}, on() { return () => {} } },
    ...(providers ? { providerConfig: { listProviders: () => providers } } : {}),
  } as any
  await securityGateModule.onRegister!(ctx)
  await securityGateModule.onStart!(ctx)
  return { ctx, app: http, gate: ctx.securityGate }
}

async function getReport(app: Hono) {
  const res = await app.request('/api/v1/security/memory-policy')
  return { status: res.status, body: res.status === 200 ? (await res.json()) as any : null }
}

function insertEvent(db: any, row: { decision: string; checkpoint?: string; reason: string; createdAt: string; toolName?: string }) {
  db.run(sql`INSERT INTO security_events (tool_name, input, decision, checkpoint, reason, risk_tier, created_at)
    VALUES (${row.toolName ?? 'Read'}, '{}', ${row.decision}, ${row.checkpoint ?? 'deterministic'}, ${row.reason}, 'green', ${row.createdAt})`)
}

describe('GET /api/v1/security/memory-policy — access', () => {
  it.each(['admin', 'owner'] as const)('%s gets 200 with the policy, sandbox and refusal shape', async (role) => {
    const { app } = await wiredModule(role, [
      { id: 'claude-code', enabled: true },
      { id: 'grok-cli', enabled: false },
      { id: 'anthropic', enabled: true },
    ])
    const { status, body } = await getReport(app)
    expect(status).toBe(200)

    expect(body.policy).toMatchObject({
      dataDir: fx.dataDir,
      databasePath: fx.databasePath,
      workspacesRoot: fx.workspacesRoot,
      foreignMemoryPaths: [{ path: ownerStore, present: true }],
      ignoredForeignMemoryPaths: ['relative/notes'],
    })
    const present = body.policy.foreignStores.filter((s: any) => s.present).map((s: any) => s.id)
    expect(present).toEqual(expect.arrayContaining(['claude', 'grok']))
    expect(present).not.toContain('codex')

    // Only switched-on CLI providers; an API provider is never listed.
    expect(body.sandbox.mode).toBe('auto')
    expect(body.sandbox.providers).toHaveLength(1)
    expect(body.sandbox.providers[0]).toMatchObject({
      id: 'claude-code',
      name: 'Claude Code CLI',
      fileSandbox: { status: 'active', reason: 'darwin-seatbelt', mode: 'auto' },
    })

    expect(body.refusals).toMatchObject({ windowHours: 24, memoryPathDenials: 0, unsandboxedEscalations: 0 })
    expect(Number.isNaN(Date.parse(body.refusals.since))).toBe(false)
  })

  it.each(['user', 'guest', 'agent'] as const)('negative: %s is refused with 403', async (role) => {
    const { app } = await wiredModule(role)
    const { status } = await getReport(app)
    expect(status).toBe(403)
  })

  it('negative: no ability at all is 401', async () => {
    const app = new Hono()
    createSecurityGateRoutes(app as any, createMemoryDb() as any, DEFAULT_CONFIG)
    expect((await app.request('/api/v1/security/memory-policy')).status).toBe(401)
  })
})

describe('GET /api/v1/security/memory-policy — refusal counts', () => {
  it('counts a memory-path denial the gate logged (B2); negative: an allowed Read is not counted', async () => {
    const { app, gate } = await wiredModule('admin')
    const denied = await gate.validateToolCall('Read', { file_path: fx.claudeMemory }, { conversationId: 'conv-1' })
    expect(denied.decision).toBe('deny')
    const allowed = await gate.validateToolCall('Read', { file_path: fx.ownFile }, { workingDirectories: [fx.ownWorkspace] })
    expect(allowed.decision).toBe('allow')

    const { body } = await getReport(app)
    expect(body.refusals.memoryPathDenials).toBe(1)
    expect(body.refusals.unsandboxedEscalations).toBe(0)
  })

  it('counts every memory-path refusal channel: EYAS data, another workspace, the checkMemoryPath hook path', async () => {
    const { app, gate } = await wiredModule('admin')
    const own = { workingDirectories: [fx.ownWorkspace] }
    expect((await gate.validateToolCall('Write', { file_path: fx.eyasVaultNote, content: 'x' }, own)).decision).toBe('deny')
    expect((await gate.validateToolCall('Read', { file_path: fx.otherFile }, own)).decision).toBe('deny')
    expect(gate.checkMemoryPath('mcp__eyas__read_file', { path: fx.vaultNote })).not.toBeNull()

    const { body } = await getReport(app)
    expect(body.refusals.memoryPathDenials).toBe(3)
  })

  it('negative: a sensitive-path or blocklist deny is not a memory-policy refusal', async () => {
    const { app, gate } = await wiredModule('admin')
    expect((await gate.validateToolCall('Read', { file_path: 'data/master.key' })).decision).toBe('deny')
    expect((await gate.validateToolCall('Bash', { command: 'sudo ls' })).decision).toBe('deny')

    const { body } = await getReport(app)
    expect(body.refusals.memoryPathDenials).toBe(0)
  })

  it('counts an unsandboxed-shell escalation; negative: a plain escalation is not counted', async () => {
    const { app, gate, ctx } = await wiredModule('admin')
    const r = await gate.validateToolCall('Bash', { command: 'npm install', dangerouslyDisableSandbox: true }, { requireHuman: true })
    expect(r.decision).toBe('escalate')
    insertEvent(ctx.db, { decision: 'escalate', checkpoint: 'llm_judge', reason: 'judge unsure', createdAt: new Date().toISOString(), toolName: 'Bash' })

    const { body } = await getReport(app)
    expect(body.refusals.unsandboxedEscalations).toBe(1)
    expect(body.refusals.memoryPathDenials).toBe(0)
  })

  it('negative: events older than 24 hours are not counted', async () => {
    const { app, ctx } = await wiredModule('admin')
    const old = new Date(Date.now() - 25 * 3_600_000).toISOString()
    insertEvent(ctx.db, { decision: 'deny', reason: 'Memory outside EYAS (Claude Code) — use memory_search / memory_expand from EYAS', createdAt: old })
    insertEvent(ctx.db, { decision: 'escalate', reason: UNSANDBOXED_SHELL_REASON, createdAt: old, toolName: 'Bash' })

    const { body } = await getReport(app)
    expect(body.refusals).toMatchObject({ memoryPathDenials: 0, unsandboxedEscalations: 0 })
  })
})

describe('buildMemoryPolicyReport', () => {
  const policy = () => fx.policy

  it('counts the fail-closed refusal and a judge text that only mentions the wording is not counted', () => {
    const db = createMemoryDb()
    db.run(sql`CREATE TABLE security_events (id INTEGER PRIMARY KEY AUTOINCREMENT, tool_name TEXT NOT NULL, input TEXT,
      decision TEXT NOT NULL, checkpoint TEXT NOT NULL, reason TEXT, risk_tier TEXT NOT NULL, conversation_id TEXT,
      agent_id TEXT, session_risk_score REAL DEFAULT 0, created_at TEXT NOT NULL)`)
    const now = new Date().toISOString()
    insertEvent(db, { decision: 'deny', reason: memoryPathFailClosedReason(new Error('boom')), createdAt: now })
    // The judge's own words never count, whatever they say.
    insertEvent(db, { decision: 'deny', checkpoint: 'llm_judge', reason: 'Memory outside EYAS (x) looks risky', createdAt: now })
    const since = new Date(Date.now() - 3_600_000).toISOString()
    expect(countMemoryPolicyRefusals(db as any, since)).toEqual({ memoryPathDenials: 1, unsandboxedEscalations: 0 })
  })

  it('lists every CLI when the switched-on providers are unknown, in display order', async () => {
    const seen: string[] = []
    const report = await buildMemoryPolicyReport(emptyEventsDb(), {
      policy,
      mode: () => 'required',
      fileSandbox: async (cli, mode): Promise<FileSandboxInfo> => {
        seen.push(`${cli}:${mode}`)
        return cli === 'kimi-cli'
          ? { status: 'unsupported', reason: 'cli-has-none', mode }
          : { status: 'unavailable', reason: 'no-bwrap', mode }
      },
    })
    expect(report.sandbox.mode).toBe('required')
    expect(report.sandbox.providers.map((p) => p.id)).toEqual(['claude-code', 'grok-cli', 'kimi-cli'])
    expect(seen).toEqual(['claude-code:required', 'grok-cli:required', 'kimi-cli:required'])
    expect(report.sandbox.providers[2].fileSandbox).toEqual({ status: 'unsupported', reason: 'cli-has-none', mode: 'required' })
  })

  it('negative: a detection that throws is reported as null (never active); no CLI switched on lists none', async () => {
    const failing = await buildMemoryPolicyReport(emptyEventsDb(), {
      policy,
      enabledProviders: () => ['grok-cli'],
      fileSandbox: async () => { throw new Error('probe crashed') },
    })
    expect(failing.sandbox.providers).toEqual([{ id: 'grok-cli', name: 'Grok CLI', fileSandbox: null }])

    const none = await buildMemoryPolicyReport(emptyEventsDb(), { policy, enabledProviders: () => ['anthropic'] })
    expect(none.sandbox.providers).toEqual([])
  })

  it('the refusal window starts 24 hours before now', async () => {
    const now = Date.parse('2026-09-23T12:00:00.000Z')
    const report = await buildMemoryPolicyReport(emptyEventsDb(), { policy, enabledProviders: () => [], now: () => now })
    expect(report.refusals.since).toBe('2026-09-22T12:00:00.000Z')
  })
})

function emptyEventsDb() {
  const db = createMemoryDb()
  db.run(sql`CREATE TABLE security_events (id INTEGER PRIMARY KEY AUTOINCREMENT, tool_name TEXT NOT NULL, input TEXT,
    decision TEXT NOT NULL, checkpoint TEXT NOT NULL, reason TEXT, risk_tier TEXT NOT NULL, conversation_id TEXT,
    agent_id TEXT, session_risk_score REAL DEFAULT 0, created_at TEXT NOT NULL)`)
  return db as any
}

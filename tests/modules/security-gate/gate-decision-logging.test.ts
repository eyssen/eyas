// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// F0: the security gate must log EVERY decision (allow, deny, escalate) to
// security_events, not just denials — an operator auditing "what did the
// agent touch" must see the green allows too. Also verifies the tools
// module's registry-supplied riskTier is actually consulted by the wired
// gate (not just by the standalone deterministic-gate unit).

import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { sql } from 'drizzle-orm'
import { createMemoryDb } from '../../helpers/test-db'
import { securityGateModule } from '@modules/security-gate/index.js'
import { DEFAULT_CONFIG } from '@modules/security-gate/types.js'
import { createPermissionRegistry } from '@modules/permissions/registry'
import { getPathPolicy, resetPathPolicyForTests } from '@shared/memory-sovereignty/path-policy.js'
import type { ModelGateway, ModelResponse, StreamEvent } from '@modules/model/types'
import { createSovereigntyFixture, type SovereigntyFixture } from '../../helpers/memory-sovereignty-fixture'
import { createAuxiliaryModelOverGateway } from '../../helpers/fake-auxiliary-model'

// The gate installs the configured path policy from the instance layout:
// every test runs against a throw-away one, never the real home.
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

const noopLogger = { info() {}, warn() {}, error() {}, debug() {} }

function createJudgeGateway(verdictJson: string): ModelGateway {
  const response: ModelResponse = {
    id: 'resp-judge',
    provider: 'anthropic',
    model: 'claude-haiku-4-5-20251001',
    content: [{ type: 'text', text: verdictJson }],
    stopReason: 'end',
    usage: { inputTokens: 50, outputTokens: 20 },
  }
  return {
    registerProvider: vi.fn(),
    unregisterProvider: vi.fn(),
    getProvider: vi.fn(),
    // Non-empty — a vendor-neutral install with zero providers is its own
    // escalate path, not exercised here.
    listProviders: vi.fn(() => [{ id: 'mock' }]),
    listAllModels: vi.fn(async () => []),
    complete: vi.fn(async () => response),
    async *stream() {
      yield { type: 'done', response } as StreamEvent
    },
  } as unknown as ModelGateway
}

function events(db: any, toolName: string) {
  return db.all(sql`SELECT * FROM security_events WHERE tool_name = ${toolName}`) as any[]
}

async function makeCtx(model: ModelGateway, extra?: Record<string, unknown>) {
  fx.stubInstanceEnv()
  const db = createMemoryDb()
  const registry = createPermissionRegistry()
  const config = {
    database: { path: fx.databasePath },
    security: { foreignMemoryPaths: [ownerStore, 'relative/notes'] },
  }
  // The judge runs on the background model service; here the real one over
  // the mock gateway, with its one (API) provider eligible.
  const auxiliaryModel = createAuxiliaryModelOverGateway(model, { providers: ['mock'] })
  const ctx = { db, model, auxiliaryModel, permissions: registry, logger: noopLogger, config, ...extra } as any
  await securityGateModule.onRegister!(ctx)
  return ctx
}

describe('security gate — every decision is logged', () => {
  it('logs a green allow (search_memory) with the conversation id', async () => {
    const ctx = await makeCtx(createJudgeGateway('{"verdict":"DENY","reason":"n/a"}'))
    const result = await ctx.securityGate.validateToolCall('search_memory', { query: 'x' }, { conversationId: 'conv-1' })

    expect(result.decision).toBe('allow')
    const rows = events(ctx.db, 'search_memory')
    expect(rows).toHaveLength(1)
    expect(rows[0].decision).toBe('allow')
    expect(rows[0].conversation_id).toBe('conv-1')
  })

  it('logs a deterministic path-denial (Read data/master.key)', async () => {
    const ctx = await makeCtx(createJudgeGateway('{"verdict":"DENY","reason":"n/a"}'))
    const result = await ctx.securityGate.validateToolCall('Read', { file_path: 'data/master.key' })

    expect(result.decision).toBe('deny')
    const rows = events(ctx.db, 'Read')
    expect(rows).toHaveLength(1)
    expect(rows[0].decision).toBe('deny')
    expect(rows[0].checkpoint).toBe('deterministic')
  })

  it('escalates an unknown tool to the judge (mock DENY) and logs the judged decision', async () => {
    const ctx = await makeCtx(createJudgeGateway('{"verdict":"DENY","reason":"not aligned with goal"}'))
    const result = await ctx.securityGate.validateToolCall('completely_unknown_tool', { data: 'x' })

    expect(result.decision).toBe('deny')
    expect(result.checkpoint).toBe('llm_judge')
    const rows = events(ctx.db, 'completely_unknown_tool')
    expect(rows).toHaveLength(1)
    expect(rows[0].decision).toBe('deny')
    expect(rows[0].checkpoint).toBe('llm_judge')
  })

  it('the judge is one isolated background call, and reads ctx.auxiliaryModel per call (wired after onRegister)', async () => {
    const model = createJudgeGateway('{"verdict":"ALLOW","reason":"fine"}')
    const ctx = await makeCtx(model, { auxiliaryModel: undefined })
    // Registration order is not guaranteed: the service may appear later.
    ctx.auxiliaryModel = createAuxiliaryModelOverGateway(model, { providers: ['mock'] })
    const result = await ctx.securityGate.validateToolCall('completely_unknown_tool', { data: 'x' }, { conversationId: 'conv-9' })

    expect(result.decision).toBe('allow')
    const req = (model.complete as any).mock.calls[0][0]
    expect(req.isolated).toBe(true)
    expect(req.metadata).toMatchObject({ purpose: 'security_judge', conversationId: 'conv-9' })
  })

  it('escalates (and logs the escalation) when no background model is eligible — the model is never called', async () => {
    const model = createJudgeGateway('{"verdict":"ALLOW","reason":"fine"}')
    const ctx = await makeCtx(model, { auxiliaryModel: createAuxiliaryModelOverGateway(model, { providers: ['grok-cli'] }) })
    const result = await ctx.securityGate.validateToolCall('completely_unknown_tool', { data: 'x' })

    expect(result.decision).toBe('escalate')
    expect(model.complete).not.toHaveBeenCalled()
    const rows = events(ctx.db, 'completely_unknown_tool')
    expect(rows).toHaveLength(1)
    expect(rows[0].decision).toBe('escalate')
    expect(rows[0].checkpoint).toBe('llm_judge')
  })

  it('consults ctx.tools.registry for the risk tier of a custom tool', async () => {
    const registryTools = {
      registry: { get: (name: string) => (name === 'custom_red_tool' ? { name, riskTier: 'red' } : undefined) },
    }
    const ctx = await makeCtx(createJudgeGateway('{"verdict":"DENY","reason":"not aligned with goal"}'), { tools: registryTools })
    const result = await ctx.securityGate.validateToolCall('custom_red_tool', { data: 'x' })

    expect(result.riskTier).toBe('red')
    expect(result.checkpoint).toBe('llm_judge')
    const rows = events(ctx.db, 'custom_red_tool')
    expect(rows).toHaveLength(1)
    expect(rows[0].risk_tier).toBe('red')
    expect(rows[0].checkpoint).toBe('llm_judge')
  })
})

describe('security gate — memory outside EYAS (B2)', () => {
  it('logs a memory-path deny as ONE deterministic row and never asks the judge', async () => {
    const model = createJudgeGateway('{"verdict":"ALLOW","reason":"looks fine"}')
    const ctx = await makeCtx(model)
    const result = await ctx.securityGate.validateToolCall('Read', { file_path: fx.claudeMemory }, { conversationId: 'conv-1' })

    expect(result.decision).toBe('deny')
    expect(result.checkpoint).toBe('deterministic')
    expect(result.reason).toMatch(/^Memory outside EYAS/)
    const rows = events(ctx.db, 'Read')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ decision: 'deny', checkpoint: 'deterministic', conversation_id: 'conv-1' })
    expect(model.complete).not.toHaveBeenCalled()
  })

  it('refuses a yellow-tier write into the EYAS vault without escalating (the judge would allow)', async () => {
    const model = createJudgeGateway('{"verdict":"ALLOW","reason":"looks fine"}')
    const ctx = await makeCtx(model)
    const result = await ctx.securityGate.validateToolCall(
      'Write',
      { file_path: join(fx.dataDir, 'vault', 'semantic', 'new.md'), content: 'x' },
      { workingDirectories: [fx.repo] },
    )
    expect(result.decision).toBe('deny')
    expect(result.reason).toBe('EYAS data directory (vault) is read and written only by EYAS')
    expect(model.complete).not.toHaveBeenCalled()
    expect(events(ctx.db, 'Write')).toHaveLength(1)
  })

  it('uses the caller\'s working folders for the cross-workspace refusal', async () => {
    const ctx = await makeCtx(createJudgeGateway('{"verdict":"DENY","reason":"n/a"}'))
    const own = { workingDirectories: [fx.ownWorkspace] }
    expect((await ctx.securityGate.validateToolCall('Read', { file_path: fx.otherFile }, own)).decision).toBe('deny')
    expect((await ctx.securityGate.validateToolCall('Read', { file_path: fx.ownFile }, own)).decision).toBe('allow')
  })

  it('installs the configured policy: database.path and security.foreignMemoryPaths are protected', async () => {
    const ctx = await makeCtx(createJudgeGateway('{"verdict":"DENY","reason":"n/a"}'))
    const described = getPathPolicy().describe()
    expect(described.databasePath).toBe(fx.databasePath)
    expect(described.foreignMemoryPaths.map((p) => p.path)).toEqual([ownerStore])
    expect(described.ignoredForeignMemoryPaths).toEqual(['relative/notes'])

    const db = await ctx.securityGate.validateToolCall('Read', { file_path: fx.databasePath })
    expect(db.decision).toBe('deny')
    expect(db.reason).toBe('EYAS data directory (database) is read and written only by EYAS')
    const owner = await ctx.securityGate.validateToolCall('read_file', { path: join(ownerStore, 'today.md') })
    expect(owner.decision).toBe('deny')
    expect(owner.reason).toBe('Memory outside EYAS (protected path (security.foreignMemoryPaths)) — use memory_search / memory_expand from EYAS')
  })

  it('warns about foreignMemoryPaths entries that are not absolute', async () => {
    const warn = vi.fn()
    await makeCtx(createJudgeGateway('{"verdict":"DENY","reason":"n/a"}'), { logger: { ...noopLogger, warn } })
    expect(warn).toHaveBeenCalledWith({ ignored: ['relative/notes'] }, expect.stringContaining('ignored'))
  })

  it('checkMemoryPath: logs a deny as one row, returns null and logs nothing for a clean path', async () => {
    const ctx = await makeCtx(createJudgeGateway('{"verdict":"DENY","reason":"n/a"}'))
    const denied = ctx.securityGate.checkMemoryPath('mcp__eyas__read_file', { path: fx.vaultNote }, { conversationId: 'conv-9' })
    expect(denied).toMatchObject({ decision: 'deny', checkpoint: 'deterministic' })
    const rows = events(ctx.db, 'read_file')
    expect(rows).toHaveLength(1)
    expect(rows[0].conversation_id).toBe('conv-9')

    expect(ctx.securityGate.checkMemoryPath('Read', { file_path: join(fx.repo, 'src', 'a.ts') })).toBeNull()
    expect(events(ctx.db, 'Read')).toHaveLength(0)
  })

  it('keeps the memory-path deny with the gate switched off', async () => {
    const ctx = await makeCtx(createJudgeGateway('{"verdict":"DENY","reason":"n/a"}'))
    const enabled = DEFAULT_CONFIG.enabled
    ctx.securityGate.config.enabled = false
    try {
      expect((await ctx.securityGate.validateToolCall('Read', { file_path: fx.grokMemory })).decision).toBe('deny')
      expect(events(ctx.db, 'Read')).toHaveLength(1)
      // Everything else is allowed, as a disabled gate always did.
      expect((await ctx.securityGate.validateToolCall('Bash', { command: 'ls' })).decision).toBe('allow')
    } finally {
      ctx.securityGate.config.enabled = enabled
    }
  })
})

// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// F0: the security gate must log EVERY decision (allow, deny, escalate) to
// security_events, not just denials — an operator auditing "what did the
// agent touch" must see the green allows too. Also verifies the tools
// module's registry-supplied riskTier is actually consulted by the wired
// gate (not just by the standalone deterministic-gate unit).

import { describe, it, expect, vi } from 'vitest'
import { sql } from 'drizzle-orm'
import { createMemoryDb } from '../../helpers/test-db'
import { securityGateModule } from '@modules/security-gate/index.js'
import { createPermissionRegistry } from '@modules/permissions/registry'
import type { ModelGateway, ModelResponse, StreamEvent } from '@modules/model/types'

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
  const db = createMemoryDb()
  const registry = createPermissionRegistry()
  const ctx = { db, model, permissions: registry, logger: noopLogger, ...extra } as any
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

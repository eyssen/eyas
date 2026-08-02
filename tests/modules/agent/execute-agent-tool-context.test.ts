// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Capture what executeAgent hands the runner. Mocked at the agent-runner
// module boundary because executeAgent builds its runner inside the agent
// module's onRegister — there is no seam to inject one from the outside.
const runCalls: any[] = []
vi.mock('@modules/agent/agent-runner', () => ({
  createAgentRunner: () => ({
    run: (options: any) => {
      runCalls.push(options)
      return (async function* () { yield { type: 'text', text: 'ok' } })()
    },
  }),
}))

import { agentModule } from '@modules/agent/index'
import { createMemoryDb } from '../../helpers/test-db'

const silentLogger: any = {
  info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, trace: () => {}, fatal: () => {},
  child: () => silentLogger,
}

async function bootAgentModule() {
  const ctx: any = {
    db: createMemoryDb(),
    bus: { emit: () => {}, on: () => {}, off: () => {} },
    logger: silentLogger,
    model: {},
    permissions: { registerSubject: () => {} },
    hasModule: () => false,
    http: { get: () => {}, post: () => {}, use: () => {} },
  }
  await agentModule.onRegister!(ctx)
  return ctx
}

describe('executeAgent — tool context (F0 R2)', () => {
  beforeEach(() => {
    runCalls.length = 0
  })

  // Regression: executeAgent used to call runner.run() with no toolContext at
  // all. Since the executor became a fail-closed authorization choke point,
  // agent-runner only builds an exec context when toolContext is present — so
  // an absent one meant every delegated / pipeline tool call was denied with
  // "no actor identity on tool context". Reachable from delegate_to_agent and
  // from all four ticket-to-code pipeline stages via AgentRunnerPort.
  it('passes a toolContext so the executor can authorize delegated tool calls', async () => {
    const ctx = await bootAgentModule()

    await ctx.agents.executeAgent('conv-42', 'researcher', 'find the bug')

    expect(runCalls).toHaveLength(1)
    const { toolContext } = runCalls[0]
    expect(toolContext).toBeDefined()
    expect(toolContext.conversationId).toBe('conv-42')
    expect(toolContext.agentId).toBe('researcher')
    expect(toolContext.userId).toBe('system')
    expect(toolContext.logger).toBeDefined()
  })

  it('keeps the pipeline origin path on the same tool context', async () => {
    const ctx = await bootAgentModule()

    await ctx.agents.executeAgent('pipeline-reviewer', 'reviewer', 'review it', { origin: 'pipeline' })

    const { toolContext, metadata } = runCalls[0]
    expect(metadata.origin).toBe('pipeline')
    expect(toolContext.conversationId).toBe('pipeline-reviewer')
    expect(toolContext.agentId).toBe('reviewer')
    expect(toolContext.userId).toBe('system')
  })

  // D1 (F1 task-3): an agent whose persisted `tools` column is an empty JSON
  // array round-trips through agent-registry's toAgentDefinition as `[]` —
  // truthy in JS — so the old `agentDef.tools ? toToolDefinitions(agentDef.tools)
  // : toToolDefinitions()` ternary always took the "has tools" branch and
  // resolved zero tools instead of the intended "no restriction" fallback.
  describe('D1 — empty persisted tools list falls back to ALL tools', () => {
    function stubToolRegistry() {
      const calls: Array<string[] | undefined> = []
      const registry = {
        toToolDefinitions: (names?: string[]) => {
          calls.push(names)
          if (!names) return [{ name: 'sentinel_all_tools_a' }, { name: 'sentinel_all_tools_b' }]
          return names.map(n => ({ name: n }))
        },
      }
      return { calls, registry }
    }

    it('agentDef.tools = [] → runner receives a NON-empty tools array (the "all tools" fallback)', async () => {
      const ctx = await bootAgentModule()
      const { calls, registry } = stubToolRegistry()
      ctx.tools = { registry }

      ctx.agents.registry.create({
        id: 'empty-tools-agent',
        name: 'Empty Tools Agent',
        role: 'tester',
        description: 'd',
        goal: 'g',
        backstory: 'b',
        systemPrompt: 'sp',
        capabilities: [],
        tools: [],
        constraints: [],
      })

      await ctx.agents.executeAgent('conv-empty', 'empty-tools-agent', 'do the thing')

      expect(calls).toHaveLength(1)
      expect(calls[0]).toBeUndefined() // called with no args → "all tools"
      const { tools } = runCalls[0]
      expect(tools.length).toBeGreaterThan(0)
      expect(tools).toEqual([{ name: 'sentinel_all_tools_a' }, { name: 'sentinel_all_tools_b' }])
    })

    it('agentDef.tools = [\'search_memory\'] → runner receives exactly that tool', async () => {
      const ctx = await bootAgentModule()
      const { calls, registry } = stubToolRegistry()
      ctx.tools = { registry }

      ctx.agents.registry.create({
        id: 'one-tool-agent',
        name: 'One Tool Agent',
        role: 'tester',
        description: 'd',
        goal: 'g',
        backstory: 'b',
        systemPrompt: 'sp',
        capabilities: [],
        tools: ['search_memory'],
        constraints: [],
      })

      await ctx.agents.executeAgent('conv-one', 'one-tool-agent', 'do the thing')

      expect(calls).toHaveLength(1)
      expect(calls[0]).toEqual(['search_memory'])
      const { tools } = runCalls[0]
      expect(tools).toEqual([{ name: 'search_memory' }])
    })
  })

  // F1 Task 5 (R7): a conversation bound to a team session threads its id
  // onto both the tool context (so team-memory / agent-messaging tools have
  // a session to key on) and the run metadata.
  describe('F1 Task 5 — team session threading', () => {
    it('conv.teamSessionId is threaded onto toolContext (teamSessionId + sessionId) and metadata', async () => {
      const ctx = await bootAgentModule()
      ctx.conversations = {
        get: () => ({ providerId: null, modelId: null, teamSessionId: 'ts-9' }),
        addMessage: () => {},
      }

      await ctx.agents.executeAgent('conv-team', 'researcher', 'find the bug')

      const { toolContext, metadata } = runCalls[0]
      expect(toolContext.teamSessionId).toBe('ts-9')
      expect(toolContext.sessionId).toBe('ts-9')
      expect(metadata.teamSessionId).toBe('ts-9')
    })

    it('leaves teamSessionId undefined when the conversation has none', async () => {
      const ctx = await bootAgentModule()
      ctx.conversations = {
        get: () => ({ providerId: null, modelId: null, teamSessionId: null }),
        addMessage: () => {},
      }

      await ctx.agents.executeAgent('conv-solo', 'researcher', 'find the bug')

      const { toolContext, metadata } = runCalls[0]
      expect(toolContext.teamSessionId).toBeUndefined()
      expect(toolContext.sessionId).toBeUndefined()
      expect(metadata.teamSessionId).toBeUndefined()
    })
  })
})

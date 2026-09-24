// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// I5 on the chat route:
//   - the tool scope every other run path applies (agent/tool-scope.ts): the
//     conversation's colleague — else its project's default agent — decides
//     the list, the memory tools are always in it, Solo strips delegation;
//   - the per-message turn block (clock + recall) reaches the model on both
//     branches — the runner's (AgentRunOptions.turn) and the no-runner
//     fallback's (attached to the copy it streams) — while the stored user
//     message stays as the user wrote it.
// Fictive agents and conversations throughout.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { createTestDb, insertTestOwner } from '../../helpers/test-db.js'
import { createConversationRoutes } from '../../../src/modules/conversations/routes.js'
import { createConversationService, type ConversationService } from '../../../src/modules/conversations/conversation-service.js'
import { createModelGateway } from '../../../src/modules/model/gateway.js'
import { createProviderConfigService } from '../../../src/modules/model/provider-config-service.js'
import { errorHandler } from '../../../src/core/http/middleware/error-handler.js'
import { buildAbilityForRole } from '../../../src/modules/permissions/roles.js'
import { createPermissionRegistry } from '../../../src/modules/permissions/registry.js'
import type { AIProvider, ModelRequest, StreamEvent, ToolDefinition } from '../../../src/modules/model/types.js'
import { createAgentRunner } from '../../../src/modules/agent/agent-runner.js'
import { createGrokCliProvider } from '../../../src/modules/model/submodules/grok-cli/provider.js'
import { getBridgeBinding, type BridgeBinding } from '../../../src/modules/model/cli-mcp/bridge-routes.js'
import { scopeAllowlist } from '../../../src/modules/agent/tool-scope.js'

const testDb = createTestDb('routes-tool-scope')

const TURN = '<turn-context>\nAdded by EYAS to this message — not written by its sender.\nCurrent date and time: 2031-02-03 04:05\n<eyas-memory>\n- (gs:g1) Harbor ledger closes on Fridays\n</eyas-memory>\n</turn-context>'

const ALL_TOOLS = ['memory_search', 'memory_expand', 'read_file', 'run_command', 'run_specialist', 'delegate_to_agent', 'assign_task']

function def(name: string): ToolDefinition {
  return { name, description: name, inputSchema: { type: 'object', properties: {} } }
}

const toolRegistry = {
  toToolDefinitions(names?: string[]) {
    const all = ALL_TOOLS.map(def)
    return names ? all.filter((t) => names.includes(t.name)) : all
  },
}

function makeAbility() {
  const reg = createPermissionRegistry()
  reg.registerSubject('Conversation', {
    actions: ['read', 'update', 'create', 'delete'],
    defaults: { admin: ['read', 'update', 'create', 'delete'], owner: ['read', 'update', 'create', 'delete'], user: ['read'], agent: [], guest: [] },
  })
  reg.registerSubject('ConversationMessage', {
    actions: ['read', 'create'],
    defaults: { admin: ['read', 'create'], owner: ['read', 'create'], user: ['read'], agent: [], guest: [] },
  })
  return buildAbilityForRole('owner', reg)
}

function assembled(turn: string | undefined) {
  return {
    prefix: 'PREFIX', suffix: 'SUFFIX', reminders: [], cacheBoundaryHint: 6, prefixHash: 'h',
    tokenEstimate: { prefix: 1, suffix: 1, reminders: 0 },
    sections: turn ? [{ zone: 'turn', key: 'memory-recall', content: '<eyas-memory>…</eyas-memory>', chars: 1, estimatedTokens: 1, truncated: false, droppedChars: 0 }] : [],
    ...(turn ? { turn } : {}),
  }
}

describe('chat route — tool scope and turn block (I5)', () => {
  let db: any
  let chat: ConversationService
  let userId: string
  let streamed: ModelRequest[]
  let runs: any[]
  let buildCalls: any[]
  const agents: Record<string, { model?: string | null; tools?: string[] | null }> = {}
  let projectDefaultAgent: string | null

  beforeEach(async () => {
    db = testDb.open()
    userId = await insertTestOwner(db, `owner-${Date.now()}-${Math.random()}`)
    chat = createConversationService(db)
    streamed = []
    runs = []
    buildCalls = []
    projectDefaultAgent = null
    for (const k of Object.keys(agents)) delete agents[k]
  })

  afterEach(() => testDb.cleanup())

  function mount(opts: { runner?: boolean; turn?: string | null; assembler?: boolean } = {}): Hono {
    const provider: AIProvider = {
      id: 'p1', name: 'p1',
      async listModels() { return [] },
      async complete() { throw new Error('unused') },
      async *stream(request: ModelRequest) {
        streamed.push(structuredClone({ ...request, signal: undefined }))
        yield { type: 'text', text: 'ok' }
        yield {
          type: 'done',
          response: { id: 'r', provider: 'p1', model: 'm1', content: [{ type: 'text', text: 'ok' }], stopReason: 'end', usage: { inputTokens: 1, outputTokens: 1 } },
        }
      },
    }
    const gateway = createModelGateway()
    gateway.registerProvider(provider)
    const runner = {
      async *run(options: any) {
        runs.push(options)
        yield { type: 'text', text: 'ok' }
        yield {
          type: 'done',
          response: { id: 'r', provider: 'p1', model: 'm1', content: [{ type: 'text', text: 'ok' }], stopReason: 'end', usage: { inputTokens: 1, outputTokens: 1 } },
        }
      },
    }
    const turn = opts.turn === undefined ? TURN : opts.turn ?? undefined
    const assembler = {
      async buildForPrimary(o: any) {
        buildCalls.push({ ...o, via: 'buildForPrimary' })
        return assembled(turn)
      },
      async buildTurnOnly(o: any) {
        buildCalls.push({ ...o, via: 'buildTurnOnly' })
        const a = assembled(turn)
        return { turn: a.turn ?? '', sections: a.sections, delivery: undefined as any }
      },
    }
    const board = {
      projects: {
        getWithStages: (_id: string) => (projectDefaultAgent ? { defaultAgentId: projectDefaultAgent, stages: [] } : null),
      },
    }
    const ability = makeAbility()
    const app = new Hono()
    app.onError(errorHandler)
    app.use('*', async (c: any, next: any) => { c.set('ability', ability); c.set('userId', userId); await next() })
    createConversationRoutes(
      app as any, chat, gateway, createProviderConfigService(db),
      undefined,                                             // getDocuments
      opts.runner === false ? undefined : () => runner as any, // getAgentRunner
      () => toolRegistry as any,                             // getToolRegistry
      undefined,                                             // getDecisionEngine
      opts.assembler === false ? undefined : () => assembler as any, // getAssembler
      undefined, undefined,                                  // getSkills, memoryHooks
      () => board as any,                                    // getBoard
      undefined, undefined, undefined, undefined, undefined, // pricing, teamPropose, godMode, recorder, designs
      undefined, undefined, undefined, undefined, undefined, // skillDecisions, capture, media, studio, aux
      undefined,                                             // getBindingResolver
      () => ({ get: (id: string) => agents[id] }),           // getAgentRegistry
    )
    return app
  }

  function conversation(over: { agentId?: string; orchestration?: 'solo' | 'auto' | 'deep'; projectId?: string } = {}): string {
    const id = chat.create({ userId, title: 'T', providerId: 'p1', modelId: 'm1' }).id
    const update: Record<string, unknown> = {}
    if (over.agentId) update.agentId = over.agentId
    if (over.orchestration) update.orchestration = over.orchestration
    if (over.projectId) update.projectId = over.projectId
    if (Object.keys(update).length) chat.update(id, update as any)
    return id
  }

  async function send(app: Hono, id: string, content = 'When does the harbor ledger close?'): Promise<void> {
    const res = await app.request(`/api/v1/conversations/${id}/messages`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content, provider: 'p1', model: 'm1' }),
    })
    expect(res.status).toBe(200)
    await res.text()
  }

  const toolNames = (): string[] => (runs[0].tools as ToolDefinition[]).map((t) => t.name).sort()

  describe('tool scope', () => {
    it('(+) a narrow-list colleague: the run is offered its list plus the memory tools', async () => {
      agents.narrow = { tools: ['read_file'] }
      const app = mount()
      await send(app, conversation({ agentId: 'narrow' }))
      expect(toolNames()).toEqual(['memory_expand', 'memory_search', 'read_file'])
    })

    it('(−) a tool outside the list is not offered', async () => {
      agents.narrow = { tools: ['read_file'] }
      const app = mount()
      await send(app, conversation({ agentId: 'narrow' }))
      expect(toolNames()).not.toContain('run_command')
      expect(toolNames()).not.toContain('run_specialist')
    })

    it('(+) no agent: every tool', async () => {
      const app = mount()
      await send(app, conversation())
      expect(toolNames()).toEqual([...ALL_TOOLS].sort())
    })

    it('(+) an agent with an empty list: every tool', async () => {
      agents.open = { tools: [] }
      const app = mount()
      await send(app, conversation({ agentId: 'open' }))
      expect(toolNames()).toEqual([...ALL_TOOLS].sort())
    })

    it('(+) a Solo conversation: no delegation tools, memory tools kept', async () => {
      const app = mount()
      await send(app, conversation({ orchestration: 'solo' }))
      expect(toolNames()).not.toContain('run_specialist')
      expect(toolNames()).not.toContain('delegate_to_agent')
      expect(toolNames()).toContain('memory_search')
      expect(toolNames()).toContain('assign_task')
    })

    it('(+) no colleague on the conversation: its project\'s default agent decides, as it does for the prompt', async () => {
      agents.pdef = { tools: ['run_command'] }
      projectDefaultAgent = 'pdef'
      const app = mount()
      await send(app, conversation({ projectId: 'proj-1' }))
      expect(toolNames()).toEqual(['memory_expand', 'memory_search', 'run_command'])
    })
  })

  describe('turn block', () => {
    it('(+) runner branch: the turn goes to the runner, the message text to recall', async () => {
      agents.helper = { tools: [] }
      const app = mount()
      const id = conversation({ agentId: 'helper' })
      await send(app, id)
      expect(runs[0].turn).toBe(TURN)
      expect(runs[0].system).toBe('PREFIX\n\nSUFFIX')
      expect(buildCalls[0]).toMatchObject({ via: 'buildForPrimary', conversationId: id, turnText: 'When does the harbor ledger close?' })
    })

    it('(+) a conversation with no colleague (no system prompt) still gets the clock and recall', async () => {
      const app = mount()
      const id = conversation()
      await send(app, id)
      expect(buildCalls[0]).toMatchObject({ via: 'buildTurnOnly', conversationId: id, turnText: 'When does the harbor ledger close?' })
      expect(runs[0].turn).toBe(TURN)
    })

    it('(+) no-runner fallback: the streamed copy carries the turn block on the user message', async () => {
      agents.helper = { tools: [] }
      const app = mount({ runner: false })
      const id = conversation({ agentId: 'helper' })
      await send(app, id)
      const last = streamed[0].messages.at(-1)!
      expect(last.role).toBe('user')
      expect(last.content).toBe(`${TURN}\n\nWhen does the harbor ledger close?`)
      expect(streamed[0].system ?? '').not.toContain('turn-context')
    })

    it('(−) the stored user message stays as the user wrote it', async () => {
      agents.helper = { tools: [] }
      const app = mount({ runner: false })
      const id = conversation({ agentId: 'helper' })
      await send(app, id)
      const stored = chat.get(id)!.messages.filter((m) => m.role === 'user')
      expect(stored.map((m) => m.content)).toEqual(['When does the harbor ledger close?'])
    })

    it('(−) no assembler: no turn block, the messages go out unchanged', async () => {
      const app = mount({ runner: false, assembler: false })
      const id = conversation()
      await send(app, id)
      expect(streamed[0].messages.at(-1)!.content).toBe('When does the harbor ledger close?')
    })
  })
})

// H9 — the agent's tool list and Solo reach the provider on the interactive
// route, a CLI one included: a real runner streams to a real grok-cli
// provider (its ACP run faked), whose bridge binding is what the Grok CLI's
// EYAS tools/list will serve.
describe('chat route — tool scope reaches the provider (H9)', () => {
  let db: any
  let chat: ConversationService
  let userId: string
  let requests: ModelRequest[]
  let bindings: Array<Readonly<BridgeBinding> | undefined>
  const agents: Record<string, { tools?: string[] | null }> = {}

  beforeEach(async () => {
    db = testDb.open()
    userId = await insertTestOwner(db, `owner-${Date.now()}-${Math.random()}`)
    chat = createConversationService(db)
    requests = []
    bindings = []
    for (const k of Object.keys(agents)) delete agents[k]
  })

  afterEach(() => testDb.cleanup())

  function mount(providerId: 'p1' | 'grok-cli'): Hono {
    const gateway = createModelGateway()
    if (providerId === 'grok-cli') {
      gateway.registerProvider(createGrokCliProvider({
        mcpBridge: { baseUrl: 'http://127.0.0.1:3100' },
        runPrompt: async function* (opts: any) {
          const secret = opts.mcpServers?.[0]?.env?.find((e: any) => e.name === 'EYAS_MCP_BRIDGE_SECRET')?.value
          bindings.push(secret ? getBridgeBinding(secret) : undefined)
          yield { type: 'text', text: 'ok' } satisfies StreamEvent
          return { text: 'ok', inputTokens: 1, outputTokens: 1, stopReason: 'end' as const }
        } as any,
      }))
    } else {
      gateway.registerProvider({
        id: 'p1', name: 'p1',
        async listModels() { return [] },
        async complete() { throw new Error('unused') },
        async *stream(request: ModelRequest) {
          requests.push(request)
          yield { type: 'text', text: 'ok' }
          yield {
            type: 'done',
            response: { id: 'r', provider: 'p1', model: 'm1', content: [{ type: 'text', text: 'ok' }], stopReason: 'end', usage: { inputTokens: 1, outputTokens: 1 } },
          }
        },
      })
    }
    const runner = createAgentRunner({ gateway, toolExecutor: { execute: async () => ({ success: true, durationMs: 0 }) } as any })
    const ability = makeAbility()
    const app = new Hono()
    app.onError(errorHandler)
    app.use('*', async (c: any, next: any) => { c.set('ability', ability); c.set('userId', userId); await next() })
    createConversationRoutes(
      app as any, chat, gateway, createProviderConfigService(db),
      undefined, () => runner as any, () => toolRegistry as any,
      undefined, undefined, undefined, undefined, undefined,
      undefined, undefined, undefined, undefined, undefined,
      undefined, undefined, undefined, undefined, undefined,
      undefined,
      () => ({ get: (id: string) => agents[id] }),
    )
    return app
  }

  async function send(app: Hono, id: string, provider: string, model: string): Promise<void> {
    const res = await app.request(`/api/v1/conversations/${id}/messages`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: 'go', provider, model }),
    })
    expect(res.status).toBe(200)
    await res.text()
  }

  function conversation(providerId: string, modelId: string, over: { agentId?: string; orchestration?: 'solo' } = {}): string {
    const id = chat.create({ userId, title: 'T', providerId, modelId }).id
    if (over.agentId || over.orchestration) chat.update(id, over as any)
    return id
  }

  it('(+) an agent with a restricted tool list restricts the provider request.tools in interactive chat', async () => {
    agents.narrow = { tools: ['read_file'] }
    const app = mount('p1')
    await send(app, conversation('p1', 'm1', { agentId: 'narrow' }), 'p1', 'm1')
    expect(requests).toHaveLength(1)
    expect((requests[0].tools ?? []).map((t) => t.name).sort()).toEqual(['memory_expand', 'memory_search', 'read_file'])
  })

  it('(−) a Solo conversation on grok-cli is offered no run_specialist, while assign_task remains', async () => {
    const app = mount('grok-cli')
    await send(app, conversation('grok-cli', 'grok-cli-default', { orchestration: 'solo' }), 'grok-cli', 'grok-cli-default')
    expect(bindings).toHaveLength(1)
    const scope = bindings[0]!.toolScope!
    const offered = scopeAllowlist(scope, ALL_TOOLS)
    expect(offered.has('run_specialist')).toBe(false)
    expect(offered.has('delegate_to_agent')).toBe(false)
    expect(offered.has('assign_task')).toBe(true)
    expect(offered.has('memory_search')).toBe(true)
  })
})

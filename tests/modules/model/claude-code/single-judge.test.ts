// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// A4 — one LLM judge per Claude Code tool call. canUseTool (the permission
// bridge) already runs security-gate validateToolCall, which is what calls the
// judge, writes security_events and moves the denial streak. Every hook
// composed through mergeHooks — the deterministic memory-policy hook (B4's
// contract: a pure path check, never validateToolCall) — must stay off that
// path, or each call would be judged twice. (G6: the run tree is the agent
// runner's; the provider installs no orchestration hooks any more.)

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { sql } from 'drizzle-orm'

const h = vi.hoisted(() => ({
  judgeCheck: vi.fn(async (_tool: string, _input: unknown, riskTier: string) => ({
    decision: 'allow' as const,
    checkpoint: 'llm_judge' as const,
    reason: 'aligned',
    riskTier,
    timestamp: new Date().toISOString(),
  })),
  policyCalls: [] as string[],
  bash: { command: 'npm test' },
}))

// The judge itself is a spy: the question is how often it is asked.
vi.mock('@modules/security-gate/llm-judge.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createLlmJudge: () => ({ check: h.judgeCheck }),
}))

/** Drive what the CLI does for one Bash tool call: PreToolUse hooks, then canUseTool. */
async function driveBashCall(options: any): Promise<void> {
  const input = { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: h.bash, tool_use_id: 'tu-1', session_id: 's', transcript_path: '', cwd: options.cwd }
  for (const matcher of options.hooks?.PreToolUse ?? []) {
    for (const hook of matcher.hooks) await hook(input, 'tu-1', { signal: new AbortController().signal })
  }
  await options.canUseTool('Bash', h.bash, { toolUseID: 'tu-1', signal: new AbortController().signal })
}

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: (args: any) => (async function* () {
    const { fakeClaudeInit } = await import('../../../helpers/claude-sdk-init.js')
    yield fakeClaudeInit(args.options)
    await driveBashCall(args.options)
    yield { type: 'assistant', message: { content: [{ type: 'text', text: 'done' }] } }
    yield { type: 'result', subtype: 'success', result: 'done', usage: { input_tokens: 1, output_tokens: 1 } }
  })(),
  tool: (name: string, description: string, _schema: unknown, handler: unknown) => ({ name, description, handler }),
  createSdkMcpServer: (cfg: unknown) => ({ ...(cfg as object) }),
}))

import { createMemoryDb } from '../../../helpers/test-db'
import { createPermissionRegistry } from '@modules/permissions/registry'
import { securityGateModule } from '@modules/security-gate/index.js'
import { createClaudeCodeProvider } from '@modules/model/submodules/claude-code/provider.js'
import { mergeHooks } from '@modules/model/submodules/claude-code/hooks.js'
import { createPermissionBridge } from '@modules/model/submodules/claude-code/permission-bridge.js'
import { TEST_CLAUDE_RUNTIME } from '../../../helpers/claude-runtime.js'

const noopLogger = { info() {}, warn() {}, error() {}, debug() {} }

async function realGate() {
  const db = createMemoryDb()
  const ctx = { db, model: {}, permissions: createPermissionRegistry(), logger: noopLogger, bus: { emit() {} } } as any
  await securityGateModule.onRegister!(ctx)
  const gate = ctx.securityGate
  const validate = vi.spyOn(gate, 'validateToolCall')
  return { db, gate, validate }
}

function bashRows(db: any): any[] {
  return db.all(sql`SELECT * FROM security_events WHERE tool_name = 'Bash'`) as any[]
}

/**
 * A deterministic memory-policy hook on B4's contract: a pure path check on
 * the tool input, no gate call, `continue` unless the path is a foreign store.
 */
const sovereigntyStub = {
  hooks: {
    PreToolUse: [{
      hooks: [async (input: any) => {
        h.policyCalls.push(input.tool_name)
        return { continue: true }
      }],
    }],
  },
}

beforeEach(() => {
  h.judgeCheck.mockClear()
  h.policyCalls = []
})

describe('claude-code — exactly one judge per tool call', () => {
  it('through the provider: the policy hook + canUseTool judge a Bash call once', async () => {
    const { db, gate, validate } = await realGate()
    const provider = createClaudeCodeProvider({
      runtime: TEST_CLAUDE_RUNTIME,
      toolExecutor: { execute: vi.fn() } as any,
      toolRegistry: { list: () => [{ name: 'search_memory', category: 'memory' }] } as any,
      getGovernance: () => ({ securityGate: gate }),
    })
    for await (const _ of provider.stream({ messages: [{ role: 'user', content: 'run the tests' }], metadata: { conversationId: 'c1', origin: 'interactive' } } as any)) { /* consume */ }

    expect(validate).toHaveBeenCalledTimes(1)
    expect(h.judgeCheck).toHaveBeenCalledTimes(1)
    const rows = bashRows(db)
    expect(rows).toHaveLength(1)
    expect(rows[0].checkpoint).toBe('llm_judge')
  })

  it('with the policy hook in the sovereignty slot: the hook runs, the judge is still asked once', async () => {
    const { db, gate, validate } = await realGate()
    const merged = mergeHooks({ sovereignty: sovereigntyStub })
    const canUseTool = createPermissionBridge({ validateToolCall: gate.validateToolCall.bind(gate), autonomous: false, ctx: { conversationId: 'c1' } })

    await driveBashCall({ hooks: merged.hooks, canUseTool, cwd: '/w' })

    expect(h.policyCalls).toEqual(['Bash'])
    expect(validate).toHaveBeenCalledTimes(1)
    expect(h.judgeCheck).toHaveBeenCalledTimes(1)
    expect(bashRows(db)).toHaveLength(1)
  })

  it('negative control: a hook that also called the gate would double-judge — and the counters catch it', async () => {
    const { db, gate } = await realGate()
    const doubleJudging = {
      hooks: { PreToolUse: [{ hooks: [async (input: any) => { await gate.validateToolCall(input.tool_name, input.tool_input); return { continue: true } }] }] },
    }
    const merged = mergeHooks({ sovereignty: doubleJudging })
    const canUseTool = createPermissionBridge({ validateToolCall: gate.validateToolCall.bind(gate), autonomous: false, ctx: {} })
    await driveBashCall({ hooks: merged.hooks, canUseTool, cwd: '/w' })
    expect(h.judgeCheck).toHaveBeenCalledTimes(2)
    expect(bashRows(db)).toHaveLength(2)
  })
})

// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// K3 (R1A-15) — an agent's tool list bounds Claude Code's own built-ins, not
// only the EYAS bridge. The request's tool scope (the names it offers) decides
// which native capabilities the query keeps (tools/cli-exposure.ts): the rest
// leave the built-in list and are passed as disallowedTools, so an agent
// without write or shell tools cannot write or run commands through the CLI.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ captured: { options: undefined as any } }))

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: (args: any) => {
    h.captured.options = args.options
    return (async function* () {
      const { fakeClaudeInit } = await import('../../../helpers/claude-sdk-init.js')
      yield fakeClaudeInit(args.options)
      yield { type: 'result', subtype: 'success', result: 'ok', session_id: 's1', usage: { input_tokens: 1, output_tokens: 1 } }
    })()
  },
  tool: (name: string, description: string, _schema: unknown, handler: unknown) => ({ name, description, handler }),
  createSdkMcpServer: (cfg: unknown) => ({ ...(cfg as object) }),
}))

import { createClaudeCodeProvider } from '@modules/model/submodules/claude-code/provider.js'
import { TEST_CLAUDE_RUNTIME } from '../../../helpers/claude-runtime.js'

const REGISTERED = ['memory_search', 'memory_expand', 'read_file', 'write_file', 'edit_file', 'run_command', 'git_status', 'git_diff', 'research', 'browser_navigate']

const toolDeps = {
  runtime: TEST_CLAUDE_RUNTIME,
  toolExecutor: { execute: vi.fn() } as any,
  toolRegistry: { list: () => REGISTERED.map((name) => ({ name, description: name, category: 'custom', inputSchema: {} })) } as any,
}

function governance() {
  return {
    securityGate: { validateToolCall: () => ({ decision: 'allow' as const, reason: 'ok', riskTier: 'green' }) },
  }
}

async function drain(gen: AsyncIterable<any>) { for await (const _ of gen) { /* consume */ } }

const def = (name: string) => ({ name, description: name, inputSchema: {} })

async function optionsFor(tools?: string[], extra: Record<string, unknown> = {}): Promise<any> {
  const provider = createClaudeCodeProvider({ ...toolDeps, getGovernance: () => governance() as any })
  await drain(provider.stream({
    messages: [{ role: 'user', content: 'hi' }],
    metadata: { conversationId: 'c1', origin: 'interactive' },
    ...(tools ? { tools: tools.map(def) } : {}),
    ...extra,
  } as any))
  return h.captured.options
}

const bridged = (options: any): string[] => (options.mcpServers?.eyas?.tools ?? []).map((t: { name: string }) => t.name)

describe('claude-code provider — the tool list bounds the built-ins (K3)', () => {
  beforeEach(() => { h.captured.options = undefined })

  it('(−) a list without write and shell tools: no Write, Edit, NotebookEdit or Bash — left out and disallowed', async () => {
    const o = await optionsFor(['memory_search', 'memory_expand', 'read_file'])
    for (const name of ['Write', 'Edit', 'NotebookEdit', 'Bash']) {
      expect(o.tools, name).not.toContain(name)
      expect(o.disallowedTools, name).toContain(name)
    }
  })

  it('(−) a list without a web tool: no WebFetch or WebSearch', async () => {
    const o = await optionsFor(['memory_search', 'write_file', 'run_command'])
    expect(o.tools).not.toContain('WebFetch')
    expect(o.tools).not.toContain('WebSearch')
    expect(o.disallowedTools).toEqual(expect.arrayContaining(['WebFetch', 'WebSearch']))
  })

  it('(+) reading stays on any list: Read, Glob and Grep', async () => {
    const o = await optionsFor(['memory_search'])
    expect([...o.tools].sort()).toEqual(['Glob', 'Grep', 'Read'])
  })

  it('(+) a list with write, shell and web tools keeps Write, Edit, Bash and WebFetch, and disallows nothing', async () => {
    const o = await optionsFor(['memory_search', 'write_file', 'edit_file', 'run_command', 'research'])
    for (const name of ['Write', 'Edit', 'NotebookEdit', 'Bash', 'WebFetch', 'WebSearch', 'Read']) expect(o.tools, name).toContain(name)
    expect(o).not.toHaveProperty('disallowedTools')
  })

  it('(+) a request that names no tools (no list) keeps every built-in', async () => {
    const o = await optionsFor()
    expect([...o.tools].sort()).toEqual(['Bash', 'Edit', 'Glob', 'Grep', 'NotebookEdit', 'Read', 'WebFetch', 'WebSearch', 'Write'])
    expect(o).not.toHaveProperty('disallowedTools')
  })

  it('(+) the shell alone: Bash stays, Write and Edit do not', async () => {
    const o = await optionsFor(['run_command'])
    expect(o.tools).toContain('Bash')
    expect(o.tools).not.toContain('Write')
    expect(o.disallowedTools).toContain('Write')
    expect(o.disallowedTools).not.toContain('Bash')
  })

  it('(−) an isolated call still gets no tools at all and nothing to disallow', async () => {
    const o = await optionsFor(['memory_search'], { isolated: true })
    expect(o.tools).toEqual([])
    expect(o).not.toHaveProperty('disallowedTools')
  })

  it('(+) without the shell, git_status and git_diff on the list are offered over the EYAS bridge instead', async () => {
    const o = await optionsFor(['memory_search', 'git_status', 'git_diff', 'read_file'])
    expect(bridged(o)).toEqual(['memory_search', 'git_status', 'git_diff'])
  })

  it('(−) with the shell granted, the git tools stay with the CLI\'s own Bash and are not bridged', async () => {
    const o = await optionsFor(['memory_search', 'git_status', 'run_command'])
    expect(bridged(o)).toEqual(['memory_search'])
  })
})

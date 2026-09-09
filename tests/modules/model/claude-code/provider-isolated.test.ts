// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// An isolated request is EYAS asking the CLI's model a question — not EYAS
// asking the CLI to be an agent. Live test #4: the memory extractor resolved to
// claude-code, parsed cleanly, and returned an empty batch, because the call
// ran with settingSources ['user','project'] and the CLI loaded the owner's own
// ~/.claude memory — which already held the fact another tool had written there
// that evening. The extractor saw it "already recorded" and correctly said
// nothing. No prompt rule can win against a whole loaded memory system; the
// call has to stop loading it.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ captured: { options: undefined as any } }))

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: (args: any) => {
    h.captured.options = args.options
    return (async function* () {
      yield { type: 'result', subtype: 'success', result: 'ok', session_id: 's1', usage: { input_tokens: 1, output_tokens: 1 } }
    })()
  },
  // A resumable session really exists here — otherwise the resume assertions
  // below would pass without the gate that is under test doing anything.
  getSessionInfo: async (id: string) => (id === 's-prior' ? { id } : null),
  tool: (name: string, description: string, _schema: unknown, handler: unknown) => ({ name, description, handler }),
  createSdkMcpServer: (cfg: unknown) => ({ ...(cfg as object) }),
}))

import { createClaudeCodeProvider } from '@modules/model/submodules/claude-code/provider.js'

const toolDeps = {
  toolExecutor: { execute: vi.fn() } as any,
  toolRegistry: { list: () => [{ name: 'search_memory', category: 'memory' }] } as any,
}

function governance() {
  return {
    securityGate: { validateToolCall: () => ({ decision: 'allow' as const, reason: 'ok', riskTier: 'green' }) },
    agentRegistry: { list: () => [{ id: 'dev', name: 'Dev', goal: 'g', systemPrompt: 'p' }] },
  }
}

async function drain(gen: AsyncIterable<any>) { for await (const _ of gen) { /* consume */ } }

const req = { messages: [{ role: 'user' as const, content: 'hi' }], metadata: { conversationId: 'c1' } }

describe('claude-code provider — isolated completions', () => {
  beforeEach(() => { h.captured.options = undefined })

  it('declares that it can isolate a completion', () => {
    // The capability is what lets a caller CHOOSE this provider for an
    // extraction-class call; without it the choice would have to name the
    // provider by id.
    expect(createClaudeCodeProvider().supportsIsolatedCompletion).toBe(true)
  })

  it('loads no filesystem settings, even with loadClaudeMd on', async () => {
    const provider = createClaudeCodeProvider({ ...toolDeps, loadClaudeMd: true, getGovernance: () => governance() as any })
    await drain(provider.stream({ ...req, isolated: true } as any))
    expect(h.captured.options.settingSources).toEqual([])
  })

  it('bridges no tools and offers no SDK builtins', async () => {
    const provider = createClaudeCodeProvider({ ...toolDeps, getGovernance: () => governance() as any })
    await drain(provider.stream({ ...req, isolated: true } as any))
    expect(h.captured.options.mcpServers).toBeUndefined()
    // Skipping the bridge alone would leave the SDK's own Read/Write/Bash
    // available — an extraction has no business touching a filesystem.
    expect(h.captured.options.tools).toEqual([])
  })

  it('runs a single turn, whatever the caller or the provider default says', async () => {
    const provider = createClaudeCodeProvider({ ...toolDeps, maxTurns: 25 })
    await drain(provider.stream({ ...req, isolated: true, maxTurns: 12 } as any))
    expect(h.captured.options.maxTurns).toBe(1)
  })

  it('resumes no session, so no prior context comes back in through the side door', async () => {
    // A resumed session restores the whole SDK context of the run it belongs
    // to — everything the empty settingSources just kept out. Isolation wins
    // over a sessionId rather than quietly co-existing with it.
    const provider = createClaudeCodeProvider({ ...toolDeps })
    await drain(provider.stream({ ...req, isolated: true, sessionId: 's-prior' } as any))
    expect(h.captured.options.resume).toBeUndefined()

    // Control: the same session DOES resume without the flag, so the assertion
    // above is the gate at work and not a session that never existed.
    h.captured.options = undefined
    await drain(provider.stream({ ...req, sessionId: 's-prior' } as any))
    expect(h.captured.options.resume).toBe('s-prior')
  })

  it('sends the explicit full source list when the owner opted in', async () => {
    const provider = createClaudeCodeProvider({ ...toolDeps, loadClaudeMd: true, getGovernance: () => governance() as any })
    await drain(provider.stream(req as any))
    // Explicit, not omitted: the installed CLI treats an ABSENT
    // --setting-sources flag as "load everything" while the SDK docs promise
    // the opposite (omitted = none). Stating the intent survives both
    // readings and any SDK upgrade.
    expect(h.captured.options.settingSources).toEqual(['user', 'project', 'local'])
    expect(h.captured.options.mcpServers?.eyas).toBeTruthy()
    expect(h.captured.options.tools).toContain('Read')
    expect(h.captured.options.maxTurns).toBe(25)
  })

  it('defaults to isolation: a provider built without the option sends settingSources []', async () => {
    const provider = createClaudeCodeProvider({ ...toolDeps, getGovernance: () => governance() as any })
    await drain(provider.stream(req as any))
    expect(h.captured.options.settingSources).toEqual([])
  })

  it('still honours loadClaudeMd=false on an ordinary request', async () => {
    const provider = createClaudeCodeProvider({ ...toolDeps, loadClaudeMd: false })
    await drain(provider.stream(req as any))
    expect(h.captured.options.settingSources).toEqual([])
    expect(h.captured.options.maxTurns).toBe(25)
  })

  // F1.7 — settingSources: [] was never the whole isolation story: the CLI's
  // auto-memory keys ~/.claude/projects/<cwd-slug>/memory/MEMORY.md on the
  // WORKING DIRECTORY, not on setting sources, and filesystem MCP configs leak
  // the same way. Both have kill switches; every branch that forces isolation
  // must also set them.

  it('disables auto-memory and filesystem MCP configs on an isolated request', async () => {
    const provider = createClaudeCodeProvider({ ...toolDeps })
    await drain(provider.stream({ ...req, isolated: true } as any))
    expect(h.captured.options.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY).toBe('1')
    expect(h.captured.options.strictMcpConfig).toBe(true)
  })

  it('disables auto-memory and filesystem MCP configs on an ordinary request, provider default', async () => {
    const provider = createClaudeCodeProvider({ ...toolDeps, getGovernance: () => governance() as any })
    await drain(provider.stream(req as any))
    expect(h.captured.options.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY).toBe('1')
    expect(h.captured.options.strictMcpConfig).toBe(true)
  })

  it('leaves auto-memory and MCP config untouched when the owner opts into loadClaudeMd', async () => {
    const provider = createClaudeCodeProvider({ ...toolDeps, loadClaudeMd: true, getGovernance: () => governance() as any })
    await drain(provider.stream(req as any))
    expect(h.captured.options.env).toBeUndefined()
    expect(h.captured.options.strictMcpConfig).toBeUndefined()
  })
})

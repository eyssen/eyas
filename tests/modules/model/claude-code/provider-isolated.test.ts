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
import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const h = vi.hoisted(() => ({
  captured: { options: undefined as any, prompt: undefined as any },
  // A resumable host session "exists" for any id: if the provider still
  // looked sessions up, the no-resume assertions below would catch it.
  getSessionInfo: vi.fn(async (id: string) => ({ id })),
}))

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: (args: any) => {
    h.captured.options = args.options
    h.captured.prompt = args.prompt
    return (async function* () {
      const { fakeClaudeInit } = await import('../../../helpers/claude-sdk-init.js')
      yield fakeClaudeInit(args.options)
      yield { type: 'result', subtype: 'success', result: 'ok', session_id: 's1', usage: { input_tokens: 1, output_tokens: 1 } }
    })()
  },
  getSessionInfo: h.getSessionInfo,
  tool: (name: string, description: string, _schema: unknown, handler: unknown) => ({ name, description, handler }),
  createSdkMcpServer: (cfg: unknown) => ({ ...(cfg as object) }),
}))

import { createClaudeCodeProvider } from '@modules/model/submodules/claude-code/provider.js'
import { TEST_CLAUDE_RUNTIME } from '../../../helpers/claude-runtime.js'

const toolDeps = {
  runtime: TEST_CLAUDE_RUNTIME,
  toolExecutor: { execute: vi.fn() } as any,
  toolRegistry: { list: () => [{ name: 'search_memory', category: 'memory' }] } as any,
}

function governance() {
  return {
    securityGate: { validateToolCall: () => ({ decision: 'allow' as const, reason: 'ok', riskTier: 'green' }) },
  }
}

async function drain(gen: AsyncIterable<any>) { for await (const _ of gen) { /* consume */ } }

const req = { messages: [{ role: 'user' as const, content: 'hi' }], metadata: { conversationId: 'c1' } }

describe('claude-code provider — isolated completions', () => {
  beforeEach(() => {
    h.captured.options = undefined
    h.captured.prompt = undefined
    h.getSessionInfo.mockClear()
  })

  it('declares that it can isolate a completion', () => {
    // The capability is what lets a caller CHOOSE this provider for an
    // extraction-class call; without it the choice would have to name the
    // provider by id.
    expect(createClaudeCodeProvider().supportsIsolatedCompletion).toBe(true)
  })

  it('loads no filesystem settings', async () => {
    const provider = createClaudeCodeProvider({ ...toolDeps, getGovernance: () => governance() as any })
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

  // A3 — continuity is EYAS replay only. A resumed session would restore the
  // provider-native transcript as live context, so no request resumes one —
  // not even a legacy caller that still smuggles a sessionId in by cast.

  it('never resumes a session, even when a legacy caller passes sessionId as an untyped cast', async () => {
    const provider = createClaudeCodeProvider({ ...toolDeps, getGovernance: () => governance() as any })
    for (const isolated of [true, false]) {
      h.captured.options = undefined
      await drain(provider.stream({ ...req, isolated, sessionId: 's-prior' } as any))
      expect(h.captured.options.resume).toBeUndefined()
      expect(h.captured.options).not.toHaveProperty('resume')
    }
    // Nothing looks a host session up any more.
    expect(h.getSessionInfo).not.toHaveBeenCalled()
  })

  it('keeps no CLI transcript: every query sets persistSession false', async () => {
    const provider = createClaudeCodeProvider({ ...toolDeps, getGovernance: () => governance() as any })
    await drain(provider.stream(req as any))
    expect(h.captured.options.persistSession).toBe(false)
    await drain(provider.stream({ ...req, isolated: true } as any))
    expect(h.captured.options.persistSession).toBe(false)
  })

  it('always carries the earlier turns in a <conversation-history> block', async () => {
    const provider = createClaudeCodeProvider({ ...toolDeps })
    await drain(provider.stream({
      messages: [
        { role: 'user', content: 'my name is Ada' },
        { role: 'assistant', content: 'Hello Ada' },
        { role: 'user', content: 'what is my name?' },
      ],
      metadata: { conversationId: 'c1' },
      sessionId: 's-prior',
    } as any))
    expect(typeof h.captured.prompt).toBe('string')
    expect(h.captured.prompt).toContain('<conversation-history>')
    expect(h.captured.prompt).toContain('User: my name is Ada')
    expect(h.captured.prompt).toContain('Assistant: Hello Ada')
    expect(h.captured.prompt.trim().endsWith('what is my name?')).toBe(true)
  })

  it('sends a single-message conversation as-is, with no empty history block', async () => {
    const provider = createClaudeCodeProvider({ ...toolDeps })
    await drain(provider.stream(req as any))
    expect(h.captured.prompt).toBe('hi')
  })

  it('reports no provider session id on the done response', async () => {
    const provider = createClaudeCodeProvider({ ...toolDeps })
    let done: any
    for await (const ev of provider.stream(req as any)) if (ev.type === 'done') done = ev
    expect(done.response).not.toHaveProperty('sessionId')
    expect(done.response.id).not.toBe('s1')
  })

  // A4 — one isolation contract for every query. The same options reach the
  // CLI whether EYAS is chatting, running in the background or asking an
  // isolated one-shot; only the tools and the turn budget differ.

  const variants = [
    ['isolated', { ...req, isolated: true }],
    ['interactive', { ...req, metadata: { ...req.metadata, origin: 'interactive' } }],
    ['background', { ...req, metadata: { ...req.metadata, origin: 'scheduled', autonomous: true } }],
  ] as const

  for (const [label, request] of variants) {
    it(`${label}: no transcript, no host settings, strict MCP, no checkpoints, both kill switches`, async () => {
      const provider = createClaudeCodeProvider({ ...toolDeps, getGovernance: () => governance() as any })
      await drain(provider.stream(request as any))
      const o = h.captured.options
      expect(o.persistSession).toBe(false)
      expect(o.settingSources).toEqual([])
      expect(o.strictMcpConfig).toBe(true)
      expect(o.enableFileCheckpointing).toBe(false)
      expect(o.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY).toBe('1')
      expect(o.env.CLAUDE_CODE_DISABLE_CLAUDE_MDS).toBe('1')
      expect(o.env.CLAUDE_AGENT_SDK_CLIENT_APP).toBe('eyas')
      expect(o.pathToClaudeCodeExecutable).toBe(TEST_CLAUDE_RUNTIME.path)
    })
  }

  describe('environment', () => {
    const planted = { CLAUDECODE: '1', CLAUDE_CODE_SIMPLE: '1', CLAUDE_CONFIG_DIR: '/tmp/elsewhere', OPENAI_API_KEY: 'sk-leak', EYAS_TEST_SECRET: 'x' }
    const saved: Record<string, string | undefined> = {}
    beforeEach(() => {
      for (const [k, v] of Object.entries(planted)) { saved[k] = process.env[k]; process.env[k] = v }
      return () => {
        for (const k of Object.keys(planted)) {
          if (saved[k] === undefined) delete process.env[k]
          else process.env[k] = saved[k]
        }
      }
    })

    it('drops a launching CLI session\'s switches and unrelated secrets from the child env', async () => {
      const provider = createClaudeCodeProvider({ ...toolDeps, getGovernance: () => governance() as any })
      for (const request of [req, { ...req, isolated: true }]) {
        await drain(provider.stream(request as any))
        const env = h.captured.options.env
        for (const key of Object.keys(planted)) expect(env).not.toHaveProperty(key)
        // An allowlist, not a spread: PATH survives, the rest of the server env does not.
        expect(env.PATH).toBe(process.env.PATH)
        expect(Object.keys(env).length).toBeLessThan(Object.keys(process.env).length)
      }
    })
  })

  describe('working directory', () => {
    it('is never the server\'s own cwd: without folders it is the conversation workspace', async () => {
      const provider = createClaudeCodeProvider({ ...toolDeps })
      await drain(provider.stream(req as any))
      const cwd = h.captured.options.cwd
      expect(cwd).not.toBe(process.cwd())
      expect(cwd).toBe(join(process.env.EYAS_WORKSPACES_DIR!, 'c1'))
      expect(existsSync(cwd)).toBe(true)
    })

    it('isolated call without a conversation gets a scratch folder, never process.cwd()', async () => {
      const provider = createClaudeCodeProvider({ ...toolDeps })
      await drain(provider.stream({ messages: [{ role: 'user', content: 'hi' }], isolated: true } as any))
      const cwd = h.captured.options.cwd
      expect(cwd).not.toBe(process.cwd())
      expect(cwd.startsWith(join(process.env.EYAS_WORKSPACES_DIR!, '_runs'))).toBe(true)
    })

    it('uses a stored folder that still validates', async () => {
      const folder = mkdtempSync(join(tmpdir(), 'eyas-cc-folder-'))
      try {
        const provider = createClaudeCodeProvider({ ...toolDeps })
        await drain(provider.stream({ ...req, metadata: { ...req.metadata, workingDirectories: [folder] } } as any))
        expect(h.captured.options.cwd).toBe(realpathSync(folder))
      } finally {
        rmSync(folder, { recursive: true, force: true })
      }
    })

    it('skips a stored folder that no longer validates instead of using it', async () => {
      const provider = createClaudeCodeProvider({ ...toolDeps })
      await drain(provider.stream({ ...req, metadata: { ...req.metadata, workingDirectory: 'relative/dir' } } as any))
      expect(h.captured.options.cwd).toBe(join(process.env.EYAS_WORKSPACES_DIR!, 'c1'))
    })
  })

  it('a provider built with the retired loadClaudeMd=true behaves exactly like one without it', async () => {
    const legacy = createClaudeCodeProvider({ ...toolDeps, loadClaudeMd: true, getGovernance: () => governance() as any } as any)
    await drain(legacy.stream(req as any))
    const a = h.captured.options
    const plain = createClaudeCodeProvider({ ...toolDeps, getGovernance: () => governance() as any })
    await drain(plain.stream(req as any))
    const b = h.captured.options
    // Hook callbacks are per-query closures: compare their shape (events,
    // matcher counts), not function identity.
    const hookShape = (hooks: any) => Object.fromEntries(Object.entries(hooks ?? {}).map(([event, ms]) => [event, (ms as any[]).map((m) => m.hooks.length)]))
    // Each query has its own temp root (CLAUDE_CODE_TMPDIR, also in the sandbox's
    // writable folders): compare where it is used, not its random name.
    const comparable = (o: any) => {
      const { abortController: _a, canUseTool: _c, mcpServers, hooks, ...rest } = o
      const shape = JSON.stringify({ ...rest, mcpServers: Object.keys(mcpServers ?? {}), hooks: hookShape(hooks) })
      return JSON.parse(shape.split(String(o.env.CLAUDE_CODE_TMPDIR)).join('<query tmp>'))
    }
    expect(comparable(a)).toEqual(comparable(b))
    expect(a.settingSources).toEqual([])
    expect(a.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY).toBe('1')
    expect(a.strictMcpConfig).toBe(true)
  })
})

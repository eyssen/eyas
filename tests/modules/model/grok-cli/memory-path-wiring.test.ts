// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// B2: Grok and Kimi permission requests reach the gate with the folders the
// turn really works in — the jail roots (conversation folders that pass the
// folder check, plus the session cwd). Without the cwd a conversation's own
// EYAS workspace would look like another conversation's to the memory-path
// policy.

import { describe, it, expect, vi } from 'vitest'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createGrokCliProvider } from '@modules/model/submodules/grok-cli/provider.js'
import { createKimiCliProvider } from '@modules/model/submodules/kimi-cli/provider.js'
import type { StreamEvent } from '@modules/model/types.js'

function captureRunPrompt() {
  const captured: { opts?: any } = {}
  async function* fakeRun(opts: any) {
    captured.opts = opts
    yield { type: 'text', text: 'ok' } satisfies StreamEvent
    return { text: 'ok', inputTokens: 1, outputTokens: 1, stopReason: 'end' as const }
  }
  return { captured, fakeRun }
}

function governance() {
  const validateToolCall = vi.fn((_name: string, _input: Record<string, unknown>, _ctx?: unknown) => ({
    decision: 'allow' as const, reason: 'green', riskTier: 'green',
  }))
  const checkMemoryPath = vi.fn(() => null)
  return {
    gov: { securityGate: { validateToolCall, checkMemoryPath, autonomyPolicy: undefined } },
    validateToolCall,
    checkMemoryPath,
  }
}

async function drain(gen: AsyncIterable<unknown>) { for await (const _ of gen) { /* consume */ } }

const PROVIDERS = [
  ['grok-cli', (o: any) => createGrokCliProvider(o)],
  ['kimi-cli', (o: any) => createKimiCliProvider(o)],
] as const

describe.each(PROVIDERS)('%s — working folders reach the gate', (_id, create) => {
  it('(+) the permission bridge hands the gate the jail roots, session cwd included', async () => {
    const { captured, fakeRun } = captureRunPrompt()
    const { gov, validateToolCall } = governance()
    const provider = create({ runPrompt: fakeRun, getGovernance: () => gov })
    await drain(provider.stream({
      messages: [{ role: 'user', content: 'hi' }],
      metadata: { conversationId: 'conv-b2', agentId: 'a1', origin: 'interactive' },
    } as any))

    const roots = captured.opts.roots as string[]
    expect(roots).toContain(captured.opts.cwd)
    expect(captured.opts.cwd).toBe(join(process.env.EYAS_WORKSPACES_DIR!, 'conv-b2'))
    await captured.opts.canUseTool('Read', { target_file: 'notes.md' })
    const ctx = validateToolCall.mock.calls[0][2] as { workingDirectories?: string[]; conversationId?: string }
    expect(ctx.conversationId).toBe('conv-b2')
    expect(ctx.workingDirectories).toEqual(roots)
  })

  it('(+) every valid conversation folder is part of them', async () => {
    const extra = mkdtempSync(join(tmpdir(), 'eyas-b2-folder-'))
    try {
      const { captured, fakeRun } = captureRunPrompt()
      const { gov, validateToolCall } = governance()
      const provider = create({ runPrompt: fakeRun, getGovernance: () => gov })
      await drain(provider.stream({
        messages: [{ role: 'user', content: 'hi' }],
        metadata: { conversationId: 'conv-b2', origin: 'interactive', workingDirectories: [extra] },
      } as any))
      await captured.opts.canUseTool('Read', { target_file: 'a.md' })
      const ctx = validateToolCall.mock.calls[0][2] as { workingDirectories?: string[] }
      expect(ctx.workingDirectories).toEqual(captured.opts.roots)
      expect(ctx.workingDirectories?.map((p) => realpathSync(p))).toContain(realpathSync(extra))
      expect(captured.opts.cwd).not.toBe(join(process.env.EYAS_WORKSPACES_DIR!, 'conv-b2'))
    } finally {
      rmSync(extra, { recursive: true, force: true })
    }
  })

  it('(+) client-fs requests use the gate\'s audited checkMemoryPath with the turn identity', async () => {
    const { captured, fakeRun } = captureRunPrompt()
    const { gov, checkMemoryPath } = governance()
    const provider = create({ runPrompt: fakeRun, getGovernance: () => gov })
    await drain(provider.stream({
      messages: [{ role: 'user', content: 'hi' }],
      metadata: { conversationId: 'conv-b2', agentId: 'a1', origin: 'interactive' },
    } as any))
    expect(typeof captured.opts.checkMemoryPath).toBe('function')
    await captured.opts.checkMemoryPath('Read', { path: '/x' }, { workingDirectories: captured.opts.roots })
    expect(checkMemoryPath).toHaveBeenCalledWith('Read', { path: '/x' }, {
      workingDirectories: captured.opts.roots,
      conversationId: 'conv-b2',
      agentId: 'a1',
      homeDir: captured.opts.profile.home,
    })
  })

  it('(+) the gate gets the CLI\'s EYAS-owned HOME, so `~`/`$HOME` are judged where they point', async () => {
    const { captured, fakeRun } = captureRunPrompt()
    const { gov, validateToolCall } = governance()
    const provider = create({ runPrompt: fakeRun, getGovernance: () => gov })
    await drain(provider.stream({
      messages: [{ role: 'user', content: 'hi' }],
      metadata: { conversationId: 'conv-b2', origin: 'interactive' },
    } as any))
    await captured.opts.canUseTool('Bash', { command: 'cat ~/../../vault/x.md' })
    const ctx = validateToolCall.mock.calls[0][2] as { homeDir?: string }
    expect(ctx.homeDir).toBe(captured.opts.profile.home)
    expect(ctx.homeDir).toMatch(new RegExp(`cli-homes[\\\\/]${_id}$`))
  })

  it('(−) an isolated completion gets no gate callback at all', async () => {
    const { captured, fakeRun } = captureRunPrompt()
    const { gov, validateToolCall } = governance()
    const provider = create({ runPrompt: fakeRun, getGovernance: () => gov })
    await drain(provider.stream({
      messages: [{ role: 'user', content: 'hi' }],
      isolated: true,
      metadata: { conversationId: 'conv-b2', origin: 'interactive' },
    } as any))
    expect(captured.opts.canUseTool).toBeUndefined()
    expect(validateToolCall).not.toHaveBeenCalled()
  })
})

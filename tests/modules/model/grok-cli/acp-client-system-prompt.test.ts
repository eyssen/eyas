// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// I8 — the ACP runner's system-prompt channel and its session-closed hook,
// driven against the fake ACP agent over real stdio. The fake keeps
// system_prompt.txt the way grok 1.0.40 does (A1 spike): the default prompt
// from session/new, the override only once the model request is made. So
// the hook must run after the turn and before the session store is purged.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runGrokAcpPrompt, type GrokAcpRunOptions, type GrokAcpRunResult } from '@modules/model/submodules/grok-cli/acp-client.js'
import { readGrokSystemPrompt, type AcpSessionClosedInfo } from '@modules/model/submodules/grok-cli/acp-system-prompt.js'
import type { StreamEvent } from '@modules/model/types.js'
import { fakeAcpProfile, readFakeAcpLog, type FakeAcpProfileOptions } from '../../../helpers/fake-acp.js'

let root: string
let cwd: string

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'eyas-acp-sysprompt-run-')))
  cwd = join(root, 'workspace')
  mkdirSync(cwd, { recursive: true })
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

async function drain(gen: AsyncGenerator<StreamEvent, GrokAcpRunResult>): Promise<GrokAcpRunResult> {
  let step = await gen.next()
  while (!step.done) step = await gen.next()
  return step.value
}

function run(opts: Partial<GrokAcpRunOptions> & { log: string } & Partial<Pick<FakeAcpProfileOptions, 'providerId' | 'systemOverride' | 'promptError' | 'scenario'>>) {
  const { log, providerId, systemOverride, promptError, scenario, ...rest } = opts
  const profile = fakeAcpProfile({ providerId, homesDir: join(root, 'data', 'cli-homes'), dir: root, log, systemOverride, promptError, scenario })
  const gen = runGrokAcpPrompt({ profile, cwd, prompt: [{ type: 'text', text: 'hello' }], turnTimeouts: { idleMs: 20_000, toolMs: 20_000 }, ...rest })
  return { profile, gen }
}

const sent = (log: string, method: string) => readFakeAcpLog(log).received.find((m) => m.method === method)!

describe.skipIf(process.platform === 'win32')('ACP runner — system prompt channel', () => {
  it("'prompt' (the default): no override; the fenced system prompt is the first text block (positive)", async () => {
    const log = join(root, 'prompt.log')
    await drain(run({ log, systemPrompt: 'EYAS SYSTEM' }).gen)
    expect(sent(log, 'session/new').params).not.toHaveProperty('_meta')
    const blocks = sent(log, 'session/prompt').params.prompt
    expect(blocks[0].type).toBe('text')
    expect(blocks[0].text.startsWith('<eyas-system-prompt>\n')).toBe(true)
    expect(blocks[0].text).toContain('EYAS SYSTEM')
    // The conversation follows as its own block.
    expect(blocks[1]).toEqual({ type: 'text', text: 'hello' })
  })

  it("'meta': the override (with the marker) and no fenced copy (positive)", async () => {
    const log = join(root, 'meta.log')
    await drain(run({ log, systemPrompt: 'EYAS SYSTEM', systemPromptChannel: 'meta', systemPromptMarker: '<!-- check X -->' }).gen)
    expect(sent(log, 'session/new').params._meta).toEqual({ systemPromptOverride: 'EYAS SYSTEM\n\n<!-- check X -->' })
    expect(sent(log, 'session/prompt').params.prompt).toEqual([{ type: 'text', text: 'hello' }])
  })

  it("'meta+prompt': both, and the marker rides on the override only (positive)", async () => {
    const log = join(root, 'both.log')
    await drain(run({ log, systemPrompt: 'EYAS SYSTEM', systemPromptChannel: 'meta+prompt', systemPromptMarker: '<!-- check X -->' }).gen)
    expect(sent(log, 'session/new').params._meta.systemPromptOverride).toContain('<!-- check X -->')
    const blocks = sent(log, 'session/prompt').params.prompt
    expect(blocks[0].text).toContain('EYAS SYSTEM')
    expect(JSON.stringify(blocks)).not.toContain('check X')
  })

  it('no system prompt: neither an override nor a fence (negative)', async () => {
    const log = join(root, 'none.log')
    await drain(run({ log, systemPrompt: '   ', systemPromptChannel: 'meta+prompt' }).gen)
    expect(sent(log, 'session/new').params).not.toHaveProperty('_meta')
    expect(sent(log, 'session/prompt').params.prompt).toEqual([{ type: 'text', text: 'hello' }])
  })

  it('Kimi through the same runner: the fenced prompt, never an override (negative)', async () => {
    const log = join(root, 'kimi.log')
    await drain(run({ log, providerId: 'kimi-cli', systemPrompt: 'EYAS SYSTEM' }).gen)
    expect(sent(log, 'session/new').params).not.toHaveProperty('_meta')
    expect(sent(log, 'session/prompt').params.prompt[0].text).toContain('EYAS SYSTEM')
  })

  it('every run opens session/new with the MCP servers again — nothing is re-used from an earlier session (positive)', async () => {
    const mcpServers = [{ name: 'eyas', command: '/bin/echo', args: ['bridge'] }]
    const logs = [join(root, 'one.log'), join(root, 'two.log')]
    for (const log of logs) await drain(run({ log, mcpServers, systemPrompt: 'EYAS SYSTEM' }).gen)
    for (const log of logs) {
      const methods = readFakeAcpLog(log).received.map((m) => m.method)
      expect(methods).toContain('session/new')
      expect(methods).not.toContain('session/load')
      expect(sent(log, 'session/new').params.mcpServers).toEqual(mcpServers)
      expect(sent(log, 'session/prompt').params.prompt[0].text).toContain('EYAS SYSTEM')
    }
  })
})

describe.skipIf(process.platform === 'win32')('ACP runner — onSessionClosed', () => {
  it('runs after the model request and before the purge: the record holds the override then, and nothing survives (positive)', async () => {
    const log = join(root, 'closed.log')
    let seen: { info: AcpSessionClosedInfo; record: string | null } | null = null
    const { profile, gen } = run({
      log,
      systemPrompt: 'EYAS SYSTEM',
      systemPromptChannel: 'meta',
      systemPromptMarker: '<!-- check Y -->',
      onSessionClosed: (info) => {
        seen = { info, record: readGrokSystemPrompt(profile.sessionStorePath, info.sessionId) }
      },
    })
    await drain(gen)
    expect(seen).not.toBeNull()
    expect(seen!.info).toEqual({ sessionId: 'fake-session-1', modelAnswered: true })
    expect(seen!.record).toContain('<!-- check Y -->')
    // The purge ran after the hook.
    expect(existsSync(profile.sessionStorePath) ? readdirSync(profile.sessionStorePath) : []).toEqual([])
  })

  it('a CLI that ignores the override leaves its default prompt in the record (negative)', async () => {
    const log = join(root, 'ignored.log')
    let record: string | null = null
    const { profile, gen } = run({
      log,
      systemOverride: 'ignore',
      systemPrompt: 'EYAS SYSTEM',
      systemPromptChannel: 'meta',
      systemPromptMarker: '<!-- check Z -->',
      onSessionClosed: (info) => { record = readGrokSystemPrompt(profile.sessionStorePath, info.sessionId) },
    })
    await drain(gen)
    expect(record).not.toBeNull()
    expect(record).not.toContain('check Z')
  })

  it('a turn that failed before the model request reports modelAnswered:false (negative)', async () => {
    const log = join(root, 'failed.log')
    let info: AcpSessionClosedInfo | null = null
    const { gen } = run({ log, promptError: true, systemPrompt: 'EYAS SYSTEM', onSessionClosed: (i) => { info = i } })
    await expect(drain(gen)).rejects.toThrow(/before the model request/)
    expect(info).toEqual({ sessionId: 'fake-session-1', modelAnswered: false })
  })

  it('a throwing observer never breaks the turn, and the store is still purged (negative)', async () => {
    const log = join(root, 'throws.log')
    const warnings: string[] = []
    const warn = (_o: unknown, msg?: string) => { warnings.push(msg ?? '') }
    const { profile, gen } = run({
      log,
      systemPrompt: 'EYAS SYSTEM',
      logger: { warn },
      onSessionClosed: () => { throw new Error('observer broke') },
    })
    const result = await drain(gen)
    expect(result.text).toBe('answer')
    expect(warnings.filter((m) => m.includes('session-closed observer failed'))).toHaveLength(1)
    expect(existsSync(profile.sessionStorePath) ? readdirSync(profile.sessionStorePath) : []).toEqual([])
  })
})

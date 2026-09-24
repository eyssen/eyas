// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// A3 — continuity is EYAS replay only. The ACP runner always opens a fresh
// session (session/new) and never sends session/load: a loaded CLI session
// would bring the provider's own transcript back as live context (and, on a
// failed load, silently drop the history — GRK-11). Driven against a tiny fake
// ACP agent over real stdio, so the wire traffic itself is asserted.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runGrokAcpPrompt, type GrokAcpRunResult } from '@modules/model/submodules/grok-cli/acp-client'
import type { StreamEvent } from '@modules/model/types'
import { fakeAcpProfile, readFakeAcpLog } from '../../../helpers/fake-acp.js'

let dir: string

beforeAll(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'eyas-acp-no-resume-')))
})

afterAll(() => { rmSync(dir, { recursive: true, force: true }) })

async function run(logName: string, extra: Record<string, unknown>): Promise<{ result: GrokAcpRunResult; events: StreamEvent[]; methods: Array<{ method: string; params: any }> }> {
  const log = join(dir, logName)
  // The shared fake ACP agent answers session/load too; the test proves it is never asked.
  const profile = fakeAcpProfile({ homesDir: join(dir, 'cli-homes'), dir, log })
  const gen = runGrokAcpPrompt({
    profile,
    cwd: dir,
    prompt: [{ type: 'text', text: '<conversation-history>\nUser: earlier\n</conversation-history>\n\nnow' }],
    turnTimeouts: { idleMs: 15_000, toolMs: 15_000 },
    ...extra,
  } as any)
  const events: StreamEvent[] = []
  let step = await gen.next()
  while (!step.done) {
    events.push(step.value)
    step = await gen.next()
  }
  const methods = readFakeAcpLog(log).received
    .filter((m) => typeof m.method === 'string')
    .map((m) => ({ method: m.method as string, params: m.params ?? null }))
  return { result: step.value, events, methods }
}

describe('grok ACP client — no CLI-side continuity', () => {
  it('opens a fresh session and sends the full prompt (positive)', async () => {
    const { result, events, methods } = await run('plain.log', {})
    expect(methods.map((m) => m.method)).toEqual(['initialize', 'notifications/initialized', 'session/new', 'session/prompt'])
    const prompt = methods.find((m) => m.method === 'session/prompt')!
    expect(prompt.params.sessionId).toBe('fake-session-1')
    expect(prompt.params.prompt[0].text).toContain('<conversation-history>')
    expect(events.some((e) => e.type === 'text' && e.text === 'answer')).toBe(true)
    expect(result.text).toBe('answer')
  })

  it('never sends session/load, even when a legacy caller passes a sessionId by cast (negative)', async () => {
    const { result, methods } = await run('legacy.log', { sessionId: 'host-session-id' })
    const names = methods.map((m) => m.method)
    expect(names).not.toContain('session/load')
    expect(names).toContain('session/new')
    // The smuggled id reaches the wire nowhere.
    expect(JSON.stringify(methods)).not.toContain('host-session-id')
    // And the ACP session id is not handed back to anyone either.
    expect(result).not.toHaveProperty('sessionId')
  })
})

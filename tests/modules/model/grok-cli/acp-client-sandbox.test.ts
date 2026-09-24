// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// B5 — the ACP runner's sandbox hook: prepared once the home is ready and the
// preflight passed, its variables go on the turn's spawn only (never on the
// preflight's `grok inspect`), and it is released after the CLI exited —
// also when the turn fails. Driven against the fake ACP agent over stdio.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runGrokAcpPrompt, type GrokAcpRunResult } from '@modules/model/submodules/grok-cli/acp-client.js'
import { clearAcpPreflightCache } from '@modules/model/submodules/grok-cli/acp-verify.js'
import { resetIsolationStatuses } from '@modules/model/cli-runtime/isolation.js'
import type { StreamEvent } from '@modules/model/types.js'
import { fakeAcpProfile, readFakeAcpLog } from '../../../helpers/fake-acp.js'

let root: string
let cwd: string

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'eyas-acp-sandbox-')))
  cwd = join(root, 'workspace')
  mkdirSync(cwd, { recursive: true })
})

afterEach(() => {
  clearAcpPreflightCache()
  resetIsolationStatuses()
  rmSync(root, { recursive: true, force: true })
})

async function drain(gen: AsyncGenerator<StreamEvent, GrokAcpRunResult>): Promise<GrokAcpRunResult> {
  let step = await gen.next()
  while (!step.done) step = await gen.next()
  return step.value
}

describe.skipIf(process.platform === 'win32')('ACP runner — kernel sandbox hook', () => {
  it('adds its variables to the spawn only, after the preflight, and releases once the CLI exited', async () => {
    const log = join(root, 'grok.log')
    const profile = fakeAcpProfile({ homesDir: join(root, 'homes'), dir: root, log })
    const order: string[] = []
    const release = vi.fn(() => order.push('release'))
    const prepareSandbox = vi.fn(({ executable }: { executable: string }) => {
      order.push(`prepare:${executable === '' ? 'none' : 'exe'}`)
      // The preflight has already run when the sandbox is prepared.
      expect(readFakeAcpLog(log).inspects.length).toBe(1)
      return { env: { GROK_SANDBOX: 'eyas-0123456789abcdef', GROK_SANDBOX_AUTO_ALLOW_BASH: 'false' }, release }
    })
    const result = await drain(runGrokAcpPrompt({ profile, cwd, prompt: [{ type: 'text', text: 'hi' }], turnTimeouts: { idleMs: 20_000, toolMs: 20_000 }, prepareSandbox }))
    expect(result.text).toBe('answer')
    expect(prepareSandbox).toHaveBeenCalledTimes(1)
    expect(prepareSandbox.mock.calls[0][0].executable).toBe(await profile.resolveExecutable())
    const { start, inspects } = readFakeAcpLog(log)
    expect(start.env.GROK_SANDBOX).toBe('eyas-0123456789abcdef')
    expect(start.env.GROK_SANDBOX_AUTO_ALLOW_BASH).toBe('false')
    for (const i of inspects) expect(i.env).not.toHaveProperty('GROK_SANDBOX')
    expect(release).toHaveBeenCalledTimes(1)
    expect(order).toEqual(['prepare:exe', 'release'])
  })

  it('releases when the turn fails after the spawn', async () => {
    const log = join(root, 'grok-fail.log')
    const profile = fakeAcpProfile({ homesDir: join(root, 'homes'), dir: root, log, promptError: true })
    const release = vi.fn()
    const err = await drain(runGrokAcpPrompt({
      profile, cwd, prompt: [{ type: 'text', text: 'hi' }], turnTimeouts: { idleMs: 20_000, toolMs: 20_000 },
      prepareSandbox: () => ({ env: { GROK_SANDBOX: 'eyas-0123456789abcdef' }, release }),
    })).catch((e) => e)
    expect(err).toBeInstanceOf(Error)
    expect(release).toHaveBeenCalledTimes(1)
  })

  it('negative: a preflight that refuses the turn never prepares a sandbox', async () => {
    const log = join(root, 'grok-hostile.log')
    const profile = fakeAcpProfile({ homesDir: join(root, 'homes'), dir: root, log, inspect: 'hostile' })
    const prepareSandbox = vi.fn(() => ({ env: {}, release: vi.fn() }))
    const err = await drain(runGrokAcpPrompt({ profile, cwd, prompt: [{ type: 'text', text: 'hi' }], turnTimeouts: { idleMs: 20_000, toolMs: 20_000 }, prepareSandbox })).catch((e) => e)
    expect(err).toMatchObject({ kind: 'isolation', code: 'cliIsolation' })
    expect(prepareSandbox).not.toHaveBeenCalled()
    expect(readFakeAcpLog(log).start.argv).toEqual([])
  })

  it('negative: without the hook the spawn carries no sandbox selection', async () => {
    const log = join(root, 'grok-plain.log')
    const profile = fakeAcpProfile({ homesDir: join(root, 'homes'), dir: root, log })
    await drain(runGrokAcpPrompt({ profile, cwd, prompt: [{ type: 'text', text: 'hi' }], turnTimeouts: { idleMs: 20_000, toolMs: 20_000 } }))
    expect(readFakeAcpLog(log).start.env).not.toHaveProperty('GROK_SANDBOX')
  })
})

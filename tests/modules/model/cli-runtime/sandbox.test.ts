// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// B5 — kernel file sandbox availability and the per-turn decision: one
// strategy per OS (macOS Seatbelt, Linux bubblewrap), Kimi has none, and
// security.cliSandbox decides what a turn with tools does without one.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  CliSandboxUnavailableError,
  clearKernelSandboxCache,
  configureCliSandbox,
  describeFileSandbox,
  detectKernelSandbox,
  exemptableDirs,
  getCliSandboxMode,
  planCliSandboxTurn,
  resetCliSandboxForTests,
  sandboxDenyList,
  setDefaultSandboxHostForTests,
  whichOnPath,
  type SandboxHostDeps,
} from '@modules/model/cli-runtime/sandbox/index.js'
import { BWRAP_PROBE_ARGS } from '@modules/model/cli-runtime/sandbox/linux-bubblewrap.js'
import { classifyModelError } from '@shared/classify-model-error.js'
import { createSovereigntyFixture } from '../../../helpers/memory-sovereignty-fixture'

/** The host tests/helpers/cli-sandbox.setup.ts pins for every test file. */
const PINNED_HOST: Partial<SandboxHostDeps> = { platform: 'darwin', which: () => null, probe: async () => false }

afterEach(() => {
  resetCliSandboxForTests()
})

/** A Linux host with the given tools on PATH and a bwrap probe that exits 0 (or not). */
function linux(tools: string[], probeOk = true): Partial<SandboxHostDeps> & { probe: ReturnType<typeof vi.fn> } {
  return {
    platform: 'linux',
    which: (name: string) => (tools.includes(name) ? `/usr/bin/${name}` : null),
    probe: vi.fn(async () => probeOk),
  }
}

describe('detectKernelSandbox', () => {
  it('macOS: Seatbelt is available to both sandbox-capable CLIs', async () => {
    const host = { platform: 'darwin' as const, which: () => null, probe: vi.fn(async () => false) }
    expect(await detectKernelSandbox('claude-code', { host })).toEqual({ available: true, reason: 'darwin-seatbelt' })
    expect(await detectKernelSandbox('grok-cli', { host })).toEqual({ available: true, reason: 'darwin-seatbelt' })
    // Nothing to install, nothing to probe.
    expect(host.probe).not.toHaveBeenCalled()
  })

  it('Linux without bubblewrap: no-bwrap for both CLIs', async () => {
    const host = linux([])
    expect(await detectKernelSandbox('grok-cli', { host })).toEqual({ available: false, reason: 'no-bwrap' })
    expect(await detectKernelSandbox('claude-code', { host })).toEqual({ available: false, reason: 'no-bwrap' })
    expect(host.probe).not.toHaveBeenCalled()
  })

  it('Linux with bubblewrap but no socat: Claude Code unavailable, Grok available', async () => {
    const host = linux(['bwrap'])
    expect(await detectKernelSandbox('claude-code', { host })).toEqual({ available: false, reason: 'no-socat' })
    expect(await detectKernelSandbox('grok-cli', { host })).toEqual({ available: true, reason: 'linux-bwrap' })
  })

  it('Linux with bubblewrap and socat: both available after one working probe run', async () => {
    const host = linux(['bwrap', 'socat'])
    expect(await detectKernelSandbox('claude-code', { host })).toEqual({ available: true, reason: 'linux-bwrap' })
    expect(host.probe).toHaveBeenCalledWith('/usr/bin/bwrap', BWRAP_PROBE_ARGS)
  })

  it('Linux where bubblewrap cannot build a sandbox (no user namespaces): bwrap-unusable, never available', async () => {
    const host = linux(['bwrap', 'socat'], false)
    expect(await detectKernelSandbox('grok-cli', { host })).toEqual({ available: false, reason: 'bwrap-unusable' })
    expect(await detectKernelSandbox('claude-code', { host })).toEqual({ available: false, reason: 'bwrap-unusable' })
  })

  it('a platform without a strategy has none; Kimi never has one', async () => {
    const win = { platform: 'win32' as const, which: () => null, probe: async () => true }
    expect(await detectKernelSandbox('claude-code', { host: win })).toEqual({ available: false, reason: 'unsupported-platform' })
    expect(await detectKernelSandbox('kimi-cli', { host: { platform: 'darwin' } })).toEqual({ available: false, reason: 'cli-has-none' })
  })

  it('a probe that throws is no sandbox (negative)', async () => {
    const host = { platform: 'linux' as const, which: () => '/usr/bin/bwrap', probe: async () => { throw new Error('boom') } }
    expect((await detectKernelSandbox('grok-cli', { host })).available).toBe(false)
  })

  it("this process's own detection is cached, and refresh re-detects", async () => {
    setDefaultSandboxHostForTests(null)
    try {
      clearKernelSandboxCache()
      const a = detectKernelSandbox('kimi-cli')
      expect(detectKernelSandbox('kimi-cli')).toBe(a)
      expect(detectKernelSandbox('kimi-cli', { refresh: true })).not.toBe(a)
      expect(await a).toEqual({ available: false, reason: 'cli-has-none' })
    } finally {
      setDefaultSandboxHostForTests(PINNED_HOST)
    }
  })

  it('the test pin replaces the host when a caller passes none; an explicit host still wins', async () => {
    expect(await detectKernelSandbox('grok-cli')).toEqual({ available: true, reason: 'darwin-seatbelt' })
    expect(await detectKernelSandbox('grok-cli', { host: { platform: 'linux' } })).toEqual({ available: false, reason: 'no-bwrap' })
  })
})

describe('whichOnPath', () => {
  it('finds an executable file on PATH and ignores non-executables and relative entries', () => {
    const dir = mkdtempSync(join(tmpdir(), 'eyas-which-'))
    try {
      mkdirSync(join(dir, 'bin'))
      writeFileSync(join(dir, 'bin', 'bwrap'), '#!/bin/sh\n')
      chmodSync(join(dir, 'bin', 'bwrap'), 0o755)
      writeFileSync(join(dir, 'bin', 'socat'), 'not executable')
      chmodSync(join(dir, 'bin', 'socat'), 0o644)
      const path = ['relative/bin', join(dir, 'bin')].join(process.platform === 'win32' ? ';' : ':')
      expect(whichOnPath('bwrap', path)).toBe(join(dir, 'bin', 'bwrap'))
      expect(whichOnPath('socat', path)).toBeNull()
      expect(whichOnPath('nothing-here', path)).toBeNull()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('security.cliSandbox mode', () => {
  it('defaults to auto, follows the configured value on every call', () => {
    expect(getCliSandboxMode()).toBe('auto')
    let configured: unknown = 'required'
    configureCliSandbox({ mode: () => configured })
    expect(getCliSandboxMode()).toBe('required')
    configured = 'auto'
    expect(getCliSandboxMode()).toBe('auto')
  })

  it('a value that is set but unknown fails closed to required (negative)', () => {
    configureCliSandbox({ mode: () => 'off' })
    expect(getCliSandboxMode()).toBe('required')
    configureCliSandbox({ mode: () => { throw new Error('config gone') } })
    expect(getCliSandboxMode()).toBe('auto')
  })

  it('describeFileSandbox: active / unavailable / unsupported with reason and mode', async () => {
    expect(await describeFileSandbox('grok-cli', { host: { platform: 'darwin' }, mode: 'auto' }))
      .toEqual({ status: 'active', reason: 'darwin-seatbelt', mode: 'auto' })
    expect(await describeFileSandbox('claude-code', { host: linux(['bwrap']), mode: 'required' }))
      .toEqual({ status: 'unavailable', reason: 'no-socat', mode: 'required' })
    expect(await describeFileSandbox('kimi-cli', { mode: 'auto' }))
      .toEqual({ status: 'unsupported', reason: 'cli-has-none', mode: 'auto' })
  })
})

describe('planCliSandboxTurn', () => {
  it('available: sandboxed, whatever the mode', async () => {
    for (const mode of ['auto', 'required'] as const) {
      expect(await planCliSandboxTurn('grok-cli', { host: { platform: 'darwin' }, mode }))
        .toEqual({ sandboxed: true, mode, reason: 'darwin-seatbelt' })
    }
  })

  it("'required' and none available: a coded, terminal refusal before anything runs", async () => {
    const err = await planCliSandboxTurn('claude-code', { host: linux([]), mode: 'required' }).catch((e) => e)
    expect(err).toBeInstanceOf(CliSandboxUnavailableError)
    expect(err).toMatchObject({ kind: 'isolation', code: 'cliSandboxUnavailable', params: { provider: 'claude-code', reason: 'no-bwrap' } })
    // Never retried, never failed over.
    expect(classifyModelError(err)).toMatchObject({ kind: 'isolation', retryable: false, code: 'cliSandboxUnavailable' })
    const kimi = await planCliSandboxTurn('kimi-cli', { mode: 'required' }).catch((e) => e)
    expect(kimi).toMatchObject({ code: 'cliSandboxUnavailable', params: { reason: 'cli-has-none' } })
  })

  it("'auto' and none available: runs, with the notice once per conversation and CLI", async () => {
    const first = await planCliSandboxTurn('kimi-cli', { conversationId: 'c1', mode: 'auto' })
    expect(first).toEqual({
      sandboxed: false,
      mode: 'auto',
      reason: 'cli-has-none',
      notice: { type: 'notice', code: 'cliSandboxUnavailable', params: { provider: 'Kimi Code CLI', reason: 'cli-has-none' } },
    })
    expect(await planCliSandboxTurn('kimi-cli', { conversationId: 'c1', mode: 'auto' })).toMatchObject({ sandboxed: false, notice: null })
    // Another conversation, or another CLI, is told again.
    expect(await planCliSandboxTurn('kimi-cli', { conversationId: 'c2', mode: 'auto' })).toMatchObject({ notice: { code: 'cliSandboxUnavailable' } })
    expect(await planCliSandboxTurn('grok-cli', { conversationId: 'c1', host: linux([]), mode: 'auto' }))
      .toMatchObject({ reason: 'no-bwrap', notice: { params: { provider: 'Grok CLI', reason: 'no-bwrap' } } })
  })
})

describe('exemptableDirs', () => {
  it('keeps folders beside or below the home, never the home, an ancestor of it or /', () => {
    const home = '/home/op'
    expect(exemptableDirs(['/home/op/.grok/bin', '/opt/grok', '/home/op', '/home', '/', 'relative/x'], home))
      .toEqual(['/home/op/.grok/bin', '/opt/grok'])
  })

  it('negative: never a folder that holds something the deny list protects', () => {
    expect(exemptableDirs(['/srv', '/srv/eyas/bin', '/srv/eyas/data/cli-homes/grok-cli'], '/home/op', ['/srv/eyas/data', '/srv/notes']))
      .toEqual(['/srv/eyas/bin', '/srv/eyas/data/cli-homes/grok-cli'])
  })
})

describe('sandboxDenyList', () => {
  it("keeps the CLI's own home and binary folder usable, and drops a keep that would shelter a protected store", () => {
    const fx = createSovereigntyFixture()
    try {
      const cliHome = join(fx.dataDir, 'cli-homes', 'grok-cli')
      mkdirSync(join(cliHome, '.grok'), { recursive: true })
      const denied = (list: string[], p: string) => list.some((d) => p === d || p.startsWith(`${d}/`) || realpathSync(p) === d || realpathSync(p).startsWith(`${d}/`))

      const list = sandboxDenyList(fx.policy, { workingDirectories: [fx.ownWorkspace], keep: [cliHome], homeDir: fx.home })
      expect(denied(list, join(cliHome, '.grok'))).toBe(false)
      expect(denied(list, fx.eyasVaultNote)).toBe(true)
      expect(denied(list, fx.claudeMemory)).toBe(true)

      // A "binary folder" that is the fixture root would exempt everything: dropped.
      const sheltered = sandboxDenyList(fx.policy, { workingDirectories: [fx.ownWorkspace], keep: [fx.root, cliHome], homeDir: '/nowhere' })
      expect(denied(sheltered, fx.claudeMemory)).toBe(true)
      expect(denied(sheltered, fx.otherFile)).toBe(true)
    } finally {
      fx.cleanup()
    }
  })
})

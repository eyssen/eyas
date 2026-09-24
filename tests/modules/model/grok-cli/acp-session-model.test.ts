// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// F11 — the runner's in-session model selection (session/set_model, ACP
// unstable), used by Kimi whose argv takes no --model, and the Kimi preflight
// that holds the share dir set_model writes to inside the EYAS Kimi home (the
// guard the plan called kimiShareDirOwned, derived from the isolation check
// instead of a second flag).

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runGrokAcpPrompt, type GrokAcpRunResult } from '@modules/model/submodules/grok-cli/acp-client.js'
import { clearAcpPreflightCache, evaluateKimiHome } from '@modules/model/submodules/grok-cli/acp-verify.js'
import { createAcpProfile, kimiShareDirOf } from '@modules/model/submodules/grok-cli/acp-profiles.js'
import { resetIsolationStatuses } from '@modules/model/cli-runtime/isolation.js'
import { CliModelIdError } from '@modules/model/cli-model-id.js'
import type { AcpSessionModels } from '@modules/model/submodules/grok-cli/acp-events.js'
import { fakeAcpProfile, readFakeAcpLog } from '../../../helpers/fake-acp.js'

let root: string
let cwd: string

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'eyas-acp-set-model-')))
  cwd = join(root, 'workspace')
  mkdirSync(cwd, { recursive: true })
  clearAcpPreflightCache()
  resetIsolationStatuses()
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
  resetIsolationStatuses()
})

describe('kimiShareDirOf', () => {
  it('KIMI_SHARE_DIR wins; without it ~/.kimi of the child HOME; neither: null', () => {
    expect(kimiShareDirOf({ KIMI_SHARE_DIR: '/a/.kimi', HOME: '/h' })).toBe('/a/.kimi')
    expect(kimiShareDirOf({ HOME: '/h' })).toBe(join('/h', '.kimi'))
    expect(kimiShareDirOf({})).toBeNull()
  })
})

describe('Kimi preflight — the share dir is the EYAS Kimi home', () => {
  const kimi = (extraEnv?: () => Record<string, string | undefined>) => {
    const profile = createAcpProfile('kimi-cli', { homesDir: join(root, 'cli-homes'), resolveExecutable: async () => '/bin/false', sourceEnv: { PATH: '/usr/bin' }, extraEnv })
    profile.ensureHome()
    return profile
  }

  it('the profile as built points Kimi at its own home: no violation (positive)', () => {
    expect(evaluateKimiHome(kimi(), { parseToml: null })).toEqual([])
    // Without KIMI_SHARE_DIR, ~/.kimi of the EYAS HOME is the same folder.
    expect(evaluateKimiHome(kimi(() => ({ KIMI_SHARE_DIR: undefined })), { parseToml: null })).toEqual([])
  })

  it('a share dir outside the EYAS home, or a relative one, is a violation (negative)', () => {
    const foreign = evaluateKimiHome(kimi(() => ({ KIMI_SHARE_DIR: join(root, 'host', '.kimi') })), { parseToml: null })
    expect(foreign.map((v) => v.check)).toEqual(['permissionMode'])
    expect(foreign[0].detail).toContain('not the EYAS Kimi home')
    expect(evaluateKimiHome(kimi(() => ({ KIMI_SHARE_DIR: '.kimi' })), { parseToml: null }).map((v) => v.check)).toEqual(['permissionMode'])
  })
})

describe.skipIf(process.platform === 'win32')('runner — sessionModel (session/set_model)', () => {
  async function run(sessionModel: (m: AcpSessionModels | null) => string | undefined, opts: { dialect?: 'kimi' | 'grok' } = {}) {
    const log = join(root, `run-${Math.random().toString(36).slice(2)}.log`)
    const profile = fakeAcpProfile({ providerId: 'kimi-cli', homesDir: join(root, 'data', 'cli-homes'), dir: root, log, dialect: opts.dialect ?? 'kimi' })
    const seen: Array<AcpSessionModels | null> = []
    const gen = runGrokAcpPrompt({
      profile,
      cwd,
      prompt: [{ type: 'text', text: 'hi' }],
      sessionModel: (m) => { seen.push(m); return sessionModel(m) },
    })
    let result: GrokAcpRunResult | undefined
    let error: unknown
    try {
      let step = await gen.next()
      while (!step.done) step = await gen.next()
      result = step.value
    } catch (err) {
      error = err
    }
    const received = readFakeAcpLog(log).received
    return { result, error, seen, received, methods: received.map((m) => m.method).filter(Boolean) }
  }

  it('sends the chosen id after session/new and before the prompt, and reports it as the model that ran (positive)', async () => {
    const r = await run(() => 'k2.6')
    expect(r.error).toBeUndefined()
    expect(r.seen[0]?.currentModelId).toBe('kimi-code/kimi-for-coding,thinking')
    expect(r.methods.indexOf('session/new')).toBeLessThan(r.methods.indexOf('session/set_model'))
    expect(r.methods.indexOf('session/set_model')).toBeLessThan(r.methods.indexOf('session/prompt'))
    expect(r.received.find((m) => m.method === 'session/set_model')!.params).toEqual({ sessionId: 'fake-session-1', modelId: 'k2.6' })
    expect(r.result?.resolvedModelId).toBe('k2.6')
  })

  it('the current id, or undefined, sends nothing (negative)', async () => {
    for (const choice of [() => 'kimi-code/kimi-for-coding,thinking', () => undefined]) {
      const r = await run(choice)
      expect(r.methods).not.toContain('session/set_model')
      expect(r.result?.resolvedModelId).toBe('kimi-code/kimi-for-coding,thinking')
    }
  })

  it('a refused switch ends the turn with CliModelIdError before any prompt (negative)', async () => {
    const r = await run(() => 'kimi-k3')
    expect(r.error).toBeInstanceOf(CliModelIdError)
    expect((r.error as Error).message).toContain('refused to switch')
    expect(r.methods).not.toContain('session/prompt')
  })

  it('a flag-like id is never sent; a selection that throws ends the turn the same way (negative)', async () => {
    const flag = await run(() => '--yolo')
    expect(flag.error).toBeInstanceOf(CliModelIdError)
    expect(flag.methods).not.toContain('session/set_model')
    const thrown = await run(() => { throw new CliModelIdError('x', 'not offered') })
    expect(thrown.error).toBeInstanceOf(CliModelIdError)
    expect(thrown.methods).not.toContain('session/prompt')
  })
})

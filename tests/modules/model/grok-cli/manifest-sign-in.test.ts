// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// A7 — the Grok/Kimi submodules take their sign-in from ctx.cliSignIn: the
// stored key is re-read when the provider loads, reaches grok only through
// the profile's extraEnv (never from the host environment), and a signed-out
// home fails a turn with 'cliSignIn' before anything is spawned.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { chmodSync, existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { clearExecutableCache } from '@modules/model/cli-runtime/executables.js'
import { grokCliManifest } from '@modules/model/submodules/grok-cli/manifest.js'
import { kimiCliManifest } from '@modules/model/submodules/kimi-cli/manifest.js'
import { classifyModelError } from '@shared/classify-model-error.js'
import type { ModuleContext } from '@core/types'
import { readFakeAcpLog, writeFakeAcpExecutable } from '../../../helpers/fake-acp.js'

const KEYS = ['EYAS_GROK_BIN', 'EYAS_KIMI_BIN', 'EYAS_DATA_DIR', 'XAI_API_KEY'] as const
const saved: Record<string, string | undefined> = {}
let root: string

/** Answers --version; anything else is logged as a spawn. */
function fakeCli(name: string, log: string): string {
  const path = join(root, name)
  writeFileSync(path, [
    '#!/bin/sh',
    'if [ "$1" = "--version" ]; then echo "fake 1.0.40"; exit 0; fi',
    `printf 'spawned %s\\n' "$*" >> '${log}.spawn'`,
    'exit 1',
  ].join('\n') + '\n')
  chmodSync(path, 0o755)
  return path
}

function context(signIn: { signedIn: boolean; key?: string }) {
  const registered: any[] = []
  const upserts: any[] = []
  const noop = () => {}
  const logger = { info: noop, warn: noop, error: noop, debug: noop, child: () => logger } as any
  const cliSignIn = {
    refresh: vi.fn(async () => {}),
    profileEnv: vi.fn(() => (signIn.key ? { XAI_API_KEY: signIn.key } : {})),
    isSignedIn: vi.fn(() => signIn.signedIn),
  }
  const ctx = {
    logger,
    config: { server: { host: '127.0.0.1', port: 3999 } },
    providerReload: new Map(),
    providerConfig: {
      ensureProvider: noop,
      getProvider: () => ({ enabled: true, settings: {} }),
      listModels: () => [],
      upsertModels: (_id: string, models: any[]) => upserts.push(models),
      reconcileDiscoveredModels: (_id: string, models: any[]) => {
        upserts.push(models)
        return { missing: [], restored: [] }
      },
    },
    model: {
      registerProvider: (p: any) => registered.push(p),
      unregisterProvider: noop,
      getProvider: () => registered[0],
    },
    cliSignIn,
  } as unknown as ModuleContext
  return { ctx, registered, upserts, cliSignIn }
}

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'eyas-acp-sign-in-')))
  for (const k of KEYS) saved[k] = process.env[k]
  process.env.EYAS_DATA_DIR = join(root, 'data')
  clearExecutableCache()
})

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
  clearExecutableCache()
  rmSync(root, { recursive: true, force: true })
})

describe.skipIf(process.platform === 'win32')('Grok/Kimi submodules and the EYAS sign-in', () => {
  it('grok: the stored key reaches the CLI through the profile, the host key never does (positive + negative)', async () => {
    const log = join(root, 'models.log')
    // The discovery probe speaks ACP: the fake agent logs the env it got.
    process.env.EYAS_GROK_BIN = writeFakeAcpExecutable(root, { log, models: 'recorded' })
    process.env.XAI_API_KEY = 'HOST-XAI-KEY'
    const { ctx, registered, upserts, cliSignIn } = context({ signedIn: true, key: 'xai-EYAS-STORED' })
    await grokCliManifest.onStart!(ctx)
    expect(cliSignIn.refresh).toHaveBeenCalledWith('grok-cli')
    expect(registered).toHaveLength(1)
    for (let i = 0; i < 250 && upserts.length < 2; i++) await new Promise((r) => setTimeout(r, 20))
    expect(upserts).toHaveLength(2)
    const { start, inspects } = readFakeAcpLog(log)
    expect(start.env.XAI_API_KEY).toBe('xai-EYAS-STORED')
    expect(inspects.every((i) => i.env.XAI_API_KEY === 'xai-EYAS-STORED')).toBe(true)
    expect(JSON.stringify(start.env)).not.toContain('HOST-XAI-KEY')
  })

  it('grok: a signed-out home runs no discovery probe at load (negative)', async () => {
    const log = join(root, 'signed-out.log')
    process.env.EYAS_GROK_BIN = writeFakeAcpExecutable(root, { log, models: 'recorded' })
    const { ctx, upserts } = context({ signedIn: false })
    await grokCliManifest.onStart!(ctx)
    // The load-time isolation check (inspect) may run; a session never starts.
    for (let i = 0; i < 40; i++) await new Promise((r) => setTimeout(r, 20))
    expect(readFakeAcpLog(log).start.argv).toEqual([])
    expect(upserts).toHaveLength(1)
  })

  it('grok: a signed-out home fails a turn with cliSignIn and spawns nothing (negative)', async () => {
    const log = join(root, 'turn.log')
    process.env.EYAS_GROK_BIN = fakeCli('grok', log)
    const { ctx, registered } = context({ signedIn: false })
    await grokCliManifest.onStart!(ctx)
    let thrown: unknown
    try {
      for await (const _ of registered[0].stream({ messages: [{ role: 'user', content: 'hi' }] })) { /* drain */ }
    } catch (err) {
      thrown = err
    }
    expect(classifyModelError(thrown)).toMatchObject({ kind: 'auth', code: 'cliSignIn', params: { provider: 'grok-cli' } })
    expect(existsSync(`${log}.spawn`)).toBe(false)
  })

  it('kimi: the sign-in is refreshed on load and a signed-out home fails with cliSignIn', async () => {
    const log = join(root, 'kimi.log')
    process.env.EYAS_KIMI_BIN = fakeCli('kimi', log)
    const { ctx, registered, cliSignIn } = context({ signedIn: false })
    await kimiCliManifest.onStart!(ctx)
    expect(cliSignIn.refresh).toHaveBeenCalledWith('kimi-cli')
    let thrown: unknown
    try {
      for await (const _ of registered[0].stream({ messages: [{ role: 'user', content: 'hi' }] })) { /* drain */ }
    } catch (err) {
      thrown = err
    }
    expect(classifyModelError(thrown).code).toBe('cliSignIn')
    expect(existsSync(`${log}.spawn`)).toBe(false)
  })
})

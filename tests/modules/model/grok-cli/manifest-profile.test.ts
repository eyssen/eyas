// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// A5 — the Grok/Kimi submodules resolve their binary with the shared
// cli-runtime resolver (override → PATH, an invalid override fails closed)
// and register a provider whose every spawn — the model discovery probe
// included — runs through the EYAS-owned profile, never the operator's HOME.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { clearExecutableCache } from '@modules/model/cli-runtime/executables.js'
import { grokCliManifest, isGrokCliAvailable } from '@modules/model/submodules/grok-cli/manifest.js'
import { isKimiCliAvailable } from '@modules/model/submodules/kimi-cli/manifest.js'
import type { ModuleContext } from '@core/types'
import { readFakeAcpLog, writeFakeAcpExecutable } from '../../../helpers/fake-acp.js'

const saved: Record<string, string | undefined> = {}
const KEYS = ['EYAS_GROK_BIN', 'EYAS_KIMI_BIN', 'EYAS_DATA_DIR'] as const
let root: string

/** The fake ACP CLI (answers --version, inspect and ACP; logs its argv/env), with the recorded grok 1.0.41 models. */
function fakeCli(_name: string, log: string): string {
  return writeFakeAcpExecutable(root, { log, models: 'recorded' })
}

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'eyas-acp-manifest-')))
  for (const k of KEYS) saved[k] = process.env[k]
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

describe.skipIf(process.platform === 'win32')('Grok/Kimi availability', () => {
  it('is the cli-runtime resolver: an override pointing at an executable counts (positive)', async () => {
    process.env.EYAS_GROK_BIN = fakeCli('grok', join(root, 'unused.log'))
    process.env.EYAS_KIMI_BIN = fakeCli('kimi', join(root, 'unused.log'))
    expect(await isGrokCliAvailable()).toBe(true)
    expect(await isKimiCliAvailable()).toBe(true)
  })

  it('an invalid override fails closed and never falls back to PATH (negative)', async () => {
    process.env.EYAS_GROK_BIN = join(root, 'missing-grok')
    process.env.EYAS_KIMI_BIN = 'relative/kimi'
    expect(await isGrokCliAvailable()).toBe(false)
    expect(await isKimiCliAvailable()).toBe(false)
  })
})

describe.skipIf(process.platform === 'win32')('grok submodule start', () => {
  function ctx(opts: { enabled: boolean }) {
    const registered: any[] = []
    const upserts: Array<{ id: string; models: any[] }> = []
    const noop = () => {}
    const logger = { info: noop, warn: noop, error: noop, debug: noop, child: () => logger } as any
    const context = {
      logger,
      config: { server: { host: '127.0.0.1', port: 3999 } },
      providerReload: new Map(),
      providerConfig: {
        ensureProvider: noop,
        getProvider: () => ({ enabled: opts.enabled, settings: { maxTurns: 5 } }),
        listModels: () => [],
        upsertModels: (id: string, models: any[]) => upserts.push({ id, models }),
        // The background discovery lands through the reconcile (F2).
        reconcileDiscoveredModels: (id: string, models: any[]) => {
          upserts.push({ id, models })
          return { missing: [], restored: [] }
        },
      },
      model: {
        registerProvider: (p: any) => registered.push(p),
        unregisterProvider: noop,
        getProvider: () => registered[0],
      },
    } as unknown as ModuleContext
    return { context, registered, upserts }
  }

  it('registers a provider whose model probe runs in the EYAS home, not the operator HOME', async () => {
    process.env.EYAS_DATA_DIR = join(root, 'data')
    const log = join(root, 'models.log')
    process.env.EYAS_GROK_BIN = fakeCli('grok', log)
    const { context, registered, upserts } = ctx({ enabled: true })
    await grokCliManifest.onStart!(context)
    expect(registered).toHaveLength(1)

    // The model probe runs in the background; wait for it.
    for (let i = 0; i < 250 && upserts.length < 2; i++) await new Promise((r) => setTimeout(r, 20))
    expect(upserts.at(-1)?.models.map((m: any) => m.metadata.realModelId)).toContain('grok-4.5')

    const { start } = readFakeAcpLog(log)
    const home = join(root, 'data', 'cli-homes', 'grok-cli')
    expect(start.env.HOME).toBe(home)
    expect(start.env.GROK_HOME).toBe(join(home, '.grok'))
    expect(start.env.HOME).not.toBe(process.env.HOME)
    // The managed files were in place before the CLI ran.
    expect(existsSync(join(home, '.grok', 'requirements.toml'))).toBe(true)
  })

  it('does not register (or spawn anything) when the provider is disabled (negative)', async () => {
    process.env.EYAS_DATA_DIR = join(root, 'data')
    const log = join(root, 'disabled.log')
    process.env.EYAS_GROK_BIN = fakeCli('grok', log)
    const { context, registered } = ctx({ enabled: false })
    await grokCliManifest.onStart!(context)
    expect(registered).toHaveLength(0)
    expect(existsSync(log)).toBe(false)
    expect(existsSync(join(root, 'data', 'cli-homes'))).toBe(false)
  })
})

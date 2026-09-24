// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// F10 — the Grok submodule rediscovers the models and their effort levels on
// every provider load (not only on a first boot), through the isolated
// profile, and lets the reasoning registry forget what it memoized. Only a
// successful discovery touches the stored rows.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { clearExecutableCache } from '@modules/model/cli-runtime/executables.js'
import { clearAcpPreflightCache } from '@modules/model/submodules/grok-cli/acp-verify.js'
import { resetIsolationStatuses } from '@modules/model/cli-runtime/isolation.js'
import { grokCliManifest } from '@modules/model/submodules/grok-cli/manifest.js'
import type { ModuleContext } from '@core/types'
import { readFakeAcpLog, writeFakeAcpExecutable, type FakeAcpInspect } from '../../../helpers/fake-acp.js'

const KEYS = ['EYAS_GROK_BIN', 'EYAS_DATA_DIR'] as const
const saved: Record<string, string | undefined> = {}
let root: string

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'eyas-grok-discovery-')))
  for (const k of KEYS) saved[k] = process.env[k]
  process.env.EYAS_DATA_DIR = join(root, 'data')
  clearExecutableCache()
  clearAcpPreflightCache()
  resetIsolationStatuses()
})

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
  clearExecutableCache()
  resetIsolationStatuses()
  rmSync(root, { recursive: true, force: true })
})

function context(existingRows: number) {
  const registered: any[] = []
  const reconciled: any[][] = []
  const upserted: any[][] = []
  const invalidate = vi.fn()
  const noop = () => {}
  const logger = { info: noop, warn: noop, error: noop, debug: noop, child: () => logger } as any
  const ctx = {
    logger,
    config: { server: { host: '127.0.0.1', port: 3999 } },
    providerReload: new Map(),
    providerConfig: {
      ensureProvider: noop,
      getProvider: () => ({ enabled: true, settings: {} }),
      listModels: () => Array.from({ length: existingRows }, (_, i) => ({ modelId: `grok-cli-row-${i}` })),
      upsertModels: (_id: string, models: any[]) => upserted.push(models),
      reconcileDiscoveredModels: (_id: string, models: any[]) => {
        reconciled.push(models)
        return { missing: [], restored: [] }
      },
      getModelMetadata: () => null,
      setImageSupport: noop,
    },
    model: {
      registerProvider: (p: any) => registered.push(p),
      unregisterProvider: noop,
      getProvider: () => registered[0],
    },
    reasoningRegistry: { invalidate, get: vi.fn() },
  } as unknown as ModuleContext
  return { ctx, registered, reconciled, upserted, invalidate }
}

async function until(cond: () => boolean): Promise<void> {
  for (let i = 0; i < 250 && !cond(); i++) await new Promise((r) => setTimeout(r, 20))
}

function fakeGrok(log: string, inspect?: FakeAcpInspect): string {
  return writeFakeAcpExecutable(root, { log, models: 'recorded', inspect })
}

describe.skipIf(process.platform === 'win32')('grok submodule — model rediscovery on load', () => {
  it('rediscovers on a load that already has rows, stores the effort levels and invalidates the registry (positive)', async () => {
    const log = join(root, 'grok.log')
    process.env.EYAS_GROK_BIN = fakeGrok(log)
    const { ctx, reconciled, upserted, invalidate } = context(3)
    await grokCliManifest.onStart!(ctx)
    await until(() => reconciled.length > 0 && invalidate.mock.calls.length > 0)

    expect(upserted).toHaveLength(0)
    expect(reconciled).toHaveLength(1)
    const rows = reconciled[0] as Array<{ id: string; metadata: any }>
    const grok45 = rows.find((r) => r.id === 'grok-cli-grok-4.5')!
    expect(grok45.metadata.reasoning).toMatchObject({ source: 'acp', param: 'effort', levels: ['low', 'medium', 'high'] })
    expect(invalidate).toHaveBeenCalledWith('grok-cli')
    // Discovery never prompts.
    expect(readFakeAcpLog(log).received.some((m) => m.method === 'session/prompt')).toBe(false)

    // A reload (sign-in change, settings save) discovers again.
    await ctx.providerReload.get('grok-cli')!()
    await until(() => reconciled.length > 1)
    expect(reconciled).toHaveLength(2)
  })

  it('a first boot seeds the default row at once, then discovery adds the rest', async () => {
    process.env.EYAS_GROK_BIN = fakeGrok(join(root, 'first.log'))
    const { ctx, reconciled, upserted } = context(0)
    await grokCliManifest.onStart!(ctx)
    expect(upserted).toHaveLength(1)
    expect(upserted[0].map((m: any) => m.id)).toEqual(['grok-cli-default'])
    await until(() => reconciled.length > 0)
    expect(reconciled[0].map((m: any) => m.id)).toContain('grok-cli-grok-4.7')
  })

  it('a discovery that fails its checks changes no row and invalidates nothing (negative)', async () => {
    const log = join(root, 'hostile.log')
    process.env.EYAS_GROK_BIN = fakeGrok(log, 'hostile')
    const { ctx, reconciled, invalidate } = context(2)
    await grokCliManifest.onStart!(ctx)
    await until(() => readFakeAcpLog(log).inspects.length >= 2)
    await new Promise((r) => setTimeout(r, 100))
    expect(reconciled).toHaveLength(0)
    expect(invalidate).not.toHaveBeenCalled()
    // Refused before a session was ever started.
    expect(readFakeAcpLog(log).start.argv).toEqual([])
  })
})

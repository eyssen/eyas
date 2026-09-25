// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// F11 — the Kimi submodule rediscovers the models and their thinking variants
// on every provider load, in the background, through the isolated profile (a
// session/new only), and lets the reasoning registry forget what it memoized.
// A signed-out home or a failed discovery changes nothing. At start, the
// routing configuration EYAS seeded with retired Kimi ids moves to the CLI's
// own default.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sql } from 'drizzle-orm'
import { clearExecutableCache } from '@modules/model/cli-runtime/executables.js'
import { clearAcpPreflightCache } from '@modules/model/submodules/grok-cli/acp-verify.js'
import { resetIsolationStatuses } from '@modules/model/cli-runtime/isolation.js'
import { kimiCliManifest } from '@modules/model/submodules/kimi-cli/manifest.js'
import type { ModuleContext } from '@core/types'
import { createTestDb } from '../../../helpers/test-db'
import { readFakeAcpLog, writeFakeAcpExecutable } from '../../../helpers/fake-acp.js'

const KEYS = ['EYAS_KIMI_BIN', 'EYAS_DATA_DIR'] as const
const saved: Record<string, string | undefined> = {}
let root: string

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'eyas-kimi-discovery-')))
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

function context(opts: { existingRows?: number; signedIn?: boolean; db?: unknown } = {}) {
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
    ...(opts.db ? { db: opts.db } : {}),
    ...(opts.signedIn === undefined ? {} : {
      cliSignIn: { refresh: async () => {}, isSignedIn: () => opts.signedIn, profileEnv: () => ({}) },
    }),
    providerConfig: {
      ensureProvider: noop,
      getProvider: () => ({ enabled: true, settings: {} }),
      listModels: () => Array.from({ length: opts.existingRows ?? 0 }, (_, i) => ({ modelId: `kimi-cli-row-${i}` })),
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

describe.skipIf(process.platform === 'win32')('kimi submodule — model discovery on load', () => {
  it('a first boot seeds the default row at once, then discovery stores the grouped rows and invalidates the registry (positive)', async () => {
    const log = join(root, 'kimi.log')
    process.env.EYAS_KIMI_BIN = writeFakeAcpExecutable(root, { log, dialect: 'kimi' })
    const { ctx, reconciled, upserted, invalidate } = context({ existingRows: 0 })
    await kimiCliManifest.onStart!(ctx)
    expect(upserted).toHaveLength(1)
    expect(upserted[0].map((m: any) => m.id)).toEqual(['kimi-cli-default'])

    await until(() => reconciled.length > 0 && invalidate.mock.calls.length > 0)
    const rows = reconciled[0] as Array<{ id: string; metadata: any }>
    expect(rows.map((r) => r.id)).toContain('kimi-cli-k2.6')
    expect(rows.find((r) => r.id === 'kimi-cli-k2.6')!.metadata.reasoning).toMatchObject({ source: 'acp', param: 'toggle', levels: ['none', 'high'] })
    expect(invalidate).toHaveBeenCalledWith('kimi-cli')
    // Discovery never prompts and never switches the CLI's model.
    const methods = readFakeAcpLog(log).received.map((m) => m.method)
    expect(methods).not.toContain('session/prompt')
    expect(methods).not.toContain('session/set_model')
  })

  it('a signed-out home is not probed: no session, no row change (negative)', async () => {
    const log = join(root, 'signed-out.log')
    process.env.EYAS_KIMI_BIN = writeFakeAcpExecutable(root, { log, dialect: 'kimi' })
    const { ctx, reconciled, invalidate } = context({ existingRows: 2, signedIn: false })
    await kimiCliManifest.onStart!(ctx)
    await new Promise((r) => setTimeout(r, 200))
    expect(reconciled).toHaveLength(0)
    expect(invalidate).not.toHaveBeenCalled()
    expect(readFakeAcpLog(log).received.some((m) => m.method === 'session/new')).toBe(false)
  })

  it('a discovery that fails its session check changes no row and invalidates nothing (negative)', async () => {
    const log = join(root, 'yolo.log')
    process.env.EYAS_KIMI_BIN = writeFakeAcpExecutable(root, { log, dialect: 'kimi', sessionMode: 'yolo' })
    const { ctx, reconciled, invalidate } = context({ existingRows: 2 })
    await kimiCliManifest.onStart!(ctx)
    await until(() => readFakeAcpLog(log).received.some((m) => m.method === 'session/new'))
    await new Promise((r) => setTimeout(r, 150))
    expect(reconciled).toHaveLength(0)
    expect(invalidate).not.toHaveBeenCalled()
  })

  it('moves routing tiers off the retired seed ids at start', async () => {
    process.env.EYAS_KIMI_BIN = writeFakeAcpExecutable(root, { log: join(root, 'db.log'), dialect: 'kimi' })
    const testDb = createTestDb('kimi-manifest-retired')
    const db = testDb.open()
    try {
      db.run(sql`CREATE TABLE IF NOT EXISTS routing_tiers (tier TEXT PRIMARY KEY, provider_id TEXT NOT NULL, model_id TEXT NOT NULL, fallback_provider_id TEXT, fallback_model_id TEXT, description TEXT, enabled INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL)`)
      db.run(sql`CREATE TABLE IF NOT EXISTS provider_config (id TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 1, settings TEXT DEFAULT '{}', is_default INTEGER NOT NULL DEFAULT 0, default_model TEXT, updated_at TEXT NOT NULL)`)
      db.run(sql`INSERT INTO routing_tiers (tier, provider_id, model_id, updated_at) VALUES ('complex', 'kimi-cli', 'kimi-cli-k3', 'x')`)
      const { ctx } = context({ existingRows: 1, signedIn: false, db })
      await kimiCliManifest.onStart!(ctx)
      expect((db.all(sql`SELECT model_id FROM routing_tiers WHERE tier = 'complex'`) as any[])[0].model_id).toBe('kimi-cli-default')
    } finally {
      testDb.cleanup()
    }
  })
})

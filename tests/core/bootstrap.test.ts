import { describe, it, expect, afterEach, vi } from 'vitest'
import { bootstrap, shutdown } from '@core/bootstrap'
import { join } from 'path'
import { tmpdir } from 'os'
import { rmSync, mkdirSync, writeFileSync } from 'fs'
import { sql } from 'drizzle-orm'

describe('Bootstrap', () => {
  const testDir = join(tmpdir(), `eyas-bootstrap-${Date.now()}`)
  const dbPath = join(testDir, 'test.db')
  const configPath = join(testDir, 'config.yaml')
  const dataDir = join(testDir, 'data')
  const vaultNotesDir = join(dataDir, 'vault', 'semantic')

  afterEach(async () => {
    await shutdown()
    vi.unstubAllEnvs()
    try { rmSync(testDir, { recursive: true }) } catch {}
  })

  it('starts the system and returns context', async () => {
    mkdirSync(testDir, { recursive: true })
    writeFileSync(configPath, [
      'server:',
      '  port: 4321',
      'database:',
      `  path: "${dbPath}"`,
      'log:',
      '  level: warn',
      '  pretty: false',
    ].join('\n'))
    // A throw-away instance boots on its own data dir. Left at the default,
    // that is the checkout's data/ — a developer's live instance — and the
    // memory module's deferred import (v2/migrate-imported.ts, two seconds
    // into its start) ingests that instance's whole vault into this database,
    // holding the event loop for as long as the vault is big: on a loaded
    // suite the rest of the boot never finishes inside the timeout. The vault
    // holds one note of its own, because legacy-location.ts copies the notes
    // of a <home>/data/vault folder only into an empty vault.
    vi.stubEnv('EYAS_DATA_DIR', dataDir)
    mkdirSync(vaultNotesDir, { recursive: true })
    writeFileSync(join(vaultNotesDir, 'bootstrap-test.md'), '---\ntitle: Bootstrap test\n---\nA throw-away note.\n')

    const ctx = await bootstrap({ configPath })
    expect(ctx).toBeDefined()
    expect(ctx.config.server.port).toBe(4321)
    expect(ctx.bus).toBeDefined()
    expect(ctx.db).toBeDefined()
    expect(ctx.logger).toBeDefined()
    // Regression (F0): privacy must be registered so PII-egress scanning is live.
    expect(ctx.hasModule('privacy')).toBe(true)
    // The boot indexed the isolated vault, and only its one note: nothing of
    // the checkout's data/ was read or copied in.
    const indexed = (ctx.db as any).all(sql`SELECT path FROM vault_index ORDER BY path`) as Array<{ path: string }>
    expect(indexed.map((r) => r.path)).toEqual(['semantic/bootstrap-test.md'])
    // This boots the whole system — every module, migrations included — which
    // takes far longer than vitest's 5s default. It only ever passed because it
    // ran with CPU to spare; under a loaded suite it times out. The work is the
    // point of the test, so give it room rather than making it do less.
  }, 30_000)
})

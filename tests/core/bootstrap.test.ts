import { describe, it, expect, afterEach } from 'vitest'
import { bootstrap, shutdown } from '@core/bootstrap'
import { join } from 'path'
import { tmpdir } from 'os'
import { rmSync, mkdirSync, writeFileSync } from 'fs'

describe('Bootstrap', () => {
  const testDir = join(tmpdir(), `eyas-bootstrap-${Date.now()}`)
  const dbPath = join(testDir, 'test.db')
  const configPath = join(testDir, 'config.yaml')

  afterEach(async () => {
    await shutdown()
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

    const ctx = await bootstrap({ configPath })
    expect(ctx).toBeDefined()
    expect(ctx.config.server.port).toBe(4321)
    expect(ctx.bus).toBeDefined()
    expect(ctx.db).toBeDefined()
    expect(ctx.logger).toBeDefined()
    // Regression (F0): privacy must be registered so PII-egress scanning is live.
    expect(ctx.hasModule('privacy')).toBe(true)
    // This boots the whole system — every module, migrations included — which
    // takes far longer than vitest's 5s default. It only ever passed because it
    // ran with CPU to spare; under a loaded suite it times out. The work is the
    // point of the test, so give it room rather than making it do less.
  }, 30_000)
})

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createTestDb } from '../../helpers/test-db'
import { createCostopsService, createCostopsTables } from '@modules/costops/service'

const testDb = createTestDb('costops-service')

describe('costops service', () => {
  let db: ReturnType<typeof testDb.open>
  let dir: string
  let costops: ReturnType<typeof createCostopsService>

  beforeEach(() => {
    db = testDb.open()
    createCostopsTables(db as any)
    dir = mkdtempSync(join(tmpdir(), 'eyas-costops-'))
    costops = createCostopsService({ db: db as any, configPath: join(dir, 'costops.json') })
  })

  afterEach(() => {
    testDb.cleanup()
    rmSync(dir, { recursive: true, force: true })
  })

  it('summarises fixed costs + line items against budgets', () => {
    costops.saveConfig({
      currency: 'HUF',
      fixedCosts: [{ sourceId: 'hosting', name: 'Hosting', provider: 'other', sourceType: 'subscription', amount: 10000 }],
      budgets: [{ id: 'monthly', name: 'Monthly', amount: 50000, warningThreshold: 0.8, hardThreshold: 1.0 }],
    })
    costops.recordLineItem({ sourceId: 'saas', period: '2026-08', amount: 5000 })
    const summary = costops.monthlySummary('2026-08')
    expect(summary.fixedTotal).toBe(10000)
    expect(summary.lineItemsTotal).toBe(5000)
    expect(summary.total).toBe(15000)
    expect(summary.budgets[0].status).toBe('ok')
  })
})

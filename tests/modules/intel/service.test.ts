import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTestDb } from '../../helpers/test-db'
import { createIntelTables } from '@modules/intel/schema'
import { createIntelService } from '@modules/intel/service'

const testDb = createTestDb('intel-service')

describe('intel service', () => {
  let db: ReturnType<typeof testDb.open>
  let intel: ReturnType<typeof createIntelService>

  beforeEach(() => {
    db = testDb.open()
    createIntelTables(db as any)
    intel = createIntelService(db as any)
  })

  afterEach(() => {
    testDb.cleanup()
  })

  it('dedups facts by content hash and evolves status', () => {
    const a = intel.addFact({ title: 'Rate cut', content: 'Competitor cut prices 10%', domain: 'market', priority: 0.8 })
    expect(a.created).toBe(true)
    const b = intel.addFact({ title: 'Rate cut', content: 'Competitor cut prices 10%', domain: 'market', priority: 0.9 })
    expect(b.created).toBe(false)
    expect(b.id).toBe(a.id)
    const facts = intel.listFacts({ domain: 'market' })
    expect(facts).toHaveLength(1)
    expect(facts[0].status).toBe('evolving')
  })

  it('builds a daily brief with top signals', () => {
    intel.addFact({ title: 'A', content: 'a', priority: 0.9 })
    intel.addFact({ title: 'B', content: 'b', priority: 0.5 })
    intel.addWatch({ title: 'Watch X' })
    const brief = intel.buildDailyBrief()
    expect(brief.topSignals.length).toBeGreaterThan(0)
    expect(brief.watchlist.length).toBe(1)
    expect(brief.generatedAt).toBeTruthy()
  })
})

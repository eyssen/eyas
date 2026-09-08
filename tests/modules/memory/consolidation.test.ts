// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { createMemoryDb } from '../../helpers/test-db'
import { createMemoryTables } from '../../../src/modules/memory/schema.js'
import { createEpisodicMemoryService } from '../../../src/modules/memory/tiers/episodic-memory.js'
import { createArchiveMemoryService } from '../../../src/modules/memory/tiers/archive-memory.js'
import { createDecayService } from '../../../src/modules/memory/consolidation/decay.js'
import { createImplicitExtractor } from '../../../src/modules/memory/consolidation/implicit-extractor.js'

describe('DecayService', () => {
  let db: ReturnType<typeof createMemoryDb>
  let episodic: ReturnType<typeof createEpisodicMemoryService>
  let archive: ReturnType<typeof createArchiveMemoryService>
  let decay: ReturnType<typeof createDecayService>

  beforeEach(() => {
    db = createMemoryDb()
    createMemoryTables(db)
    episodic = createEpisodicMemoryService(db)
    archive = createArchiveMemoryService(db)
    decay = createDecayService(episodic, archive, {
      decayRate: 0.95, promotionThreshold: 0.7, promotionMinAccess: 3,
      demotionThreshold: 0.2, demotionAgeDays: 30,
      // Required since the working→episodic promotion field was added; value
      // matches the equivalent episodic threshold so test behaviour is stable.
      workingPromotionMinAccess: 3,
    })
  })

  it('demotes old low-salience memories to archive', () => {
    const mem = episodic.create({ content: 'old forgotten fact', sourceType: 'extraction' })
    const oldDate = new Date(Date.now() - 40 * 86400000).toISOString()
    db.run(sql`UPDATE episodic_memories SET salience = 0.1, created_at = ${oldDate}, last_accessed_at = ${oldDate} WHERE id = ${mem.id}`)
    const result = decay.runDemotion()
    expect(result.demoted).toBe(1)
    expect(episodic.get(mem.id)).toBeNull()
    expect(archive.list(10)).toHaveLength(1)
  })

  it('finds promotion candidates', () => {
    const mem = episodic.create({ content: 'important fact', sourceType: 'extraction' })
    db.run(sql`UPDATE episodic_memories SET salience = 0.8, access_count = 5 WHERE id = ${mem.id}`)
    expect(decay.findPromotionCandidates()).toHaveLength(1)
  })
})

describe('ImplicitExtractor', () => {
  let db: ReturnType<typeof createMemoryDb>
  let episodic: ReturnType<typeof createEpisodicMemoryService>

  beforeEach(() => {
    db = createMemoryDb()
    createMemoryTables(db)
    episodic = createEpisodicMemoryService(db)
  })

  it('saves extracted facts as episodic memories', () => {
    const extractor = createImplicitExtractor(episodic)
    extractor.saveExtractedFacts('conv-123', [
      'User uses K8s on OKE',
      'Odoo runs on port 8069',
      '', // empty should be skipped
    ])
    const list = episodic.list({ limit: 10 })
    expect(list).toHaveLength(2)
    expect(list[0].tags).toEqual(['auto-extracted'])
  })
})

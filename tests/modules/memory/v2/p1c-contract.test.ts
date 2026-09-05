// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Gate for plan p1c: the modules below are consumed by exact name. A failure
// here means a sibling plan (p1a / p1b) and this plan disagree — reconcile
// there, never patch an export from here.

import { describe, it, expect } from 'vitest'
import { sql } from 'drizzle-orm'
import { makeV2Db } from './helpers'
import { seedRawRow, count } from './extract-helpers'

const columns = (db: any, table: string): string[] =>
  (db.all(sql.raw(`PRAGMA table_info(${table})`)) as Array<{ name: string }>).map((c) => c.name)

describe('p1c contract gate', () => {
  it('p1a exposes the schema helpers, run ledger and instance id', async () => {
    const schema = await import('@modules/memory/v2/schema')
    expect(typeof schema.createMemoryV2Tables).toBe('function')
    expect(typeof schema.allocateRid).toBe('function')
    expect(typeof schema.getMemoryMeta).toBe('function')
    expect(typeof schema.setMemoryMeta).toBe('function')
    const runs = await import('@modules/memory/v2/runs')
    expect(typeof runs.recordRun).toBe('function')
    expect(typeof runs.finishRun).toBe('function')
    expect(typeof runs.getRun).toBe('function')
    const instance = await import('@modules/memory/v2/instance')
    expect(typeof instance.getInstanceId).toBe('function')
    const zstd = await import('@shared/zstd')
    expect(typeof zstd.initZstd).toBe('function')
    expect(typeof zstd.zstdDecompress).toBe('function')
  })

  it('p1b exposes the ingest, language, scope and wire contracts', async () => {
    const ingest = await import('@modules/memory/v2/ingest')
    expect(typeof ingest.sha256Hex).toBe('function')
    expect(typeof ingest.createMemoryIngest).toBe('function')
    expect(typeof (await import('@modules/memory/v2/language')).detectLanguage).toBe('function')
    expect(typeof (await import('@modules/memory/v2/scope')).resolveConversationScope).toBe('function')
    expect(typeof (await import('@modules/memory/v2/wire')).wireL0Capture).toBe('function')
    const helpers = await import('./helpers')
    expect(typeof helpers.makeV2Db).toBe('function')
    expect(typeof helpers.makeUnit).toBe('function')
    expect(helpers.silentLogger).toBeDefined()
  })

  it('legacy helpers this plan reuses exist', async () => {
    expect(typeof (await import('@modules/memory/schema')).escapeFtsQuery).toBe('function')
    expect(typeof (await import('@modules/prompt-wizard/token-budget')).estimateTokens).toBe('function')
  })

  it('the v2 tables carry the columns arbitration writes', () => {
    const { db } = makeV2Db()
    expect(columns(db, 'memory_idf')).toEqual(['stem', 'df'])
    for (const c of ['subject', 'predicate', 'object_text', 'valid_from', 'valid_until', 'invalidated_by_fact_id', 'confidence', 'trust_tier', 'extraction_run_id', 'entity_id', 'facts_pending']) {
      expect(columns(db, 'memory_fact')).toContain(c)
    }
    for (const c of ['scope_type', 'scope_id', 'tree_depth', 'text', 'structured_json', 'trust_tier', 'token_count', 'importance_score', 'gist_source', 'consolidation_run_id', 'supersedes_gist_id', 'superseded_by_gist_id', 'is_current']) {
      expect(columns(db, 'memory_gist')).toContain(c)
    }
    expect(columns(db, 'memory_entity')).toEqual(expect.arrayContaining(['canonical_name', 'entity_type', 'aliases_json', 'merged_into_entity_id']))
    expect(columns(db, 'memory_fact_source')).toEqual(['fact_id', 'episode_id'])
    expect(columns(db, 'memory_gist_source')).toEqual(['gist_id', 'child_type', 'child_id'])
    expect(columns(db, 'memory_link')).toEqual(expect.arrayContaining(['from_type', 'from_id', 'to_type', 'to_id', 'link_type', 'run_id']))
    // The CHECK vocabularies this plan relies on.
    db.run(sql`INSERT INTO memory_link (id, from_type, from_id, to_type, to_id, link_type, run_id, created_at) VALUES ('l1', 'fact', 'f', 'fact', 'g', 'supersedes', NULL, 1)`)
    db.run(sql`INSERT INTO memory_link (id, from_type, from_id, to_type, to_id, link_type, run_id, created_at) VALUES ('l2', 'raw', 'r', 'fact', 'f', 'part_of', NULL, 1)`)
    db.run(sql`INSERT INTO memory_link (id, from_type, from_id, to_type, to_id, link_type, run_id, created_at) VALUES ('l3', 'gist', 'g', 'raw', 'r', 'derived_from', NULL, 1)`)
    expect(count(db, 'memory_link')).toBe(3)
  })

  it('seedRawRow writes a raw row tagged like the ingest does', () => {
    const { db } = makeV2Db()
    const { id, rid } = seedRawRow(db, { conversationId: 'c1', projectId: 'p1', trustTier: 'ingested' })
    expect(count(db, 'memory_raw', `id = '${id}'`)).toBe(1)
    const tags = db.all(sql`SELECT tag_type, tag_value FROM memory_tag WHERE memory_rid = ${rid} ORDER BY tag_type`) as Array<{ tag_type: string; tag_value: string }>
    expect(tags).toEqual(expect.arrayContaining([
      { tag_type: 'project', tag_value: 'p1' }, { tag_type: 'task', tag_value: 'c1' },
      { tag_type: 'layer', tag_value: 'raw' }, { tag_type: 'trust_tier', tag_value: 'ingested' },
    ]))
    const untagged = seedRawRow(db, { conversationId: 'c1', projectId: 'p1', tagProject: false })
    expect(count(db, 'memory_tag', `memory_rid = ${untagged.rid} AND tag_type = 'project'`)).toBe(0)
  })
})

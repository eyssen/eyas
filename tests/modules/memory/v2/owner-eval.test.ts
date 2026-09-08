// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Phase 2 owner acceptance: assembleMemory on the live DB (vec0 loaded) must
// put the answer in the injected section — no tools, no model guess.

import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { sql } from 'drizzle-orm'
import { openRawSqlite } from '@core/db/connection'
import { probeSqliteCapabilities } from '@core/db/sqlite-capabilities'
import { tryCreateE5Embedder } from '@modules/memory/embeddings/local-embedder'
import { assembleMemory } from '@modules/memory/v2/assemble'
import { retrieve } from '@modules/memory/v2/retrieve'
import { parseVaultFile } from '@modules/memory/vault/frontmatter'
import { embedLayeredBatch } from '@modules/memory/v2/l3-embed'
import { allocateRid } from '@modules/memory/v2/schema'
import { isBun } from '@shared/platform'
import { silentLogger } from './helpers'

function drizzleOf(raw: unknown): any {
  const { drizzle } = isBun
    ? require('drizzle-orm/bun-sqlite')
    : require('drizzle-orm/better-sqlite3')
  return drizzle(raw)
}

const LIVE_DB = resolve('data/sqlite/eyas.db')
const MODELS = resolve('data/models')
const GOLD_NOTES: Array<{ path: string; file: string }> = [
  {
    path: 'semantic/werth.md',
    file: resolve('data/vault/semantic/werth.md'),
  },
  {
    path: 'semantic/project_werth_ticket1145_corrective_invoice_declaration.md',
    file: resolve('data/vault/semantic/project_werth_ticket1145_corrective_invoice_declaration.md'),
  },
  {
    path: 'procedural/feedback_never_auto_commit.md',
    file: resolve('data/vault/procedural/feedback_never_auto_commit.md'),
  },
  {
    path: 'procedural/feedback_eyas_import_no_limits.md',
    file: resolve('data/vault/procedural/feedback_eyas_import_no_limits.md'),
  },
  {
    path: 'procedural/feedback_eyas_memory_sovereignty.md',
    file: resolve('data/vault/procedural/feedback_eyas_memory_sovereignty.md'),
  },
  {
    path: 'semantic/grok-claude-shared-setup.md',
    file: resolve('data/vault/semantic/grok-claude-shared-setup.md'),
  },
]

const hasLive = existsSync(LIVE_DB)
const hasModels = existsSync(MODELS) && readdirSync(MODELS).length > 0

interface EvalQ {
  id: string
  query: string
  gold: RegExp[]
  gate?: 'werth-para' | 'commit'
}

const QUESTIONS: EvalQ[] = [
  { id: 'werth-kw', query: 'Werth 1145 ticket', gold: [/1145/, /werth/i] },
  {
    id: 'werth-para-1',
    query: 'mi volt a helyesbítő számla döntés a Werth ügyfélnél',
    gold: [/1145|helyesb[ií]t|corrected_invoice|2665M|LeasePlan/i, /werth/i],
    gate: 'werth-para',
  },
  {
    id: 'werth-para-2',
    query: 'hogyan kellett a bejövő helyesbítőt a Werth áfa-bevallásba tenni',
    gold: [/1145|helyesb[ií]t|corrected_invoice|2665M|reversed_entry/i],
    gate: 'werth-para',
  },
  {
    id: 'werth-para-3',
    query: 'Werth ügyfél LeasePlan módosító számla NAV bevallás',
    gold: [/1145|helyesb[ií]t|corrected_invoice|2665M|LeasePlan/i],
    gate: 'werth-para',
  },
  {
    id: 'werth-para-4',
    query: 'melyik mező kell a helyesbítő számlához Werthnél reversed helyett',
    gold: [/corrected_invoice|1145|helyesb[ií]t/i],
    gate: 'werth-para',
  },
  {
    id: 'werth-para-5',
    query: 'mit döntöttünk a Werth korrektív invoice-ról a bevallásban',
    gold: [/1145|helyesb[ií]t|corrected_invoice|2665M/i],
    gate: 'werth-para',
  },
  {
    id: 'commit-1',
    query: 'szabad-e magamtól commitolni',
    gold: [/commit/i],
    gate: 'commit',
  },
  {
    id: 'commit-2',
    query: 'soha ne commitálj vagy pusholj automatikusan',
    gold: [/commit/i],
    gate: 'commit',
  },
  {
    id: 'commit-3',
    query: 'ne pusholj a user kérése nélkül',
    gold: [/commit|push/i],
    gate: 'commit',
  },
  {
    id: 'commit-4',
    query: 'git szabály: automatikus commit tilos',
    gold: [/commit/i],
    gate: 'commit',
  },
  {
    id: 'commit-5',
    query: 'kell-e kérdezni commit előtt',
    gold: [/commit/i],
    gate: 'commit',
  },
  {
    id: 'sov-1',
    query: 'EYAS memória szuverenitás egyirányú import',
    gold: [/one-way|egyirány|data-port|data\/vault|Obsidian|sovereign/i],
  },
  {
    id: 'sov-2',
    query: 'olvas-e az EYAS élő Obsidian vaultot',
    gold: [/Obsidian|data\/vault|one-way|data-port/i],
  },
  {
    id: 'limit-1',
    query: 'data-port nincs limit',
    gold: [/limit|NO limits|nincs limit|cap/i],
  },
  {
    id: 'limit-2',
    query: 'szabad-e kihagyni mappákat az EYAS importból alapból',
    gold: [/limit|import|cap|map everything|mindent/i],
  },
  {
    id: 'shared-1',
    query: 'hova került a Grok és Claude Obsidian memóriája',
    gold: [/ai-memory|MEMORY\.md|claude-sessions|Obsidian|data\/vault|Grok \+ Claude/i],
  },
  {
    id: 'shared-2',
    query: 'Grok Claude shared setup memory path',
    gold: [/ai-memory|MEMORY\.md|claude-sessions|Grok \+ Claude|99_Meta/i],
  },
  {
    id: 'shared-3',
    query: 'hol van a MEMORY.md amit a Claude mindig betölt',
    gold: [/MEMORY\.md|ai-memory|vault/i],
  },
  {
    id: 'sov-3',
    query: 'EYAS saját vaultja a data/vault, nem a host MEMORY.md',
    gold: [/data\/vault|Obsidian|one-way|MEMORY\.md/i],
  },
  {
    id: 'import-1',
    query: 'memória import csak data-porton keresztül egy irányba',
    gold: [/data-port|one-way|import/i],
  },
]

function upsertVaultNote(db: any, vaultPath: string, filePath: string): void {
  if (!existsSync(filePath)) return
  const parsed = parseVaultFile(readFileSync(filePath, 'utf8'))
  const now = new Date().toISOString()
  const tags = JSON.stringify(parsed.frontmatter.tags)
  const contentText = parsed.content.replace(/^#{1,6}\s+/gm, '').trim()
  const title = parsed.frontmatter.title
  const tier = parsed.frontmatter.tier
  const kind = parsed.frontmatter.kind ?? null
  const summary = parsed.frontmatter.summary ?? null
  const existing = db.all(sql`SELECT path FROM vault_index WHERE path = ${vaultPath}`) as Array<{ path: string }>
  if (existing.length > 0) {
    db.run(sql`UPDATE vault_index SET
      title = ${title}, tier = ${tier}, tags = ${tags}, content_text = ${contentText},
      kind = ${kind}, summary = ${summary}, file_hash = ${`eval-${now}`}, indexed_at = ${now}
      WHERE path = ${vaultPath}`)
    return
  }
  db.run(sql`INSERT INTO vault_index
    (path, title, tier, tags, content_text, kind, summary, file_hash, indexed_at)
    VALUES (${vaultPath}, ${title}, ${tier}, ${tags}, ${contentText}, ${kind}, ${summary}, ${`eval-${now}`}, ${now})`)
}

async function seedGoldFact(db: any, raw: any, bridge: { embed: (t: string[]) => Promise<number[][]> }): Promise<void> {
  const id = 'owner-eval-werth-1145'
  const have = db.all(sql`SELECT id FROM memory_fact WHERE id = ${id} AND tombstoned = 0`) as Array<{ id: string }>
  if (have.length === 0) {
    const now = Date.now()
    const rid = allocateRid(db, 'fact', id, now)
    const objectText = 'Werth ticket 1145 helyesbítő számla: MODIFY uses corrected_invoice_id not reversed_entry_id; 2665M ÁFA-bevallás; LeasePlan BE/2026/0577'
    db.run(sql`INSERT INTO memory_fact (
      rid, id, content_hash, origin_instance_id, hlc_physical_ms, created_at, subject, predicate, object_text, trust_tier, confidence
    ) VALUES (
      ${rid}, ${id}, 'owner-eval-werth-1145', 'inst', ${now}, ${now},
      'Werth ticket 1145', 'decided', ${objectText}, 'owner', 1
    )`)
  }
  await embedLayeredBatch({ db, rawDb: raw, bridge: bridge as any, logger: silentLogger }, 8)
}

describe.skipIf(!hasLive || !hasModels)('owner-eval (live db, injected context, no tools)', () => {
  it('answers the 20 owner questions from assembleMemory content', async () => {
    const raw = openRawSqlite(LIVE_DB)
    const caps = probeSqliteCapabilities(raw)
    expect(caps.vec0).toBe(true)
    const db = drizzleOf(raw)
    const bridge = await tryCreateE5Embedder({ cacheDir: MODELS, logger: silentLogger })
    expect(bridge, 'e5 must load when data/models is present').toBeTruthy()
    if (!bridge) {
      raw.close()
      return
    }
    for (const note of GOLD_NOTES) upsertVaultNote(db, note.path, note.file)
    await seedGoldFact(db, raw, bridge)

    const deps = { db, rawDb: raw, bridge, logger: silentLogger }
    const knnHits = await retrieve(deps, {
      query: 'mi volt a helyesbítő számla döntés a Werth ügyfélnél',
      language: 'hu',
      limit: 12,
    })
    expect(knnHits.some((h) => h.source === 'gist' || h.source === 'fact')).toBe(true)

    const index = await assembleMemory(deps, {
      query: 'standing index check',
      conversationId: 'owner-eval',
      language: 'hu',
      budgetChars: 8_000,
    })
    expect(index).toBeTruthy()
    expect(index!.ids.some((id) => id.includes('semantic/werth.md'))).toBe(true)
    expect(index!.ids.some((id) => /commit/i.test(id) || index!.content.toLowerCase().includes('commit'))).toBe(true)

    const rows: Array<{ id: string; gate?: string; hit: boolean; tokens: number; inTop: boolean }> = []
    for (const q of QUESTIONS) {
      const assembled = await assembleMemory(deps, {
        query: q.query,
        conversationId: 'owner-eval',
        language: 'hu',
        budgetChars: 8_000,
      })
      expect(assembled).toBeTruthy()
      const content = assembled!.content
      const hit = q.gold.every((re) => re.test(content))
      rows.push({ id: q.id, gate: q.gate, hit, tokens: assembled!.tokens, inTop: true })
      // 8000-char standing index is ~2000 tokens; retrieved + expanded sit on top.
      expect(assembled!.tokens).toBeLessThanOrEqual(3_200)
    }

    const gate = rows.filter((r) => r.gate === 'werth-para' || r.gate === 'commit')
    const gateHits = gate.filter((r) => r.hit).length
    const report = rows.map((r) => `${r.hit ? 'HIT' : 'MISS'} ${r.id} tokens=${r.tokens}`).join('\n')
    expect(gateHits, `gate ${gateHits}/10\n${report}`).toBeGreaterThanOrEqual(8)
    raw.close()
  }, 180_000)
})

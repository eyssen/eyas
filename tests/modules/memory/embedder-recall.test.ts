// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Phase 0 spike R@5 on the 80-pair / 300-distractor hu/de/en fixture.
// Skipped when data/models is empty. Naive RRF must lose to gated fusion.

import { describe, it, expect } from 'vitest'
import { existsSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { Database } from 'bun:sqlite'
import { tryCreateE5Embedder } from '@modules/memory/embeddings/local-embedder'
import { gatedFuse } from '@modules/memory/v2/retrieve'
import { computeRRF } from '@modules/memory/search/hybrid-search'
import { pairs, distractors } from './fixtures/recall-hu-de-en'
import { silentLogger } from './v2/helpers'

const MODELS = resolve('data/models')
const hasModels = existsSync(MODELS) && readdirSync(MODELS).length > 0

function cosine(a: number[], b: number[]): number {
  let s = 0
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) s += (a[i] ?? 0) * (b[i] ?? 0)
  return s
}

function recallAt(ranks: number[], k: number, pred: (i: number) => boolean = () => true): number {
  const idx = ranks.map((_, i) => i).filter(pred)
  if (idx.length === 0) return 0
  return idx.filter((i) => ranks[i]! <= k).length / idx.length
}

function ftsTokenQuery(q: string): string {
  return q.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((t) => t.length > 0).map((t) => `"${t.replace(/"/g, '')}"`).join(' OR ')
}

describe.skipIf(!hasModels)('e5 R@5 hu/de/en fixture (skip if data/models empty)', () => {
  it('e5 R@5 ≥ 0.80 (hu ≥ 0.85), gated fusion ≥ dense − 0.02, naive RRF loses', async () => {
    const bridge = await tryCreateE5Embedder({ cacheDir: MODELS, logger: silentLogger })
    expect(bridge, 'e5 must load when data/models is present').toBeTruthy()
    if (!bridge) return

    const docs = [...pairs.map((p) => p.d), ...distractors]
    const queries = pairs.map((p) => p.q)
    const D = await bridge.embed(docs)
    const Q = bridge.embedQuery ? await bridge.embedQuery(queries) : await bridge.embed(queries)

    const denseRanks: number[] = []
    const denseLists: number[][] = []
    for (let qi = 0; qi < Q.length; qi++) {
      const scores = D.map((d) => cosine(Q[qi]!, d))
      const order = scores.map((s, i) => ({ i, s })).sort((a, b) => b.s - a.s).map((x) => x.i)
      denseLists.push(order)
      const pos = order.indexOf(qi)
      denseRanks.push(pos === -1 ? 1_000 : pos + 1)
    }

    const ftsDb = new Database(':memory:')
    ftsDb.exec(`CREATE VIRTUAL TABLE d USING fts5(body, tokenize="unicode61 remove_diacritics 2")`)
    const ins = ftsDb.prepare('INSERT INTO d(rowid, body) VALUES (?, ?)')
    docs.forEach((t, i) => ins.run(i, t))
    const ftsQ = ftsDb.prepare('SELECT rowid AS id FROM d WHERE d MATCH ? ORDER BY bm25(d) LIMIT 100')
    const ftsLists = queries.map((q) => (ftsQ.all(ftsTokenQuery(q)) as Array<{ id: number }>).map((r) => r.id))

    const gatedRanks: number[] = []
    const naiveRanks: number[] = []
    for (let qi = 0; qi < queries.length; qi++) {
      const ftsItems = ftsLists[qi]!.map((id, rank) => ({
        id: String(id), score: 1 / (rank + 1), source: 'raw' as const, text: docs[id] ?? '',
      }))
      const denseItems = denseLists[qi]!.slice(0, 50).map((id, rank) => ({
        id: String(id), score: 1 / (rank + 1), source: 'gist' as const, text: docs[id] ?? '',
      }))
      const gated = gatedFuse(queries[qi]!, pairs[qi]!.lang, ftsItems, denseItems)
      const naive = computeRRF(
        ftsItems.map((h) => ({ id: h.id, score: h.score, source: h.source })),
        denseItems.map((h) => ({ id: h.id, score: h.score, source: h.source })),
        new Map(),
        { k: 60, ftsWeight: 1, vectorWeight: 1 },
      )
      const gPos = gated.findIndex((h) => h.id === String(qi))
      const nPos = naive.findIndex((h) => h.id === String(qi))
      gatedRanks.push(gPos === -1 ? 1_000 : gPos + 1)
      naiveRanks.push(nPos === -1 ? 1_000 : nPos + 1)
    }

    const denseAll = recallAt(denseRanks, 5)
    const denseHu = recallAt(denseRanks, 5, (i) => pairs[i]!.lang === 'hu')
    const gatedAll = recallAt(gatedRanks, 5)
    const naiveAll = recallAt(naiveRanks, 5)

    expect(denseAll).toBeGreaterThanOrEqual(0.80)
    expect(denseHu).toBeGreaterThanOrEqual(0.85)
    expect(gatedAll).toBeGreaterThanOrEqual(denseAll - 0.02)
    // Spike: naive RRF dropped e5 R@5 85 → 65. The guard must fail naive.
    expect(naiveAll).toBeLessThan(0.72)
  }, 180_000)
})

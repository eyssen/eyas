// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Dream-engine groundwork (Cap 6). A nightly reflection is persisted as a digest
// of five buckets and rendered into a morning briefing. One digest per day (a
// re-run replaces it) so retries are idempotent; survives restarts.
//
// This is the deterministic scaffold. Filling the buckets with an LLM reflection
// pass and un-stubbing the memory consolidator (skill mining → forge proposals,
// tiering + embedding backfill) and the off-by-default SSRF-hardened web-egress
// bucket are the larger, model-dependent follow-ups.

import { sql } from 'drizzle-orm'
import { generateId } from '@shared/crypto.js'

export interface DigestBucket {
  key: string
  title: string
  items: string[]
}

export interface ReflectionDigest {
  id: string
  date: string
  buckets: DigestBucket[]
  createdAt: string
}

export interface ReflectionDigestService {
  record(input: { date: string; buckets: DigestBucket[] }): ReflectionDigest
  latest(): ReflectionDigest | null
  list(limit?: number): ReflectionDigest[]
  getByDate(date: string): ReflectionDigest | null
}

export function createReflectionDigestTables(db: any): void {
  db.run(sql`CREATE TABLE IF NOT EXISTS reflection_digests (
    id TEXT PRIMARY KEY,
    digest_date TEXT NOT NULL UNIQUE,
    buckets TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`)
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_reflection_digests_date ON reflection_digests(digest_date DESC)`)
}

function rowToDigest(r: any): ReflectionDigest {
  return { id: r.id, date: r.digest_date, buckets: JSON.parse(r.buckets), createdAt: r.created_at }
}

export function createReflectionDigestService(
  db: any,
  opts: { now?: () => Date } = {},
): ReflectionDigestService {
  const now = opts.now ?? (() => new Date())

  function getByDate(date: string): ReflectionDigest | null {
    const rows = db.all(sql`SELECT * FROM reflection_digests WHERE digest_date = ${date}`) as any[]
    return rows[0] ? rowToDigest(rows[0]) : null
  }

  function record({ date, buckets }: { date: string; buckets: DigestBucket[] }): ReflectionDigest {
    const id = generateId()
    const createdAt = now().toISOString()
    db.run(
      sql`INSERT INTO reflection_digests (id, digest_date, buckets, created_at)
          VALUES (${id}, ${date}, ${JSON.stringify(buckets)}, ${createdAt})
          ON CONFLICT(digest_date) DO UPDATE SET buckets = excluded.buckets, created_at = excluded.created_at`,
    )
    return getByDate(date)!
  }

  function latest(): ReflectionDigest | null {
    const rows = db.all(sql`SELECT * FROM reflection_digests ORDER BY digest_date DESC LIMIT 1`) as any[]
    return rows[0] ? rowToDigest(rows[0]) : null
  }

  function list(limit = 30): ReflectionDigest[] {
    return (db.all(sql`SELECT * FROM reflection_digests ORDER BY digest_date DESC LIMIT ${limit}`) as any[]).map(rowToDigest)
  }

  return { record, latest, list, getByDate }
}

/** Render a digest into a morning briefing, skipping empty buckets. */
export function buildMorningBriefing(digest: ReflectionDigest, opts: { maxChars?: number } = {}): string {
  const maxChars = opts.maxChars ?? 8000
  const nonEmpty = digest.buckets.filter((b) => b.items.length > 0)
  if (nonEmpty.length === 0) {
    return `Good morning. Briefing for ${digest.date}: nothing notable overnight.`
  }
  const sections = nonEmpty.map((b) => `## ${b.title}\n${b.items.map((i) => `- ${i}`).join('\n')}`)
  let out = `Good morning. Briefing for ${digest.date}:\n\n${sections.join('\n\n')}`
  if (out.length > maxChars) out = out.slice(0, Math.max(0, maxChars - 12)) + '\n…[truncated]'
  return out
}

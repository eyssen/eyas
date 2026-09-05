// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { makeV2Db } from './helpers'
import { extractDeterministic, type ExtractionUnit } from '@modules/memory/v2/extract/deterministic'

let db: any
beforeEach(() => { db = makeV2Db().db })

const t0 = Date.UTC(2026, 8, 3)
const u = (id: string, sourceType: ExtractionUnit['sourceType'], content: string, i: number): ExtractionUnit =>
  ({ id, sourceType, content, occurredAtMs: t0 + i * 60_000, trustTier: sourceType === 'user_message' ? 'owner' : 'derived' })

const units: ExtractionUnit[] = [
  u('r1', 'user_message', 'Please plan the invoice module rollout for Werth Kft.\nDeadline: 2026-10-01\nCustomer = Werth Kft', 0),
  u('r2', 'assistant_message', 'Sure. Kubernetes first: I will renew the Kubernetes ingress certificate on the Kubernetes staging cluster.', 1),
  u('r3', 'user_message', 'We decided to go live on October first.\nEnvironment: staging', 2),
  u('r4', 'tool_result', '{"ok":true,"tool":"browser_click","url":"https://example.com/x"}', 3),
  // A tool result whose body IS `key: value` shaped. The JSON one above cannot
  // test the rule: entities.ts's KV_LINE excludes `"`, so JSON keys can never
  // match, and the assertion below would pass even if the user-only filter were
  // deleted. This one produces `status` and `url` facts the moment it does.
  u('r4b', 'tool_result', 'status: ok\nurl: https://example.com/x', 3),
  u('r5', 'assistant_message', 'Great, deadline confirmed for October first.', 4),
]
const allIds = units.map((x) => x.id)

function boardTables(): void {
  db.run(sql`CREATE TABLE conversations (id TEXT PRIMARY KEY, title TEXT, status TEXT, stage_id TEXT, pinned INTEGER DEFAULT 0,
    project_id TEXT, user_id TEXT, agent_id TEXT, god_mode INTEGER DEFAULT 0, parent_conversation_id TEXT)`)
  db.run(sql`CREATE TABLE projects (id TEXT PRIMARY KEY, type_id TEXT)`)
  db.run(sql`INSERT INTO projects VALUES ('p1', 'pt1')`)
  db.run(sql`INSERT INTO conversations (id, title, status, pinned, project_id, agent_id) VALUES ('c1', 'Invoice rollout', 'active', 0, 'p1', 'agent-1')`)
}

describe('extractDeterministic', () => {
  it('turns key: value lines in USER messages into structural facts; tool results never yield facts', () => {
    const c = extractDeterministic(units, { db, projectId: null, taskClosed: false })
    expect(c.facts).toEqual(expect.arrayContaining([
      { subject: 'deadline', predicate: 'is', object: '2026-10-01', confidenceHint: 0.5, sourceRawIds: ['r1'] },
      { subject: 'customer', predicate: 'is', object: 'Werth Kft', confidenceHint: 0.5, sourceRawIds: ['r1'] },
      { subject: 'environment', predicate: 'is', object: 'staging', confidenceHint: 0.5, sourceRawIds: ['r3'] },
    ]))
    expect(c.facts.some((f) => f.subject === 'url' || f.subject === 'tool' || f.subject === 'ok' || f.subject === 'status')).toBe(false)
  })

  it('adds board facts (title, project, project_type, agent) when a conversation id is given', () => {
    boardTables()
    const c = extractDeterministic(units, { db, projectId: 'p1', taskClosed: false, conversationId: 'c1' })
    expect(c.facts).toEqual(expect.arrayContaining([
      { subject: 'c1', predicate: 'title', object: 'Invoice rollout', confidenceHint: 0.9, sourceRawIds: allIds },
      { subject: 'c1', predicate: 'project', object: 'p1', confidenceHint: 0.9, sourceRawIds: allIds },
      { subject: 'c1', predicate: 'project_type', object: 'pt1', confidenceHint: 0.9, sourceRawIds: allIds },
      { subject: 'c1', predicate: 'agent', object: 'agent-1', confidenceHint: 0.9, sourceRawIds: allIds },
    ]))
  })

  it('detects the language, extracts entities and unions TF-IDF stems with entity names into topics', () => {
    const c = extractDeterministic(units, { db, projectId: null, taskClosed: false })
    expect(c.language).toBe('en')
    expect(c.entities).toEqual(expect.arrayContaining([{ name: '2026-10-01', type: 'date' }, { name: 'Werth Kft', type: 'proper' }, { name: 'browser_click', type: 'code' }]))
    expect(c.topics).toContain('kuber')
    expect(c.topics).toContain('werth kft')
    expect(new Set(c.topics).size).toBe(c.topics.length)
  })

  it('produces a heuristic gist under 280 chars and an importance that responds to close and pin', () => {
    const open = extractDeterministic(units, { db, projectId: null, taskClosed: false })
    expect(open.gistSource).toBe('heuristic')
    expect(open.heuristicGist).toBe(open.gist)
    expect(open.gist.length).toBeLessThanOrEqual(280)
    expect(open.gist.startsWith('Please plan the invoice module rollout for Werth Kft.')).toBe(true)
    expect(open.gist.endsWith('Great, deadline confirmed for October first.')).toBe(true)
    expect(open.importance).toBeGreaterThan(0.15)
    const closed = extractDeterministic(units, { db, projectId: null, taskClosed: true })
    expect(closed.importance).toBeCloseTo(open.importance + 0.1, 3)
    boardTables()
    db.run(sql`UPDATE conversations SET pinned = 1 WHERE id = 'c1'`)
    const pinned = extractDeterministic(units, { db, projectId: 'p1', taskClosed: false, conversationId: 'c1' })
    expect(pinned.importance).toBeCloseTo(open.importance + 0.1, 3)
  })

  it('detects the language from conversational text, not from tool JSON', () => {
    // Twelve JSON payloads swamp two short Hungarian turns and detectLanguage
    // falls to 'und'. That is not merely a wrong label: STOP_WORDS has no 'und'
    // entry, so isStopWord returns false for every token and stop-word filtering
    // switches off silently in the fact-subject gate, in every TF-IDF call and in
    // the gist. A tool-heavy turn is the normal shape of this product's traffic.
    const payload = (i: number) => JSON.stringify({ ok: true, tool: 'bash', exit_code: 0, duration_ms: 1_200 + i, command: 'ls -la' })
    const heavy: ExtractionUnit[] = [
      u('h1', 'user_message', 'A szállítási címet holnap pontosítjuk a vevővel.', 0),
      u('h2', 'user_message', 'Kérlek nézd meg a szerződést és a határidőt.', 1),
      ...Array.from({ length: 12 }, (_, i) => u(`t${i}`, 'tool_result', payload(i), 2 + i)),
    ]
    expect(extractDeterministic(heavy, { db, projectId: null, taskClosed: false }).language).toBe('hu')
    // With no conversational text at all it still falls back to the whole batch.
    expect(extractDeterministic([heavy[2]], { db, projectId: null, taskClosed: false }).language).toBe('und')
  })

  it('survives an empty batch', () => {
    const c = extractDeterministic([], { db, projectId: null, taskClosed: false })
    expect(c).toEqual({ gist: '', importance: 0.15, entities: [], topics: [], facts: [], language: 'und', gistSource: 'heuristic', heuristicGist: '' })
  })
})

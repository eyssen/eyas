// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// J6 — one recall query per spec §7 on every entry path (the turn text, the
// previous user turn, the title and the goal), read in the language the owner
// writes in rather than a hard-coded 'en'. Fictive conversations throughout.

import { describe, it, expect } from 'vitest'
import { sql } from 'drizzle-orm'
import { createMemoryDb } from '../../../helpers/test-db'
import {
  buildRecallQuery,
  RECALL_QUERY_MAX_CHARS,
  PREVIOUS_TURN_MAX_CHARS,
  TITLE_MAX_CHARS,
  GOAL_MAX_CHARS,
} from '@modules/memory/v2/recall-query'
import { resolveQueryLanguage } from '@modules/memory/v2/language'
import { buildFtsQuery } from '@modules/memory/v2/extract/tokenize'
import { gatedFuse, retrieve } from '@modules/memory/v2/retrieve'
import { fallbackTitleFromMessage } from '@shared/conversation-title'
import { makeD1Db, vaultRow } from './d1-fixtures'
import { seedRawRow } from './extract-helpers'
import { silentLogger } from './helpers'

let clock = 0
const at = () => new Date(Date.UTC(2026, 8, 1) + (clock += 1_000)).toISOString()

function makeDb(): any {
  const { db } = makeD1Db()
  db.run(sql`CREATE TABLE conversations (id TEXT PRIMARY KEY, title TEXT, goal_description TEXT)`)
  db.run(sql`CREATE TABLE conversation_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, conversation_id TEXT NOT NULL,
    role TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL)`)
  return db
}

function conversation(db: any, id: string, title: string | null, goal: string | null = null): void {
  db.run(sql`INSERT INTO conversations (id, title, goal_description) VALUES (${id}, ${title}, ${goal})`)
}

function message(db: any, conversationId: string, role: 'user' | 'assistant', content: string): void {
  db.run(sql`INSERT INTO conversation_messages (conversation_id, role, content, created_at)
    VALUES (${conversationId}, ${role}, ${content}, ${at()})`)
}

/** L0 rows of the conversation tagged with `lang` (the ingest tags every row with its detected language). */
function l0Language(db: any, conversationId: string, lang: string, n = 2): void {
  for (let i = 0; i < n; i++) {
    const { rid } = seedRawRow(db, { conversationId })
    db.run(sql`UPDATE memory_tag SET tag_value = ${lang} WHERE memory_rid = ${rid} AND tag_type = 'language'`)
  }
}

const HU_REQUEST = 'Készítsd el a havi számla exportot a könyvelőnek CSV formátumban'
const HU_TITLE = 'Havi számla export a könyvelőnek'

describe('buildRecallQuery — the spec §7 parts, turn text first', () => {
  it("'igen, csináld' includes the previous turn and the title", () => {
    const db = makeDb()
    conversation(db, 'c-hu', HU_TITLE)
    message(db, 'c-hu', 'user', HU_REQUEST)
    message(db, 'c-hu', 'assistant', 'Rendben, a CSV oszlopai: dátum, partner, összeg. Elkészítsem?')
    message(db, 'c-hu', 'user', 'igen, csináld') // the route stores the turn before recall runs

    const query = buildRecallQuery(db, { conversationId: 'c-hu', turnText: 'igen, csináld' })
    expect(query.split('\n')).toEqual(['igen, csináld', HU_REQUEST, HU_TITLE])
  })

  it('without turn text it starts from the last stored user message', () => {
    const db = makeDb()
    conversation(db, 'c-hu', HU_TITLE)
    message(db, 'c-hu', 'user', HU_REQUEST)
    message(db, 'c-hu', 'user', 'igen, csináld')
    expect(buildRecallQuery(db, { conversationId: 'c-hu', turnText: '' }).split('\n'))
      .toEqual(['igen, csináld', HU_REQUEST, HU_TITLE])
    expect(buildRecallQuery(db, { conversationId: 'c-hu', turnText: '   ' }).split('\n')[0]).toBe('igen, csináld')
  })

  it('a background conversation with an empty goal still gets a title-based query', async () => {
    const db = makeDb()
    conversation(db, 'c-bg', 'Quarterly supplier audit checklist', '')
    vaultRow(db, 'semantic/audit.md', 'Supplier audit checklist for the quarterly review of vendors')

    const query = buildRecallQuery(db, { conversationId: 'c-bg', turnText: '' })
    expect(query).toBe('Quarterly supplier audit checklist')
    const ids = (await retrieve({ db, logger: silentLogger }, { query, excludeConversationId: 'c-bg' })).map((h) => h.id)
    expect(ids).toContain('vt:semantic/audit.md')
    // The old background query was the goal alone: empty, so nothing was retrieved.
    expect(await retrieve({ db, logger: silentLogger }, { query: '', excludeConversationId: 'c-bg' })).toEqual([])
  })

  it('adds the goal description, and drops it when it is the turn text itself', () => {
    const db = makeDb()
    conversation(db, 'c-goal', 'Supplier onboarding', 'Collect the signed supplier contracts and file them per vendor')
    expect(buildRecallQuery(db, { conversationId: 'c-goal', turnText: 'Start with the Harbor vendor' }).split('\n'))
      .toEqual(['Start with the Harbor vendor', 'Supplier onboarding', 'Collect the signed supplier contracts and file them per vendor'])
    // A background run hands its goal over as the turn text: searched once.
    expect(buildRecallQuery(db, { conversationId: 'c-goal', turnText: 'Collect the signed supplier contracts and file them per vendor' }).split('\n'))
      .toEqual(['Collect the signed supplier contracts and file them per vendor', 'Supplier onboarding'])
  })

  it('does not repeat a first-turn title snippet or an untitled placeholder', () => {
    const db = makeDb()
    const first = 'Please prepare the migration plan for the warehouse stock ledger and list every open question for the finance team'
    conversation(db, 'c-snip', fallbackTitleFromMessage(first))
    message(db, 'c-snip', 'user', first)
    expect(fallbackTitleFromMessage(first).endsWith('…')).toBe(true)
    expect(buildRecallQuery(db, { conversationId: 'c-snip', turnText: first })).toBe(first)

    conversation(db, 'c-untitled', 'Névtelen')
    expect(buildRecallQuery(db, { conversationId: 'c-untitled', turnText: 'Harbor gateway maintenance' })).toBe('Harbor gateway maintenance')
  })

  it('skips a repeated message to find the previous DISTINCT user turn, and never takes assistant text', () => {
    const db = makeDb()
    conversation(db, 'c-rep', null)
    message(db, 'c-rep', 'user', 'Rotate the staging certificates')
    message(db, 'c-rep', 'assistant', 'Which certificate authority should sign them?')
    message(db, 'c-rep', 'user', 'mehet')
    message(db, 'c-rep', 'user', 'mehet')
    const query = buildRecallQuery(db, { conversationId: 'c-rep', turnText: 'mehet' })
    expect(query.split('\n')).toEqual(['mehet', 'Rotate the staging certificates'])
    expect(query).not.toContain('certificate authority')
  })

  it('caps each part and the whole query, keeping the turn text first', () => {
    const db = makeDb()
    const word = (w: string, n: number) => Array.from({ length: n }, (_, i) => `${w}${i}`).join(' ')
    conversation(db, 'c-cap', word('title', 60), word('goal', 200))
    message(db, 'c-cap', 'user', word('previous', 150))
    message(db, 'c-cap', 'user', 'short turn')

    const query = buildRecallQuery(db, { conversationId: 'c-cap', turnText: 'short turn' })
    const [turn, previous, title, goal] = query.split('\n')
    expect(turn).toBe('short turn')
    expect(previous.length).toBeLessThanOrEqual(PREVIOUS_TURN_MAX_CHARS)
    expect(title.length).toBeLessThanOrEqual(TITLE_MAX_CHARS)
    expect(goal.length).toBeLessThanOrEqual(GOAL_MAX_CHARS)
    expect(query.length).toBeLessThanOrEqual(RECALL_QUERY_MAX_CHARS)

    const long = word('pasted', 600)
    const longQuery = buildRecallQuery(db, { conversationId: 'c-cap', turnText: long })
    expect(longQuery.length).toBeLessThanOrEqual(RECALL_QUERY_MAX_CHARS)
    expect(longQuery.startsWith('pasted0 pasted1')).toBe(true)
    expect(longQuery).not.toContain('title0')
  })
})

describe('buildRecallQuery — negative cases', () => {
  it("never includes another conversation's messages, title or goal", () => {
    const db = makeDb()
    conversation(db, 'c-a', null)
    conversation(db, 'c-b', 'Zephyr roadmap', 'Zephyr launch goal')
    message(db, 'c-b', 'user', 'Zephyr secret launch date is next Friday')
    message(db, 'c-a', 'user', 'Harbor gateway maintenance')

    const query = buildRecallQuery(db, { conversationId: 'c-a', turnText: 'ok' })
    expect(query).not.toMatch(/zephyr/i)
    expect(query.split('\n')).toEqual(['ok', 'Harbor gateway maintenance'])
  })

  it('is empty for a conversation with nothing to search with', () => {
    const db = makeDb()
    conversation(db, 'c-empty', null, null)
    expect(buildRecallQuery(db, { conversationId: 'c-empty', turnText: '' })).toBe('')
    expect(buildRecallQuery(db, { conversationId: 'c-missing' })).toBe('')
  })

  it('falls back to the bare turn text when the conversation tables are absent', () => {
    const db = createMemoryDb()
    expect(buildRecallQuery(db, { conversationId: 'c-1', turnText: '  Harbor   gateway ' })).toBe('Harbor gateway')
  })
})

describe('the recall query is read in the language the owner writes in', () => {
  const HU_TURN = 'Hogy csak minden héten legyen kész a számla export, mert a könyvelő kéri'

  it("Hungarian resolves 'hu' and its stop words leave the FTS query", () => {
    const db = makeDb()
    conversation(db, 'c-hu', HU_TITLE)
    const query = buildRecallQuery(db, { conversationId: 'c-hu', turnText: HU_TURN })
    const lang = resolveQueryLanguage(db, query, 'c-hu')
    expect(lang).toBe('hu')
    const fts = buildFtsQuery(query, lang)!
    for (const stop of ['"hogy"*', '"csak"*', '"minde"*', '"mert"*']) expect(fts).not.toContain(stop)
    expect(fts).toContain('"szaml"*')
    // The old hard-coded 'en' searched the Hungarian glue words too.
    expect(buildFtsQuery(query, 'en')).toContain('"hogy"*')
  })

  it('retrieve() resolves the language itself: Hungarian glue no longer passes the two-stem gate', async () => {
    const db = makeDb()
    vaultRow(db, 'semantic/glue.md', 'hogy csak minden szamla')
    vaultRow(db, 'semantic/export.md', 'Szamla export minden heten a konyveloknek')
    const ids = (await retrieve({ db, logger: silentLogger }, { query: HU_TURN })).map((h) => h.id)
    expect(ids).toContain('vt:semantic/export.md')
    expect(ids).not.toContain('vt:semantic/glue.md')
    // Negative control: read as English, the glue note shares three "stems" with the query.
    const asEnglish = (await retrieve({ db, logger: silentLogger }, { query: HU_TURN, language: 'en' })).map((h) => h.id)
    expect(asEnglish).toContain('vt:semantic/glue.md')
  })

  it("a short follow-up in a Hungarian conversation is read as 'hu' from the conversation's L0 rows", () => {
    const db = makeDb()
    conversation(db, 'c-hu', null)
    l0Language(db, 'c-hu', 'hu', 3)
    expect(resolveQueryLanguage(db, buildRecallQuery(db, { conversationId: 'c-hu', turnText: 'igen, csináld' }), 'c-hu')).toBe('hu')
  })

  it('Klingon gets the tlh lexical weight', () => {
    const db = makeDb()
    conversation(db, 'c-tlh', null)
    const query = buildRecallQuery(db, { conversationId: 'c-tlh', turnText: "tlhIngan Hol qawHaq Qapla' nuqneh" })
    const lang = resolveQueryLanguage(db, query, 'c-tlh')
    expect(lang).toBe('tlh')
    const fts = [{ id: 'rw:k', score: 5, source: 'raw' as const, text: 'tlhIngan Hol qawHaq memory' }]
    const dense = [{ id: 'gs:d', score: 0.99, source: 'gist' as const, text: 'unrelated english gist about invoices' }]
    const score = (l: string) => {
      const fused = gatedFuse(query, l, fts, dense)
      return { lex: fused.find((h) => h.id === 'rw:k')!.score, dense: fused.find((h) => h.id === 'gs:d')!.score }
    }
    expect(score(lang).lex).toBeGreaterThan(score(lang).dense)
    // Under the old 'en' default the lexical channel was capped at 0.3.
    expect(score('en').lex).toBeLessThan(score('en').dense)
  })

  it("'multi' keeps content words and drops every language's glue", () => {
    const db = makeDb()
    conversation(db, 'c-multi', null)
    const query = buildRecallQuery(db, { conversationId: 'c-multi', turnText: 'kann aber Rechnung invoice számla' })
    const lang = resolveQueryLanguage(db, query, 'c-multi')
    expect(lang).toBe('multi')
    const fts = buildFtsQuery(query, lang)!
    for (const kept of ['"rechn"*', '"invoi"*', '"szaml"*']) expect(fts).toContain(kept)
    for (const dropped of ['"kann"*', '"aber"*']) expect(fts).not.toContain(dropped)
  })
})

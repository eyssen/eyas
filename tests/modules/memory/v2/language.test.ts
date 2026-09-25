// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { sql } from 'drizzle-orm'
import { detectLanguage, resolveQueryLanguage, conversationLanguage } from '@modules/memory/v2/language'
import { createMemoryDb } from '../../../helpers/test-db'
import { makeV2Db } from './helpers'
import { seedRawRow } from './extract-helpers'

describe('detectLanguage — dependency-free six-language heuristic', () => {
  it('recognises the six UI languages from ordinary sentences', () => {
    expect(detectLanguage('The quick brown fox jumps over the lazy dog and then it sleeps.')).toBe('en')
    expect(detectLanguage('Kérlek, mindig magyarul válaszolj nekem, és ne felejtsd el a hosszú ékezeteket.')).toBe('hu')
    expect(detectLanguage('Bitte antworte mir immer auf Deutsch und vergiss nicht die Umlaute.')).toBe('de')
    expect(detectLanguage('Por favor, responde siempre en español y no olvides los acentos.')).toBe('es')
    expect(detectLanguage("S'il vous plaît, répondez toujours en français et n'oubliez pas les accents.")).toBe('fr')
    expect(detectLanguage("tlhIngan Hol Dajatlh'a'? Qapla'! jIyaj 'ej maSuv.")).toBe('tlh')
  })

  it('uses Hungarian-only letters as a strong signal even without marker words', () => {
    expect(detectLanguage('árvíztűrő tükörfúrógép')).toBe('hu')
  })

  it('returns und for empty, too-short or signal-free text', () => {
    expect(detectLanguage('')).toBe('und')
    expect(detectLanguage('ok')).toBe('und')
    expect(detectLanguage('x = 42; foo(bar)')).toBe('und')
  })

  it('does not mistake camelCase identifiers for Klingon', () => {
    // EYAS transcripts are full of code. A word-internal capital alone must not
    // elect 'tlh' — before this guard, all three of these scored Klingon.
    expect(detectLanguage('Please rename getUserById to fetchUserById before merging.')).toBe('und')
    expect(detectLanguage('The build failed because parseConfig returned null, so I added a guard.')).toBe('und')
    expect(detectLanguage('I updated resolveConversationScope and the tests still pass, but captureUnit is slow.')).toBe('en')
    // …and genuine Klingon still resolves, with or without the "tlh" cluster.
    expect(detectLanguage("Qapla'! jIyaj 'ej maSuv batlh.")).toBe('tlh')
  })

  it('never throws on odd input', () => {
    expect(() => detectLanguage('\x00�'.repeat(50))).not.toThrow()
    expect(detectLanguage('🙂 🙃 🙂')).toBe('und')
  })
})

/** A conversational L0 row whose language tag is `lang` (seedRawRow tags 'en'). */
function rowIn(db: any, conversationId: string, lang: string, over: { sourceType?: any; occurredAtMs?: number; tombstoned?: boolean } = {}): void {
  const { rid } = seedRawRow(db, { conversationId, sourceType: over.sourceType, occurredAtMs: over.occurredAtMs })
  db.run(sql`UPDATE memory_tag SET tag_value = ${lang} WHERE memory_rid = ${rid} AND tag_type = 'language'`)
  if (over.tombstoned) db.run(sql`UPDATE memory_raw SET tombstoned = 1 WHERE rid = ${rid}`)
}

describe('resolveQueryLanguage — query, then the conversation, then multi (J6)', () => {
  it('uses the language detected in the query itself first', () => {
    const { db } = makeV2Db()
    rowIn(db, 'conv-hu', 'hu')
    rowIn(db, 'conv-hu', 'hu')
    expect(resolveQueryLanguage(db, 'Please always answer the question that was asked.', 'conv-hu')).toBe('en')
    expect(resolveQueryLanguage(db, "tlhIngan Hol Dajatlh'a'? Qapla'! jIyaj 'ej maSuv.", 'conv-hu')).toBe('tlh')
  })

  it("a one-word 'und' query in a Hungarian conversation resolves 'hu'", () => {
    const { db } = makeV2Db()
    rowIn(db, 'conv-hu', 'hu')
    rowIn(db, 'conv-hu', 'hu')
    rowIn(db, 'conv-hu', 'en')
    expect(detectLanguage('und')).toBe('und')
    expect(resolveQueryLanguage(db, 'und', 'conv-hu')).toBe('hu')
    expect(resolveQueryLanguage(db, 'igen, csináld', 'conv-hu')).toBe('hu')
  })

  it("falls back to 'multi' — never 'en' — when neither the query nor the conversation says", () => {
    const { db } = makeV2Db()
    rowIn(db, 'conv-und', 'und')
    expect(resolveQueryLanguage(db, 'ok', 'conv-und')).toBe('multi')
    expect(resolveQueryLanguage(db, 'ok', 'conv-unknown')).toBe('multi')
    expect(resolveQueryLanguage(db, 'ok', null)).toBe('multi')
    expect(resolveQueryLanguage(db, 'ok')).toBe('multi')
    expect(resolveQueryLanguage(null, 'ok', 'conv-und')).toBe('multi')
  })

  it("does not borrow another conversation's language", () => {
    const { db } = makeV2Db()
    rowIn(db, 'conv-de', 'de')
    rowIn(db, 'conv-de', 'de')
    expect(resolveQueryLanguage(db, 'ok', 'conv-other')).toBe('multi')
    expect(resolveQueryLanguage(db, 'ok', 'conv-de')).toBe('de')
  })

  it('counts only user and assistant rows: tool payloads do not vote', () => {
    const { db } = makeV2Db()
    rowIn(db, 'conv-mix', 'hu', { sourceType: 'user_message' })
    rowIn(db, 'conv-mix', 'hu', { sourceType: 'assistant_message' })
    for (let i = 0; i < 5; i++) rowIn(db, 'conv-mix', 'en', { sourceType: 'tool_result' })
    expect(conversationLanguage(db, 'conv-mix')).toBe('hu')
  })

  it('ignores tombstoned rows and breaks a tie by the most recent row', () => {
    const { db } = makeV2Db()
    rowIn(db, 'conv-tie', 'fr', { occurredAtMs: 1_000 })
    rowIn(db, 'conv-tie', 'es', { occurredAtMs: 2_000 })
    rowIn(db, 'conv-tie', 'fr', { occurredAtMs: 3_000, tombstoned: true })
    expect(conversationLanguage(db, 'conv-tie')).toBe('es')
  })

  it('is fail-soft on a database without the memory tables', () => {
    const db = createMemoryDb()
    expect(conversationLanguage(db, 'conv-1')).toBeNull()
    expect(resolveQueryLanguage(db, 'ok', 'conv-1')).toBe('multi')
  })
})

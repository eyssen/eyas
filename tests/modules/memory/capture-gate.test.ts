// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { shouldExtract, countExtractions } from '@modules/memory/capture/capture-gate'
import { createMemoryDb } from '../../helpers/test-db'
import { createMemoryTables } from '@modules/memory/schema'

const cfg = { enabled: true, minUserChars: 40, maxPerConversation: 20, maxInputChars: 4000 }
const long = 'The owner wants every commit to be asked about first, always.'

describe('the capture gate', () => {
  it('lets a substantial turn through', () => {
    expect(shouldExtract({ config: cfg, userMessage: long, alreadyExtracted: 0 }).run).toBe(true)
  })

  it('skips a short acknowledgement without knowing any language', () => {
    // "mehet", "ok", "igen" — four of the owner's last messages in the session
    // that produced this feature. No keyword list, no language assumption.
    for (const short of ['ok', 'mehet', 'igen', 'yes', 'go ahead']) {
      const verdict = shouldExtract({ config: cfg, userMessage: short, alreadyExtracted: 0 })
      expect(verdict.run).toBe(false)
      expect(verdict.reason).toBe('too-short')
    }
  })

  it('obeys the switch', () => {
    expect(shouldExtract({ config: { ...cfg, enabled: false }, userMessage: long, alreadyExtracted: 0 }))
      .toEqual({ run: false, reason: 'disabled' })
  })

  it('stops at the per-conversation cap', () => {
    const verdict = shouldExtract({ config: cfg, userMessage: long, alreadyExtracted: 20 })
    expect(verdict).toEqual({ run: false, reason: 'cap-reached' })
  })

  it('counts characters, not bytes — an accented message is not longer', () => {
    // 41 ASCII characters vs 41 Hungarian ones must gate identically; a byte
    // count would let one through and stop the other.
    const ascii = 'a'.repeat(41)
    const magyar = 'á'.repeat(41)
    expect(shouldExtract({ config: cfg, userMessage: ascii, alreadyExtracted: 0 }).run)
      .toBe(shouldExtract({ config: cfg, userMessage: magyar, alreadyExtracted: 0 }).run)
  })

  it('ignores surrounding whitespace when measuring', () => {
    expect(shouldExtract({ config: cfg, userMessage: `   ${'a'.repeat(20)}   `, alreadyExtracted: 0 }).run).toBe(false)
  })
})

describe('what the cap is spent on', () => {
  let db: any

  const addRun = (conversationId: string, skippedReason: string | null) =>
    db.run(sql`INSERT INTO memory_capture_runs (conversation_id, notes_written, skipped_reason)
      VALUES (${conversationId}, 0, ${skippedReason})`)

  beforeEach(() => {
    db = createMemoryDb(); createMemoryTables(db)
  })

  it('counts a run that completed', () => {
    addRun('c1', null)
    addRun('c1', null)
    expect(countExtractions(db, 'c1')).toBe(2)
  })

  it('counts an unparsable run — the call was made, the reply was unusable', () => {
    addRun('c1', 'unparsable')
    expect(countExtractions(db, 'c1')).toBe(1)
  })

  it('counts a rejected-shape run — the call was made, every note failed the schema', () => {
    addRun('c1', 'rejected-shape')
    expect(countExtractions(db, 'c1')).toBe(1)
  })

  it('counts an errored run — a capture that keeps failing is what a runaway guard is for', () => {
    // The failure could be the model call OR the vault write that follows it;
    // either way, retrying it unboundedly is the thing the cap prevents.
    addRun('c1', 'error')
    addRun('c1', 'error')
    expect(countExtractions(db, 'c1')).toBe(2)
  })

  it('does not let skips spend the budget', () => {
    // The cap is a MODEL-SPEND guard. Twenty short acknowledgements reach no
    // model, so they must leave the budget untouched — otherwise the twenty-
    // first turn, however fact-rich, is refused with cap-reached.
    for (let i = 0; i < 20; i++) addRun('c1', 'too-short')
    addRun('c1', 'cap-reached')
    expect(countExtractions(db, 'c1')).toBe(0)
    expect(shouldExtract({ config: cfg, userMessage: long, alreadyExtracted: countExtractions(db, 'c1') }).run).toBe(true)
  })

  it('counts per conversation, not globally', () => {
    addRun('c1', null)
    addRun('c2', null)
    expect(countExtractions(db, 'c1')).toBe(1)
  })

  it('treats a missing table as no extractions', () => {
    db.run(sql`DROP TABLE memory_capture_runs`)
    expect(countExtractions(db, 'c1')).toBe(0)
  })
})

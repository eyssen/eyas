// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { createMemoryDb } from '../../helpers/test-db'
import { createMemoryTables } from '@modules/memory/schema'
import { buildMemoryIndex, inferKind, MEMORY_SECTION_KEY } from '@modules/memory/memory-index'

let db: any

function note(path: string, over: Record<string, unknown> = {}) {
  const row = {
    title: 'Note', tier: 'semantic', tags: '[]', content_text: 'Body text here.',
    kind: null, summary: null, file_hash: 'h', indexed_at: '2026-08-27T00:00:00Z', ...over,
  }
  db.run(sql`INSERT INTO vault_index (path, title, tier, tags, content_text, kind, summary, file_hash, indexed_at)
    VALUES (${path}, ${row.title}, ${row.tier}, ${row.tags}, ${row.content_text},
            ${row.kind}, ${row.summary}, ${row.file_hash}, ${row.indexed_at})`)
}

beforeEach(() => { db = createMemoryDb(); createMemoryTables(db) })

describe('inferKind', () => {
  it('trusts a declared kind', () => {
    expect(inferKind({ kind: 'user', tier: 'semantic' })).toBe('user')
  })

  it('reads a procedural note as feedback — "how to work" is a rule', () => {
    expect(inferKind({ kind: null, tier: 'procedural' })).toBe('feedback')
  })

  it('falls back to reference, never to user', () => {
    // Claiming an undeclared note is a fact ABOUT THE OWNER is the expensive
    // mistake: it is ranked first and it shapes every answer.
    expect(inferKind({ kind: null, tier: 'semantic' })).toBe('reference')
  })

  it('ignores a kind that is not one of ours', () => {
    expect(inferKind({ kind: 'banana', tier: 'semantic' })).toBe('reference')
  })
})

describe('buildMemoryIndex', () => {
  it('returns null on an empty vault rather than an empty heading', () => {
    expect(buildMemoryIndex(db)).toBeNull()
  })

  it('ranks user and feedback above reference', () => {
    note('semantic/ref.md', { title: 'Ref', summary: 'Some reference' })
    note('semantic/owner.md', { title: 'Owner', kind: 'user', summary: 'Answers in Hungarian' })
    note('procedural/commit.md', { title: 'Commits', tier: 'procedural', summary: 'Never commit unless asked' })

    const built = buildMemoryIndex(db)!
    expect(built.paths).toEqual(['semantic/owner.md', 'procedural/commit.md', 'semantic/ref.md'])
  })

  it('labels the block as context and never as instruction', () => {
    note('semantic/owner.md', { kind: 'user', summary: 'Answers in Hungarian' })
    const content = buildMemoryIndex(db)!.content
    // A note's body originates in a conversation and is replayed into a system
    // prompt later; saying what it is, is a security control, not politeness.
    expect(content).toMatch(/not instructions/i)
    expect(content).toContain('[user] Answers in Hungarian')
  })

  it('uses the first content line when a note declares no summary', () => {
    note('semantic/hand.md', { title: 'Hand written', content_text: '  \n\nFirst real line.\nSecond.' })
    expect(buildMemoryIndex(db)!.content).toContain('First real line.')
  })

  it('clips a summary that is a body in disguise', () => {
    note('semantic/long.md', { kind: 'user', summary: 'x'.repeat(400) })
    const line = buildMemoryIndex(db)!.content.split('\n').find((l) => l.startsWith('- '))!
    expect(line.length).toBeLessThan(200)
    expect(line).toMatch(/…$/)
  })

  it('drops whole lines to fit the budget and says how many it dropped', () => {
    for (let n = 0; n < 40; n++) note(`semantic/n${n}.md`, { summary: `Note number ${n} with some text` })
    const built = buildMemoryIndex(db, { budgetChars: 300 })!

    expect(built.content).not.toMatch(/Note number \d+ with some te$/m)  // no half line
    expect(built.content).toMatch(/\d+ more notes not shown/)
    expect(built.paths.length).toBeLessThan(40)
    expect(built.paths.length).toBeGreaterThan(0)
  })

  it('excludes project notes in M1, deliberately', () => {
    note('projects/eyas/decisions.md', { kind: 'project', summary: 'Version is frozen' })
    note('semantic/owner.md', { kind: 'user', summary: 'Answers in Hungarian' })
    const built = buildMemoryIndex(db)!
    expect(built.paths).toEqual(['semantic/owner.md'])
  })

  it('survives a vault_index that is not there', () => {
    db.run(sql`DROP TABLE vault_index`)
    expect(buildMemoryIndex(db)).toBeNull()
  })

  it('names its section key once, for the recorder', () => {
    expect(MEMORY_SECTION_KEY).toBe('memory-index')
  })
})

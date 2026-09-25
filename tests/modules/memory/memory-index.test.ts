// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { createMemoryDb, getRawFromDrizzle } from '../../helpers/test-db'
import { createMemoryTables } from '@modules/memory/schema'
import { probeSqliteCapabilities } from '@core/db/sqlite-capabilities'
import { createMemoryV2Tables, allocateRid } from '@modules/memory/v2/schema'
import { buildMemoryIndex, formatIndexLine, inferKind, MEMORY_SECTION_KEY, hasSecretsTag, recallIncludesSecrets, SIBLING_GIST_MAX } from '@modules/memory/memory-index'

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

  it('within a kind, prefers a short MOC over a long dump so standing notes still fit', () => {
    note('semantic/dump.md', { kind: 'reference', summary: 'A'.repeat(120) })
    note('semantic/contoso.md', { kind: 'reference', title: 'Contoso', summary: 'Customer Contoso' })
    const built = buildMemoryIndex(db, { budgetChars: 280 })!
    expect(built.paths[0]).toBe('semantic/contoso.md')
    expect(built.content).toContain('Customer Contoso')
  })

  it('keeps short reference MOCs and the commit rule inside an 8000-char budget after many feedback notes', () => {
    const filler = 'How to work on everyday tasks with extra wording so the line is long enough. '
    for (let n = 0; n < 60; n++) {
      note(`procedural/rule-${String(n).padStart(3, '0')}.md`, {
        kind: 'feedback', title: `Rule ${n}`, summary: `${filler}${n}`,
      })
    }
    note('procedural/commit.md', {
      kind: 'feedback', title: 'Commits', summary: 'Never commit unless asked',
    })
    note('semantic/contoso.md', { kind: 'reference', title: 'Contoso', summary: 'Customer Contoso' })
    const built = buildMemoryIndex(db, { budgetChars: 8_000 })!
    expect(built.paths).toContain('semantic/contoso.md')
    expect(built.paths).toContain('procedural/commit.md')
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
    expect(content).toContain('[user] (vt:semantic/owner.md) Answers in Hungarian')
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

  it('drops whole lines to fit the budget and returns how many it dropped', () => {
    for (let n = 0; n < 40; n++) note(`semantic/n${n}.md`, { summary: `Note number ${n} with some text` })
    const built = buildMemoryIndex(db, { budgetChars: 300 })!

    expect(built.content).not.toMatch(/Note number \d+ with some te$/m)  // no half line
    expect(built.paths.length).toBeLessThan(40)
    expect(built.paths.length).toBeGreaterThan(0)
    // The count is returned; the reader renders the trailer with the answering
    // model's tool name (v2/assemble.ts), so the index names no tool itself.
    expect(built.dropped).toBe(40 - built.paths.length)
    expect(built.content).not.toMatch(/search_memory|more notes not shown/)
  })

  it('returns every line structured, with the id printed on it', () => {
    note('semantic/owner.md', { kind: 'user', summary: 'Prefers short answers' })
    const built = buildMemoryIndex(db)!
    expect(built.lines).toEqual([{ id: 'vt:semantic/owner.md', kind: 'user', summary: 'Prefers short answers' }])
    expect(built.content).toContain(formatIndexLine(built.lines[0]))
    expect(built.dropped).toBe(0)
  })

  it('linesOnly: the budget covers the lines alone, not the legacy heading', () => {
    for (let n = 0; n < 10; n++) note(`semantic/n${n}.md`, { summary: `Note number ${n} with some text` })
    const withHeading = buildMemoryIndex(db, { budgetChars: 400 })!
    const linesOnly = buildMemoryIndex(db, { budgetChars: 400, linesOnly: true })!
    expect(linesOnly.lines.length).toBeGreaterThan(withHeading.lines.length)
    const used = linesOnly.lines.reduce((n, l) => n + formatIndexLine(l).length + 1, 0)
    expect(used).toBeLessThanOrEqual(400)
  })

  it('shows an UNSCOPED project note everywhere, ranked as project', () => {
    // D-2: a project note that declares no project belongs to nobody in
    // particular, so it belongs to everybody. Hiding it would lose it for
    // every conversation at once.
    note('semantic/decisions.md', { kind: 'project', summary: 'Version is frozen' })
    const out = buildMemoryIndex(db)!.content
    expect(out).toContain('- [project] (vt:semantic/decisions.md) Version is frozen')
  })

  it('survives a vault_index that is not there', () => {
    db.run(sql`DROP TABLE vault_index`)
    expect(buildMemoryIndex(db)).toBeNull()
  })

  it('names its section key once, for the recorder', () => {
    expect(MEMORY_SECTION_KEY).toBe('memory-index')
  })
})

const note2 = (path: string, kind: string, summary: string, projectId: string | null = null) =>
  db.run(sql`INSERT INTO vault_index (path, title, tier, tags, content_text, kind, summary, project_id, file_hash, indexed_at)
    VALUES (${path}, ${path}, 'semantic', '[]', 'body', ${kind}, ${summary}, ${projectId}, 'h', ${new Date().toISOString()})`)

describe('project-ranked recall (F1)', () => {
  it('ranks user, feedback, active project, reference — in that order', () => {
    note2('semantic/r.md', 'reference', 'A reference fact')
    note2('projects/p1/rule.md', 'project', 'P1 deploy rule', 'p1')
    note2('procedural/f.md', 'feedback', 'Never commit unasked')
    note2('semantic/u.md', 'user', 'Works in Hungarian')
    const lines = buildMemoryIndex(db, { projectId: 'p1' })!.content.split('\n').slice(2)
    expect(lines.map((l) => l.split(']')[0] + ']')).toEqual(['- [user]', '- [feedback]', '- [project]', '- [reference]'])
  })

  it('excludes other projects entirely, and all projects when there is none', () => {
    note2('projects/p2/rule.md', 'project', 'P2 rule', 'p2')
    note2('semantic/u.md', 'user', 'Works in Hungarian')
    note2('semantic/free.md', 'project', 'Free note')
    expect(buildMemoryIndex(db, { projectId: 'p1' })!.content).not.toContain('P2 rule')
    expect(buildMemoryIndex(db, {})!.content).not.toContain('P2 rule')
    // A note that named no project is not "another project's" note.
    expect(buildMemoryIndex(db, { projectId: 'p1' })!.content).toContain('Free note')
    expect(buildMemoryIndex(db, {})!.content).toContain('Free note')
  })

  it('orders stably by path within a kind — a reindex must not reorder the prompt', () => {
    note2('semantic/b.md', 'user', 'Fact B')
    note2('semantic/a.md', 'user', 'Fact A')
    const first = buildMemoryIndex(db, {})!.content
    // Touch b so indexed_at changes — the old indexed_at DESC order would flip the lines.
    db.run(sql`UPDATE vault_index SET indexed_at = ${new Date(Date.now() + 5000).toISOString()} WHERE path = 'semantic/b.md'`)
    expect(buildMemoryIndex(db, {})!.content).toBe(first)
  })

  it('a project note with no declared project id is global, ranked as project', () => {
    note2('semantic/unscoped-project.md', 'project', 'Orphan project note', null)
    expect(buildMemoryIndex(db, { projectId: 'p1' })!.content).toContain('- [project] (vt:semantic/unscoped-project.md) Orphan project note')
    expect(buildMemoryIndex(db, {})!.content).toContain('- [project] (vt:semantic/unscoped-project.md) Orphan project note')
  })
})

const note3 = (path: string, kind: string, summary: string, projectId: string | null = null, projectTypeId: string | null = null) =>
  db.run(sql`INSERT INTO vault_index (path, title, tier, tags, content_text, kind, summary, project_id, project_type_id, file_hash, indexed_at)
    VALUES (${path}, ${path}, 'semantic', '[]', 'body', ${kind}, ${summary}, ${projectId}, ${projectTypeId}, 'h', ${new Date().toISOString()})`)

describe('type-ranked recall (item 20)', () => {
  it('project alpha sees the type note and its own project note, not bravo', () => {
    note3('project-types/type-a/shared-rule.md', 'domain', 'Shared type rule', null, 'type-a')
    note3('projects/alpha/ticket.md', 'project', 'Alpha ticket constraint', 'alpha', null)
    note3('projects/bravo/local.md', 'project', 'Bravo is pod-only', 'bravo', null)
    note3('semantic/u.md', 'user', 'Works in Hungarian')

    const content = buildMemoryIndex(db, { projectId: 'alpha', projectTypeId: 'type-a' })!.content
    expect(content).toContain('Shared type rule')
    expect(content).toContain('Alpha ticket constraint')
    expect(content).not.toContain('Bravo is pod-only')
  })

  it('project bravo sees the same type note and its own project note, not alpha', () => {
    note3('project-types/type-a/shared-rule.md', 'domain', 'Shared type rule', null, 'type-a')
    note3('projects/alpha/ticket.md', 'project', 'Alpha ticket constraint', 'alpha', null)
    note3('projects/bravo/local.md', 'project', 'Bravo is pod-only', 'bravo', null)

    const content = buildMemoryIndex(db, { projectId: 'bravo', projectTypeId: 'type-a' })!.content
    expect(content).toContain('Shared type rule')
    expect(content).toContain('Bravo is pod-only')
    expect(content).not.toContain('Alpha ticket constraint')
  })

  it('ranks domain with the family, after feedback and before the client project', () => {
    note3('semantic/r.md', 'reference', 'A reference fact')
    note3('projects/alpha/rule.md', 'project', 'Alpha deploy rule', 'alpha', null)
    note3('project-types/type-a/shared.md', 'domain', 'Always extend, never edit core', null, 'type-a')
    note3('procedural/f.md', 'feedback', 'Never commit unasked')
    note3('semantic/u.md', 'user', 'Works in Hungarian')
    const lines = buildMemoryIndex(db, { projectId: 'alpha', projectTypeId: 'type-a' })!.content.split('\n').slice(2)
    expect(lines.map((l) => l.split(']')[0] + ']')).toEqual(
      ['- [user]', '- [feedback]', '- [domain]', '- [project]', '- [reference]'],
    )
  })

  it('hides type notes when the conversation has no type, including general-general', () => {
    note3('project-types/type-a/shared-rule.md', 'domain', 'Shared type rule', null, 'type-a')
    note3('semantic/u.md', 'user', 'Works in Hungarian')
    expect(buildMemoryIndex(db, { projectId: 'alpha' })!.content).not.toContain('Shared type rule')
    expect(buildMemoryIndex(db, {})!.content).not.toContain('Shared type rule')
  })

  it('a domain note with no type id is global, ranked as domain', () => {
    note3('semantic/unscoped-domain.md', 'domain', 'Orphan type note', null, null)
    expect(buildMemoryIndex(db, { projectId: 'alpha', projectTypeId: 'type-a' })!.content)
      .toContain('- [domain] (vt:semantic/unscoped-domain.md) Orphan type note')
    expect(buildMemoryIndex(db, {})!.content).toContain('- [domain] (vt:semantic/unscoped-domain.md) Orphan type note')
  })

  it('looks up type_id from the project row when projectTypeId is omitted', () => {
    db.run(sql`CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT, type_id TEXT)`)
    db.run(sql`INSERT INTO projects (id, name, type_id) VALUES ('alpha', 'Alpha', 'type-a')`)
    note3('project-types/type-a/shared-rule.md', 'domain', 'Shared type rule', null, 'type-a')
    const content = buildMemoryIndex(db, { projectId: 'alpha' })!.content
    expect(content).toContain('Shared type rule')
  })
})

describe('contains-secrets (D-7)', () => {
  const seed = (db: any, path: string, tags: string | null, summary: string) =>
    db.run(sql`INSERT INTO vault_index (path, title, tier, tags, content_text, file_hash, indexed_at, kind, summary)
      VALUES (${path}, ${path}, 'semantic', ${tags}, ${summary}, 'h', '2026-01-01', 'reference', ${summary})`)

  it('leaves a tagged note out of the index and out of the not-shown count', () => {
    const db = createMemoryDb(); createMemoryTables(db)
    seed(db, 'semantic/alpha.md', '["contains-secrets"]', 'alpha secret note')
    seed(db, 'semantic/bravo.md', '["imported"]', 'bravo plain note')
    const out = buildMemoryIndex(db, { projectTypeId: null })!
    expect(out.paths).toEqual(['semantic/bravo.md'])
    expect(out.content).not.toContain('alpha secret note')
    expect(out.dropped).toBe(0)
  })

  it('shows it when includeSecrets is on', () => {
    const db = createMemoryDb(); createMemoryTables(db)
    seed(db, 'semantic/alpha.md', '["contains-secrets"]', 'alpha secret note')
    expect(buildMemoryIndex(db, { projectTypeId: null, includeSecrets: true })!.paths).toEqual(['semantic/alpha.md'])
  })

  it('treats malformed or absent tags as no tags', () => {
    expect(hasSecretsTag(null)).toBe(false)
    expect(hasSecretsTag('not json')).toBe(false)
    expect(hasSecretsTag('["contains-secrets"]')).toBe(true)
    expect(hasSecretsTag(['a', 'contains-secrets'])).toBe(true)
  })

  it('reads the config flag through one accessor', () => {
    expect(recallIncludesSecrets({ memory: { recall: { includeSecrets: true } } })).toBe(true)
    expect(recallIncludesSecrets({})).toBe(false)
  })
})

// J1 — ids on standing lines, and the gist fill limited to D1 (the spec's
// tier-1 set): pinned gists, the active project's own tasks, never another
// project's and never the conversation the model is already in.
describe('standing ids and the D1 gist fill (J1)', () => {
  let t = 1_700_000_000_000

  function v2Db(): any {
    const d = createMemoryDb()
    createMemoryTables(d)
    createMemoryV2Tables(d, probeSqliteCapabilities(getRawFromDrizzle(d)))
    return d
  }

  function gist(d: any, id: string, text: string, o: { conv?: string; project?: string; pinned?: boolean; quarantined?: boolean; scopeType?: string; scopeId?: string } = {}) {
    t += 1_000
    const rid = allocateRid(d, 'gist', id, t)
    d.run(sql`INSERT INTO memory_gist (
      rid, id, content_hash, origin_instance_id, hlc_physical_ms, hlc_logical, revision, created_at, tombstoned,
      scope_type, scope_id, tree_depth, text, structured_json, pinned, trust_tier, token_count, importance_score, gist_source,
      is_current, decay_score, presence_tier, multi_project, times_retrieved
    ) VALUES (
      ${rid}, ${id}, ${`h-${id}`}, 'inst', ${t}, 0, 1, ${t}, 0,
      ${o.scopeType ?? 'task'}, ${o.scopeId ?? o.conv ?? null}, 0, ${text}, '{}', ${o.pinned ? 1 : 0},
      ${o.quarantined ? 'quarantined' : 'derived'}, 10, 0.5, 'heuristic',
      1, 1.0, 'hot', 0, 0
    )`)
    if (o.project) d.run(sql`INSERT INTO memory_tag (memory_rid, memory_type, tag_type, tag_value) VALUES (${rid}, 'gist', 'project', ${o.project})`)
  }

  it('prints the id on every line and returns the ids in line order', () => {
    const d = v2Db()
    d.run(sql`INSERT INTO vault_index (path, title, tier, tags, content_text, kind, summary, file_hash, indexed_at)
      VALUES ('semantic/owner.md', 'Owner', 'semantic', '[]', 'b', 'user', 'Answers in Hungarian', 'h', '2026-01-01')`)
    gist(d, 'g-global', 'Global prior work on invoices', { conv: 'c-other' })
    const out = buildMemoryIndex(d, { projectTypeId: null })!
    expect(out.content).toContain('- [user] (vt:semantic/owner.md) Answers in Hungarian')
    expect(out.content).toContain('- [gist] (gs:g-global) Global prior work on invoices')
    expect(out.ids).toEqual(['vt:semantic/owner.md', 'gs:g-global'])
    expect(out.paths).toEqual(['semantic/owner.md', 'gist:g-global'])
  })

  it('fills from pinned gists and up to 5 recent sibling tasks of the project', () => {
    const d = v2Db()
    gist(d, 'g-pinned', 'Pinned global rule', { scopeType: 'global', scopeId: 'root', pinned: true })
    for (let i = 0; i < 7; i++) gist(d, `g-p-${i}`, `Sibling task ${i} of P`, { conv: `c-p-${i}`, project: 'P' })
    const out = buildMemoryIndex(d, { projectId: 'P', projectTypeId: null, budgetChars: 8_000 })!
    expect(out.ids[0]).toBe('gs:g-pinned')
    const siblings = out.ids.filter((id) => id.startsWith('gs:g-p-'))
    expect(siblings).toHaveLength(SIBLING_GIST_MAX)
    // Most recent first.
    expect(siblings[0]).toBe('gs:g-p-6')
  })

  it('never shows another project\'s gist, this conversation\'s own gist or a quarantined one', () => {
    const d = v2Db()
    gist(d, 'g-home', 'Home project task', { conv: 'c-home', project: 'P' })
    gist(d, 'g-self', 'This very conversation', { conv: 'c-self', project: 'P' })
    gist(d, 'g-q', 'Other project task', { conv: 'c-q', project: 'Q' })
    gist(d, 'g-q-pinned', 'Other project pinned', { conv: 'c-q2', project: 'Q', pinned: true })
    gist(d, 'g-q-root', 'Other project root', { scopeType: 'project', scopeId: 'Q', pinned: true })
    gist(d, 'g-bad', 'Suspicious task', { conv: 'c-bad', project: 'P', quarantined: true })
    const out = buildMemoryIndex(d, { projectId: 'P', projectTypeId: null, conversationId: 'c-self', budgetChars: 8_000 })!
    expect(out.ids).toContain('gs:g-home')
    expect(out.ids).not.toContain('gs:g-self')
    expect(out.ids).not.toContain('gs:g-q')
    expect(out.ids).not.toContain('gs:g-q-pinned')
    expect(out.ids).not.toContain('gs:g-q-root')
    expect(out.ids).not.toContain('gs:g-bad')
  })

  it('a projectless conversation sees global gists only (fail closed)', () => {
    const d = v2Db()
    gist(d, 'g-free', 'Projectless task', { conv: 'c-free' })
    gist(d, 'g-p', 'Project task', { conv: 'c-p', project: 'P' })
    const out = buildMemoryIndex(d, { projectId: null, projectTypeId: null })!
    expect(out.ids).toEqual(['gs:g-free'])
  })

  it('keeps a scoped note of ANY kind inside its own project', () => {
    const d = v2Db()
    db = d // note2 writes through the suite's db
    note2('semantic/q-user.md', 'user', 'Q-only owner preference', 'Q')
    note2('semantic/global-user.md', 'user', 'Global owner preference')
    expect(buildMemoryIndex(d, { projectId: 'P', projectTypeId: null })!.content).not.toContain('Q-only owner preference')
    expect(buildMemoryIndex(d, { projectId: null, projectTypeId: null })!.content).not.toContain('Q-only owner preference')
    expect(buildMemoryIndex(d, { projectId: 'Q', projectTypeId: null })!.content).toContain('Q-only owner preference')
    expect(buildMemoryIndex(d, { projectId: 'P', projectTypeId: null })!.content).toContain('Global owner preference')
  })
})

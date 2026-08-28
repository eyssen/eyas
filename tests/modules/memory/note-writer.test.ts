// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { sql } from 'drizzle-orm'
import { createMemoryDb } from '../../helpers/test-db'
import { createMemoryTables } from '@modules/memory/schema'
import { createVaultService } from '@modules/memory/vault/vault-service'
import { createVaultIndexer } from '@modules/memory/vault/vault-indexer'
import { createWikilinkService } from '@shared/wikilinks'
import { createNoteWriter } from '@modules/memory/capture/note-writer'

let db: any, root: string, vault: any, indexer: any, writer: any

const candidate = (over = {}) => ({
  kind: 'user' as const, title: 'Working language',
  summary: 'Answers in Hungarian', body: 'The owner works in Hungarian.', ...over,
})

const noProject = { conversationId: 'c1', projectId: null as string | null }

beforeEach(() => {
  db = createMemoryDb(); createMemoryTables(db)
  root = mkdtempSync(join(tmpdir(), 'eyas-notewriter-'))
  vault = createVaultService(root)
  const wikilinks = createWikilinkService(db); wikilinks.init()
  indexer = createVaultIndexer(db, vault, wikilinks)
  writer = createNoteWriter({ db, vault, indexer })
})
afterEach(() => { rmSync(root, { recursive: true, force: true }) })

describe('note writer', () => {
  it('writes a user note into semantic/ with kind and summary in frontmatter', async () => {
    const out = await writer.write(candidate(), noProject)
    expect(out.action).toBe('created')
    expect(out.path).toBe('semantic/working-language.md')

    const entry = vault.read(out.path)!
    expect(entry.frontmatter.kind).toBe('user')
    expect(entry.frontmatter.summary).toBe('Answers in Hungarian')
    expect(entry.frontmatter.tier).toBe('semantic')
  })

  it('writes a feedback note into procedural/, with its reason', async () => {
    const out = await writer.write(candidate({
      kind: 'feedback', title: 'Commits', summary: 'Never commit unless asked',
      body: 'Do not commit without being asked.',
      why: 'The owner decides what enters history', howToApply: 'Ask before every commit',
    }), noProject)
    expect(out.path).toBe('procedural/commits.md')
    const body = vault.read(out.path)!.content
    expect(body).toContain('The owner decides what enters history')
    expect(body).toContain('Ask before every commit')
  })

  it('updates the existing note instead of writing a second one', async () => {
    await writer.write(candidate(), noProject)
    indexer.indexAll()
    const again = await writer.write(candidate({ summary: 'Answers in Hungarian, always', body: 'Confirmed again.' }), noProject)

    expect(again.action).toBe('updated')
    expect(vault.listFiles().filter((f: string) => f.endsWith('.md'))).toHaveLength(1)
    const entry = vault.read(again.path)!
    expect(entry.frontmatter.summary).toBe('Answers in Hungarian, always')
    // History is appended, not overwritten: a later reader can see it was
    // reinforced rather than invented once.
    expect(entry.content).toContain('The owner works in Hungarian.')
    expect(entry.content).toContain('Confirmed again.')
  })

  it('indexes what it wrote, so the very next turn can see it', async () => {
    const out = await writer.write(candidate(), noProject)
    const rows = db.all(sql`SELECT summary FROM vault_index WHERE path = ${out.path}`) as any[]
    expect(rows[0]?.summary).toBe('Answers in Hungarian')
  })

  it('sanitises before writing, never after, when privacySanitize is provided', async () => {
    // The file IS the artefact; a redaction applied on read would leave the
    // secret on disk and in the FTS index. privacySanitize is an optional dep
    // (published by the privacy module) — this pins the "present" branch.
    const sanitizingWriter = createNoteWriter({
      db, vault, indexer,
      privacySanitize: async (text: string) => text.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[redacted]'),
    })
    const out = await sanitizingWriter.write(candidate({ body: 'Reach the owner at owner@example.com about this.' }), noProject)
    expect(vault.read(out.path)!.content).not.toContain('owner@example.com')
  })

  it('writes text unchanged when privacySanitize is absent', async () => {
    // A self-hosted build without the privacy module must still capture.
    const out = await writer.write(candidate({ body: 'Reach the owner at owner@example.com about this.' }), noProject)
    expect(vault.read(out.path)!.content).toContain('owner@example.com')
  })

  it('refuses a title that would escape the vault', async () => {
    const out = await writer.write(candidate({ title: '../../etc/passwd' }), noProject)
    expect(out.path.startsWith('semantic/')).toBe(true)
    expect(out.path).not.toContain('..')
  })

  it('does not collide two different notes onto one slug', async () => {
    await writer.write(candidate({ title: 'Language' }), noProject)
    indexer.indexAll()
    const second = await writer.write(candidate({ title: 'Language', summary: 'Unrelated fact about builds', body: 'Builds run on Bun.' }), noProject)
    // Same slug, genuinely different note: it must land somewhere of its own.
    expect(second.action === 'created' ? second.path : '').not.toBe('semantic/language.md')
  })

  // --- Fuzzy FTS dedup: the title-column scoping fix ---

  it('updates a note found via fuzzy title match at a different slug', async () => {
    await writer.write({
      kind: 'user', title: 'Deploy rule for staging',
      summary: 'Deploys need a green pipeline', body: 'Check CI before deploying to staging.',
    }, noProject)
    indexer.indexAll()

    // Different wording -> different slug, so this can only be found through
    // the fuzzy FTS branch, not the exact-slug check.
    const out = await writer.write({
      kind: 'user', title: 'Deploy rule',
      summary: 'Deploys need a green pipeline, always', body: 'Reconfirmed.',
    }, noProject)

    expect(out.action).toBe('updated')
    expect(out.path).toBe('semantic/deploy-rule-for-staging.md')
  })

  it('does not match an unrelated note whose title shares only one word and whose body contains the rest', async () => {
    // Title shares "deploy" with the next write; "rule" only appears in this
    // note's BODY, never in its title. A title-column search that leaks the
    // second term unscoped (see note-writer.ts's findFtsMatch comment) would
    // wrongly treat this as the same note — its summary is also written to
    // overlap enough with the next write's to pass materiallySame(), so a
    // scoping bug here would silently merge two unrelated facts.
    await writer.write({
      kind: 'user', title: 'Deploy notes',
      summary: 'Deploys need a green pipeline',
      body: 'This note is actually about an unrelated rule for filing expense reports.',
    }, noProject)
    indexer.indexAll()

    const out = await writer.write({
      kind: 'user', title: 'Deploy rule',
      summary: 'Deploys need a green pipeline, confirmed',
      body: 'Green pipeline required before every deploy.',
    }, noProject)

    expect(out.action).toBe('created')
    expect(out.path).toBe('semantic/deploy-rule.md')

    // And the unrelated note must be untouched.
    const original = vault.read('semantic/deploy-notes.md')!
    expect(original.frontmatter.summary).toBe('Deploys need a green pipeline')
    expect(original.content).toContain('unrelated rule for filing expense reports')
  })

  // --- F1 deltas: scope and provenance ---

  it('routes a project note into the project folder with frozen scope', async () => {
    const out = await writer.write(
      { kind: 'project', title: 'Deploy rule', summary: 'Deploys need a green pipeline', body: 'Green pipeline first.' },
      { conversationId: 'c1', projectId: 'p1' })
    expect(out.path).toBe('projects/p1/deploy-rule.md')
    expect(vault.read(out.path)!.frontmatter.project).toBe('p1')
  })

  it('throws when a project note has no project to scope it to', async () => {
    // The schema already prevents this (createCandidateBatchSchema's
    // allowProject gate); this is the second lock, for any candidate that
    // reaches the writer some other way.
    await expect(writer.write(
      { kind: 'project', title: 'Orphan rule', summary: 'Has nowhere to live', body: 'No project.' },
      { conversationId: 'c1', projectId: null },
    )).rejects.toThrow()
  })

  // --- Final wave A: the dedup match must be the same NOTE, not a similar one ---

  it('never lets a project note eclipse an overlapping global note', async () => {
    // One shared title word plus 0.4 summary overlap used to be enough for a
    // project candidate to match a GLOBAL user note, rewrite it to
    // kind=project, and — with the scope frozen and no project frontmatter —
    // strand it under a NULL project_id: reachable from neither index, while
    // the run row read perfectly healthy.
    await writer.write(
      { kind: 'user', title: 'Deploy preferences', summary: 'Deploys need a green pipeline', body: 'Green first.' },
      noProject)
    indexer.indexAll()

    const out = await writer.write(
      { kind: 'project', title: 'Deploy preferences', summary: 'Deploys need a green pipeline', body: 'Green first.' },
      { conversationId: 'c2', projectId: 'p1' })

    expect(out.action).toBe('created')
    expect(out.path).toBe('projects/p1/deploy-preferences.md')
    expect(vault.read(out.path)!.frontmatter.project).toBe('p1')

    // The global note is untouched: still a user note, still global.
    const global = vault.read('semantic/deploy-preferences.md')!
    expect(global.frontmatter.kind).toBe('user')
    expect(global.frontmatter.project).toBeUndefined()
    expect(global.content).not.toContain('## History')
  })

  it('never lets a global note eclipse another project\'s note', async () => {
    await writer.write(
      { kind: 'project', title: 'Deploy preferences', summary: 'Deploys need a green pipeline', body: 'Green first.' },
      { conversationId: 'c1', projectId: 'p1' })
    indexer.indexAll()

    const out = await writer.write(
      { kind: 'user', title: 'Deploy preferences', summary: 'Deploys need a green pipeline', body: 'Green first.' },
      noProject)

    expect(out.path).toBe('semantic/deploy-preferences.md')
    expect(vault.read('projects/p1/deploy-preferences.md')!.frontmatter.kind).toBe('project')
  })

  it('never lets one project\'s note eclipse another project\'s', async () => {
    await writer.write(
      { kind: 'project', title: 'Deploy rule', summary: 'Deploys need a green pipeline', body: 'Green first.' },
      { conversationId: 'c1', projectId: 'p1' })
    indexer.indexAll()

    const out = await writer.write(
      { kind: 'project', title: 'Deploy rule', summary: 'Deploys need a green pipeline', body: 'Green first.' },
      { conversationId: 'c2', projectId: 'p2' })

    expect(out.action).toBe('created')
    expect(out.path).toBe('projects/p2/deploy-rule.md')
    expect(vault.read('projects/p1/deploy-rule.md')!.content).not.toContain('## History')
  })

  it('leaves a hand-written note alone rather than rewriting it', async () => {
    // An undeclared kind means nobody's capture wrote it — most likely a human
    // did, in Obsidian. Merging into it is the same eclipse in other clothes.
    vault.write('semantic/working-language.md',
      { title: 'Working language', tags: [], tier: 'semantic', links: [], created: '2026-01-01', updated: '2026-01-01' },
      'Written by hand.')
    indexer.indexAll()

    const out = await writer.write(candidate(), noProject)
    expect(out.action).toBe('created')
    expect(out.path).not.toBe('semantic/working-language.md')
    expect(vault.read('semantic/working-language.md')!.content).toContain('Written by hand.')
  })

  // --- Final wave B: the title is not display-only text ---

  it('sanitises the title, so no secret survives in the path or the index', async () => {
    // The title becomes the slug and therefore the file NAME. A redaction
    // applied to summary and body only left the secret where no read-time
    // redaction reaches it.
    const sanitizingWriter = createNoteWriter({
      db, vault, indexer,
      privacySanitize: async (text: string) => text.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[redacted]'),
    })
    const out = await sanitizingWriter.write(
      candidate({ title: 'Contact owner@example.com directly' }), noProject)

    expect(out.path).not.toContain('example')
    expect(out.path).not.toContain('owner')
    expect(vault.read(out.path)!.frontmatter.title).toBe('Contact [redacted] directly')
    const indexed = db.all(sql`SELECT path, title FROM vault_index WHERE path = ${out.path}`) as any[]
    expect(indexed[0].title).not.toContain('owner@example.com')
  })

  it('records a provenance link on create and on update, without duplicates', async () => {
    const c = { kind: 'user' as const, title: 'Language', summary: 'Answers in Hungarian', body: 'Hungarian.' }
    await writer.write(c, { conversationId: 'c1', projectId: null })
    indexer.indexAll()
    await writer.write({ ...c, body: 'Confirmed.' }, { conversationId: 'c2', projectId: null })
    await writer.write({ ...c, body: 'Again.' }, { conversationId: 'c2', projectId: null })
    const rows = db.all(sql`SELECT owner_id FROM memory_note_links WHERE note_path = 'semantic/language.md' ORDER BY owner_id`) as any[]
    expect(rows.map((r: any) => r.owner_id)).toEqual(['c1', 'c2'])
  })
})

// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createVaultService } from '@modules/memory/vault/vault-service'
import {
  applyMemoryItem,
  contentSha,
  folderForKind,
  slugFromSource,
  freeVaultPath,
  walkCollisionChain,
} from '@modules/data-port/pipeline/apply'
import { safeImportedKind } from '@modules/data-port/pipeline/transform'
import type { MemoryTransformResult } from '@modules/data-port/types'

const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex')

const T = (over: Partial<MemoryTransformResult> = {}): MemoryTransformResult => ({
  kind: 'reference',
  title: 'Alpha Note',
  body: 'Body one.',
  tags: ['x'],
  links: ['beta'],
  aliases: ['alpha_note'],
  salience: 0.7,
  summary_one_line: 'Alpha',
  created: '2026-05-01',
  updated: '2026-08-01',
  source: { profile: 'claude-code', path: 'ai-memory/alpha_note.md', frontmatter: { type: 'reference' } },
  ...over,
})

/**
 * The vault as apply sees it: a store of bodies WITH their frontmatter, because
 * the import job of an already-stored note is read off its tags. Seeding with a
 * bare string is the frontmatter-less case a hand-written note presents.
 */
type StoredNote = string | { content: string; frontmatter?: Record<string, unknown> }

function vaultMock(existing: Record<string, StoredNote> = {}) {
  const written: Array<{ path: string; fm: Record<string, unknown>; body: string; content: string }> = []
  const entry = (v: StoredNote) => (typeof v === 'string' ? { content: v, frontmatter: {} } : { frontmatter: {}, ...v })
  return {
    written,
    vault: {
      write: (path: string, fm: Record<string, unknown>, body: string) => {
        written.push({ path, fm, body, content: body })
        // Faithful to the real writer: a body with no trailing newline gets
        // exactly one, and that is the only change it ever makes (R11.5).
        existing[path] = { content: body.endsWith('\n') ? body : `${body}\n`, frontmatter: fm }
      },
      exists: (path: string) => path in existing,
      read: (path: string) => (path in existing ? entry(existing[path]!) : null),
    },
  }
}
const base = { createProposal: () => 'p', resolveDefaultAgentId: () => 'a' }

describe('kind clamping', () => {
  it('clamps unknown kind to reference and never invents user', () => {
    expect(safeImportedKind(undefined)).toBe('reference')
    expect(safeImportedKind('owner')).toBe('reference')
    expect(safeImportedKind('user')).toBe('user')
    expect(safeImportedKind('feedback')).toBe('feedback')
  })
})

describe('folder and slug rules', () => {
  it('files feedback under procedural, others under semantic, scoped project under projects/<id>', () => {
    expect(folderForKind('feedback')).toBe('procedural')
    expect(folderForKind('user')).toBe('semantic')
    expect(folderForKind('project')).toBe('semantic')
    expect(folderForKind('project', { projectId: 'p1' })).toBe('projects/p1')
    expect(folderForKind('domain', { projectTypeId: 'alpha' })).toBe('project-types/alpha')
  })

  it('keeps a scoped folder to one path segment', () => {
    expect(folderForKind('project', { projectId: '../../etc/passwd' })).toBe('projects/etc-passwd')
    // A scope id that sanitises away is no scope at all — never `projects/..`.
    expect(folderForKind('project', { projectId: '..' })).toBe('semantic')
    expect(folderForKind('domain', { projectTypeId: '.' })).toBe('semantic')
  })

  it('uses the source basename as the slug so wikilinks resolve', () => {
    expect(slugFromSource('ai-memory/feedback_no_auto_commit.md', 'No auto commit', null)).toBe(
      'feedback_no_auto_commit',
    )
    expect(slugFromSource('.codex/memories_1.sqlite', 'bun-setup', 't1')).toBe('memories_1-t1')
    expect(slugFromSource('x/Weird name (1).md', 'W', null)).toBe('Weird-name-1')
  })

  it('keeps non-ASCII letters and is stable across calls and normal forms', () => {
    const nfc = 'x/Árvíztűrő tükörfúrógép.md'.normalize('NFC')
    const nfd = 'x/Árvíztűrő tükörfúrógép.md'.normalize('NFD')
    expect(slugFromSource(nfc, 'T', null)).toBe('Árvíztűrő-tükörfúrógép'.normalize('NFC'))
    expect(slugFromSource(nfd, 'T', null)).toBe(slugFromSource(nfc, 'T', null))
    expect(slugFromSource('x/日本語のノート.md', 'T', null)).toBe('日本語のノート')
  })

  it('falls back to a deterministic hash slug when nothing survives sanitising', () => {
    const first = slugFromSource('x/###.md', 'Title', null)
    const second = slugFromSource('x/###.md', 'Title', null)
    expect(first).toBe(second)
    expect(first).toMatch(/^note-[0-9a-f]{12}$/)
    // Different source paths must not collide on the same fallback slug.
    expect(slugFromSource('y/###.md', 'Title', null)).not.toBe(first)
  })

  it('finds the next free path without overwriting', () => {
    const v = { exists: (p: string) => ['semantic/a.md', 'semantic/a-2.md'].includes(p) }
    expect(freeVaultPath(v, 'semantic', 'a')).toBe('semantic/a-3.md')
  })

  it('gives up rather than spinning when every path in the capped chain is taken', () => {
    expect(freeVaultPath({ exists: () => true }, 'semantic', 'a')).toBeNull()
  })
})

describe('applyMemoryItem — collision walk cap', () => {
  it('reports an error instead of spinning on a vault that answers every path', async () => {
    const r = await applyMemoryItem(
      {
        ...base,
        vault: {
          exists: () => true,
          // Never the same body, so the walk never short-circuits on a match.
          read: () => ({ content: 'something else' }),
          write: () => {
            throw new Error('must not write')
          },
        },
      },
      {
        jobId: 'j1',
        sourceProfile: 'claude-code',
        target: 'vault.semantic',
        relativePath: 'notes/a.md',
        transformed: T(),
      },
    )
    expect(r).toEqual({ status: 'error', error: 'id collision walk exhausted', reasonCode: 'error' })
  })
})

/**
 * A5 — an earlier import's `-2` may have been deleted while its `-3` still
 * stands. Stopping at the first free slot would then miss the note that IS this
 * item and write a fourth copy of it on every rescan, forever.
 */
describe('walkCollisionChain', () => {
  const walkOver = (taken: Record<string, string>, body: string) =>
    walkCollisionChain<string>(
      (n) => (n === 1 ? 'a' : `a-${n}`),
      (name) =>
        name in taken
          ? taken[name] === body
            ? { taken: true, hit: name }
            : { taken: true }
          : { taken: false },
    )

  it('looks past a hole in the chain and finds the slot that already holds this item', () => {
    // `a` is someone else's, `a-2` was deleted, `a-3` is this exact note.
    expect(walkOver({ a: 'other', 'a-3': 'mine' }, 'mine')).toEqual({ hit: 'a-3', free: 'a-2' })
  })

  it('offers the first free slot when nothing in the chain matches', () => {
    expect(walkOver({ a: 'other', 'a-3': 'different' }, 'mine')).toEqual({ free: 'a-2' })
  })

  it('stops at two empty slots in a row rather than walking to the cap', () => {
    let probes = 0
    const out = walkCollisionChain<string>(
      (n) => `a-${n}`,
      (name) => {
        probes++
        return name === 'a-1' ? { taken: true } : { taken: false }
      },
    )
    expect(out).toEqual({ free: 'a-2' })
    expect(probes).toBe(3)
  })
})

describe('applyMemoryItem', () => {
  it('writes the verbatim body with kind, tier, aliases, dates and provenance', async () => {
    const { vault, written } = vaultMock()
    const r = await applyMemoryItem(
      { ...base, vault },
      {
        jobId: 'j1',
        sourceProfile: 'claude-code',
        target: 'vault.semantic',
        transformed: T({ kind: 'feedback' }),
        relativePath: 'ai-memory/alpha_note.md',
      },
    )
    // The digest of what was written travels back to the ledger, so a rollback
    // can tell an untouched note from one the owner has edited since.
    expect(r).toEqual({
      status: 'applied',
      kind: 'vault.procedural',
      ref: 'procedural/alpha_note.md',
      sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    })
    expect(written[0].body).toBe('Body one.')
    expect(written[0].fm).toMatchObject({
      title: 'Alpha Note',
      tier: 'procedural',
      kind: 'feedback',
      summary: 'Alpha',
      aliases: ['alpha_note'],
      links: ['beta'],
      created: '2026-05-01',
      updated: '2026-08-01',
    })
    expect(written[0].fm.tags).toEqual(
      expect.arrayContaining(['imported', 'source:claude-code', 'import-job:j1', 'x']),
    )
    expect((written[0].fm.source as Record<string, unknown>).frontmatter).toEqual({ type: 'reference' })
  })

  it('never puts an undefined value in the frontmatter', async () => {
    const { vault, written } = vaultMock()
    await applyMemoryItem(
      { ...base, vault },
      {
        jobId: 'j1',
        sourceProfile: 'claude-code',
        target: 'vault.semantic',
        transformed: T({ aliases: [], summary_one_line: '', created: null, updated: null }),
        relativePath: 'ai-memory/alpha_note.md',
      },
    )
    const fm = written[0].fm
    expect(Object.values(fm).every((v) => v !== undefined)).toBe(true)
    expect('aliases' in fm).toBe(false)
    expect('summary' in fm).toBe(false)
    expect('project' in fm).toBe(false)
    expect(typeof fm.created).toBe('string')
    expect(typeof fm.updated).toBe('string')
  })

  it('writes the declared scope into the folder and the frontmatter', async () => {
    const { vault, written } = vaultMock()
    const r = await applyMemoryItem(
      { ...base, vault },
      {
        jobId: 'j1',
        sourceProfile: 'claude-code',
        target: 'vault.semantic',
        transformed: T({ kind: 'project' }),
        relativePath: 'ai-memory/alpha_note.md',
        scope: { projectId: 'p1', projectTypeId: null },
      },
    )
    expect(r).toMatchObject({ status: 'applied', ref: 'projects/p1/alpha_note.md' })
    expect(written[0].fm).toMatchObject({ project: 'p1', tier: 'semantic' })
    expect('projectType' in written[0].fm).toBe(false)
  })

  it('reports unchanged when the same body already sits at the path', async () => {
    const { vault, written } = vaultMock({ 'semantic/alpha_note.md': 'Body one.' })
    const r = await applyMemoryItem(
      { ...base, vault },
      {
        jobId: 'j1',
        sourceProfile: 'claude-code',
        target: 'vault.semantic',
        transformed: T(),
        relativePath: 'ai-memory/alpha_note.md',
      },
    )
    expect(r).toEqual({
      status: 'unchanged',
      ref: 'semantic/alpha_note.md',
      importJobId: null,
      sha256: sha256('Body one.'),
    })
    expect(written).toHaveLength(0)
  })

  it('writes a -2 sibling with a conflict tag when the path holds a different body', async () => {
    const { vault, written } = vaultMock({ 'semantic/alpha_note.md': 'Other body.' })
    const r = await applyMemoryItem(
      { ...base, vault },
      {
        jobId: 'j1',
        sourceProfile: 'claude-code',
        target: 'vault.semantic',
        transformed: T(),
        relativePath: 'ai-memory/alpha_note.md',
      },
    )
    expect(r).toMatchObject({ status: 'applied', ref: 'semantic/alpha_note-2.md' })
    expect(written[0].fm.tags).toContain('conflict-with:semantic/alpha_note.md')
  })

  it('walks past a deleted sibling to the one that still holds the body', async () => {
    // The gap case: an earlier import parked this body on `-3`, and whoever
    // deleted `-2` left a hole in the chain. Stopping at the hole would add a
    // second copy of a note that is already there — on every future re-import.
    const { vault, written } = vaultMock({
      'semantic/alpha_note.md': 'Other body.',
      'semantic/alpha_note-3.md': 'Body one.',
    })
    const r = await applyMemoryItem(
      { ...base, vault },
      {
        jobId: 'j1',
        sourceProfile: 'claude-code',
        target: 'vault.semantic',
        transformed: T(),
        relativePath: 'ai-memory/alpha_note.md',
      },
    )
    expect(r).toEqual({
      status: 'unchanged',
      ref: 'semantic/alpha_note-3.md',
      importJobId: null,
      sha256: sha256('Body one.'),
    })
    expect(written).toHaveLength(0)
  })

  it('still fills the hole in the chain when nothing in it holds this body', async () => {
    const { vault, written } = vaultMock({
      'semantic/alpha_note.md': 'Other body.',
      'semantic/alpha_note-3.md': 'A third body.',
    })
    const r = await applyMemoryItem(
      { ...base, vault },
      {
        jobId: 'j1',
        sourceProfile: 'claude-code',
        target: 'vault.semantic',
        transformed: T(),
        relativePath: 'ai-memory/alpha_note.md',
      },
    )
    // The first free slot is still the first free slot; the walk only looks
    // further, it does not file further away.
    expect(r).toMatchObject({ status: 'applied', ref: 'semantic/alpha_note-2.md' })
    expect(written).toHaveLength(1)
  })

  it('records the digest of the body it wrote, so a rollback can tell it apart from an edit', async () => {
    const { vault } = vaultMock()
    const r = await applyMemoryItem(
      { ...base, vault },
      {
        jobId: 'j1',
        sourceProfile: 'claude-code',
        target: 'vault.semantic',
        transformed: T(),
        relativePath: 'ai-memory/alpha_note.md',
      },
    )
    // Over the body exactly as written — no trim (R11.5).
    expect(r).toMatchObject({ status: 'applied', sha256: sha256('Body one.') })
  })

  describe('a scope id this instance does not have', () => {
    const scopeExists = { project: (id: string) => id === 'known', projectType: (id: string) => id === 'known-type' }

    it('files a note under a declared project only when that project exists', async () => {
      const { vault, written } = vaultMock()
      const r = await applyMemoryItem(
        { ...base, vault, scopeExists },
        {
          jobId: 'j1',
          sourceProfile: 'claude-code',
          target: 'vault.semantic',
          transformed: T({ kind: 'project' }),
          relativePath: 'ai-memory/alpha_note.md',
          scope: { projectId: 'known' },
        },
      )
      expect(r).toMatchObject({ status: 'applied', ref: 'projects/known/alpha_note.md' })
      expect(written[0].fm).toMatchObject({ project: 'known' })
    })

    it('keeps an unknown project id as a tag instead of hiding the note under it', async () => {
      const { vault, written } = vaultMock()
      const r = await applyMemoryItem(
        { ...base, vault, scopeExists },
        {
          jobId: 'j1',
          sourceProfile: 'claude-code',
          target: 'vault.semantic',
          transformed: T({ kind: 'project' }),
          relativePath: 'ai-memory/alpha_note.md',
          scope: { projectId: 'from-another-install' },
        },
      )
      // Unscoped, so recall still finds it; the declared id is on the row and in
      // the source frontmatter, so the owner can still see what it asked for.
      expect(r).toMatchObject({ status: 'applied', ref: 'semantic/alpha_note.md' })
      expect(written[0].fm.tags).toContain('declared-project:from-another-install')
      expect('project' in written[0].fm).toBe(false)
      // What the source asked for is still readable, verbatim.
      expect((written[0].fm.source as Record<string, unknown>).frontmatter).toEqual({
        type: 'reference',
      })
    })

    it('does the same for an unknown project type', async () => {
      const { vault, written } = vaultMock()
      const r = await applyMemoryItem(
        { ...base, vault, scopeExists },
        {
          jobId: 'j1',
          sourceProfile: 'claude-code',
          target: 'vault.semantic',
          transformed: T({ kind: 'domain' }),
          relativePath: 'ai-memory/alpha_note.md',
          scope: { projectTypeId: 'unknown-type' },
        },
      )
      expect(r).toMatchObject({ status: 'applied', ref: 'semantic/alpha_note.md' })
      expect(written[0].fm.tags).toContain('declared-project-type:unknown-type')
      expect('projectType' in written[0].fm).toBe(false)
    })

    it('trusts the declaration when there is no resolver to ask', async () => {
      const { vault, written } = vaultMock()
      const r = await applyMemoryItem(
        { ...base, vault },
        {
          jobId: 'j1',
          sourceProfile: 'claude-code',
          target: 'vault.semantic',
          transformed: T({ kind: 'project' }),
          relativePath: 'ai-memory/alpha_note.md',
          scope: { projectId: 'p1' },
        },
      )
      expect(r).toMatchObject({ status: 'applied', ref: 'projects/p1/alpha_note.md' })
      expect(written[0].fm).toMatchObject({ project: 'p1' })
    })
  })

  it('walks the collision chain and reports unchanged when a sibling already holds the body', async () => {
    const { vault, written } = vaultMock({
      'semantic/alpha_note.md': 'Other body.',
      'semantic/alpha_note-2.md': 'Body one.',
    })
    const r = await applyMemoryItem(
      { ...base, vault },
      {
        jobId: 'j1',
        sourceProfile: 'claude-code',
        target: 'vault.semantic',
        transformed: T(),
        relativePath: 'ai-memory/alpha_note.md',
      },
    )
    expect(r).toEqual({
      status: 'unchanged',
      ref: 'semantic/alpha_note-2.md',
      importJobId: null,
      sha256: sha256('Body one.'),
    })
    expect(written).toHaveLength(0)
  })

  it('re-running the same import twice writes once', async () => {
    const { vault, written } = vaultMock()
    const input = {
      jobId: 'j1',
      sourceProfile: 'claude-code' as const,
      target: 'vault.semantic' as const,
      transformed: T(),
      relativePath: 'ai-memory/alpha_note.md',
    }
    const first = await applyMemoryItem({ ...base, vault }, input)
    const second = await applyMemoryItem({ ...base, vault }, input)
    expect(first).toMatchObject({ status: 'applied', ref: 'semantic/alpha_note.md' })
    // The second run names the job that wrote it, read off the note's own tags.
    expect(second).toEqual({
      status: 'unchanged',
      ref: 'semantic/alpha_note.md',
      importJobId: 'j1',
      sha256: sha256('Body one.'),
    })
    expect(written).toHaveLength(1)
  })

  it('imports MEMORY.md as one note tagged index', async () => {
    const { vault, written } = vaultMock()
    const r = await applyMemoryItem(
      { ...base, vault },
      {
        jobId: 'j1',
        sourceProfile: 'grok-cli',
        target: 'vault.semantic',
        transformed: T({ title: 'Memory Index', body: '- [a](a.md)\n- [b](b.md)' }),
        relativePath: '.grok/memory/MEMORY.md',
      },
    )
    expect(r).toMatchObject({ status: 'applied', ref: 'semantic/memory-index-grok-cli.md' })
    expect(written[0].fm.tags).toContain('index')
  })

  it('names a nested index after its parent folder so per-project indexes do not collide', async () => {
    const { vault, written } = vaultMock()
    const r = await applyMemoryItem(
      { ...base, vault },
      {
        jobId: 'j1',
        sourceProfile: 'grok-cli',
        target: 'vault.semantic',
        transformed: T({ title: 'Memory Index', body: '- [a](a.md)' }),
        relativePath: '.grok/memory/alpha-project/MEMORY.md',
      },
    )
    expect(r).toMatchObject({
      status: 'applied',
      ref: 'semantic/memory-index-grok-cli-alpha-project.md',
    })
    expect(written[0].fm.tags).toContain('index')
  })

  it('names a Claude Code per-project index after the project, not its memory folder', async () => {
    const { vault, written } = vaultMock()
    const index = (relativePath: string) => ({
      jobId: 'j1',
      sourceProfile: 'claude-code' as const,
      target: 'vault.semantic' as const,
      transformed: T({ title: 'Memory Index', body: `- [a](a.md) for ${relativePath}` }),
      relativePath,
    })

    const first = await applyMemoryItem(
      { ...base, vault },
      index('.claude/projects/alpha-app/memory/MEMORY.md'),
    )
    const second = await applyMemoryItem(
      { ...base, vault },
      index('.claude/projects/beta-app/memory/MEMORY.md'),
    )

    expect(first).toMatchObject({ ref: 'semantic/memory-index-claude-code-alpha-app.md' })
    expect(second).toMatchObject({ ref: 'semantic/memory-index-claude-code-beta-app.md' })
    // Two projects, two notes: neither is a collision sibling of the other.
    expect(written).toHaveLength(2)
    for (const w of written) {
      expect(w.fm.tags).not.toContain(`conflict-with:${w.path}`)
      expect((w.fm.tags as string[]).some((t) => t.startsWith('conflict-with:'))).toBe(false)
    }
  })

  it('treats an index at the root of its tree as the root index', async () => {
    const { vault } = vaultMock()
    const r = await applyMemoryItem(
      { ...base, vault },
      {
        jobId: 'j1',
        sourceProfile: 'claude-code',
        target: 'vault.semantic',
        transformed: T({ title: 'Memory Index', body: '- [a](a.md)' }),
        relativePath: 'ai-memory/MEMORY.md',
      },
    )
    expect(r).toMatchObject({ ref: 'semantic/memory-index-claude-code.md' })
  })

  it('creates an episodic row for sessions with validFrom, the session tag and a content sha', async () => {
    const calls: Array<Record<string, unknown>> = []
    const episodic = {
      create: (i: Record<string, unknown>) => {
        calls.push(i)
        return { id: 'e1' }
      },
    }
    const r = await applyMemoryItem(
      { ...base, episodic },
      {
        jobId: 'j1',
        sourceProfile: 'obsidian',
        target: 'episodic',
        transformed: T({ body: 'log body' }),
        relativePath: 'claude-sessions/x.md',
        sessionId: 'abc',
        sessionDate: '2026-09-05T11:06:00.000Z',
      },
    )
    expect(r).toEqual({ status: 'applied', kind: 'episodic', ref: 'e1', sha256: sha256('log body') })
    expect(calls[0]).toMatchObject({
      content: 'log body',
      sourceType: 'system',
      sourceId: 'import:j1',
      validFrom: '2026-09-05T11:06:00.000Z',
      // No model call on the import path: the row is embedded later.
      embed: false,
    })
    const sha = createHash('sha256').update('log body').digest('hex')
    expect(calls[0].tags).toEqual(
      expect.arrayContaining(['imported', 'source:obsidian', 'import-job:j1', 'session:abc', `sha:${sha}`]),
    )
  })

  it('reports unchanged when an episodic row with the same content sha was already imported', async () => {
    const calls: Array<Record<string, unknown>> = []
    const seen: string[] = []
    const sha = createHash('sha256').update('log body').digest('hex')
    const episodic = {
      create: (i: Record<string, unknown>) => {
        calls.push(i)
        return { id: 'e2' }
      },
      findImported: (s: string) => {
        seen.push(s)
        return s === sha ? { id: 'e1' } : null
      },
    }
    const r = await applyMemoryItem(
      { ...base, episodic },
      {
        jobId: 'j1',
        sourceProfile: 'obsidian',
        target: 'episodic',
        transformed: T({ body: 'log body' }),
        relativePath: 'claude-sessions/x.md',
      },
    )
    expect(r).toEqual({ status: 'unchanged', ref: 'e1', importJobId: null, sha256: sha })
    expect(calls).toHaveLength(0)
    // The verbatim digest is asked for FIRST, and it hit — no legacy lookup.
    expect(seen).toEqual([sha])
  })

  it('skips an empty body and reports a missing service rather than throwing', async () => {
    const { vault } = vaultMock()
    const empty = await applyMemoryItem(
      { ...base, vault },
      {
        jobId: 'j1',
        sourceProfile: 'claude-code',
        target: 'vault.semantic',
        transformed: T({ body: '   ' }),
        relativePath: 'ai-memory/alpha_note.md',
      },
    )
    expect(empty).toEqual({ status: 'skipped', reason: 'empty body', reasonCode: 'empty' })

    const noVault = await applyMemoryItem(base, {
      jobId: 'j1',
      sourceProfile: 'claude-code',
      target: 'vault.semantic',
      transformed: T(),
      relativePath: 'ai-memory/alpha_note.md',
    })
    expect(noVault).toEqual({ status: 'skipped', reason: 'vault service unavailable', reasonCode: 'service-unavailable' })
  })

  it('warns exactly once per process when it cannot read the vault back', async () => {
    const warnings: Array<{ o: unknown; m?: string }> = []
    const logger = { warn: (o: unknown, m?: string) => warnings.push({ o, m }) }
    // No `read`: the walk can find a free path but can never recognise its own work.
    const writeOnly = {
      write: () => {},
      exists: (p: string) => p === 'semantic/alpha_note.md',
    }
    const item = {
      jobId: 'j1',
      sourceProfile: 'claude-code' as const,
      target: 'vault.semantic' as const,
      transformed: T(),
      relativePath: 'ai-memory/alpha_note.md',
    }

    const first = await applyMemoryItem({ ...base, vault: writeOnly, logger }, item)
    const second = await applyMemoryItem({ ...base, vault: writeOnly, logger }, item)

    expect(first).toMatchObject({ status: 'applied', ref: 'semantic/alpha_note-2.md' })
    expect(second).toMatchObject({ status: 'applied', ref: 'semantic/alpha_note-2.md' })
    expect(warnings).toHaveLength(1)
    expect(warnings[0].m).toMatch(/vault\.read is unavailable/)
  })

  it('writes a body with leading and trailing blank lines byte for byte and returns its verbatim digest', async () => {
    const { vault, written } = vaultMock()
    const body = '\n\nBody.\n\n\n'
    const r = await applyMemoryItem(
      { ...base, vault },
      {
        jobId: 'j',
        sourceProfile: 'claude-code',
        adapterId: 'grok-cli',
        target: 'vault.semantic',
        transformed: T({
          body,
          tags: ['legacy'],
          source: { profile: 'claude-code', adapter: 'grok-cli', path: 'x.md' },
        }),
        relativePath: 'x.md',
      },
    )
    expect(r).toMatchObject({ status: 'applied', sha256: sha256(body) })
    expect(written[0].content).toBe(body)
    // The adapter that read the file wins the `source:` tag; the job's own
    // profile is kept beside it, so neither fact is lost (R11.6).
    expect(written[0].fm.tags).toEqual(
      expect.arrayContaining(['source:grok-cli', 'source-profile:claude-code', 'legacy']),
    )
    expect((written[0].fm.source as Record<string, unknown>).adapter).toBe('grok-cli')
  })

  it('re-stamps a note an earlier import wrote trimmed, on its own path, keeping its job tag', async () => {
    // A-24 — the trimmed bytes are the pre-amendment ones. They match only
    // through `legacyBody`, which proves identity and not freshness, so the
    // verbatim body is stamped over them instead of being reported `unchanged`.
    const { vault, written } = vaultMock({
      'semantic/x.md': { content: 'Body.', frontmatter: { title: 'X', tags: ['import-job:old'] } },
    })
    const r = await applyMemoryItem(
      { ...base, vault },
      {
        jobId: 'j',
        sourceProfile: 'obsidian',
        target: 'vault.semantic',
        transformed: T({ body: '\n\nBody.\n\n\n' }),
        relativePath: 'x.md',
      },
    )
    expect(r).toMatchObject({
      status: 'applied',
      ref: 'semantic/x.md',
      sha256: sha256('\n\nBody.\n\n\n'),
    })
    // The same note, not a second copy and not a `-2` sibling.
    expect(written).toHaveLength(1)
    expect(written[0].path).toBe('semantic/x.md')
    expect(written[0].content).toBe('\n\nBody.\n\n\n')
    // Its own frontmatter survives the re-stamp.
    expect(written[0].fm.title).toBe('X')
    expect(written[0].fm.tags).toContain('import-job:old')
  })

  it('reports a note it wrote itself as unchanged on the very next run', async () => {
    const { vault, written } = vaultMock()
    const item = {
      jobId: 'j',
      sourceProfile: 'obsidian' as const,
      target: 'vault.semantic' as const,
      transformed: T({ body: '\n\nBody.\n\n\n' }),
      relativePath: 'x.md',
    }
    expect(await applyMemoryItem({ ...base, vault }, item)).toMatchObject({ status: 'applied' })
    expect(await applyMemoryItem({ ...base, vault }, item)).toMatchObject({
      status: 'unchanged',
      ref: 'semantic/x.md',
      importJobId: 'j',
      sha256: sha256('\n\nBody.\n\n\n'),
    })
    expect(written).toHaveLength(1)
  })

  it('re-stamps a whitespace-only edit instead of calling it unchanged', async () => {
    // The case a tolerant compare loses for ever: same words, different bytes.
    const { vault, written } = vaultMock()
    const first = {
      jobId: 'j',
      sourceProfile: 'obsidian' as const,
      target: 'vault.semantic' as const,
      transformed: T({ body: 'Body.\n' }),
      relativePath: 'x.md',
    }
    await applyMemoryItem({ ...base, vault }, first)
    const r = await applyMemoryItem(
      { ...base, vault },
      { ...first, transformed: T({ body: '\n\nBody.\n\n\n' }) },
    )
    expect(r).toMatchObject({
      status: 'applied',
      ref: 'semantic/x.md',
      sha256: sha256('\n\nBody.\n\n\n'),
    })
    expect(written).toHaveLength(2)
    expect(written[1].path).toBe('semantic/x.md')
    expect(written[1].content).toBe('\n\nBody.\n\n\n')
  })

  it('tolerates the vault writer\'s appended newline rather than re-stamping on it', async () => {
    // The writer adds one trailing newline to a body that has none. That is its
    // own documented normalisation, not an edit — and a re-stamp on every run
    // would be an endless rewrite of an untouched note.
    const { vault, written } = vaultMock({
      'semantic/x.md': { content: 'Body.\n', frontmatter: { tags: ['import-job:old'] } },
    })
    const r = await applyMemoryItem(
      { ...base, vault },
      {
        jobId: 'j',
        sourceProfile: 'obsidian',
        target: 'vault.semantic',
        transformed: T({ body: 'Body.' }),
        relativePath: 'x.md',
      },
    )
    expect(r).toMatchObject({ status: 'unchanged', ref: 'semantic/x.md', importJobId: 'old' })
    expect(written).toHaveLength(0)
  })

  it('tags contains-secrets on the vault note and the episodic row', async () => {
    const { vault, written } = vaultMock()
    const episodicCalls: Array<Record<string, unknown>> = []
    const episodic = {
      create: (i: Record<string, unknown>) => {
        episodicCalls.push(i)
        return { id: 'e1' }
      },
    }
    await applyMemoryItem(
      { ...base, vault, episodic },
      {
        jobId: 'j',
        sourceProfile: 'obsidian',
        target: 'vault.semantic',
        transformed: T({ body: 'k', tags: ['contains-secrets'] }),
        relativePath: 'k.md',
      },
    )
    expect(written.at(-1)!.fm.tags).toContain('contains-secrets')

    await applyMemoryItem(
      { ...base, vault, episodic },
      {
        jobId: 'j',
        sourceProfile: 'obsidian',
        target: 'episodic',
        transformed: T({ body: 'k2', tags: ['contains-secrets'] }),
      },
    )
    expect(episodicCalls.at(-1)!.tags).toContain('contains-secrets')
    expect(episodicCalls.at(-1)!.embed).toBe(false)
  })

  it('re-tags a stored note the recompute now says holds a credential, without duplicating it', async () => {
    // A-8b — the note is already there, byte for byte, but the earlier import
    // never tagged it. `unchanged` would leave a credential in recall for ever.
    const { vault, written } = vaultMock({
      'semantic/k.md': { content: 'k', frontmatter: { title: 'K', tags: ['imported', 'import-job:old'] } },
    })
    const r = await applyMemoryItem(
      { ...base, vault },
      {
        jobId: 'j',
        sourceProfile: 'obsidian',
        target: 'vault.semantic',
        transformed: T({ body: 'k', tags: ['contains-secrets'] }),
        relativePath: 'k.md',
      },
    )
    expect(r).toMatchObject({ status: 'applied', ref: 'semantic/k.md' })
    expect(written).toHaveLength(1)
    // Same path, same body, the note's own frontmatter kept — only the tag is new.
    expect(written[0].path).toBe('semantic/k.md')
    expect(written[0].content).toBe('k')
    expect(written[0].fm.title).toBe('K')
    expect(written[0].fm.tags).toEqual(expect.arrayContaining(['import-job:old', 'contains-secrets']))
    // What the note itself declared wins over what this run would have written.
    expect(written[0].fm.tags).not.toContain('import-job:j')
  })

  it('falls back to the legacy trimmed digest and tags the verbatim one on a new row', async () => {
    const legacySha = sha256('Body.')
    const verbatim = sha256('\nBody.\n')
    const calls: Array<Record<string, unknown>> = []
    let answer: (s: string) => { id: string; sourceId?: string } | null = (s) =>
      s === legacySha ? { id: 'e1', sourceId: 'import:old' } : null
    const episodic = {
      create: (i: Record<string, unknown>) => {
        calls.push(i)
        return { id: 'e2' }
      },
      findImported: (s: string) => answer(s),
    }
    expect(
      await applyMemoryItem(
        { ...base, episodic },
        { jobId: 'j', sourceProfile: 'obsidian', target: 'episodic', transformed: T({ body: '\nBody.\n' }) },
      ),
    ).toMatchObject({ status: 'unchanged', ref: 'e1', importJobId: 'old' })
    expect(calls).toHaveLength(0)

    answer = () => null
    const r = await applyMemoryItem(
      { ...base, episodic },
      {
        jobId: 'j',
        sourceProfile: 'obsidian',
        target: 'episodic',
        transformed: T({ body: '\nBody.\n' }),
        kindTag: 'transcript',
        part: { n: 1, of: 2 },
      },
    )
    expect(r).toMatchObject({ status: 'applied', sha256: verbatim })
    expect(calls.at(-1)!.tags).toEqual(
      expect.arrayContaining([`sha:${verbatim}`, 'transcript', 'session-part:1/2']),
    )
  })

  it('re-stamps the verbatim bytes over a row found only by its legacy digest', async () => {
    // A-24 — the legacy digest is many-to-one, so a hit through it means "the
    // same item", never "the stored bytes are current".
    const legacySha = sha256('Body.')
    const verbatim = sha256('\nBody.\n\n')
    const restamped: Array<{ id: string; input: Record<string, unknown> }> = []
    const episodic = {
      create: () => {
        throw new Error('must not create a second row')
      },
      findImported: (s: string) => (s === legacySha ? { id: 'e1', sourceId: 'import:old', tags: [] } : null),
      restamp: (id: string, input: Record<string, unknown>) => restamped.push({ id, input }),
    }
    const r = await applyMemoryItem(
      { ...base, episodic },
      { jobId: 'j', sourceProfile: 'obsidian', target: 'episodic', transformed: T({ body: '\nBody.\n\n' }) },
    )
    expect(r).toEqual({ status: 'applied', kind: 'episodic', ref: 'e1', sha256: verbatim })
    expect(restamped).toHaveLength(1)
    expect(restamped[0]).toMatchObject({ id: 'e1', input: { content: '\nBody.\n\n', sha: verbatim } })
  })

  it('re-tags a byte-identical episodic row that is missing the secrets tag', async () => {
    const sha = sha256('k')
    const restamped: Array<{ id: string; input: Record<string, unknown> }> = []
    const episodic = {
      create: () => {
        throw new Error('must not create a second row')
      },
      findImported: (s: string) => (s === sha ? { id: 'e1', sourceId: 'import:old', tags: ['imported'] } : null),
      restamp: (id: string, input: Record<string, unknown>) => restamped.push({ id, input }),
    }
    const r = await applyMemoryItem(
      { ...base, episodic },
      {
        jobId: 'j',
        sourceProfile: 'obsidian',
        target: 'episodic',
        transformed: T({ body: 'k', tags: ['contains-secrets'] }),
      },
    )
    expect(r).toEqual({ status: 'applied', kind: 'episodic', ref: 'e1', sha256: sha })
    expect(restamped[0].input.addTags).toContain('contains-secrets')
  })

  it('reports unchanged rather than duplicating when no re-stamp is wired', async () => {
    const legacySha = sha256('Body.')
    const episodic = {
      create: () => {
        throw new Error('must not create a second row')
      },
      findImported: (s: string) => (s === legacySha ? { id: 'e1', sourceId: 'import:old' } : null),
    }
    expect(
      await applyMemoryItem(
        { ...base, episodic },
        { jobId: 'j', sourceProfile: 'obsidian', target: 'episodic', transformed: T({ body: '\nBody.\n' }) },
      ),
    ).toEqual({ status: 'unchanged', ref: 'e1', importJobId: 'old', sha256: legacySha })
  })

  it('imports a container unit under its own slug', async () => {
    const { vault, written } = vaultMock()
    const r = await applyMemoryItem(
      { ...base, vault },
      {
        jobId: 'j1',
        sourceProfile: 'codex',
        target: 'vault.semantic',
        transformed: T({ title: 'Bun setup' }),
        relativePath: '.codex/memories_1.sqlite',
        unit: 't1',
      },
    )
    expect(r).toMatchObject({ status: 'applied', ref: 'semantic/memories_1-t1.md' })
    expect(written[0].body).toBe('Body one.')
  })
})

/**
 * The REAL vault service, not a double. R11.5 is a property of the round trip —
 * writer, file, reader — and a mock that models the writer correctly still
 * cannot prove the reader agrees with it.
 */
describe('applyMemoryItem — round trip through the real vault', () => {
  let vaultPath: string
  let deps: Parameters<typeof applyMemoryItem>[0]

  beforeEach(() => {
    vaultPath = mkdtempSync(join(tmpdir(), 'eyas-apply-vault-'))
    const vault = createVaultService(vaultPath)
    deps = {
      ...base,
      vault: {
        write: (path, fm, body) => vault.write(path, fm as never, body),
        exists: (path) => vault.exists(path),
        read: (path) => {
          const entry = vault.read(path)
          return entry ? { content: entry.content, frontmatter: { ...entry.frontmatter } } : null
        },
      },
    }
  })

  afterEach(() => {
    rmSync(vaultPath, { recursive: true, force: true })
  })

  const item = (body: string) => ({
    jobId: 'j1',
    sourceProfile: 'obsidian' as const,
    target: 'vault.semantic' as const,
    transformed: T({ body }),
    relativePath: 'alpha_note.md',
  })

  it('writes a body with blank lines at both ends and reads it back byte for byte', async () => {
    const body = '\n\n  indented first line\n\nlast line\n\n\n'
    const r = await applyMemoryItem(deps, item(body))
    expect(r).toMatchObject({ status: 'applied', ref: 'semantic/alpha_note.md', sha256: sha256(body) })
    expect(createVaultService(vaultPath).read('semantic/alpha_note.md')!.content).toBe(body)
  })

  it('reports the same source as unchanged on a second run', async () => {
    const body = '\n\nBody.\n\n\n'
    await applyMemoryItem(deps, item(body))
    expect(await applyMemoryItem(deps, item(body))).toMatchObject({
      status: 'unchanged',
      ref: 'semantic/alpha_note.md',
      importJobId: 'j1',
      sha256: sha256(body),
    })
  })

  it('re-stamps a whitespace-only edit on the same note instead of adding a sibling', async () => {
    await applyMemoryItem(deps, item('Body.'))
    const edited = '\n\nBody.\n\n\n'
    const r = await applyMemoryItem(deps, item(edited))
    expect(r).toMatchObject({ status: 'applied', ref: 'semantic/alpha_note.md', sha256: sha256(edited) })

    const vault = createVaultService(vaultPath)
    expect(vault.read('semantic/alpha_note.md')!.content).toBe(edited)
    expect(vault.exists('semantic/alpha_note-2.md')).toBe(false)
    expect(vault.listFiles()).toEqual(['semantic/alpha_note.md'])
  })

  it('tolerates the writer\'s appended newline rather than rewriting on every run', async () => {
    // The body has no trailing newline, so the writer adds one. Reading it back
    // must not read as an edit, or an untouched note would be rewritten for ever.
    await applyMemoryItem(deps, item('Body.'))
    expect(await applyMemoryItem(deps, item('Body.'))).toMatchObject({ status: 'unchanged' })
    expect(await applyMemoryItem(deps, item('Body.'))).toMatchObject({ status: 'unchanged' })
  })
})

/**
 * Memory sovereignty under A-24. A legacy-digest match proves two bodies are the
 * same modulo surrounding whitespace; it does not prove the stored note is the
 * importer's to rewrite. A note the OWNER typed can match that loosely, and an
 * import may never write over it.
 */
describe('applyMemoryItem — a note the import never wrote', () => {
  const hand = () =>
    vaultMock({
      // No `imported` tag, no `import-job:` tag: nothing says an import wrote it.
      'semantic/hand.md': {
        content: 'Hand written body.',
        frontmatter: { title: 'Hand', tags: ['mine'], embedding_hash: 'abc123' },
      },
    })

  const item = (body: string) => ({
    jobId: 'j',
    sourceProfile: 'obsidian' as const,
    target: 'vault.semantic' as const,
    transformed: T({ body }),
    relativePath: 'hand.md',
  })

  it('leaves a hand-written note byte-identical and files the import beside it', async () => {
    const { vault, written } = hand()
    const r = await applyMemoryItem({ ...base, vault }, item('\n\nHand written body.\n\n\n'))

    expect(r).toMatchObject({ status: 'applied', ref: 'semantic/hand-2.md' })
    // The owner's note is untouched — not rewritten, not re-tagged, not deleted.
    expect(written.map((w) => w.path)).toEqual(['semantic/hand-2.md'])
    expect(written[0].fm.tags).toContain('conflict-with:semantic/hand.md')
    expect(vault.read('semantic/hand.md')).toMatchObject({ content: 'Hand written body.' })
  })

  it('still re-stamps the same note once an import owns it', async () => {
    const { vault, written } = vaultMock({
      'semantic/hand.md': {
        content: 'Hand written body.',
        frontmatter: { title: 'Hand', tags: ['imported', 'import-job:old'] },
      },
    })
    const r = await applyMemoryItem({ ...base, vault }, item('\n\nHand written body.\n\n\n'))

    expect(r).toMatchObject({ status: 'applied', ref: 'semantic/hand.md' })
    expect(written.map((w) => w.path)).toEqual(['semantic/hand.md'])
    expect(written[0].content).toBe('\n\nHand written body.\n\n\n')
  })

  it('accepts the ledger as provenance when the owner has edited the tags away', async () => {
    const { vault, written } = hand()
    const asked: Array<[string, string]> = []
    const r = await applyMemoryItem(
      {
        ...base,
        vault,
        wasImported: (kind, ref) => {
          asked.push([kind, ref])
          return ref === 'semantic/hand.md'
        },
      },
      item('\n\nHand written body.\n\n\n'),
    )
    expect(asked).toContainEqual(['vault', 'semantic/hand.md'])
    expect(r).toMatchObject({ status: 'applied', ref: 'semantic/hand.md' })
    expect(written[0].path).toBe('semantic/hand.md')
  })

  it('accepts the source frontmatter block when the tags AND the ledger are gone', async () => {
    // A-39 — the owner's 780 already-imported notes carry `source:`. A note whose
    // tags were edited away and whose ledger row has been pruned is still ours,
    // and duplicating it to a sibling would be the very outcome R11.8 forbids.
    const { vault, written } = vaultMock({
      'semantic/hand.md': {
        content: 'Hand written body.',
        frontmatter: {
          title: 'Hand',
          tags: ['mine'],
          source: { profile: 'claude-code', path: 'ai-memory/hand.md' },
        },
      },
    })
    const r = await applyMemoryItem(
      // No ledger to ask, and no provenance tag on the note.
      { ...base, vault, wasImported: () => false },
      item('\n\nHand written body.\n\n\n'),
    )
    expect(r).toMatchObject({ status: 'applied', ref: 'semantic/hand.md' })
    expect(written.map((w) => w.path)).toEqual(['semantic/hand.md'])
    expect(written[0].content).toBe('\n\nHand written body.\n\n\n')
  })

  it('recognises every profile the importer can run under', async () => {
    // The witness is the closed `SourceProfile` list, so a note written under any
    // of them is ours — including the pre-R11 shape, which set only `profile`.
    for (const profile of ['claude-code', 'grok-cli', 'obsidian', 'generic-md']) {
      const { vault, written } = vaultMock({
        'semantic/hand.md': {
          content: 'Hand written body.',
          frontmatter: { title: 'Hand', tags: ['mine'], source: { profile, path: 'a/hand.md' } },
        },
      })
      const r = await applyMemoryItem(
        { ...base, vault, wasImported: () => false },
        item('\n\nHand written body.\n\n\n'),
      )
      expect(r).toMatchObject({ status: 'applied', ref: 'semantic/hand.md' })
      expect(written.map((w) => w.path)).toEqual(['semantic/hand.md'])
    }
  })

  describe('a source block that is not this importer\'s provenance', () => {
    const shapes: Array<[string, unknown]> = [
      // Another tool's exporter, naming a profile EYAS has never had.
      ['a different importer', { profile: 'notion-exporter' }],
      // `path` is a key anybody's exporter writes; on its own it says nothing.
      ['a bare path', { path: 'https://example.com/article' }],
      ['an unknown adapter', { adapter: 'some-other-tool' }],
      ['a block with no profile at all', { url: 'https://example.invalid/a' }],
      ['an empty profile', { profile: '' }],
      ['a non-string profile', { profile: 42 }],
      ['a scalar source', 'https://example.invalid/a'],
      ['an array source', [{ profile: 'claude-code' }]],
      ['no source at all', undefined],
    ]

    for (const [name, source] of shapes) {
      it(`leaves the owner's note untouched for ${name}`, async () => {
        const { vault, written } = vaultMock({
          'semantic/hand.md': {
            content: 'Hand written body.',
            frontmatter: { title: 'Hand', tags: ['mine'], ...(source === undefined ? {} : { source }) },
          },
        })
        const r = await applyMemoryItem(
          { ...base, vault, wasImported: () => false },
          item('\n\nHand written body.\n\n\n'),
        )
        expect(r).toMatchObject({ status: 'applied', ref: 'semantic/hand-2.md' })
        expect(vault.read('semantic/hand.md')).toMatchObject({ content: 'Hand written body.' })
        expect(written.map((w) => w.path)).toEqual(['semantic/hand-2.md'])
      })
    }
  })

  it('reports a byte-identical hand-written note as unchanged, writing nothing', async () => {
    // Same bytes is same content whoever wrote them: nothing to do, and nothing
    // is written either way.
    const { vault, written } = hand()
    const r = await applyMemoryItem({ ...base, vault }, item('Hand written body.'))
    expect(r).toMatchObject({ status: 'unchanged', ref: 'semantic/hand.md', importJobId: null })
    expect(written).toHaveLength(0)
  })

  it('leaves a hand-written episodic row alone rather than re-stamping it', async () => {
    const legacySha = sha256('Body.')
    const restamped: string[] = []
    const episodic = {
      create: () => ({ id: 'e-new' }),
      // A row with no import provenance at all.
      findImported: (s: string) => (s === legacySha ? { id: 'e1', sourceId: 'conv-9', tags: ['mine'] } : null),
      restamp: (id: string) => restamped.push(id),
    }
    const r = await applyMemoryItem(
      { ...base, episodic },
      { jobId: 'j', sourceProfile: 'obsidian', target: 'episodic', transformed: T({ body: '\nBody.\n' }) },
    )
    expect(restamped).toEqual([])
    expect(r).toMatchObject({ status: 'unchanged', ref: 'e1', sha256: legacySha })
  })

  it('re-stamps an episodic row an import wrote', async () => {
    const legacySha = sha256('Body.')
    const restamped: string[] = []
    const episodic = {
      create: () => ({ id: 'e-new' }),
      findImported: (s: string) =>
        s === legacySha ? { id: 'e1', sourceId: 'import:old', tags: ['imported'] } : null,
      restamp: (id: string) => restamped.push(id),
    }
    const r = await applyMemoryItem(
      { ...base, episodic },
      { jobId: 'j', sourceProfile: 'obsidian', target: 'episodic', transformed: T({ body: '\nBody.\n' }) },
    )
    expect(restamped).toEqual(['e1'])
    expect(r).toMatchObject({ status: 'applied', ref: 'e1', sha256: sha256('\nBody.\n') })
  })

  it('reports an episodic row matched on the verbatim digest as unchanged', async () => {
    const sha = sha256('\nBody.\n')
    const restamped: string[] = []
    const episodic = {
      create: () => ({ id: 'e-new' }),
      findImported: (s: string) =>
        s === sha ? { id: 'e1', sourceId: 'import:old', tags: ['imported'] } : null,
      restamp: (id: string) => restamped.push(id),
    }
    const r = await applyMemoryItem(
      { ...base, episodic },
      { jobId: 'j', sourceProfile: 'obsidian', target: 'episodic', transformed: T({ body: '\nBody.\n' }) },
    )
    expect(restamped).toEqual([])
    expect(r).toMatchObject({ status: 'unchanged', ref: 'e1', importJobId: 'old', sha256: sha })
  })
})

// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, it, expect } from 'vitest'
import { readSourceNote } from '@modules/data-port/source-frontmatter'
import {
  normalizeMemory,
  enrichMemory,
  safeImportedKind,
  isReservedTag,
  isImporterOwnedSourceTag,
} from '@modules/data-port/pipeline/transform'

const RAW = '---\nname: feedback_no_auto_commit\ndescription: "Do not commit automatically"\ntype: feedback\nmetadata:\n  modified: 2026-08-01T00:00:00.000Z\n---\nNever commit. See [[feedback_terse]].\n\n' + 'body '.repeat(2000)

describe('normalizeMemory', () => {
  const note = readSourceNote('ai-memory/feedback_no_auto_commit.md', RAW, { mtime: '2026-09-01T00:00:00.000Z', birthtime: '2026-05-01T00:00:00.000Z' })
  const r = normalizeMemory(note, { relativePath: 'ai-memory/feedback_no_auto_commit.md', sourceProfile: 'claude-code', sha256: 'abc', mtime: '2026-09-01T00:00:00.000Z', hooks: { hooks: ['No commit/push unless asked'], section: 'Feedback — Global' } })

  it('keeps the whole body verbatim', () => {
    // Byte equality against an expectation reconstructed independently of `note.body`,
    // not merely a length check — a truncation or whitespace change that happened to
    // keep the same length would slip past `toBeGreaterThan`.
    const expectedBody = 'Never commit. See [[feedback_terse]].\n\n' + 'body '.repeat(2000)
    expect(r.body).toBe(expectedBody)
    expect(r.body).toBe(note.body)
  })

  it('maps declared type to kind and description to summary', () => {
    expect(r.kind).toBe('feedback')
    expect(r.summary_one_line).toBe('Do not commit automatically')
    expect(r.title).toBe('feedback_no_auto_commit')
    expect(r.aliases).toEqual(['feedback_no_auto_commit'])
    expect(r.links).toEqual(['feedback_terse'])
    // By reference, not a copy: normalizeMemory passes the source note's own
    // links array straight through.
    expect(r.links).toBe(note.links)
    expect(r.created).toBe('2026-05-01')
    expect(r.updated).toBe('2026-08-01')
  })

  it('records provenance and the index hook and section', () => {
    expect(r.source).toMatchObject({ profile: 'claude-code', path: 'ai-memory/feedback_no_auto_commit.md', name: 'feedback_no_auto_commit', type: 'feedback', sha256: 'abc', indexHooks: ['No commit/push unless asked'], indexSection: 'Feedback — Global' })
    // By reference, not a copy: the source note's own frontmatter object travels
    // through unchanged (toBe is strictly stronger than a deep-equality toEqual).
    expect((r.source as Record<string, unknown>).frontmatter).toBe(note.data)
    expect(r.tags).toContain('index-section:feedback-global')
  })

  it('uses the hook as summary when there is no description, then the first line', () => {
    const n1 = readSourceNote('x/a.md', '# Title\nFirst line.\nSecond.')
    expect(normalizeMemory(n1, { relativePath: 'x/a.md', sourceProfile: 'obsidian', hooks: { hooks: ['hook'], section: null } }).summary_one_line).toBe('hook')
    expect(normalizeMemory(n1, { relativePath: 'x/a.md', sourceProfile: 'obsidian' }).summary_one_line).toBe('First line.')
  })

  it('falls back to the title when the body is only headings', () => {
    const n = readSourceNote('x/a.md', '# Heading One\n## Heading Two')
    expect(normalizeMemory(n, { relativePath: 'x/a.md', sourceProfile: 'obsidian' }).summary_one_line).toBe('Heading One')
  })

  it('never infers user; undeclared is reference', () => {
    const n = readSourceNote('x/a.md', 'The owner prefers tea.')
    expect(normalizeMemory(n, { relativePath: 'x/a.md', sourceProfile: 'generic-md' }).kind).toBe('reference')
    expect(safeImportedKind('user', { declared: false })).toBe('reference')
    expect(safeImportedKind('user', { declared: true })).toBe('user')
  })

  it('collects name, basename and title as aliases, minus the vault file slug', () => {
    const h = readSourceNote('x/a.md', '# Heading One\ntext')
    expect(normalizeMemory(h, { relativePath: 'x/a.md', sourceProfile: 'obsidian' }).aliases).toEqual(['a', 'Heading One'])
    expect(normalizeMemory(h, { relativePath: 'x/a.md', sourceProfile: 'obsidian', fileSlug: 'a' }).aliases).toEqual(['Heading One'])
  })

  it('drops nothing when the caller does not say which slug the note is written to', () => {
    const named = readSourceNote('ai-memory/user_profile.md', '---\nname: user_profile\naliases: [profile]\n---\ntext')
    // The vault file would be `user-profile.md`, so `user_profile` is the alias
    // that keeps an existing [[user_profile]] link resolving — never guess it away.
    expect(normalizeMemory(named, { relativePath: 'ai-memory/user_profile.md', sourceProfile: 'claude-code' }).aliases)
      .toEqual(['user_profile', 'profile'])
    expect(normalizeMemory(named, { relativePath: 'ai-memory/user_profile.md', sourceProfile: 'claude-code', fileSlug: 'user_profile' }).aliases)
      .toEqual(['profile'])
  })

  it('records every path the same content was found at, and the container unit', () => {
    const n = readSourceNote('x/a.md', 'text')
    const one = normalizeMemory(n, { relativePath: 'x/a.md', sourceProfile: 'obsidian', paths: ['x/a.md'] })
    expect((one.source as Record<string, unknown>).paths).toBeUndefined()
    const many = normalizeMemory(n, { relativePath: 'x/a.md', sourceProfile: 'obsidian', paths: ['x/a.md', 'y/a.md'], unit: 'conv-1' })
    expect((many.source as Record<string, unknown>).paths).toEqual(['x/a.md', 'y/a.md'])
    expect((many.source as Record<string, unknown>).unit).toBe('conv-1')
  })

  it('titles and summarises an imported one-line memory index', () => {
    const idx = readSourceNote('ai-memory/MEMORY.md', '- [Hook](a.md)\n- [Other](b.md)')
    const out = normalizeMemory(idx, { relativePath: 'ai-memory/MEMORY.md', sourceProfile: 'claude-code', indexEntryCount: 42 })
    expect(out.title).toBe('Memory index (imported)')
    expect(out.summary_one_line).toBe('Imported one-line memory index (42 entries)')
    const titled = readSourceNote('ai-memory/MEMORY.md', '# My Index\n- [Hook](a.md)')
    expect(normalizeMemory(titled, { relativePath: 'ai-memory/MEMORY.md', sourceProfile: 'claude-code', indexEntryCount: 1 }).title).toBe('My Index')
  })

  it('omits the index-section tag when the section name slugs to nothing', () => {
    const n = readSourceNote('x/a.md', 'text')
    const cyrillic = normalizeMemory(n, { relativePath: 'x/a.md', sourceProfile: 'obsidian', hooks: { hooks: ['hook'], section: 'Проект' } })
    expect(cyrillic.tags.some((t) => t.startsWith('index-section:'))).toBe(false)
    // The hook itself still survives as the summary; only the empty tag is dropped.
    expect(cyrillic.summary_one_line).toBe('hook')
  })

  it('dedupes the tags it assigns', () => {
    const n = readSourceNote('x/a.md', '---\ntags: [alpha, alpha, bravo]\n---\ntext')
    const out = normalizeMemory(n, { relativePath: 'x/a.md', sourceProfile: 'obsidian', hooks: { hooks: ['h'], section: 'Notes' }, sourceChanged: true })
    expect(out.tags).toEqual(['alpha', 'bravo', 'index-section:notes', 'source-changed'])
  })

  it('tags a note whose source changed since the last import', () => {
    const n = readSourceNote('x/a.md', 'text')
    expect(normalizeMemory(n, { relativePath: 'x/a.md', sourceProfile: 'obsidian', sourceChanged: true }).tags).toContain('source-changed')
    expect(normalizeMemory(n, { relativePath: 'x/a.md', sourceProfile: 'obsidian' }).tags).not.toContain('source-changed')
  })

  it('summarises past a horizontal rule instead of reporting it as the first line', () => {
    const n = readSourceNote('x/a.md', '---\ntitle: Alpha\n---\n\n***\n\nThe actual first line.')
    expect(normalizeMemory(n, { relativePath: 'x/a.md', sourceProfile: 'obsidian' }).summary_one_line).toBe(
      'The actual first line.',
    )
  })

  it('does not alias a container unit after the container it came out of', () => {
    const n = readSourceNote('exports/conversations.json', 'A single chat.')
    const unit = normalizeMemory(n, {
      relativePath: 'exports/conversations.json',
      sourceProfile: 'chat-export',
      unit: 'chat-one',
    })
    // Five hundred conversations in one file are not five hundred notes called
    // `conversations`; the container's name says nothing about any of them.
    expect(unit.aliases).not.toContain('conversations')
    const whole = normalizeMemory(n, {
      relativePath: 'exports/conversations.json',
      sourceProfile: 'chat-export',
    })
    expect(whole.aliases).toContain('conversations')
  })

  describe('tags the importer owns', () => {
    /** Every prefix and literal a source file must not be able to declare. */
    const FORGED = [
      'sha:0123456789abcdef',
      'content-sha:0123456789abcdef',
      'imported',
      'import-job:someone-elses-job',
      'source:claude-code',
      'pii:likely',
      'conflict-with:semantic/other.md',
      'index-section:feedback-global',
      'session:abc123',
      'source-changed',
    ]

    it('drops a forged tag from the source and keeps everything else', () => {
      const n = readSourceNote(
        'x/a.md',
        `---\ntags: [alpha, ${FORGED.map((t) => JSON.stringify(t)).join(', ')}, bravo]\n---\ntext`,
      )
      const out = normalizeMemory(n, { relativePath: 'x/a.md', sourceProfile: 'obsidian' })
      // The genuine ones survive; not one of the importer's own does.
      expect(out.tags).toEqual(['alpha', 'bravo'])
      // The note itself records what was refused, and the original frontmatter
      // travels untouched — nothing is lost, it is only not believed.
      expect((out.source as Record<string, unknown>).strippedTags).toEqual(FORGED)
      expect(((out.source as Record<string, unknown>).frontmatter as { tags: string[] }).tags).toContain(
        'sha:0123456789abcdef',
      )
    })

    it('is what stops a declared sha from claiming another note has already been imported', () => {
      // The concrete attack: file A declares the digest of file B's body, and
      // the episodic idempotency lookup then reports B as already imported.
      const forged = readSourceNote('x/a.md', '---\ntags: ["sha:deadbeef"]\n---\nA body.')
      const out = normalizeMemory(forged, { relativePath: 'x/a.md', sourceProfile: 'obsidian' })
      expect(out.tags.some((t) => t.startsWith('sha:'))).toBe(false)
    })

    it('says out loud which tags it refused', () => {
      const warned: unknown[] = []
      const n = readSourceNote('x/a.md', '---\ntags: [alpha, "import-job:other"]\n---\ntext')
      normalizeMemory(n, {
        relativePath: 'x/a.md',
        sourceProfile: 'obsidian',
        logger: { warn: (o) => warned.push(o) },
      })
      expect(warned).toHaveLength(1)
      expect(warned[0]).toMatchObject({ path: 'x/a.md', dropped: 1, tags: ['import-job:other'] })
    })

    it('leaves an ordinary note without a stripped-tags record at all', () => {
      const n = readSourceNote('x/a.md', '---\ntags: [alpha]\n---\ntext')
      const out = normalizeMemory(n, { relativePath: 'x/a.md', sourceProfile: 'obsidian' })
      expect((out.source as Record<string, unknown>).strippedTags).toBeUndefined()
    })
  })
})

/**
 * I5 — the importer mints tags it later reads back as fact: `sha:` is the
 * episodic idempotency key, `import-job:` is what the rollback guards match on,
 * `pii:` feeds the review queue. A source file that declared one of them would
 * make a genuine transcript report `unchanged` and never be imported at all.
 */
describe('normalizeMemory — tags the importer owns', () => {
  const norm = (raw: string, extra: Record<string, unknown> = {}) =>
    normalizeMemory(readSourceNote('x/a.md', raw), {
      relativePath: 'x/a.md',
      sourceProfile: 'obsidian',
      ...extra,
    } as never)

  it('drops a declared idempotency key and keeps the tags around it', () => {
    const out = norm('---\ntags: [alpha, "sha:0123456789abcdef", bravo]\n---\nBody.')
    expect(out.tags).toEqual(['alpha', 'bravo'])
  })

  it('drops every prefix the importer reads back as provenance', () => {
    const out = norm(
      '---\ntags:\n  - imported\n  - "import-job:other"\n  - "source:claude-code"\n' +
        '  - "content-sha:abc"\n  - "pii:likely"\n  - "conflict-with:semantic/x.md"\n' +
        '  - "index-section:rules"\n  - "session:s1"\n  - source-changed\n  - kept\n---\nBody.',
    )
    expect(out.tags).toEqual(['kept'])
  })

  it('refuses a declared provenance the classifier derives, never the source', () => {
    // A file cannot claim it came from a legacy backup folder, or that it is
    // someone else's product documentation: the classifier decides both from
    // where the file sat.
    expect(norm('---\ntags: [legacy, "third-party", kept]\n---\nBody.').tags).toEqual(['kept'])
    expect(isReservedTag('legacy')).toBe(true)
    expect(isReservedTag('third-party')).toBe(true)
  })

  it('lets a source file declare contains-secrets about itself', () => {
    // The one importer-read tag a source may set: declaring it can only HIDE the
    // note from recall, never expose anything, and a hand-tagged Obsidian note
    // must keep working.
    expect(isReservedTag('contains-secrets')).toBe(false)
    expect(norm('---\ntags: ["contains-secrets", alpha]\n---\nBody.').tags).toEqual([
      'contains-secrets',
      'alpha',
    ])
  })

  it('names the refused tags on the note rather than discarding them in silence', () => {
    const warned: unknown[] = []
    const out = norm('---\ntags: [alpha, "sha:deadbeef"]\n---\nBody.', {
      logger: { warn: (o: unknown) => warned.push(o) },
    })
    // R2 — nothing is dropped silently: the note carries what was refused, and
    // the whole original frontmatter is still there beside it.
    expect(out.source.strippedTags).toEqual(['sha:deadbeef'])
    expect((out.source.frontmatter as Record<string, unknown>).tags).toEqual([
      'alpha',
      'sha:deadbeef',
    ])
    expect(warned).toHaveLength(1)
  })

  it('says nothing about stripped tags when the source declared none of them', () => {
    const out = norm('---\ntags: [alpha]\n---\nBody.')
    expect(out.source.strippedTags).toBeUndefined()
  })

  it('is case-insensitive: `SHA:` is the same key as `sha:`', () => {
    expect(norm('---\ntags: ["SHA:abc", "Imported"]\n---\nBody.').tags).toEqual([])
  })

  it('keeps the project tag the claiming adapter derived from the path', () => {
    // By the time a note reaches `normalizeMemory`, the adapter's own
    // `grok-project:` and the file's declared tags are one array. Stripping the
    // prefix here would throw away the project every rooted Grok import is
    // identified by — and nothing reads it back as fact, so there is nothing to
    // forge. A model is still refused one (see enrichMemory below).
    expect(norm('---\ntags: ["grok-project:p1", alpha]\n---\nBody.').tags).toEqual([
      'grok-project:p1',
      'alpha',
    ])
    expect(isReservedTag('grok-project:p1')).toBe(true)
    expect(isImporterOwnedSourceTag('grok-project:p1')).toBe(false)
    // Everything the fix list names is still refused from a source file.
    expect(isImporterOwnedSourceTag('sha:abc')).toBe(true)
    expect(isImporterOwnedSourceTag('import-job:x')).toBe(true)
  })
})

/** R11.4 / R11.6 — what a note carries about where it came from and what is in it. */
describe('normalizeMemory — provenance and the secrets flag', () => {
  const norm = (raw: string, extra: Record<string, unknown> = {}, path = 'x/a.md') =>
    normalizeMemory(readSourceNote(path, raw), {
      relativePath: path,
      sourceProfile: 'claude-code',
      ...extra,
    } as never)

  it('records the adapter that read the file, and falls back to the job profile', () => {
    expect(norm('Body.', { adapterId: 'grok-cli' }).source.adapter).toBe('grok-cli')
    expect(norm('Body.').source.adapter).toBe('claude-code')
  })

  it('keeps the classifier tags the adapter handed it', () => {
    expect(norm('Body.', { tags: ['legacy', 'claude-project:alpha'] }).tags).toEqual(
      expect.arrayContaining(['legacy', 'claude-project:alpha']),
    )
  })

  it('tags contains-secrets when the scan flagged the file', () => {
    expect(norm('Body.', { containsSecrets: true }).tags).toContain('contains-secrets')
  })

  it('tags a credential the scan never saw, past the head of the file', () => {
    // A-8 — the scan may have judged the file from its first bytes only; this
    // pass reads every one of them.
    const body = 'filler '.repeat(4000) + '\nAWS_SECRET_ACCESS_KEY=wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY\n'
    expect(norm(body).tags).toContain('contains-secrets')
  })

  it('leaves an ordinary note untagged', () => {
    expect(norm('Never deploy on a Friday.').tags).not.toContain('contains-secrets')
  })
})

/** M6, M7 — small things that reach the owner's index, one line each. */
describe('normalizeMemory — what the index shows', () => {
  it('does not alias every unit of a container with the container name', () => {
    const note = readSourceNote('exports/conversations.json', 'Chat body.')
    const unit = normalizeMemory(note, {
      relativePath: 'exports/conversations.json',
      sourceProfile: 'chat-export',
      unit: 'chat-one',
      fileSlug: 'chat-one',
    } as never)
    expect(unit.aliases).not.toContain('conversations')

    // A standalone file still takes its own basename as an alias.
    const standalone = normalizeMemory(readSourceNote('notes/alpha.md', 'Body.'), {
      relativePath: 'notes/alpha.md',
      sourceProfile: 'obsidian',
      fileSlug: 'something-else',
    } as never)
    expect(standalone.aliases).toContain('alpha')
  })

  it('summarises a body that opens with a horizontal rule by its first real line', () => {
    const out = normalizeMemory(readSourceNote('x/a.md', '---\n\nThe first real line.\n\nMore.'), {
      relativePath: 'x/a.md',
      sourceProfile: 'obsidian',
    } as never)
    // A leading `---` that is not frontmatter is a rule, and a rule is not a summary.
    expect(out.summary_one_line).toBe('The first real line.')
    expect(out.body).toContain('---')
  })

  it('skips a heading and an asterisk or underscore rule alike', () => {
    const of = (raw: string) =>
      normalizeMemory(readSourceNote('x/a.md', raw), {
        relativePath: 'x/a.md',
        sourceProfile: 'obsidian',
      } as never).summary_one_line
    expect(of('# Title\n\n***\n\nReal prose here.')).toBe('Real prose here.')
    expect(of('___\n\nAlso real prose.')).toBe('Also real prose.')
  })
})

describe('enrichMemory', () => {
  const note = readSourceNote('x/a.md', 'Plain note without frontmatter. ' + 'text '.repeat(500))
  const base = normalizeMemory(note, { relativePath: 'x/a.md', sourceProfile: 'generic-md' })

  it('never hands a contains-secrets note to a model, and never takes the tag from one', async () => {
    // A-8b — the full-body recompute has already run in `normalizeMemory`, so
    // this gate cannot be bypassed by a head-only scan.
    let calls = 0
    const ctx = {
      model: {
        complete: async () => {
          calls++
          return { content: JSON.stringify({ summary_one_line: 's' }) }
        },
      },
    } as never
    const flagged = normalizeMemory(note, {
      relativePath: 'x/a.md',
      sourceProfile: 'generic-md',
      containsSecrets: true,
    })
    const { result, enriched } = await enrichMemory(ctx, note, flagged, {
      path: 'x/a.md',
      sourceProfile: 'generic-md',
    })
    expect(calls).toBe(0)
    expect(enriched).toBe(false)
    expect(result).toBe(flagged)

    // …and a model that invents the tag on an unflagged note does not get it:
    // hiding a note from recall is not a guess it may make.
    const inventing = {
      model: {
        complete: async () => ({
          content: JSON.stringify({ summary_one_line: 's', tags: ['contains-secrets', 'ok'] }),
        }),
      },
    } as never
    const out = await enrichMemory(inventing, note, base, { path: 'x/a.md', sourceProfile: 'generic-md' })
    expect(out.result.tags).toContain('ok')
    expect(out.result.tags).not.toContain('contains-secrets')
  })

  it('never replaces the body, even when the model returns one', async () => {
    const ctx = { model: { complete: async () => ({ content: JSON.stringify({ kind: 'feedback', body: 'SHORT REWRITE', summary_one_line: 'model summary', tags: ['t'], links: ['l'] }) }) } } as never
    const { result, enriched } = await enrichMemory(ctx, note, base, { path: 'x/a.md', sourceProfile: 'generic-md' })
    expect(enriched).toBe(true)
    expect(result.body).toBe(base.body)
    expect(result.kind).toBe('feedback')
    expect(result.summary_one_line).toBe('model summary')
    expect(result.tags).toContain('t')
  })

  it('does not honour skip or kind user from the model', async () => {
    const ctx = { model: { complete: async () => ({ content: JSON.stringify({ skip: true, kind: 'user', summary_one_line: 's' }) }) } } as never
    const { result } = await enrichMemory(ctx, note, base, { path: 'x/a.md', sourceProfile: 'generic-md' })
    expect(result.skip).toBeFalsy()
    expect(result.kind).toBe('reference')
  })

  it('never lets inference overwrite a kind the source declared', async () => {
    const reply = (json: Record<string, unknown>) =>
      ({ model: { complete: async () => ({ content: JSON.stringify(json) }) } }) as never
    const enrich = async (raw: string, json: Record<string, unknown>) => {
      const n = readSourceNote('x/d.md', raw)
      const b = normalizeMemory(n, { relativePath: 'x/d.md', sourceProfile: 'generic-md' })
      return (await enrichMemory(reply(json), n, b, { path: 'x/d.md', sourceProfile: 'generic-md' })).result
    }
    // A declared kind is a fact the source stated; the model does not get a vote.
    expect((await enrich('---\ntype: user\n---\ntext', { kind: 'reference', summary_one_line: 's' })).kind).toBe('user')
    expect((await enrich('---\ntype: feedback\n---\ntext', { kind: 'project' })).kind).toBe('feedback')
    // Undeclared: the model classifies, and a missing kind still lands on reference.
    expect((await enrich('text', { kind: 'project' })).kind).toBe('project')
    expect((await enrich('text', { summary_one_line: 's' })).kind).toBe('reference')
  })

  it('records a reported PII risk as a tag', async () => {
    const risky = { model: { complete: async () => ({ content: JSON.stringify({ kind: 'reference', pii_risk: 'likely' }) }) } } as never
    expect((await enrichMemory(risky, note, base, { path: 'x/a.md', sourceProfile: 'generic-md' })).result.tags).toContain('pii:likely')
    const clean = { model: { complete: async () => ({ content: JSON.stringify({ kind: 'reference', pii_risk: 'none' }) }) } } as never
    const tags = (await enrichMemory(clean, note, base, { path: 'x/a.md', sourceProfile: 'generic-md' })).result.tags
    expect(tags.some((t) => t.startsWith('pii:'))).toBe(false)
  })

  it('clamps a model summary to one line of at most 140 characters', async () => {
    const long = 'x'.repeat(200)
    const ctx = { model: { complete: async () => ({ content: JSON.stringify({ summary_one_line: `first line\nsecond line ${long}` }) }) } } as never
    const { result } = await enrichMemory(ctx, note, base, { path: 'x/a.md', sourceProfile: 'generic-md' })
    expect(result.summary_one_line).toBe('first line')
    const ctx2 = { model: { complete: async () => ({ content: JSON.stringify({ summary_one_line: long }) }) } } as never
    expect((await enrichMemory(ctx2, note, base, { path: 'x/a.md', sourceProfile: 'generic-md' })).result.summary_one_line).toHaveLength(140)
  })

  it('refuses reserved tags from the model', async () => {
    const forged = ['imported', 'IMPORTED', 'import-job:abc', 'source:claude-code', 'source-changed', 'pii:none', 'index-section:forged', 'session:1', 'conflict-with:x', 'grok-project:y']
    const ctx = { model: { complete: async () => ({ content: JSON.stringify({ tags: [...forged, 'genuine-topic'] }) }) } } as never
    const { result } = await enrichMemory(ctx, note, base, { path: 'x/a.md', sourceProfile: 'generic-md' })
    expect(result.tags).toEqual(['genuine-topic'])
  })

  it('falls back to the deterministic result without a model', async () => {
    const { result, enriched } = await enrichMemory({} as never, note, base, { path: 'x/a.md', sourceProfile: 'generic-md' })
    expect(enriched).toBe(false)
    expect(result).toEqual(base)
  })

  it('falls back to the deterministic result when the model returns no JSON', async () => {
    const ctx = { model: { complete: async () => ({ content: 'I cannot help with that.' }) } } as never
    const { result, enriched } = await enrichMemory(ctx, note, base, { path: 'x/a.md', sourceProfile: 'generic-md' })
    expect(enriched).toBe(false)
    expect(result).toEqual(base)
  })
})

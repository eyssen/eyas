// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, it, expect } from 'vitest'
import {
  splitFrontmatter, legacyBody, readSourceNote, extractWikilinkTargets, extractQuotedPhrases, declaredKindOf,
} from '@modules/data-port/source-frontmatter'

describe('splitFrontmatter', () => {
  it('splits only a LEADING frontmatter block', () => {
    const r = splitFrontmatter('---\nname: a\ntype: feedback\n---\nBody line.\n')
    expect(r.hadFrontmatter).toBe(true)
    expect(r.data).toEqual({ name: 'a', type: 'feedback' })
    expect(r.body).toBe('Body line.\n')
  })
  it('leaves a body with horizontal rules untouched when there is no frontmatter', () => {
    const raw = 'Intro\n\n---\n\n- a\n- b\n\n---\n\nprose after'
    const r = splitFrontmatter(raw)
    expect(r.hadFrontmatter).toBe(false)
    expect(r.body).toBe(raw)
  })
  it('keeps leading and trailing blank lines, indentation and CRLF byte for byte', () => {
    expect(splitFrontmatter('---\na: 1\n---\n\n\n  indented\n\n\n').body).toBe('\n\n  indented\n\n\n')
    expect(splitFrontmatter('---\r\na: 1\r\n---\r\nline\r\n').body).toBe('line\r\n')
    expect(splitFrontmatter('---\na: 1\n---').body).toBe('')
    expect(splitFrontmatter('no frontmatter\n\n').body).toBe('no frontmatter\n\n')
  })
  it('drops only a leading BOM (documented exception)', () => {
    expect(splitFrontmatter('﻿---\na: 1\n---\nx').hadFrontmatter).toBe(true)
  })
  it('reproduces the pre-amendment trimming for the idempotency fallback (frontmatter branch)', () => {
    expect(legacyBody('\n\n  indented\n\n\n', true)).toBe('  indented')
  })
  it('keeps LEADING blank lines when there was no frontmatter to drop them after (I1)', () => {
    // The pre-amendment splitter's no-frontmatter branch was `body: trimTail(raw)`
    // — trailing whitespace trimmed, leading blank lines untouched — never
    // `dropLeadingBlankLines`. `legacyBody` must take the SAME branch, or the
    // fallback digest is taken over bytes the original import never had, and a
    // file like this one re-imports as a duplicate instead of `unchanged`.
    expect(legacyBody('\n\n# Title\n\ntext\n', false)).toBe('\n\n# Title\n\ntext')
    expect(legacyBody('\n\n\ntext\n\n\n', false)).toBe('\n\n\ntext')
  })
  it('keeps a table separator and a mid-body rule inside a note WITH frontmatter', () => {
    const raw = '---\ntitle: t\n---\n| a | b |\n|---|---|\n| 1 | 2 |\n\n---\n\ntail'
    expect(splitFrontmatter(raw).body).toBe('| a | b |\n|---|---|\n| 1 | 2 |\n\n---\n\ntail')
  })
  it('keeps the note when the YAML is invalid: block out of the body, fields read line by line', () => {
    const raw = '---\n: : bad\n---\nx'
    const r = splitFrontmatter(raw)
    expect(r.hadFrontmatter).toBe(true)
    expect(r.body).toBe('x')
    expect(r.frontmatterRaw).toBe(': : bad')
    expect(r.parseError).toBeTruthy()
  })
  it('keeps date-only and timestamp scalars as plain strings, verbatim', () => {
    const raw = '---\ndate: 2026-09-05\nmodified: 2026-08-28T13:36:52.270Z\ncount: 3\nflag: true\n---\nx'
    expect(splitFrontmatter(raw).data).toEqual({ date: '2026-09-05', modified: '2026-08-28T13:36:52.270Z', count: 3, flag: true })
  })
  it('strips a leading byte-order mark before detecting frontmatter', () => {
    expect(splitFrontmatter('﻿---\ntitle: t\n---\nbody').hadFrontmatter).toBe(true)
  })

  // A leading `---` block is frontmatter only when it reads as a mapping. A
  // sentence, a list or a number between the rules is prose the author fenced
  // off, and every byte of it stays in the body (I4/A8).
  const NOT_FRONTMATTER = [
    '---\nAlways answer in Hungarian.\n---\n\n# Rules\n\nMore rules here.',
    '---\nrule one\nrule two\n---\nend',
    '---\n42\n---\nbody',
    '---\n- first rule\n- second rule\n---\nbody',
  ]
  for (const raw of NOT_FRONTMATTER) {
    it(`keeps every byte of a non-mapping block in the body: ${JSON.stringify(raw.slice(0, 24))}`, () => {
      const r = splitFrontmatter(raw)
      expect(r.hadFrontmatter).toBe(false)
      expect(r.data).toEqual({})
      expect(r.body).toBe(raw)
      expect(r.frontmatterRaw).toBeNull()
    })
  }

  it('reads a note whose description holds a colon line by line instead of losing it', () => {
    const raw =
      '---\nname: project_alpha_gap\ndescription: Ticket 12 asks facet semantics; measured live: fix is cheap\nmetadata:\n  type: project\n---\n\nBody line.'
    const r = splitFrontmatter(raw)
    expect(r.hadFrontmatter).toBe(true)
    expect(r.body).toBe('\nBody line.')
    expect(r.data.name).toBe('project_alpha_gap')
    expect(r.data.description).toBe('Ticket 12 asks facet semantics; measured live: fix is cheap')
    expect(r.data.metadata).toEqual({ type: 'project' })
    expect(r.parseError).toBeTruthy()
    expect(r.frontmatterRaw).toContain('name: project_alpha_gap')
  })

  it('reads a block with a duplicate key by tolerating the duplicate', () => {
    const r = splitFrontmatter('---\nname: a\nname: b\ntype: feedback\n---\nbody')
    expect(r.hadFrontmatter).toBe(true)
    expect(r.data).toMatchObject({ name: 'b', type: 'feedback' })
    expect(r.body).toBe('body')
  })

  it('reads a tab-indented block by converting the indentation', () => {
    const r = splitFrontmatter('---\nname: a\nmetadata:\n\ttype: project\n---\nbody')
    expect(r.hadFrontmatter).toBe(true)
    expect(r.data).toMatchObject({ name: 'a', metadata: { type: 'project' } })
  })

  it('keeps the indentation of a body that opens with a code block', () => {
    expect(splitFrontmatter('---\ntitle: t\n---\n\n    indented code\nafter\n').body)
      .toBe('\n    indented code\nafter\n')
    expect(splitFrontmatter('    indented code\nafter\n').body).toBe('    indented code\nafter\n')
  })
})

describe('declaredKindOf', () => {
  it('reads type, metadata.type and kind; ignores unknown values', () => {
    expect(declaredKindOf({ type: 'user' })).toBe('user')
    expect(declaredKindOf({ metadata: { type: 'feedback' } })).toBe('feedback')
    expect(declaredKindOf({ kind: 'project' })).toBe('project')
    expect(declaredKindOf({ type: 'claude-session' })).toBeNull()
    expect(declaredKindOf({ node_type: 'memory' })).toBeNull()
  })
})

describe('readSourceNote', () => {
  it('maps Claude Code memory frontmatter', () => {
    const raw = '---\nname: user_profile\ndescription: Who the owner is\ntype: user\nmetadata:\n  modified: 2026-08-28T13:36:52.270Z\n---\nSenior dev. See [[company_identity]] and [[feedback_x|alias]].\n'
    const n = readSourceNote('ai-memory/user_profile.md', raw, { mtime: '2026-09-01T10:00:00.000Z', birthtime: '2026-03-01T10:00:00.000Z' })
    expect(n.declaredKind).toBe('user')
    expect(n.name).toBe('user_profile')
    expect(n.title).toBe('user_profile')
    expect(n.description).toBe('Who the owner is')
    expect(n.links).toEqual(['company_identity', 'feedback_x'])
    expect(n.created).toBe('2026-03-01')
    expect(n.updated).toBe('2026-08-28')
    expect(n.body).toBe('Senior dev. See [[company_identity]] and [[feedback_x|alias]].\n')
    expect(n.data).toEqual({ name: 'user_profile', description: 'Who the owner is', type: 'user', metadata: { modified: '2026-08-28T13:36:52.270Z' } })
  })
  it('prefers frontmatter title, then H1, then name, then basename', () => {
    expect(readSourceNote('x/a_b.md', '# Heading One\ntext').title).toBe('Heading One')
    expect(readSourceNote('x/a_b.md', 'text only').title).toBe('a_b')
    expect(readSourceNote('x/SKILL.md', 'text only').title).toBe('x')
  })
  it('reads the declared project scope, and leaves it null when undeclared', () => {
    const scoped = readSourceNote('x/a.md', '---\nproject: alpha\nprojectType: research\n---\ntext')
    expect(scoped.project).toBe('alpha')
    expect(scoped.projectType).toBe('research')
    const bare = readSourceNote('x/b.md', 'text')
    expect(bare.project).toBeNull()
    expect(bare.projectType).toBeNull()
  })
  // A session note whose frontmatter names no id still carries one in its name,
  // and the id is what keeps a re-import idempotent rather than duplicating the
  // note. Frontmatter still wins when it declares one.
  it('falls back to the session id in the file name, and never over a declared one', () => {
    expect(readSourceNote('claude-sessions/2026-08/2026-08-09_0928_topic_g019fe56c.md', 'log').sessionId).toBe('019fe56c')
    expect(readSourceNote('claude-sessions/2026-08/2026-08-09_0928_topic_019fe56c.md', 'log').sessionId).toBe('019fe56c')
    expect(
      readSourceNote('claude-sessions/2026-08/2026-08-09_0928_topic_g019fe56c.md', '---\nsession_id: declared-one\n---\nlog')
        .sessionId,
    ).toBe('declared-one')
    expect(readSourceNote('claude-sessions/2026-04/2026-04-09_1330_topic.md', 'log').sessionId).toBeNull()
  })

  it('extracts session id and date from session-note frontmatter', () => {
    const raw = '---\ndate: 2026-09-05\ntime: "11:06"\ntype: grok-session\nsession_id: "01a070d1-bacb-7790-938d-8017f41ec3ae"\n---\nlog'
    const n = readSourceNote('claude-sessions/2026-09/x_g01a070d1.md', raw)
    expect(n.sessionId).toBe('01a070d1-bacb-7790-938d-8017f41ec3ae')
    expect(n.sessionDate).toBe(new Date('2026-09-05T11:06:00').toISOString())
    expect(n.declaredKind).toBeNull()
  })
})

describe('readSourceNote through a YAML failure', () => {
  it('keeps the declared kind, name and description of an unparsable block', () => {
    const raw =
      '---\nname: project_alpha_gap\ndescription: Ticket 12 asks facet semantics; measured live: fix is cheap\nmetadata:\n  type: project\n---\n\nBody line.'
    const n = readSourceNote('ai-memory/project_alpha_gap.md', raw)
    expect(n.declaredKind).toBe('project')
    expect(n.name).toBe('project_alpha_gap')
    expect(n.description).toMatch(/^Ticket 12 asks/)
    expect(n.body).toBe('\nBody line.')
    expect(n.frontmatterError).toBeTruthy()
    expect(n.frontmatterRaw).toContain('metadata:')
  })

  it('carries a fenced-off instruction block into the body, not into frontmatter', () => {
    const n = readSourceNote('notes/rules.md', '---\nAlways answer in Hungarian.\n---\n\n# Rules')
    expect(n.hadFrontmatter).toBe(false)
    expect(n.body).toBe('---\nAlways answer in Hungarian.\n---\n\n# Rules')
    expect(n.declaredKind).toBeNull()
  })
})

describe('helpers', () => {
  it('extractWikilinkTargets strips alias and heading parts and dedupes', () => {
    expect(extractWikilinkTargets('[[a]] [[a|x]] [[b#h]] [[c#h|y]]')).toEqual(['a', 'b', 'c'])
  })
  it('extractQuotedPhrases reads straight, typographic and Hungarian quotes', () => {
    expect(extractQuotedPhrases('Use when: user says "ticket 123", „nézd meg a 456-os ticketet”, or ‘alpha ticket’.'))
      .toEqual(['ticket 123', 'nézd meg a 456-os ticketet', 'alpha ticket'])
  })
  it('extractQuotedPhrases does not mistake an apostrophe inside a contraction for a quote mark', () => {
    expect(extractQuotedPhrases("don't stop, it's fine")).toEqual([])
    expect(extractQuotedPhrases("say 'hello there' now")).toEqual(['hello there'])
  })
})

/**
 * P-13 (I1) — `legacyBody` pinned against an INDEPENDENT reproduction of the
 * pre-amendment `splitFrontmatter`'s body computation, not against `legacyBody`
 * itself. Copied verbatim from the pre-R11 source (`trimTail` +
 * `dropLeadingBlankLines`, the had-frontmatter branch applying both, the
 * no-frontmatter branch applying only the trailing trim) so a regression in
 * either branch of `legacyBody` shows up as a mismatch here, not as the two
 * functions agreeing on the same bug.
 */
describe('legacyBody — pinned against the pre-amendment splitter (I1)', () => {
  const OLD_FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/
  const oldTrimTail = (t: string): string => t.replace(/\s+$/, '')
  const oldDropLeadingBlankLines = (t: string): string => t.replace(/^(?:\r?\n)+/, '')
  function oldSplitBody(raw: string): { body: string; hadFrontmatter: boolean } {
    const stripped = raw.replace(/^﻿/, '')
    if (!stripped.startsWith('---')) return { body: oldTrimTail(stripped), hadFrontmatter: false }
    const m = OLD_FRONTMATTER_RE.exec(stripped)
    if (!m) return { body: oldTrimTail(stripped), hadFrontmatter: false }
    return { body: oldTrimTail(oldDropLeadingBlankLines(stripped.slice(m[0].length))), hadFrontmatter: true }
  }

  const SHAPES = [
    '---\na: 1\n---\nBody line.\n',
    '---\na: 1\n---\n\n\n  indented\n\n\n',
    '---\na: 1\n---\n\nBody.',
    '---\r\na: 1\r\n---\r\n\r\nline\r\n',
    '---\r\na: 1\r\n---\r\ntext\r\n\r\n',
    '\n\n# Title\n\ntext\n',
    '\n\n\ntext\n\n\n',
    'no frontmatter\n\n',
    'plain text, no trailing whitespace',
    '\r\ntext\r\n',
    'plain\r\n\r\ntext  \t\r\n',
    '---\na: 1\n---',
  ]

  for (const raw of SHAPES) {
    it(`matches the pre-amendment body for ${JSON.stringify(raw.slice(0, 20))}`, () => {
      const oracle = oldSplitBody(raw)
      const current = splitFrontmatter(raw)
      // Only decidable case here: a block that reads as a mapping. Every SHAPE
      // above avoids the "structurally `---…---` but not a mapping" ambiguity
      // (covered separately by the NOT_FRONTMATTER cases above), so the two
      // detectors must agree.
      expect(current.hadFrontmatter).toBe(oracle.hadFrontmatter)
      expect(legacyBody(current.body, current.hadFrontmatter)).toBe(oracle.body)
    })
  }
})

describe('legacyBody — lossy by construction (I4)', () => {
  it('collapses different verbatim bodies to the same legacy digest', () => {
    // Documents the many-to-one contract at the export (I4): a fallback match
    // through `legacyBody` means "same item, possibly stale bytes" — the
    // caller (Task 11) MUST re-stamp the row's body and digest on a hit, never
    // treat it as proof the bytes are unchanged.
    const a = legacyBody('text', true)
    const b = legacyBody('text\n\n\n', true)
    const c = legacyBody('\n\ntext   \t', true)
    expect(a).toBe('text')
    expect(b).toBe(a)
    expect(c).toBe(a)
  })
})

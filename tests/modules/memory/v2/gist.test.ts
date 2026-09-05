// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach } from 'vitest'
import { makeV2Db } from './helpers'
import { heuristicLeafGist, heuristicRollupGist, clipAtSentence, LEAF_GIST_MAX_CHARS, ROLLUP_GIST_MAX_CHARS } from '@modules/memory/v2/extract/gist'

let db: any
beforeEach(() => { db = makeV2Db().db })

const unit = (content: string, sourceType = 'user_message') => ({ content, sourceType })

describe('clipAtSentence', () => {
  it('returns short text unchanged (whitespace collapsed)', () => {
    expect(clipAtSentence('a  b\n c', 20)).toBe('a b c')
  })
  it('cuts at the last sentence end when one sits past 40 % of the budget', () => {
    expect(clipAtSentence('First part is done here. Second part is long and goes on.', 40)).toBe('First part is done here.')
    expect(clipAtSentence('First part done here. Second part is long.', 30)).toBe('First part done here.')
  })
  it('never exceeds the budget and marks a mid-word cut', () => {
    const out = clipAtSentence('x'.repeat(100), 20)
    expect(out.length).toBeLessThanOrEqual(20)
    expect(out.endsWith('…')).toBe(true)
  })
})

describe('heuristicLeafGist', () => {
  const first = 'Please plan the invoice module rollout for Werth.'
  const last = 'Great, deadline confirmed for October first.'
  const middle = [
    unit('Sure, I will look at it now.', 'assistant_message'),
    unit('The Kubernetes ingress certificate expired on staging yesterday evening.'),
    unit('Noted, I will renew it before the rollout.', 'assistant_message'),
  ]
  it('contains the first and last message and stays within 280 characters', () => {
    const gist = heuristicLeafGist([unit(first), ...middle, unit(last)], 'en', db)
    expect(gist.length).toBeLessThanOrEqual(LEAF_GIST_MAX_CHARS)
    expect(gist.startsWith(first)).toBe(true)
    expect(gist.endsWith(last)).toBe(true)
    expect(gist).toContain('Kubernetes')
  })
  it('clips long edges at sentence boundaries and still fits', () => {
    const long = 'This is a rather long opening sentence about the rollout. It continues with a second sentence that is also long. And a third one.'
    const gist = heuristicLeafGist([unit(long), ...middle, unit(long)], 'en', db)
    expect(gist.length).toBeLessThanOrEqual(LEAF_GIST_MAX_CHARS)
    expect(gist.startsWith('This is a rather long opening sentence about the rollout.')).toBe(true)
  })
  it('handles one unit, whitespace-only units and no units', () => {
    expect(heuristicLeafGist([unit(first)], 'en', db)).toBe(first)
    expect(heuristicLeafGist([unit('   '), unit(first)], 'en', db)).toBe(first)
    expect(heuristicLeafGist([], 'en', db)).toBe('')
  })
})

describe('heuristicRollupGist', () => {
  const day = 86_400_000
  const t0 = Date.UTC(2026, 0, 10)
  const children = [
    { text: 'Invoice module rollout planned for Werth with a staging rehearsal.', importance: 0.9, occurredAtMs: t0 },
    { text: 'Kubernetes ingress certificate renewed on staging.', importance: 0.4, occurredAtMs: t0 + 5 * day },
    { text: 'Deadline moved to October first after the customer call.', importance: 0.6, occurredAtMs: t0 + 20 * day },
  ]
  const scope = { label: 'Project Werth', taskCount: 3, from: t0, to: t0 + 20 * day }
  it('renders the templated header, themes, key points by importance × recency and the latest line', () => {
    const text = heuristicRollupGist(children, scope, db)
    const lines = text.split('\n')
    expect(lines[0]).toBe('Project Werth — 3 tasks, 2026-01-10 → 2026-01-30.')
    expect(lines[1].startsWith('Themes: ')).toBe(true)
    expect(lines[2]).toBe('Key points:')
    expect(lines[3]).toBe('- Invoice module rollout planned for Werth with a staging rehearsal.')
    expect(lines[lines.length - 1]).toBe('Latest (2026-01-30): Deadline moved to October first after the customer call.')
    expect(text.length).toBeLessThanOrEqual(ROLLUP_GIST_MAX_CHARS)
  })
  it('ranks by importance x recency, not importance alone', () => {
    const to = t0 + 300 * day
    // Alpha carries the highest importance but is 300 days old; Bravo is newer
    // and wins on rank (0.3956 vs 0.5000). Under importance alone Alpha would
    // lead, so this fixture is what distinguishes the two rules — the three
    // children above cannot, because their importance order already matches
    // their rank order and the decay never flips anything.
    const aged = [
      { text: 'Alpha decision taken long ago about the invoice module.', importance: 0.9, occurredAtMs: t0 },
      { text: 'Bravo decision taken today about the shipping module.', importance: 0.5, occurredAtMs: to },
      { text: 'Charlie note of middling age and importance.', importance: 0.3, occurredAtMs: t0 + 150 * day },
    ]
    const lines = heuristicRollupGist(aged, { label: 'Project Werth', taskCount: 3, from: t0, to }, db).split('\n')
    expect(lines[3]).toBe('- Bravo decision taken today about the shipping module.')
    expect(lines[4]).toBe('- Alpha decision taken long ago about the invoice module.')
  })
  it('the closing clip catches a header that alone overruns the cap', () => {
    // The shrink loop only pops key points, and scope.label is never bounded by
    // anything upstream, so a long label is the one path that reaches the final
    // clipAtSentence. It degrades the whole template to a single clipped line
    // rather than exceeding the cap — deliberate, and worth pinning, because
    // without the closing clip this returns more than ROLLUP_GIST_MAX_CHARS.
    const long = { label: 'Werth '.repeat(300).trim(), taskCount: 3, from: t0, to: t0 + 20 * day }
    const text = heuristicRollupGist(children, long, db)
    expect(text.length).toBe(ROLLUP_GIST_MAX_CHARS)
    expect(text.endsWith('…')).toBe(true)
    expect(text).not.toContain('\n')
  })
  it('stays within 1 200 characters for many long children and handles the empty case', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ text: `Item ${i} ${'detail '.repeat(40)}`, importance: 0.5, occurredAtMs: t0 + i * day }))
    expect(heuristicRollupGist(many, { ...scope, taskCount: 40 }, db).length).toBeLessThanOrEqual(ROLLUP_GIST_MAX_CHARS)
    expect(heuristicRollupGist([], { ...scope, taskCount: 1 }, db)).toBe('Project Werth — 1 task, 2026-01-10 → 2026-01-30.')
  })
})

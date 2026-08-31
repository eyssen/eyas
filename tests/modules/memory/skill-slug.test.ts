// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Cap 6 — derive a meaningful skill-candidate slug from a run's tool sequence
// (replaces the pending-review-<id> placeholder).

import { describe, it, expect } from 'vitest'
import { deriveSkillSlug } from '@modules/memory/consolidator/skill-candidate-extractor'

describe('deriveSkillSlug', () => {
  it('kebab-joins the distinct tools in first-seen order', () => {
    expect(deriveSkillSlug(['search_memory', 'write_file'])).toBe('search-memory-write-file')
  })

  it('dedupes while preserving first-seen order', () => {
    expect(deriveSkillSlug(['a', 'a', 'b', 'a'])).toBe('a-b')
  })

  it('caps at 4 distinct tools', () => {
    expect(deriveSkillSlug(['t1', 't2', 't3', 't4', 't5', 't6'])).toBe('t1-t2-t3-t4')
  })

  it('sanitizes non-alphanumeric characters', () => {
    expect(deriveSkillSlug(['Send Email!', 'db.exec'])).toBe('send-email-db-exec')
  })

  it('returns empty string for an empty / unusable sequence', () => {
    expect(deriveSkillSlug([])).toBe('')
    expect(deriveSkillSlug(['', '   '])).toBe('')
  })
})

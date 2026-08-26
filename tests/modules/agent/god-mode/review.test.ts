// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { parseReviewJson } from '@modules/agent/god-mode/review'

const validPayload = {
  voteFor: 'slot-b',
  scores: { quality: 4, completeness: 5, risk: 2 },
  uniqueInsights: ['used existing helper'],
  risks: ['no tests'],
  summary: 'Solid work.',
}

describe('parseReviewJson', () => {
  it('parses a bare valid object', () => {
    const result = parseReviewJson(JSON.stringify(validPayload))
    expect(result).toEqual(validPayload)
  })

  it('extracts object buried in markdown prose', () => {
    const raw = [
      'Here is my review:',
      '```json',
      JSON.stringify(validPayload),
      '```',
      'Hope that helps.',
    ].join('\n')
    const result = parseReviewJson(raw)
    expect(result).toEqual(validPayload)
  })

  it('returns null when voteFor is missing', () => {
    const { voteFor: _omit, ...rest } = validPayload
    expect(parseReviewJson(JSON.stringify(rest))).toBeNull()
  })

  it('returns null when a score is out of range (6)', () => {
    const bad = {
      ...validPayload,
      scores: { ...validPayload.scores, quality: 6 },
    }
    expect(parseReviewJson(JSON.stringify(bad))).toBeNull()
  })

  it('returns null when a score is not an integer (3.5)', () => {
    const bad = {
      ...validPayload,
      scores: { ...validPayload.scores, risk: 3.5 },
    }
    expect(parseReviewJson(JSON.stringify(bad))).toBeNull()
  })
})

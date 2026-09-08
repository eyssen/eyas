// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import {
  buildGodModeSaveBody,
  chairRequiredForCount,
  parseCostCeiling,
  parseRetentionHours,
} from '../../src/web/src/pages/settings/god-mode-card-utils'

const a = { id: 'a', providerId: 'anthropic', modelId: 'claude' }
const b = { id: 'b', providerId: 'xai', modelId: 'grok' }
const draft = { id: 'c', providerId: 'openai', modelId: '' }

describe('chairRequiredForCount', () => {
  it('is false for an empty roster', () => {
    expect(chairRequiredForCount(0, null)).toBe(false)
  })

  it('is true for an even non-empty roster without a chair', () => {
    expect(chairRequiredForCount(2, null)).toBe(true)
    expect(chairRequiredForCount(4, null)).toBe(true)
  })

  it('is false when a chair is set or the count is odd', () => {
    expect(chairRequiredForCount(2, 'a')).toBe(false)
    expect(chairRequiredForCount(3, null)).toBe(false)
    expect(chairRequiredForCount(1, null)).toBe(false)
  })
})

describe('parseCostCeiling / parseRetentionHours', () => {
  it('treats blank ceiling as null and rejects negatives', () => {
    expect(parseCostCeiling('')).toBeNull()
    expect(parseCostCeiling('  ')).toBeNull()
    expect(parseCostCeiling('1.5')).toBe(1.5)
    expect(parseCostCeiling('-1')).toBeNull()
    expect(parseCostCeiling('nope')).toBeNull()
  })

  it('floors retention hours and falls back when invalid', () => {
    expect(parseRetentionHours('72')).toBe(72)
    expect(parseRetentionHours('10.9')).toBe(10)
    expect(parseRetentionHours('')).toBe(72)
    expect(parseRetentionHours('-3')).toBe(72)
  })
})

describe('buildGodModeSaveBody', () => {
  it('drops incomplete rows and a chair that is no longer in the roster', () => {
    const { body, chairRequired } = buildGodModeSaveBody({
      participants: [a, draft],
      chairParticipantId: 'c',
      costCeilingRaw: '',
      retentionRaw: '48',
    })
    expect(body.participants).toEqual([a])
    expect(body.chairParticipantId).toBeNull()
    expect(body.costCeilingUsd).toBeNull()
    expect(body.workspaceRetentionHours).toBe(48)
    expect(chairRequired).toBe(false)
  })

  it('flags even complete rosters without a chair', () => {
    const { body, chairRequired } = buildGodModeSaveBody({
      participants: [a, b, draft],
      chairParticipantId: null,
      costCeilingRaw: '2.5',
      retentionRaw: '72',
    })
    expect(body.participants).toHaveLength(2)
    expect(body.costCeilingUsd).toBe(2.5)
    expect(chairRequired).toBe(true)
  })

  it('keeps a chair that is still in the complete roster', () => {
    const { body, chairRequired } = buildGodModeSaveBody({
      participants: [a, b],
      chairParticipantId: 'b',
      costCeilingRaw: '',
      retentionRaw: '72',
    })
    expect(body.chairParticipantId).toBe('b')
    expect(chairRequired).toBe(false)
  })
})

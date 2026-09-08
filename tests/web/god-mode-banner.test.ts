// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { shouldConfirmGodSend } from '../../src/web/src/pages/conversations/god-mode-banner'

describe('shouldConfirmGodSend', () => {
  it('returns confirm when the conversation has never confirmed', () => {
    expect(shouldConfirmGodSend(false, 1.25, null)).toBe('confirm')
    expect(shouldConfirmGodSend(false, 1.25, 10)).toBe('confirm')
    expect(shouldConfirmGodSend(false, 10, 10)).toBe('confirm')
  })

  it('returns send when confirmed and there is no ceiling', () => {
    expect(shouldConfirmGodSend(true, 99, null)).toBe('send')
  })

  it('returns send when confirmed and estimate is at or under the ceiling', () => {
    expect(shouldConfirmGodSend(true, 4.99, 5)).toBe('send')
    expect(shouldConfirmGodSend(true, 5, 5)).toBe('send')
    expect(shouldConfirmGodSend(true, 0, 0)).toBe('send')
  })

  it('returns block-ceiling when estimate exceeds the ceiling', () => {
    expect(shouldConfirmGodSend(true, 5.01, 5)).toBe('block-ceiling')
    expect(shouldConfirmGodSend(false, 5.01, 5)).toBe('block-ceiling')
    expect(shouldConfirmGodSend(true, 1, 0)).toBe('block-ceiling')
  })
})

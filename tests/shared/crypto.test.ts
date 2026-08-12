import { describe, it, expect } from 'vitest'
import { sha256, generateId, constantTimeEqual } from '@shared/crypto'

describe('crypto utilities', () => {
  describe('sha256', () => {
    it('produces a hex string of 64 characters', async () => {
      const hash = await sha256('hello')
      expect(hash).toHaveLength(64)
      expect(hash).toMatch(/^[0-9a-f]+$/)
    })

    it('produces deterministic output', async () => {
      const a = await sha256('test-input')
      const b = await sha256('test-input')
      expect(a).toBe(b)
    })

    it('produces different output for different input', async () => {
      const a = await sha256('input-a')
      const b = await sha256('input-b')
      expect(a).not.toBe(b)
    })
  })

  describe('generateId', () => {
    it('produces a string of 26 characters (ULID format)', () => {
      const id = generateId()
      expect(id).toHaveLength(26)
      expect(id).toMatch(/^[0-9A-Z]+$/)
    })

    it('generates unique IDs', () => {
      const ids = new Set(Array.from({ length: 100 }, () => generateId()))
      expect(ids.size).toBe(100)
    })

    it('is sortable by time (monotonic)', () => {
      const a = generateId()
      const b = generateId()
      expect(b > a).toBe(true)
    })
  })

  describe('constantTimeEqual', () => {
    it('returns true for equal strings', () => {
      expect(constantTimeEqual('abc', 'abc')).toBe(true)
    })

    it('returns false for different strings', () => {
      expect(constantTimeEqual('abc', 'abd')).toBe(false)
    })

    it('returns false for different lengths', () => {
      expect(constantTimeEqual('abc', 'abcd')).toBe(false)
    })
  })
})

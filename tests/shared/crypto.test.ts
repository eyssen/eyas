import { describe, it, expect } from 'vitest'
import { sha256, generateId, generateIdAt, ulidTimestampMs, constantTimeEqual } from '@shared/crypto'

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

  describe('generateIdAt / ulidTimestampMs (deterministic migration ids, plan p1a)', () => {
    const random = (fill: number) => new Uint8Array(10).fill(fill)

    it('is deterministic: same inputs, same 26-char Crockford ULID', () => {
      const a = generateIdAt(1_700_000_000_000, random(7))
      const b = generateIdAt(1_700_000_000_000, random(7))
      expect(a).toBe(b)
      expect(a).toHaveLength(26)
      expect(a).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/)
    })

    it('differs when the random part differs, and sorts by timestamp first', () => {
      expect(generateIdAt(1_700_000_000_000, random(7))).not.toBe(generateIdAt(1_700_000_000_000, random(8)))
      const earlier = generateIdAt(1_700_000_000_000, random(255))
      const later = generateIdAt(1_700_000_000_001, random(0))
      expect(later > earlier).toBe(true)
    })

    it('round-trips the timestamp, including both edges of the 48-bit range', () => {
      for (const ms of [0, 1, 1_700_000_000_000, 2 ** 48 - 1]) {
        expect(ulidTimestampMs(generateIdAt(ms, random(3)))).toBe(ms)
      }
    })

    it('decodes the runtime generator too', () => {
      const before = Date.now()
      const ms = ulidTimestampMs(generateId())
      expect(ms).toBeGreaterThanOrEqual(before)
      expect(ms).toBeLessThanOrEqual(Date.now())
    })

    it('accepts lowercase input when decoding', () => {
      const id = generateIdAt(1_700_000_000_000, random(9))
      expect(ulidTimestampMs(id.toLowerCase())).toBe(1_700_000_000_000)
    })

    it('rejects bad input loudly', () => {
      expect(() => generateIdAt(-1, random(0))).toThrow(RangeError)
      expect(() => generateIdAt(2 ** 48, random(0))).toThrow(RangeError)
      expect(() => generateIdAt(1.5, random(0))).toThrow(RangeError)
      expect(() => generateIdAt(1, new Uint8Array(9))).toThrow(RangeError)
      expect(() => ulidTimestampMs('too-short')).toThrow(RangeError)
      expect(() => ulidTimestampMs('U'.repeat(26))).toThrow(RangeError) // 'U' is not in the Crockford alphabet
      // '8' + 25 zeros decodes to 8 * 32^9 = 2^48, one over ULID_TIME_MAX — every
      // character is valid Crockford, so this exercises the overflow branch alone.
      expect(() => ulidTimestampMs('8' + '0'.repeat(25))).toThrow(RangeError)
    })

    it('validates all 26 characters, not just the timestamp half', () => {
      // A 26-char string with a garbage tail must not be silently accepted with
      // its timestamp read out from under it.
      expect(() => ulidTimestampMs('0000000001' + '!'.repeat(16))).toThrow(RangeError)
      expect(() => ulidTimestampMs('0000000001' + 'U'.repeat(16))).toThrow(RangeError)
      expect(() => ulidTimestampMs('0000000001' + 'I'.repeat(16))).toThrow(RangeError)
      expect(() => ulidTimestampMs('0000000001' + 'L'.repeat(16))).toThrow(RangeError)
      expect(() => ulidTimestampMs('0000000001' + 'O'.repeat(16))).toThrow(RangeError)
    })

    it('matches the ULID specification worked example (canonical, not just self-consistent)', () => {
      expect(generateIdAt(1_469_918_176_385, new Uint8Array(10))).toBe('01ARYZ6S410000000000000000')

      // Non-zero random part: exercises the alphabet indexing and the 80-bit
      // packing that the all-zero vector above cannot reach.
      expect(generateIdAt(1_469_918_176_385, new Uint8Array([0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0xcd, 0xef, 0xfe, 0xdc])))
        .toBe('01ARYZ6S4104HMASW9NF6YZZPW')
    })
  })
})

import { describe, it, expect } from 'vitest'
import { generateApiKey, hashApiKey, isApiKeyFormat } from '@modules/auth/api-key'

describe('API key service', () => {
  it('generates a key with eyas_k1_ prefix', () => {
    const key = generateApiKey()
    expect(key).toMatch(/^eyas_k1_[a-f0-9]{32}$/)
  })

  it('generates unique keys', () => {
    const keys = new Set(Array.from({ length: 50 }, () => generateApiKey()))
    expect(keys.size).toBe(50)
  })

  it('extracts prefix (first 8 chars after eyas_k1_)', () => {
    const key = generateApiKey()
    const prefix = key.slice(8, 16)
    expect(prefix).toHaveLength(8)
  })

  it('hashes a key to a different value', async () => {
    const key = generateApiKey()
    const hash = await hashApiKey(key)
    expect(hash).not.toBe(key)
    expect(hash).toHaveLength(64)
  })

  it('produces deterministic hash for same key', async () => {
    const key = generateApiKey()
    const hash1 = await hashApiKey(key)
    const hash2 = await hashApiKey(key)
    expect(hash1).toBe(hash2)
  })

  it('identifies API key format correctly', () => {
    expect(isApiKeyFormat('eyas_k1_abcdef1234567890abcdef1234567890')).toBe(true)
    expect(isApiKeyFormat('eyJhbGciOiJIUzI1NiJ9.xxx.xxx')).toBe(false)
    expect(isApiKeyFormat('random-string')).toBe(false)
  })
})

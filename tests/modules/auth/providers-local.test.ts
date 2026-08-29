import { describe, it, expect } from 'vitest'
import { hashPassword, verifyPassword } from '@modules/auth/providers/local'

describe('local auth provider', () => {
  it('hashes a password with Argon2id', async () => {
    const hash = await hashPassword('test-password-123')
    expect(hash).toContain('argon2id')
    expect(hash).not.toBe('test-password-123')
  })

  it('verifies a correct password', async () => {
    const hash = await hashPassword('correct-password')
    const result = await verifyPassword('correct-password', hash)
    expect(result).toBe(true)
  })

  it('rejects an incorrect password', async () => {
    const hash = await hashPassword('correct-password')
    const result = await verifyPassword('wrong-password', hash)
    expect(result).toBe(false)
  })

  it('generates different hashes for the same password (salted)', async () => {
    const hash1 = await hashPassword('same-password')
    const hash2 = await hashPassword('same-password')
    expect(hash1).not.toBe(hash2)
  })
})

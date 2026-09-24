import { describe, it, expect } from 'vitest'
import {
  generateMasterKey,
  deriveMasterKey,
  encryptSecret,
  decryptSecret,
  exportKey,
  importKey,
} from '@modules/secrets/crypto'

describe('secrets crypto', () => {
  describe('generateMasterKey', () => {
    it('generates a CryptoKey', async () => {
      const key = await generateMasterKey()
      expect(key).toBeDefined()
      expect(key.type).toBe('secret')
      expect(key.algorithm).toMatchObject({ name: 'AES-GCM', length: 256 })
    })
  })

  describe('deriveMasterKey (PBKDF2)', () => {
    it('derives a key from password + salt', async () => {
      const salt = crypto.getRandomValues(new Uint8Array(16))
      const key = await deriveMasterKey('my-password', salt)
      expect(key).toBeDefined()
      expect(key.type).toBe('secret')
    })

    it('produces same key for same password + salt', async () => {
      const salt = crypto.getRandomValues(new Uint8Array(16))
      const key1 = await deriveMasterKey('same-password', salt)
      const key2 = await deriveMasterKey('same-password', salt)
      const exported1 = await exportKey(key1)
      const exported2 = await exportKey(key2)
      expect(exported1).toBe(exported2)
    })

    it('produces different key for different passwords', async () => {
      const salt = crypto.getRandomValues(new Uint8Array(16))
      const key1 = await deriveMasterKey('password-a', salt)
      const key2 = await deriveMasterKey('password-b', salt)
      const exported1 = await exportKey(key1)
      const exported2 = await exportKey(key2)
      expect(exported1).not.toBe(exported2)
    })

    it('produces different key for different salts', async () => {
      const salt1 = crypto.getRandomValues(new Uint8Array(16))
      const salt2 = crypto.getRandomValues(new Uint8Array(16))
      const key1 = await deriveMasterKey('same-password', salt1)
      const key2 = await deriveMasterKey('same-password', salt2)
      const exported1 = await exportKey(key1)
      const exported2 = await exportKey(key2)
      expect(exported1).not.toBe(exported2)
    })
  })

  describe('encrypt + decrypt', () => {
    it('roundtrip: decrypt recovers original plaintext', async () => {
      const key = await generateMasterKey()
      const plaintext = 'my-secret-api-key-12345'
      const { encrypted, iv, tag } = await encryptSecret(plaintext, key)
      const decrypted = await decryptSecret(encrypted, iv, tag, key)
      expect(decrypted).toBe(plaintext)
    })

    it('produces different ciphertext for same plaintext (unique IVs)', async () => {
      const key = await generateMasterKey()
      const plaintext = 'same-secret'
      const result1 = await encryptSecret(plaintext, key)
      const result2 = await encryptSecret(plaintext, key)
      expect(result1.iv).not.toBe(result2.iv)
      expect(result1.encrypted).not.toBe(result2.encrypted)
    })

    it('detects tampered ciphertext', async () => {
      const key = await generateMasterKey()
      const { encrypted, iv, tag } = await encryptSecret('secret', key)
      const tampered = encrypted.slice(0, -4) + 'XXXX'
      await expect(decryptSecret(tampered, iv, tag, key)).rejects.toThrow()
    })

    it('fails with wrong key', async () => {
      const key1 = await generateMasterKey()
      const key2 = await generateMasterKey()
      const { encrypted, iv, tag } = await encryptSecret('secret', key1)
      await expect(decryptSecret(encrypted, iv, tag, key2)).rejects.toThrow()
    })

    it('handles unicode', async () => {
      const key = await generateMasterKey()
      const plaintext = 'titkos kulcs 🔑 árvíztűrő tükörfúrógép'
      const { encrypted, iv, tag } = await encryptSecret(plaintext, key)
      const decrypted = await decryptSecret(encrypted, iv, tag, key)
      expect(decrypted).toBe(plaintext)
    })
  })

  describe('exportKey / importKey', () => {
    it('roundtrip: export then import produces working key', async () => {
      const key = await generateMasterKey()
      const hex = await exportKey(key)
      expect(hex).toHaveLength(64)
      const imported = await importKey(hex)
      const { encrypted, iv, tag } = await encryptSecret('test', imported)
      const decrypted = await decryptSecret(encrypted, iv, tag, imported)
      expect(decrypted).toBe('test')
    })
  })
})

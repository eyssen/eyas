import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { createSecretsRegistry } from '@modules/secrets/registry'
import { generateMasterKey } from '@modules/secrets/crypto'
import { createTestDb } from '../../helpers/test-db'
import type { SecretsRegistry } from '@modules/secrets/types'

const testDb = createTestDb('secrets-registry')
let db: ReturnType<typeof testDb.open>
let registry: SecretsRegistry

beforeEach(async () => {
  db = testDb.open()
  const key = await generateMasterKey()
  registry = createSecretsRegistry(db, key)
})

afterEach(() => {
  testDb.cleanup()
})

describe('SecretsRegistry', () => {
  describe('set + get', () => {
    it('stores and retrieves a secret', async () => {
      await registry.set('api-key', 'system', 'sk-abc123')
      const value = await registry.get('api-key', 'system')
      expect(value).toBe('sk-abc123')
    })

    it('returns null for non-existent secret', async () => {
      const value = await registry.get('nonexistent', 'system')
      expect(value).toBeNull()
    })

    it('updates existing secret', async () => {
      await registry.set('api-key', 'system', 'old-value')
      await registry.set('api-key', 'system', 'new-value')
      const value = await registry.get('api-key', 'system')
      expect(value).toBe('new-value')
    })

    it('stores with module attribution', async () => {
      await registry.set('jwt-secret', 'system', 'secret123', 'auth')
      const list = await registry.list('system')
      expect(list[0].module).toBe('auth')
    })
  })

  describe('scope isolation', () => {
    it('same name different scopes are independent', async () => {
      await registry.set('token', 'system', 'system-token')
      await registry.set('token', 'user:u1', 'user-token')
      expect(await registry.get('token', 'system')).toBe('system-token')
      expect(await registry.get('token', 'user:u1')).toBe('user-token')
    })

    it('list returns only secrets for specified scope', async () => {
      await registry.set('a', 'system', 'val-a')
      await registry.set('b', 'system', 'val-b')
      await registry.set('c', 'user:u1', 'val-c')
      const systemSecrets = await registry.list('system')
      expect(systemSecrets).toHaveLength(2)
      const userSecrets = await registry.list('user:u1')
      expect(userSecrets).toHaveLength(1)
    })
  })

  describe('delete', () => {
    it('deletes an existing secret', async () => {
      await registry.set('temp', 'system', 'value')
      const deleted = await registry.delete('temp', 'system')
      expect(deleted).toBe(true)
      expect(await registry.get('temp', 'system')).toBeNull()
    })

    it('returns false for non-existent secret', async () => {
      const deleted = await registry.delete('nonexistent', 'system')
      expect(deleted).toBe(false)
    })
  })

  describe('has', () => {
    it('returns true for existing secret', async () => {
      await registry.set('exists', 'system', 'value')
      expect(await registry.has('exists', 'system')).toBe(true)
    })

    it('returns false for non-existent secret', async () => {
      expect(await registry.has('nope', 'system')).toBe(false)
    })
  })

  describe('list metadata', () => {
    it('never exposes secret values', async () => {
      await registry.set('secret-key', 'system', 'super-secret-value')
      const list = await registry.list('system')
      expect(list[0].name).toBe('secret-key')
      expect((list[0] as any).value).toBeUndefined()
      expect((list[0] as any).encrypted).toBeUndefined()
    })
  })

  describe('encryption verification', () => {
    it('values are encrypted at rest', async () => {
      await registry.set('raw-check', 'system', 'plaintext-secret')
      const rows = db.all(sql`SELECT * FROM secrets WHERE name = 'raw-check' AND scope = 'system'`) as any[]
      expect(rows[0].encrypted).not.toContain('plaintext-secret')
      expect(rows[0].iv).toBeTruthy()
      expect(rows[0].tag).toBeTruthy()
    })
  })
})

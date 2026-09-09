# Secrets Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add encrypted secret storage with scope-based access control (system/user/agent), OS keychain integration for master key, and migrate JWT secret to the vault.

**Architecture:** A new `secrets` core module provides AES-256-GCM encryption via Web Crypto API. Master key is derived from a user-set password (PBKDF2) and cached in OS keychain (`@napi-rs/keyring`). Secrets are stored encrypted in SQLite with scope-based access control integrated into the existing CASL permission system. The auth module is refactored to persist JWT secrets via the vault.

**Tech Stack:** Web Crypto API (AES-256-GCM, PBKDF2), @napi-rs/keyring, Hono, Drizzle ORM

**Spec:** `docs/superpowers/specs/2026-03-31-secrets-module-design.md`

---

## File Map

### New Files

| File | Responsibility |
|------|----------------|
| `src/modules/secrets/types.ts` | SecretsRegistry, SecretMeta interfaces |
| `src/modules/secrets/schema.ts` | Drizzle `secrets` table |
| `src/modules/secrets/crypto.ts` | AES-256-GCM encrypt/decrypt, PBKDF2 key derivation |
| `src/modules/secrets/master-key.ts` | Master key provider chain (env → keychain → error) |
| `src/modules/secrets/registry.ts` | SecretsRegistry implementation |
| `src/modules/secrets/routes.ts` | `/api/v1/secrets/*` endpoints |
| `src/modules/secrets/index.ts` | EyasModule implementation |
| `tests/modules/secrets/crypto.test.ts` | Encryption roundtrip, PBKDF2, tamper detection |
| `tests/modules/secrets/master-key.test.ts` | Provider chain tests |
| `tests/modules/secrets/registry.test.ts` | CRUD, scope isolation, unique constraint |
| `tests/modules/secrets/routes.test.ts` | API endpoint + permission tests |

### Modified Files

| File | Change |
|------|--------|
| `package.json` | Add `@napi-rs/keyring` |
| `src/core/types.ts` | Add `secrets: SecretsRegistry` to `ModuleContext` |
| `src/core/bootstrap.ts` | Create SecretsRegistry, register secrets module |
| `src/modules/auth/index.ts` | Add `'secrets'` dependency, use ctx.secrets for JWT |
| `tests/helpers/test-db.ts` | Add `secrets` table to shared setup |
| `tests/core/bootstrap.test.ts` | Add secrets mock to context |

---

## Task 1: Install @napi-rs/keyring + Types + Schema

**Files:**
- Modify: `package.json`
- Create: `src/modules/secrets/types.ts`
- Create: `src/modules/secrets/schema.ts`

- [ ] **Step 1: Install @napi-rs/keyring**

```bash
cd /Users/eyssen/GitHub/eyas && bun add @napi-rs/keyring
```

Verify MIT license:
```bash
cat node_modules/@napi-rs/keyring/package.json | grep '"license"'
```

- [ ] **Step 2: Create types**

Create `src/modules/secrets/types.ts`:

```typescript
export interface SecretMeta {
  id: string
  name: string
  scope: string
  module: string | null
  createdAt: string
  updatedAt: string
}

export interface SecretsRegistry {
  get(name: string, scope: string): Promise<string | null>
  set(name: string, scope: string, value: string, module?: string): Promise<void>
  delete(name: string, scope: string): Promise<boolean>
  list(scope: string): Promise<SecretMeta[]>
  has(name: string, scope: string): Promise<boolean>
}
```

- [ ] **Step 3: Create Drizzle schema**

Create `src/modules/secrets/schema.ts`:

```typescript
import { sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const secrets = sqliteTable('secrets', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  scope: text('scope').notNull(),
  encrypted: text('encrypted').notNull(),
  iv: text('iv').notNull(),
  tag: text('tag').notNull(),
  module: text('module'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})
```

- [ ] **Step 4: Update test-db helper to include secrets table**

In `tests/helpers/test-db.ts`, add after the `setup_steps` table creation:

```typescript
db.run(sql`CREATE TABLE IF NOT EXISTS secrets (id TEXT PRIMARY KEY, name TEXT NOT NULL, scope TEXT NOT NULL, encrypted TEXT NOT NULL, iv TEXT NOT NULL, tag TEXT NOT NULL, module TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(name, scope))`)
```

- [ ] **Step 5: Run all tests**

```bash
cd /Users/eyssen/GitHub/eyas && bun vitest run
```

Expected: All 148 existing tests pass.

- [ ] **Step 6: Commit**

```bash
git add package.json bun.lock src/modules/secrets/types.ts src/modules/secrets/schema.ts tests/helpers/test-db.ts
git commit -m "feat(secrets): add types, schema, and install @napi-rs/keyring"
```

---

## Task 2: AES-256-GCM Crypto Module

**Files:**
- Create: `src/modules/secrets/crypto.ts`
- Create: `tests/modules/secrets/crypto.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/modules/secrets/crypto.test.ts`:

```typescript
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
      // Tamper with the ciphertext
      const tampered = encrypted.slice(0, -4) + 'XXXX'
      await expect(decryptSecret(tampered, iv, tag, key)).rejects.toThrow()
    })

    it('fails with wrong key', async () => {
      const key1 = await generateMasterKey()
      const key2 = await generateMasterKey()
      const { encrypted, iv, tag } = await encryptSecret('secret', key1)
      await expect(decryptSecret(encrypted, iv, tag, key2)).rejects.toThrow()
    })

    it('handles empty string', async () => {
      const key = await generateMasterKey()
      const { encrypted, iv, tag } = await encryptSecret('', key)
      const decrypted = await decryptSecret(encrypted, iv, tag, key)
      expect(decrypted).toBe('')
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
      expect(hex).toHaveLength(64) // 256-bit = 32 bytes = 64 hex chars
      const imported = await importKey(hex)
      // Use imported key to encrypt/decrypt
      const { encrypted, iv, tag } = await encryptSecret('test', imported)
      const decrypted = await decryptSecret(encrypted, iv, tag, imported)
      expect(decrypted).toBe('test')
    })
  })
})
```

- [ ] **Step 2: Implement crypto module**

Create `src/modules/secrets/crypto.ts`:

```typescript
const PBKDF2_ITERATIONS = 100_000

export async function generateMasterKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true, // extractable for export
    ['encrypt', 'decrypt'],
  )
}

export async function deriveMasterKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const passwordKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  )
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    passwordKey,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt'],
  )
}

export async function encryptSecret(
  plaintext: string,
  key: CryptoKey,
): Promise<{ encrypted: string; iv: string; tag: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encoded = new TextEncoder().encode(plaintext)
  const cipherBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, tagLength: 128 },
    key,
    encoded,
  )
  // AES-GCM appends the auth tag to the ciphertext
  const cipherArray = new Uint8Array(cipherBuffer)
  const ciphertext = cipherArray.slice(0, -16)
  const authTag = cipherArray.slice(-16)

  return {
    encrypted: toBase64(ciphertext),
    iv: toBase64(iv),
    tag: toBase64(authTag),
  }
}

export async function decryptSecret(
  encrypted: string,
  iv: string,
  tag: string,
  key: CryptoKey,
): Promise<string> {
  const ciphertext = fromBase64(encrypted)
  const ivBytes = fromBase64(iv)
  const authTag = fromBase64(tag)
  // Reconstruct combined buffer (ciphertext + tag) for AES-GCM
  const combined = new Uint8Array(ciphertext.length + authTag.length)
  combined.set(ciphertext)
  combined.set(authTag, ciphertext.length)

  const plainBuffer = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: ivBytes, tagLength: 128 },
    key,
    combined,
  )
  return new TextDecoder().decode(plainBuffer)
}

export async function exportKey(key: CryptoKey): Promise<string> {
  const raw = await crypto.subtle.exportKey('raw', key)
  return Array.from(new Uint8Array(raw)).map(b => b.toString(16).padStart(2, '0')).join('')
}

export async function importKey(hex: string): Promise<CryptoKey> {
  const bytes = new Uint8Array(hex.match(/.{2}/g)!.map(b => parseInt(b, 16)))
  return crypto.subtle.importKey(
    'raw',
    bytes,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt'],
  )
}

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64')
}

function fromBase64(str: string): Uint8Array {
  return new Uint8Array(Buffer.from(str, 'base64'))
}
```

- [ ] **Step 3: Run tests**

```bash
cd /Users/eyssen/GitHub/eyas && bun vitest run tests/modules/secrets/crypto.test.ts
```

Expected: All 10 tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/modules/secrets/crypto.ts tests/modules/secrets/crypto.test.ts
git commit -m "feat(secrets): add AES-256-GCM encryption and PBKDF2 key derivation"
```

---

## Task 3: Master Key Provider Chain

**Files:**
- Create: `src/modules/secrets/master-key.ts`
- Create: `tests/modules/secrets/master-key.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/modules/secrets/master-key.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { resolveMasterKey } from '@modules/secrets/master-key'
import { exportKey, importKey } from '@modules/secrets/crypto'

describe('master key provider chain', () => {
  const originalEnv = process.env.EYAS_MASTER_KEY

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.EYAS_MASTER_KEY = originalEnv
    } else {
      delete process.env.EYAS_MASTER_KEY
    }
  })

  it('resolves from EYAS_MASTER_KEY env var (hex)', async () => {
    // Generate a valid key, export to hex
    const { generateMasterKey } = await import('@modules/secrets/crypto')
    const key = await generateMasterKey()
    const hex = await exportKey(key)
    process.env.EYAS_MASTER_KEY = hex

    const result = await resolveMasterKey()
    expect(result).not.toBeNull()
    const resultHex = await exportKey(result!.key)
    expect(resultHex).toBe(hex)
    expect(result!.source).toBe('env')
  })

  it('returns null when no source is available', async () => {
    delete process.env.EYAS_MASTER_KEY
    // keyring will likely fail in test/CI environment
    const result = await resolveMasterKey({ skipKeyring: true })
    expect(result).toBeNull()
  })

  it('rejects invalid hex in env var', async () => {
    process.env.EYAS_MASTER_KEY = 'not-valid-hex'
    await expect(resolveMasterKey()).rejects.toThrow()
  })

  it('rejects too-short hex in env var', async () => {
    process.env.EYAS_MASTER_KEY = 'abcd1234' // only 4 bytes, need 32
    await expect(resolveMasterKey()).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Implement master key provider**

Create `src/modules/secrets/master-key.ts`:

```typescript
import { importKey } from './crypto.js'

export interface MasterKeyResult {
  key: CryptoKey
  source: 'env' | 'keyring' | 'none'
}

export interface ResolveMasterKeyOptions {
  skipKeyring?: boolean
}

export async function resolveMasterKey(options?: ResolveMasterKeyOptions): Promise<MasterKeyResult | null> {
  // 1. Try env var
  const envKey = process.env.EYAS_MASTER_KEY
  if (envKey) {
    if (!/^[0-9a-fA-F]{64}$/.test(envKey)) {
      throw new Error('EYAS_MASTER_KEY must be a 64-character hex string (256-bit key)')
    }
    const key = await importKey(envKey)
    return { key, source: 'env' }
  }

  // 2. Try OS keychain
  if (!options?.skipKeyring) {
    try {
      const { Entry } = await import('@napi-rs/keyring')
      const entry = new Entry('eyas-master', 'encryption-key')
      const stored = entry.getPassword()
      if (stored) {
        const key = await importKey(stored)
        return { key, source: 'keyring' }
      }
    } catch {
      // Keyring not available (Docker, missing libsecret, etc.)
    }
  }

  // 3. No key found
  return null
}

export async function storeMasterKeyInKeyring(hexKey: string): Promise<boolean> {
  try {
    const { Entry } = await import('@napi-rs/keyring')
    const entry = new Entry('eyas-master', 'encryption-key')
    entry.setPassword(hexKey)
    return true
  } catch {
    return false
  }
}
```

- [ ] **Step 3: Run tests**

```bash
cd /Users/eyssen/GitHub/eyas && bun vitest run tests/modules/secrets/master-key.test.ts
```

Expected: All 4 tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/modules/secrets/master-key.ts tests/modules/secrets/master-key.test.ts
git commit -m "feat(secrets): add master key provider chain (env → keyring → null)"
```

---

## Task 4: SecretsRegistry

**Files:**
- Create: `src/modules/secrets/registry.ts`
- Create: `tests/modules/secrets/registry.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/modules/secrets/registry.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
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
      expect((list[0] as any).iv).toBeUndefined()
      expect((list[0] as any).tag).toBeUndefined()
    })
  })

  describe('encryption verification', () => {
    it('values are encrypted at rest (raw DB has no plaintext)', async () => {
      await registry.set('raw-check', 'system', 'plaintext-secret')
      // Read directly from DB
      const rows = db.all(
        (await import('drizzle-orm')).sql`SELECT * FROM secrets WHERE name = 'raw-check' AND scope = 'system'`
      ) as any[]
      expect(rows[0].encrypted).not.toContain('plaintext-secret')
      expect(rows[0].iv).toBeTruthy()
      expect(rows[0].tag).toBeTruthy()
    })
  })
})
```

- [ ] **Step 2: Implement SecretsRegistry**

Create `src/modules/secrets/registry.ts`:

```typescript
import { sql } from 'drizzle-orm'
import { generateId } from '@shared/crypto'
import { encryptSecret, decryptSecret } from './crypto.js'
import type { SecretsRegistry, SecretMeta } from './types.js'

export function createSecretsRegistry(db: any, masterKey: CryptoKey): SecretsRegistry {
  function getOne<T>(query: any): T | undefined {
    const rows = db.all(query) as T[]
    return rows[0]
  }

  return {
    async get(name, scope) {
      const row = getOne<any>(sql`SELECT * FROM secrets WHERE name = ${name} AND scope = ${scope}`)
      if (!row) return null
      return decryptSecret(row.encrypted, row.iv, row.tag, masterKey)
    },

    async set(name, scope, value, module) {
      const { encrypted, iv, tag } = await encryptSecret(value, masterKey)
      const now = new Date().toISOString()
      const existing = getOne<any>(sql`SELECT id FROM secrets WHERE name = ${name} AND scope = ${scope}`)

      if (existing) {
        db.run(sql`UPDATE secrets SET encrypted = ${encrypted}, iv = ${iv}, tag = ${tag}, module = ${module ?? null}, updated_at = ${now} WHERE id = ${existing.id}`)
      } else {
        const id = generateId()
        db.run(sql`INSERT INTO secrets (id, name, scope, encrypted, iv, tag, module, created_at, updated_at) VALUES (${id}, ${name}, ${scope}, ${encrypted}, ${iv}, ${tag}, ${module ?? null}, ${now}, ${now})`)
      }
    },

    async delete(name, scope) {
      const existing = getOne<any>(sql`SELECT id FROM secrets WHERE name = ${name} AND scope = ${scope}`)
      if (!existing) return false
      db.run(sql`DELETE FROM secrets WHERE id = ${existing.id}`)
      return true
    },

    async list(scope) {
      const rows = db.all(sql`SELECT id, name, scope, module, created_at, updated_at FROM secrets WHERE scope = ${scope} ORDER BY name`) as any[]
      return rows.map((r: any) => ({
        id: r.id,
        name: r.name,
        scope: r.scope,
        module: r.module,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      }))
    },

    async has(name, scope) {
      const row = getOne<any>(sql`SELECT 1 FROM secrets WHERE name = ${name} AND scope = ${scope}`)
      return !!row
    },
  }
}
```

- [ ] **Step 3: Run tests**

```bash
cd /Users/eyssen/GitHub/eyas && bun vitest run tests/modules/secrets/registry.test.ts
```

Expected: All 12 tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/modules/secrets/registry.ts tests/modules/secrets/registry.test.ts
git commit -m "feat(secrets): add SecretsRegistry with encrypted storage and scope isolation"
```

---

## Task 5: Secrets API Routes

**Files:**
- Create: `src/modules/secrets/routes.ts`
- Create: `tests/modules/secrets/routes.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/modules/secrets/routes.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { errorHandler } from '@core/http/middleware/error-handler'
import { createTestDb, insertTestOwner } from '../../helpers/test-db'
import { createSecretsRegistry } from '@modules/secrets/registry'
import { generateMasterKey } from '@modules/secrets/crypto'
import { createSecretsRoutes } from '@modules/secrets/routes'
import { createAuthRoutes } from '@modules/auth/routes'
import { createPermissionRegistry } from '@modules/permissions/registry'
import { createTokenService } from '@modules/auth/token'
import type { SecretsRegistry } from '@modules/secrets/types'

const testDb = createTestDb('secrets-routes')
let db: ReturnType<typeof testDb.open>
let app: Hono
let secretsRegistry: SecretsRegistry
let ownerToken: string

beforeEach(async () => {
  db = testDb.open()
  const masterKey = await generateMasterKey()
  secretsRegistry = createSecretsRegistry(db, masterKey)
  const permRegistry = createPermissionRegistry()
  const tokenService = createTokenService('test-secret-that-is-at-least-32-characters-long!')

  app = new Hono()
  app.onError(errorHandler)
  createAuthRoutes(app, { db, registry: permRegistry, tokenService, sessionDuration: 86400, accessTokenDuration: 900, refreshTokenDuration: 2592000 })
  createSecretsRoutes(app, secretsRegistry)

  await insertTestOwner(db)
  const tokenRes = await app.request('/api/v1/auth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'testowner', password: 'testpassword123' }),
  })
  ownerToken = ((await tokenRes.json()) as any).accessToken
})

afterEach(() => {
  testDb.cleanup()
})

describe('POST /api/v1/secrets', () => {
  it('creates a secret', async () => {
    const res = await app.request('/api/v1/secrets', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'test-key', scope: 'system', value: 'secret123' }),
    })
    expect(res.status).toBe(201)
    const body = await res.json() as any
    expect(body.secret.name).toBe('test-key')
    expect(body.secret.scope).toBe('system')
    expect(body.secret.value).toBeUndefined() // Never returned
  })

  it('updates existing secret', async () => {
    await secretsRegistry.set('test-key', 'system', 'old')
    const res = await app.request('/api/v1/secrets', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'test-key', scope: 'system', value: 'new' }),
    })
    expect(res.status).toBe(200)
  })

  it('requires authentication', async () => {
    const res = await app.request('/api/v1/secrets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'test', scope: 'system', value: 'val' }),
    })
    expect(res.status).toBe(401)
  })
})

describe('GET /api/v1/secrets', () => {
  it('lists secrets without values', async () => {
    await secretsRegistry.set('key-a', 'system', 'val-a')
    await secretsRegistry.set('key-b', 'system', 'val-b')
    const res = await app.request('/api/v1/secrets?scope=system', {
      headers: { Authorization: `Bearer ${ownerToken}` },
    })
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.secrets).toHaveLength(2)
    expect(body.secrets[0].value).toBeUndefined()
  })

  it('filters by scope', async () => {
    await secretsRegistry.set('sys-key', 'system', 'val')
    await secretsRegistry.set('user-key', 'user:u1', 'val')
    const res = await app.request('/api/v1/secrets?scope=system', {
      headers: { Authorization: `Bearer ${ownerToken}` },
    })
    const body = await res.json() as any
    expect(body.secrets).toHaveLength(1)
    expect(body.secrets[0].name).toBe('sys-key')
  })
})

describe('DELETE /api/v1/secrets/:name', () => {
  it('deletes a secret', async () => {
    await secretsRegistry.set('delete-me', 'system', 'val')
    const res = await app.request('/api/v1/secrets/delete-me?scope=system', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${ownerToken}` },
    })
    expect(res.status).toBe(200)
    expect(await secretsRegistry.has('delete-me', 'system')).toBe(false)
  })

  it('returns 404 for non-existent', async () => {
    const res = await app.request('/api/v1/secrets/nope?scope=system', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${ownerToken}` },
    })
    expect(res.status).toBe(404)
  })
})
```

- [ ] **Step 2: Implement routes**

Create `src/modules/secrets/routes.ts`:

```typescript
import type { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { createAuthMiddleware } from '@modules/auth/middleware'
import type { SecretsRegistry } from './types.js'

export function createSecretsRoutes(app: Hono, secrets: SecretsRegistry): void {

  // All secrets endpoints require authentication
  // The auth middleware is already registered on the app by the auth module
  // We just need the permission checks here

  app.get('/api/v1/secrets', async (c) => {
    const userId = c.get('userId') as string | undefined
    if (!userId) throw new HTTPException(401, { message: 'Authentication required' })

    const scope = c.req.query('scope') || 'system'
    // Access check: system readable by all authenticated, user/agent only by owner
    const role = c.get('role') as string
    if (scope !== 'system' && role !== 'owner' && role !== 'admin') {
      const expectedScope = `user:${userId}`
      const agentScope = `agent:${userId}`
      if (scope !== expectedScope && scope !== agentScope) {
        throw new HTTPException(403, { message: 'Access denied to this scope' })
      }
    }

    const list = await secrets.list(scope)
    return c.json({ secrets: list })
  })

  app.post('/api/v1/secrets', async (c) => {
    const userId = c.get('userId') as string | undefined
    if (!userId) throw new HTTPException(401, { message: 'Authentication required' })

    const body = await c.req.json() as { name?: string; scope?: string; value?: string }
    if (!body.name || !body.scope || body.value === undefined) {
      throw new HTTPException(400, { message: 'name, scope, and value are required' })
    }

    // Write access: system only for owner/admin
    const role = c.get('role') as string
    if (body.scope === 'system' && role !== 'owner' && role !== 'admin') {
      throw new HTTPException(403, { message: 'Only owner/admin can write system secrets' })
    }
    if (body.scope !== 'system' && role !== 'owner' && role !== 'admin') {
      const expectedScope = `user:${userId}`
      const agentScope = `agent:${userId}`
      if (body.scope !== expectedScope && body.scope !== agentScope) {
        throw new HTTPException(403, { message: 'Access denied to this scope' })
      }
    }

    const existed = await secrets.has(body.name, body.scope)
    await secrets.set(body.name, body.scope, body.value)
    const list = await secrets.list(body.scope)
    const meta = list.find(s => s.name === body.name)
    return c.json({ secret: meta }, existed ? 200 : 201)
  })

  app.delete('/api/v1/secrets/:name', async (c) => {
    const userId = c.get('userId') as string | undefined
    if (!userId) throw new HTTPException(401, { message: 'Authentication required' })

    const name = c.req.param('name')
    const scope = c.req.query('scope') || 'system'

    const role = c.get('role') as string
    if (scope === 'system' && role !== 'owner' && role !== 'admin') {
      throw new HTTPException(403, { message: 'Only owner/admin can delete system secrets' })
    }

    const deleted = await secrets.delete(name, scope)
    if (!deleted) throw new HTTPException(404, { message: 'Secret not found' })
    return c.json({ message: 'Secret deleted' })
  })
}
```

- [ ] **Step 3: Run tests**

```bash
cd /Users/eyssen/GitHub/eyas && bun vitest run tests/modules/secrets/routes.test.ts
```

Expected: All 7 tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/modules/secrets/routes.ts tests/modules/secrets/routes.test.ts
git commit -m "feat(secrets): add secrets REST API routes with scope-based access control"
```

---

## Task 6: Secrets Module + Bootstrap + Setup Step

**Files:**
- Create: `src/modules/secrets/index.ts`
- Modify: `src/core/types.ts`
- Modify: `src/core/bootstrap.ts`

- [ ] **Step 1: Add SecretsRegistry to ModuleContext**

In `src/core/types.ts`, add:
- Import: `import type { SecretsRegistry } from '@modules/secrets/types'`
- Field: `secrets: SecretsRegistry` to `ModuleContext`

- [ ] **Step 2: Create secrets module**

Create `src/modules/secrets/index.ts`:

```typescript
import type { EyasModule, ModuleContext } from '@core/types'
import { sql } from 'drizzle-orm'
import { deriveMasterKey, generateMasterKey, exportKey, importKey } from './crypto.js'
import { resolveMasterKey, storeMasterKeyInKeyring } from './master-key.js'
import { createSecretsRoutes } from './routes.js'

let masterKeyRef: CryptoKey | null = null

export function getMasterKey(): CryptoKey | null {
  return masterKeyRef
}

export const secretsModule: EyasModule = {
  id: 'secrets',
  name: 'Secrets',
  version: '1.0.0',
  type: 'core',
  required: true,
  description: 'Encrypted secret storage with scope-based access control',
  dependencies: ['setup'],

  async onRegister(ctx: ModuleContext) {
    ctx.db.run(sql`
      CREATE TABLE IF NOT EXISTS secrets (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        scope TEXT NOT NULL,
        encrypted TEXT NOT NULL,
        iv TEXT NOT NULL,
        tag TEXT NOT NULL,
        module TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(name, scope)
      )
    `)

    // Register master password setup step
    ctx.setup.registerStep({
      id: 'master-password',
      module: 'secrets',
      title: 'Master Password',
      description: 'Set a master password to encrypt all stored secrets',
      required: true,
      order: 5,
      fields: [
        { name: 'masterPassword', type: 'password', label: 'Master Password', required: true },
        { name: 'confirmPassword', type: 'password', label: 'Confirm Password', required: true },
      ],
      async onComplete(data) {
        const password = data.masterPassword as string
        const confirm = data.confirmPassword as string
        if (password !== confirm) {
          throw new Error('Passwords do not match')
        }
        if (password.length < 8) {
          throw new Error('Master password must be at least 8 characters')
        }
        // Generate salt and derive key
        const salt = crypto.getRandomValues(new Uint8Array(16))
        const key = await deriveMasterKey(password, salt)
        const hexKey = await exportKey(key)
        // Store in OS keychain
        const storedInKeyring = await storeMasterKeyInKeyring(hexKey)
        if (!storedInKeyring) {
          ctx.logger.warn('Could not store master key in OS keychain — key will need to be provided via EYAS_MASTER_KEY env var on restart')
        }
        // Store salt in setup step data (non-secret)
        // The salt will be persisted by the setup registry in the step's data field
        ;(data as any).__salt = Buffer.from(salt).toString('base64')
        // Set the master key for this session
        masterKeyRef = key
      },
    })

    ctx.logger.info('Secrets module registered')
  },

  async onStart(ctx: ModuleContext) {
    // Try to resolve master key if not already set by setup step
    if (!masterKeyRef) {
      const result = await resolveMasterKey()
      if (result) {
        masterKeyRef = result.key
        ctx.logger.info(`Master key loaded from ${result.source}`)
      } else if (ctx.setup.isComplete()) {
        ctx.logger.error('FATAL: Setup is complete but no master key found. Secrets cannot be decrypted.')
        ctx.logger.error('Provide EYAS_MASTER_KEY env var or ensure OS keychain contains the key.')
      }
      // If setup not complete, the setup wizard will handle it
    }

    // Register routes (they will work once masterKey is available)
    if (masterKeyRef) {
      const { createSecretsRegistry } = await import('./registry.js')
      const registry = createSecretsRegistry(ctx.db, masterKeyRef)
      // Expose on context — bootstrap will wire this
      ;(ctx as any)._secretsRegistry = registry
      createSecretsRoutes(ctx.http, registry)
    }

    ctx.logger.info('Secrets module started')
  },

  async onStop() {
    masterKeyRef = null
  },
}
```

- [ ] **Step 3: Update bootstrap**

In `src/core/bootstrap.ts`:
1. Add imports:
```typescript
import { secretsModule, getMasterKey } from '@modules/secrets/index'
import { createSecretsRegistry } from '@modules/secrets/registry'
```

2. Create a placeholder SecretsRegistry (before the master key is available, operations will fail gracefully):
```typescript
// After setupReg creation, before ctx:
// SecretsRegistry placeholder — will be initialized when master key is available
const secretsPlaceholder: any = {
  get: async () => null,
  set: async () => { throw new Error('Secrets not initialized — complete setup first') },
  delete: async () => false,
  list: async () => [],
  has: async () => false,
}
```

3. Add `secrets: secretsPlaceholder` to ctx.

4. Register secrets module (after setup, before permissions):
```typescript
if (!moduleLoader.hasModule(secretsModule.id)) {
  moduleLoader.register(secretsModule)
}
```

5. After `startAll`, check if secrets module initialized a real registry:
```typescript
// After startAll:
if ((ctx as any)._secretsRegistry) {
  ctx.secrets = (ctx as any)._secretsRegistry
  delete (ctx as any)._secretsRegistry
}
```

- [ ] **Step 4: Update bootstrap test mock**

In `tests/core/bootstrap.test.ts`, add `secrets` mock to context if needed (same pattern as setup mock).

- [ ] **Step 5: Run all tests**

```bash
cd /Users/eyssen/GitHub/eyas && bun vitest run
```

- [ ] **Step 6: Commit**

```bash
git add src/modules/secrets/index.ts src/core/types.ts src/core/bootstrap.ts tests/core/bootstrap.test.ts
git commit -m "feat(secrets): wire secrets module into bootstrap with setup step and master key"
```

---

## Task 7: Auth Module — JWT Secret Migration

**Files:**
- Modify: `src/modules/auth/index.ts`

- [ ] **Step 1: Update auth module dependencies and onStart**

In `src/modules/auth/index.ts`:

1. Change `dependencies` to `['permissions', 'setup', 'secrets']`

2. Replace the `onStart` JWT secret logic:

```typescript
async onStart(ctx: ModuleContext) {
  // JWT secret priority: config → secrets vault → generate + persist
  let jwtSecret = ctx.config.auth.jwtSecret

  if (!jwtSecret) {
    jwtSecret = await ctx.secrets.get('jwt-secret', 'system')
  }

  if (!jwtSecret) {
    const bytes = new Uint8Array(32)
    crypto.getRandomValues(bytes)
    jwtSecret = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
    try {
      await ctx.secrets.set('jwt-secret', 'system', jwtSecret, 'auth')
      ctx.logger.info('JWT secret generated and stored in secrets vault')
    } catch {
      ctx.logger.warn('JWT secret auto-generated but could not be persisted (secrets not ready)')
    }
  }

  const tokenService = createTokenService(jwtSecret)
  // ... rest unchanged (createAuthRoutes call)
```

- [ ] **Step 2: Run all tests**

```bash
cd /Users/eyssen/GitHub/eyas && bun vitest run
```

- [ ] **Step 3: TypeScript check**

```bash
cd /Users/eyssen/GitHub/eyas && bunx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add src/modules/auth/index.ts
git commit -m "refactor(auth): migrate JWT secret to secrets vault with config fallback"
```

---

## Task 8: Full Integration Smoke Test

**Files:**
- No new files

- [ ] **Step 1: Run full test suite**

```bash
cd /Users/eyssen/GitHub/eyas && bun vitest run
```

Expected: All tests pass.

- [ ] **Step 2: TypeScript check**

```bash
cd /Users/eyssen/GitHub/eyas && bunx tsc --noEmit
```

- [ ] **Step 3: Dev server smoke test**

```bash
cd /Users/eyssen/GitHub/eyas
rm -f data/sqlite/eyas.db data/sqlite/eyas.db-wal data/sqlite/eyas.db-shm
bun src/main.ts &
sleep 3

# Setup should show 3 steps now (master-password, root-owner, first-agent)
curl -s http://localhost:3000/api/v1/setup/steps | python3 -c "
import sys,json
d=json.load(sys.stdin)
for s in d['steps']:
    print(f\"  [{s['order']}] {s['id']} — {s['status']}\")
"

# Complete master-password
curl -s -X POST http://localhost:3000/api/v1/setup/steps/master-password \
  -H "Content-Type: application/json" \
  -d '{"masterPassword":"MyMasterPass1!","confirmPassword":"MyMasterPass1!"}'

# Complete root-owner
curl -s -X POST http://localhost:3000/api/v1/setup/steps/root-owner \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"adminpass123","displayName":"Admin"}'

# Complete first-agent
curl -s -X POST http://localhost:3000/api/v1/setup/steps/first-agent \
  -H "Content-Type: application/json" \
  -d '{"name":"jarvis"}'

# Login and get token
TOKEN=$(curl -s -X POST http://localhost:3000/api/v1/auth/token \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"adminpass123"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['accessToken'])")

# Store a secret
curl -s -X POST http://localhost:3000/api/v1/secrets \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"test-api-key","scope":"system","value":"sk-test-12345"}'

# List secrets (should show name but not value)
curl -s "http://localhost:3000/api/v1/secrets?scope=system" \
  -H "Authorization: Bearer $TOKEN"

kill %1
```

- [ ] **Step 4: Fix any issues and commit**

```bash
# Only if fixes needed
git add -A && git commit -m "fix(secrets): integration smoke test fixes"
```

---

## Summary

| Task | Description | Tests |
|------|-------------|-------|
| 1 | Install keyring + types + schema | 0 (types/schema) |
| 2 | AES-256-GCM crypto module | 10 |
| 3 | Master key provider chain | 4 |
| 4 | SecretsRegistry | 12 |
| 5 | Secrets API routes | 7 |
| 6 | Secrets module + bootstrap + setup step | 0 (integration) |
| 7 | Auth JWT secret migration | 0 (refactor) |
| 8 | Full smoke test | 0 (manual) |

**Total new tests: ~33**
**New dependency: @napi-rs/keyring (MIT)**

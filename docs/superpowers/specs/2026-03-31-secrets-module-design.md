# Secrets Module Design

> EYAS 1.0 — Encrypted secret storage with scope-based access control

## Decisions

| Question | Decision | Rationale |
|----------|----------|-----------|
| Encryption | AES-256-GCM via Web Crypto API (zero-dep) | Bun native, audited standard, no external crypto library needed |
| Master key storage | `@napi-rs/keyring` (OS keychain) + env var fallback | Desktop: keychain; Docker/K8s: env var from K8s Secret |
| Master key source | User sets master password in setup wizard → PBKDF2 → key | User knows the password, can recover if keychain lost |
| Scope model | system / user:{id} / agent:{id} | System for shared, user/agent for isolation |
| API exposure | REST endpoints for CRUD + internal ModuleContext.secrets | Frontend, CLI, agents all self-service |
| JWT secret migration | Auth module uses ctx.secrets for JWT secret persistence | First consumer of secrets module, eliminates auto-regeneration on restart |

## Module Structure

```
src/modules/secrets/
  types.ts            ← SecretScope, SecretMeta, SecretsRegistry interface
  schema.ts           ← Drizzle: secrets table
  crypto.ts           ← AES-256-GCM encrypt/decrypt, PBKDF2 key derivation
  master-key.ts       ← Master key provider chain (env → keychain → auto-generate)
  registry.ts         ← SecretsRegistry implementation
  routes.ts           ← /api/v1/secrets/* endpoints
  index.ts            ← EyasModule implementation
```

**Dependencies:** `['setup']` — master password is collected during setup wizard.

**Dependents:** auth module adds `'secrets'` to its dependency list for JWT secret persistence.

## SecretsRegistry Interface

```typescript
interface SecretsRegistry {
  get(name: string, scope: string): Promise<string | null>
  set(name: string, scope: string, value: string, module?: string): Promise<void>
  delete(name: string, scope: string): Promise<boolean>
  list(scope: string): Promise<SecretMeta[]>
  has(name: string, scope: string): Promise<boolean>
}

interface SecretMeta {
  id: string
  name: string
  scope: string
  module: string | null
  createdAt: string
  updatedAt: string
}
```

Exposed on `ModuleContext` as `ctx.secrets`.

## Scope Model

| Scope | Format | Who can access | Example |
|-------|--------|---------------|---------|
| System | `system` | All users and agents (read); owner/admin (write) | JWT secret, shared API keys |
| User | `user:{userId}` | Only that user + owner/admin | Personal email password |
| Agent | `agent:{userId}` | Only that agent + owner/admin | Agent-specific API key |

The `userId` in scope corresponds to the user/agent's ID from the `users` table.

### Permission rules

- **Owner**: full access to all scopes
- **Admin**: full access to all scopes
- **User**: read/write own `user:{ownId}` + read `system`
- **Agent**: read/write own `agent:{ownId}` + read `system`; can write `system` only with explicit CASL permission
- **Guest**: no secret access

## Data Model

### secrets/schema.ts

```typescript
secrets: {
  id:         text PK (ULID)
  name:       text NOT NULL
  scope:      text NOT NULL       // 'system' | 'user:{id}' | 'agent:{id}'
  encrypted:  text NOT NULL       // AES-256-GCM ciphertext, base64
  iv:         text NOT NULL       // 12-byte initialization vector, base64
  tag:        text NOT NULL       // 16-byte auth tag, base64
  module:     text                // Which module created it (nullable)
  createdAt:  text NOT NULL
  updatedAt:  text NOT NULL
  UNIQUE(name, scope)
}
```

## Encryption

### AES-256-GCM via Web Crypto API

All secret values are encrypted before storage and decrypted on retrieval. The encryption uses:

- **Algorithm:** AES-256-GCM (authenticated encryption)
- **Key:** 256-bit master key (derived from master password via PBKDF2)
- **IV:** 12 bytes, randomly generated per encryption operation
- **Auth tag:** 16 bytes (built into GCM output)

```typescript
// Encrypt
async function encrypt(plaintext: string, masterKey: CryptoKey): Promise<{ encrypted: string; iv: string; tag: string }>

// Decrypt
async function decrypt(encrypted: string, iv: string, tag: string, masterKey: CryptoKey): Promise<string>
```

The IV and tag are stored alongside the ciphertext. Each secret gets a unique IV.

### PBKDF2 Key Derivation

Master password → master key:

```
PBKDF2(password, salt, iterations: 100000, hash: SHA-256) → 256-bit AES key
```

The salt is generated once at setup and stored in a well-known location (as a non-secret value in the DB or as a file). The derived key is then cached in the OS keychain for subsequent startups.

## Master Key Provider Chain

On startup, the secrets module resolves the master key:

```
1. EYAS_MASTER_KEY env var set?
   → Yes: use as hex-encoded 256-bit key directly
   → No: continue

2. @napi-rs/keyring available? (try/catch import)
   → Yes: read key from keychain ('eyas-master', 'encryption-key')
     → Found: use it
     → Not found: continue
   → No (Docker, missing libsecret): continue

3. No key found
   → If setup incomplete: setup wizard will collect master password
   → If setup complete but key lost: FATAL — log error, refuse to start
     (secrets exist but can't be decrypted)
```

### Docker/K8s deployment

```yaml
env:
  - name: EYAS_MASTER_KEY
    valueFrom:
      secretKeyRef:
        name: eyas-encryption
        key: master-key
```

The env var contains a hex-encoded 256-bit key (64 hex chars). No PBKDF2 derivation needed — the key is used directly.

## Setup Integration

The secrets module registers a setup step:

```typescript
ctx.setup.registerStep({
  id: 'master-password',
  module: 'secrets',
  title: 'Master Password',
  description: 'Set a master password to encrypt all stored secrets',
  required: true,
  order: 5,   // Before root-owner (order: 10) — secrets needed first
  fields: [
    { name: 'masterPassword', type: 'password', label: 'Master Password', required: true },
    { name: 'confirmPassword', type: 'password', label: 'Confirm Password', required: true },
  ],
  async onComplete(data) {
    // 1. Verify passwords match
    // 2. Generate random salt
    // 3. PBKDF2(password, salt) → masterKey
    // 4. Store derived key in OS keychain (or fallback file)
    // 5. Store salt in DB (setup_steps data or dedicated config)
    // 6. Initialize the SecretsRegistry with the key
  },
})
```

**Env var auto-complete:** `EYAS_MASTER_KEY` env var → auto-complete the master-password step (key used directly, no PBKDF2).

**Order: 5** — before root-owner (10) because the root owner's password hash doesn't need the secrets module, but the JWT secret (created in auth onStart) does. The secrets module needs its master key ready before auth starts.

## API Endpoints

All endpoints require authentication. Scope-based access checked per request.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/secrets` | List secrets (name, scope, module — NO values). Query param `?scope=system` to filter. |
| GET | `/api/v1/secrets/:name` | Check if secret exists. Query param `?scope=system`. Returns metadata only. |
| POST | `/api/v1/secrets` | Create or update a secret. Body: `{ name, scope, value }`. Value is encrypted before storage. |
| DELETE | `/api/v1/secrets/:name` | Delete a secret. Query param `?scope=system`. |

### POST /api/v1/secrets

Request:
```json
{
  "name": "anthropic-api-key",
  "scope": "system",
  "value": "sk-ant-..."
}
```

Response (201 created, 200 updated):
```json
{
  "secret": {
    "id": "01KN...",
    "name": "anthropic-api-key",
    "scope": "system",
    "module": null,
    "createdAt": "...",
    "updatedAt": "..."
  }
}
```

The `value` is NEVER returned in any API response. Only metadata.

### Access control

The routes check:
1. User is authenticated (via auth middleware)
2. For `system` scope: user must be owner or admin
3. For `user:{id}` / `agent:{id}` scope: user must be the owner of that scope, or owner/admin
4. Agents can read `system` scope but only write if they have explicit CASL permission

## Auth Module Changes

### Dependency update

```typescript
dependencies: ['permissions', 'setup', 'secrets']
```

### JWT secret from secrets vault

In auth module `onStart`, replace auto-generation with secrets lookup:

```typescript
async onStart(ctx: ModuleContext) {
  // Try config first (explicit override)
  let jwtSecret = ctx.config.auth.jwtSecret

  // Then try secrets vault
  if (!jwtSecret) {
    jwtSecret = await ctx.secrets.get('jwt-secret', 'system')
  }

  // Generate and persist if neither exists
  if (!jwtSecret) {
    const bytes = new Uint8Array(32)
    crypto.getRandomValues(bytes)
    jwtSecret = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
    await ctx.secrets.set('jwt-secret', 'system', jwtSecret, 'auth')
    ctx.logger.info('JWT secret generated and stored in secrets vault')
  }

  const tokenService = createTokenService(jwtSecret)
  // ... rest unchanged
}
```

## Bootstrap Changes

### ModuleContext extension

```typescript
interface ModuleContext {
  // ... existing fields ...
  permissions: PermissionRegistry
  setup: SetupRegistry
  secrets: SecretsRegistry
}
```

### Module registration order

```
1. setup       (no dependencies)
2. permissions  (no dependencies)
3. secrets     (depends: setup)
4. auth        (depends: permissions, setup, secrets)
```

## Dependencies

| Package | License | Purpose |
|---------|---------|---------|
| `@napi-rs/keyring` | MIT | OS keychain access (macOS Keychain, Linux libsecret, Windows Credential Manager) |

Native APIs (zero dependency):
- `crypto.subtle.encrypt/decrypt` — AES-256-GCM
- `crypto.subtle.deriveKey` — PBKDF2
- `crypto.getRandomValues` — IV generation

## Testing Strategy

- **Crypto tests:** encrypt → decrypt roundtrip, different IVs per operation, tamper detection
- **PBKDF2 tests:** deterministic derivation with same salt, different keys with different salts
- **Master key tests:** provider chain (env → keychain → fallback), mock keyring
- **Registry tests:** CRUD operations, scope isolation, unique constraint
- **Route tests:** permission enforcement (owner vs user vs agent access), no value in responses
- **Integration:** JWT secret persistence across "restarts" (new registry, same DB)

## Security Considerations

- Secret values are NEVER logged, NEVER returned in API responses
- Each secret gets a unique random IV (no IV reuse)
- AES-256-GCM provides authenticated encryption (tamper detection via auth tag)
- Master key is derived via PBKDF2 with 100k iterations (brute-force resistance)
- PBKDF2 salt is stored in DB (not secret, but unique per installation)
- Master password cleared from memory after key derivation
- `@napi-rs/keyring` uses OS-level secure storage (encrypted at rest by OS)
- In Docker: master key from env var is only as secure as the K8s Secret management

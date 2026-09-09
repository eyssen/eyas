# Auth + Permissions Module Design

> EYAS 1.0 — Phase 1: Authentication and Authorization

## Decisions

| Question | Decision | Rationale |
|----------|----------|-----------|
| User model | Owner + agents (multi-user ready schema) | Single owner initially, agents with varying permissions. Schema supports adding user/admin roles later without migration. |
| Auth flow | Hybrid — httpOnly cookie (web) + Bearer token (API/desktop/mobile) | Web UI needs CSRF-safe sessions; programmatic clients need stateless tokens. |
| AI action permissions | Define CASL structure + enum now, approval flow in Phase 6 | No frontend to display approval requests yet. `auto` = allow, `ask`/`ask_always` = deny until approval UI exists. |
| Password hashing | `Bun.password.hash()` with Argon2id | Zero dependency, native Bun API. Node.js fallback: `@node-rs/argon2`. |
| Permission extension | Modules register own subjects+actions via PermissionRegistry | Dynamic CASL abilities — permissions exist only for loaded modules. |

## Module Structure

Two separate modules with clear dependency:

```
src/modules/
  permissions/                 ← CASL ability engine, roles, middleware
    index.ts                   ← EyasModule implementation
    schema.ts                  ← Drizzle tables: roles, permission_defaults
    registry.ts                ← PermissionRegistry — modules register subjects/actions
    roles.ts                   ← Role definitions + CASL AbilityBuilder
    middleware.ts              ← Hono middleware: requirePermission()
    types.ts                   ← Role, Permission, Action, ActionLevel types
  auth/                        ← User CRUD, login, tokens, API keys
    index.ts                   ← EyasModule implementation (depends: ['permissions'])
    schema.ts                  ← Drizzle tables: users, sessions, api_keys
    routes.ts                  ← /api/v1/auth/* + /api/v1/users/* endpoints
    providers/
      local.ts                 ← Bun.password (Argon2id) + password validation
    token.ts                   ← JWT access + refresh token handling
    api-key.ts                 ← API key generation, hash, validation
    middleware.ts              ← Hono middleware: authenticate() (cookie + bearer)
    types.ts
```

**permissions** has zero module dependencies — it is a foundational module.
**auth** depends on permissions (assigns roles to users, embeds CASL abilities in tokens).

## Data Model

### permissions/schema.ts

```typescript
// Roles table — seeded with system roles on first boot
roles: {
  id:          text PK           // 'owner' | 'admin' | 'user' | 'agent' | 'guest'
  name:        text NOT NULL     // Display name
  description: text
  isSystem:    integer (bool)    // System roles cannot be deleted
  createdAt:   text (ISO 8601)
}
```

### auth/schema.ts

```typescript
// Users table — both humans and agents
users: {
  id:           text PK (ULID)
  username:     text UNIQUE NOT NULL
  displayName:  text NOT NULL
  email:        text UNIQUE          // nullable for agents
  passwordHash: text                 // nullable for agents (API key only)
  role:         text FK→roles.id     // 'owner' | 'admin' | 'user' | 'agent' | 'guest'
  isRootOwner:  integer (bool) DEFAULT 0  // First user — immutable, undeletable
  isAgent:      integer (bool) DEFAULT 0  // Agent accounts
  status:       text DEFAULT 'active'     // 'active' | 'suspended' | 'deleted'
  createdAt:    text (ISO 8601)
  updatedAt:    text (ISO 8601)
}

// Sessions table — web UI sessions (httpOnly cookie)
sessions: {
  id:         text PK (ULID)
  userId:     text FK→users.id NOT NULL
  tokenHash:  text NOT NULL          // SHA-256 of session token
  expiresAt:  text (ISO 8601) NOT NULL
  userAgent:  text                   // Browser/client info
  ipAddress:  text
  createdAt:  text (ISO 8601)
}

// API Keys table — long-lived programmatic access
api_keys: {
  id:         text PK (ULID)
  userId:     text FK→users.id NOT NULL
  name:       text NOT NULL          // User-assigned label
  keyPrefix:  text NOT NULL          // First 8 chars for identification
  keyHash:    text NOT NULL          // SHA-256 of full key
  lastUsedAt: text                   // Updated on each use
  expiresAt:  text                   // Nullable = no expiry
  createdAt:  text (ISO 8601)
  revokedAt:  text                   // Soft revoke
}
```

## Authentication Flows

### Web UI — httpOnly Cookie Session

```
Client                          Server
  |  POST /api/v1/auth/login      |
  |  { username, password }       |
  |------------------------------>|
  |                               |  Verify password (Bun.password.verify)
  |                               |  Create session in DB
  |  Set-Cookie: eyas_session=... |  (httpOnly, Secure, SameSite=Strict)
  |<------------------------------|
  |                               |
  |  GET /api/v1/auth/me          |
  |  Cookie: eyas_session=...     |
  |------------------------------>|
  |                               |  Lookup session by hash
  |  { user, permissions }        |  Check expiry, return user + CASL abilities
  |<------------------------------|
```

Session properties:
- httpOnly, Secure (HTTPS), SameSite=Strict
- Duration: 24 hours, sliding expiration (extended on activity)
- CSRF protection: `X-Eyas-Request: 1` custom header required on mutating requests

### API / Desktop / Mobile — Bearer Tokens

```
Client                          Server
  |  POST /api/v1/auth/token      |
  |  { username, password }       |
  |------------------------------>|
  |                               |  Verify password
  |  { accessToken, refreshToken, |  Access: 15min JWT
  |    expiresIn }                |  Refresh: 30 days, stored in DB
  |<------------------------------|
  |                               |
  |  GET /api/v1/...              |
  |  Authorization: Bearer <JWT>  |
  |------------------------------>|
  |                               |  Verify JWT signature + expiry
  |  { data }                     |  Extract userId + role from payload
  |<------------------------------|
  |                               |
  |  POST /auth/token/refresh     |
  |  { refreshToken }             |
  |------------------------------>|
  |                               |  Verify refresh token in DB
  |  { accessToken, expiresIn }   |  Issue new access token
  |<------------------------------|
```

JWT payload:
```typescript
{
  sub: string      // userId (ULID)
  role: string     // role id
  iat: number      // issued at
  exp: number      // expiration (15 min)
}
```

### API Key — Long-lived Access

```
Authorization: Bearer eyas_k1_<random>
```

Format: `eyas_k1_<32 random chars>` — the `eyas_k1_` prefix allows the authenticate middleware to distinguish API keys from JWTs. Only the SHA-256 hash is stored in DB.

### Authenticate Middleware — Detection Order

```typescript
// 1. Cookie present? → session lookup
// 2. Authorization: Bearer eyas_k1_... → API key lookup
// 3. Authorization: Bearer eyJ... → JWT verify
// 4. None → 401 Unauthorized
```

## Permission System

### Role Hierarchy

```
owner (full control)
  > admin (manage users, settings, modules)
    > user (CRUD own data, read public)
      > agent (only explicitly allowed actions)
        > guest (read-only)
```

### CASL Ability Building

Each role maps to CASL abilities. The `owner` gets `{ action: 'manage', subject: 'all' }`.
Other roles get specific subject+action combinations built from:
1. System defaults (hardcoded per role)
2. Module-registered subjects and their default permissions per role

### Modular Permission Extension

Modules extend the permission system via `PermissionRegistry`:

```typescript
interface PermissionRegistry {
  registerSubject(subject: string, config: {
    actions: string[]
    fields?: string[]
    defaults?: Partial<Record<RoleId, string[]>>  // role → allowed actions
  }): void

  getRegisteredSubjects(): SubjectRegistration[]
}
```

Example — Board module registering its permissions:

```typescript
async onRegister(ctx: ModuleContext) {
  ctx.permissions.registerSubject('board_task', {
    actions: ['create', 'read', 'update', 'delete', 'assign', 'move'],
    defaults: {
      admin: ['create', 'read', 'update', 'delete', 'assign', 'move'],
      user:  ['create', 'read', 'update', 'assign'],
      agent: ['read', 'update'],
      guest: ['read'],
    }
  })
}
```

The CASL AbilityBuilder consumes all registered subjects when building abilities for a user, merging system defaults with module-registered defaults.

### AI Action Types

```typescript
type ActionLevel = 'auto' | 'ask' | 'ask_always'
```

Defined now as an enum in the permissions types. The permission middleware enforces:
- `auto` → allowed (no user interaction)
- `ask` / `ask_always` → denied (returns 403 with `{ requiresApproval: true }`)

The interactive approval flow (WebSocket push to frontend, user confirms) will be implemented in Phase 6 (Agent module) when the frontend and WebSocket infrastructure exist.

### ModuleContext Extension

```typescript
interface ModuleContext {
  // ... existing fields ...
  permissions: PermissionRegistry
}
```

## Bootstrap — First Run Setup

When the database has zero users:

1. Server starts in **setup mode**
2. `GET /api/v1/auth/setup/status` → `{ needsSetup: true }`
3. `POST /api/v1/auth/setup` with `{ username, password, displayName? }` → creates root owner
4. Setup endpoints return 404 after first user exists

The root owner:
- `isRootOwner: true` — enforced by DB constraint
- Cannot be deleted (hard constraint in the delete handler)
- Role cannot be changed from `owner` (hard constraint in update handler)
- Only one root owner can exist (enforced at creation)

## API Endpoints

### Setup (unauthenticated, only when no users exist)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/auth/setup/status` | Check if setup is needed |
| POST | `/api/v1/auth/setup` | Create root owner |

### Auth (unauthenticated)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/auth/login` | Web session login (sets cookie) |
| POST | `/api/v1/auth/token` | Get access + refresh token pair |
| POST | `/api/v1/auth/token/refresh` | Refresh access token |

### Auth (authenticated)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/auth/logout` | End current session |
| GET | `/api/v1/auth/me` | Current user + permissions |
| PATCH | `/api/v1/auth/me` | Update own profile |

### Users (owner/admin only)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/users` | List users (with filters) |
| POST | `/api/v1/users` | Create user or agent |
| GET | `/api/v1/users/:id` | Get user details |
| PATCH | `/api/v1/users/:id` | Update role/status |
| DELETE | `/api/v1/users/:id` | Soft delete (root owner protected) |

### API Keys (authenticated)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/api-keys` | List own API keys |
| POST | `/api/v1/api-keys` | Generate new key (returned once) |
| DELETE | `/api/v1/api-keys/:id` | Revoke key |

## Dependencies

| Package | License | Purpose |
|---------|---------|---------|
| `jose` | MIT | JWT sign/verify — lightweight, zero-dependency, Web Crypto API |
| `@casl/ability` | MIT | Permission engine — define and check abilities |

Native APIs (zero dependency):
- `Bun.password.hash/verify` — Argon2id password hashing
- `crypto.randomUUID()` — ULID/UUID generation
- `crypto.subtle` — SHA-256 hashing for session/API key tokens

### Node.js Fallback

For Node.js 22+ compatibility:
- `@node-rs/argon2` as optional dependency (replaces `Bun.password`)
- `jose` works unchanged (uses Web Crypto API available in Node.js 20+)

## Testing Strategy

- Unit tests: CASL ability building per role, password hashing, token generation
- Integration tests: Full auth flows (login → session → authenticated request)
- Permission tests: Role hierarchy enforcement, root owner protection
- Module extension tests: Mock module registering subjects, verify CASL abilities update

## Security Considerations

- Passwords: Argon2id with auto-generated salt (Bun.password defaults)
- Sessions: SHA-256 hashed before DB storage — DB leak does not expose tokens
- API keys: SHA-256 hashed — only shown once at creation
- JWT: Signed with HMAC-SHA256, secret from `auth.jwtSecret` config key (auto-generated on first boot if not set, persisted to config)
- CSRF: SameSite=Strict cookies + X-Eyas-Request header on mutations
- Rate limiting: Login/token endpoints (5 attempts per minute per IP) — implemented in middleware
- Timing attacks: Constant-time comparison for token/key verification

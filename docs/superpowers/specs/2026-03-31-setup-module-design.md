# Setup Module Design

> EYAS 1.0 — First-boot setup wizard with modular step registry

## Decisions

| Question | Decision | Rationale |
|----------|----------|-----------|
| Field definition | Backend describes fields (name, type, label, required) — frontend renders dynamically | Enough for modules to define forms without JSON Schema dependency |
| Server behavior during setup | 503 + `{ setupRequired: true }` on all non-setup endpoints | Clear signal to clients; not an auth problem, distinct from 401 |
| Setup state persistence | DB table (`setup_steps`) per step | Survives server restarts mid-setup; user doesn't re-enter completed steps |
| Auth setup endpoint | Removed — auth registers setup steps instead | Single setup flow, no duplication |

## Module Structure

```
src/modules/setup/
  types.ts            ← SetupStepDefinition, SetupField, SetupStep types
  schema.ts           ← Drizzle: setup_steps table
  registry.ts         ← SetupRegistry — modules register steps, track completion
  middleware.ts       ← setupGuard — returns 503 when setup is incomplete
  routes.ts           ← /api/v1/setup/* endpoints (unauthenticated)
  index.ts            ← EyasModule implementation
```

**Dependencies:** None — this is a foundational module, loaded before all others.

**Dependents:** auth module adds `'setup'` to its dependency list and registers steps in `onRegister`.

## SetupRegistry Interface

```typescript
interface SetupRegistry {
  registerStep(step: SetupStepDefinition): void
  getSteps(): SetupStep[]
  isComplete(): boolean
  getStep(id: string): SetupStep | undefined
  completeStep(id: string, data: Record<string, unknown>): Promise<void>
  skipStep(id: string): Promise<void>
}
```

Exposed on `ModuleContext` as `ctx.setup`.

### SetupStepDefinition

```typescript
interface SetupStepDefinition {
  id: string              // Unique step ID: 'root-owner', 'first-agent'
  module: string          // Owning module: 'auth', 'telegram'
  title: string           // Display title for UI
  description: string     // Explains what this step configures
  required: boolean       // true = cannot be skipped
  order: number           // Sort order (10, 20, 30... gaps for insertion)
  fields: SetupField[]    // Form field definitions
  onComplete(data: Record<string, unknown>): Promise<void>  // Module executes this
}
```

### SetupField

```typescript
interface SetupField {
  name: string
  type: 'text' | 'password' | 'email' | 'toggle'
  label: string
  required: boolean
  placeholder?: string
  defaultValue?: string | boolean
}
```

### SetupStep (runtime state)

```typescript
interface SetupStep extends Omit<SetupStepDefinition, 'onComplete'> {
  status: 'pending' | 'completed' | 'skipped'
  completedAt: string | null
}
```

Note: `onComplete` is not exposed to the API — it's an internal callback. The API returns `SetupStep` (without the callback).

## Data Model

### setup/schema.ts

```typescript
setup_steps: {
  id:          text PK           // 'root-owner', 'first-agent'
  status:      text NOT NULL     // 'pending' | 'completed' | 'skipped'
  data:        text              // JSON of completed data (passwords excluded)
  completedAt: text              // ISO 8601 timestamp
}
```

The `data` field stores the submitted form data as JSON for reference, but **passwords are never stored** — the `onComplete` callback handles password hashing before the setup module persists anything. The registry strips fields with `type: 'password'` from the persisted data.

## Setup Guard Middleware

A global Hono middleware registered in bootstrap, before any module routes:

```
Request arrives
  → path is /api/v1/setup/* or /api/v1/health? → pass through
  → setupRegistry.isComplete()? → pass through
  → otherwise → 503 { error: 'Setup required', setupRequired: true }
```

The middleware is registered once and checks `isComplete()` on every request. Once all required steps are completed, `isComplete()` returns true and the middleware becomes a no-op (no performance overhead beyond a boolean check since the result is cached after completion).

## API Endpoints

All setup endpoints are **unauthenticated** — during setup there are no users yet.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/setup/status` | `{ complete: boolean, currentStep: string \| null, totalSteps: number, completedSteps: number }` |
| GET | `/api/v1/setup/steps` | Array of all steps with fields and status (ordered by `order`) |
| GET | `/api/v1/setup/steps/:id` | Single step details with fields |
| POST | `/api/v1/setup/steps/:id` | Complete a step — validates fields, calls `onComplete`, marks completed |
| POST | `/api/v1/setup/steps/:id/skip` | Skip a step (only if `required: false`) |

### POST /api/v1/setup/steps/:id

Request body: `{ [fieldName]: value }`

The endpoint:
1. Finds the step definition by ID
2. Validates all required fields are present
3. Validates field types (basic: string for text/password/email, boolean for toggle)
4. Calls `step.onComplete(data)` — the module handles business logic
5. Strips password fields from data
6. Persists `{ status: 'completed', data: sanitizedData, completedAt: now }` to DB
7. Returns `{ step: updatedStep }`

If `onComplete` throws, the step remains pending and the error is returned to the client.

### POST /api/v1/setup/steps/:id/skip

Returns 403 if `step.required === true`.

### Security

- Setup endpoints are only available while `isComplete()` returns false
- Once setup is complete, all setup endpoints return 404
- Passwords in step data are never persisted to the `setup_steps` table
- The setup guard middleware ensures no other functionality is accessible during setup

## Auth Module Changes

### Remove

- `GET /api/v1/auth/setup/status` endpoint
- `POST /api/v1/auth/setup` endpoint
- `setupSchema` from auth types (replaced by setup step field definitions)

### Add

In auth module `onRegister`, register two setup steps:

**Step 1: root-owner (order: 10, required: true)**

```typescript
ctx.setup.registerStep({
  id: 'root-owner',
  module: 'auth',
  title: 'Root Owner',
  description: 'Create the main administrator account',
  required: true,
  order: 10,
  fields: [
    { name: 'username', type: 'text', label: 'Username', required: true, placeholder: 'admin' },
    { name: 'password', type: 'password', label: 'Password', required: true },
    { name: 'displayName', type: 'text', label: 'Display Name', required: false, placeholder: 'Admin' },
  ],
  async onComplete(data) {
    // Same logic as current POST /api/v1/auth/setup:
    // hash password, insert user with isRootOwner=true, role='owner'
  },
})
```

**Step 2: first-agent (order: 20, required: true)**

```typescript
ctx.setup.registerStep({
  id: 'first-agent',
  module: 'auth',
  title: 'First Agent',
  description: 'Create your first AI agent',
  required: true,
  order: 20,
  fields: [
    { name: 'name', type: 'text', label: 'Agent Name', required: true, placeholder: 'assistant' },
  ],
  async onComplete(data) {
    // Insert user with isAgent=true, role='agent', no password
  },
})
```

### Auth module dependency update

```typescript
dependencies: ['permissions', 'setup']
```

## Bootstrap Changes

### ModuleContext extension

```typescript
interface ModuleContext {
  // ... existing fields ...
  permissions: PermissionRegistry
  setup: SetupRegistry
}
```

### Module registration order

```
1. setup (no dependencies)
2. permissions (no dependencies)
3. auth (depends: permissions, setup)
```

### Setup guard registration

After creating the Hono app and before module route registration:

```typescript
const app = createApp()
app.use('*', setupGuard(setupRegistry))  // Before module routes
```

## Env Var Auto-Complete (Headless Deploy)

In the setup module's `onStart`, check for environment variables and auto-complete required steps:

```
EYAS_SETUP_USERNAME    → root-owner step, field: username
EYAS_SETUP_PASSWORD    → root-owner step, field: password
EYAS_SETUP_DISPLAY_NAME → root-owner step, field: displayName (optional)
EYAS_SETUP_AGENT_NAME  → first-agent step, field: name
```

Logic:
1. If `EYAS_SETUP_USERNAME` and `EYAS_SETUP_PASSWORD` are set and root-owner step is pending → auto-complete
2. If `EYAS_SETUP_AGENT_NAME` is set and first-agent step is pending → auto-complete
3. Log which steps were auto-completed
4. Clear password from environment after use (`delete process.env.EYAS_SETUP_PASSWORD`)

This allows Docker/K8s deployments to pass credentials via secrets:
```yaml
env:
  - name: EYAS_SETUP_USERNAME
    value: "admin"
  - name: EYAS_SETUP_PASSWORD
    valueFrom:
      secretKeyRef:
        name: eyas-setup
        key: password
```

## Existing Test Impact

The auth route tests that use `POST /api/v1/auth/setup` will need updating:
- Tests must create a SetupRegistry, register the auth setup steps, and complete them through the setup API instead
- Or: tests directly insert a user into the DB in `beforeEach` (bypassing setup for auth-focused tests)

The simpler approach: test helpers that insert users directly. Setup module has its own dedicated tests.

## Testing Strategy

- Unit tests: SetupRegistry (register, complete, skip, isComplete, password stripping)
- Middleware tests: setupGuard (503 when incomplete, pass-through when complete, allow setup paths)
- Route tests: Full setup flow (get steps → complete step → verify status)
- Integration: Auth steps registered and executable through setup API
- Env var tests: Auto-complete with mock environment variables

## No New Dependencies

The setup module uses only existing project dependencies (Hono, Drizzle, Zod for field validation).

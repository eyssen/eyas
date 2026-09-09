# EYAS 1.0 Stabilization & Completion — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close all gaps between the EYAS architecture spec (48 sections) and current implementation — fix broken tests, add 9 missing modules, implement WebSocket/streaming, harden security, add CLI, Docker, and documentation.

**Architecture:** 5-wave parallel execution with gate checks between waves. Each wave runs 3-5 worktree subagents simultaneously. RalphTUI tracks epics. Every task produces working, tested code.

**Tech Stack:** Bun 1.x, TypeScript 5.9+, Hono, Drizzle ORM, SQLite WAL, Vitest, React 19, Zustand, TanStack Router, shadcn/ui

**Spec:** `docs/superpowers/specs/2026-04-06-stabilization-completion-design.md`

---

## File Structure Overview

### New files by wave

**Wave 1 (Foundation):**
- `src/shared/platform.ts` — runtime detection
- `src/core/http/websocket.ts` — WS upgrade + connection registry
- `src/core/http/ws-bridge.ts` — bus→WS bridge
- `src/web/src/hooks/use-websocket.ts` — React WS hook
- `src/web/src/stores/websocket-store.ts` — WS state
- `src/modules/permissions/ability-factory.ts` — CASL builder
- `config/personality/permissions.yaml` — role rules
- `src/modules/model/submodules/ollama/` (4 files)

**Wave 2 (Core modules):**
- `src/modules/audit/` (6 files)
- `src/modules/notifications/` (7 files)
- `src/modules/privacy/` (7 files)
- `src/core/config/watcher.ts`
- `src/web/src/hooks/use-streaming.ts`

**Wave 3 (Advanced):**
- `src/modules/observability/` (6 files)
- `src/modules/research/` (7 files)
- `src/web/src/components/a2ui/` (8 files)
- `src/cli/` (8 files)

**Wave 4 (Deploy + Protocols):**
- `src/modules/communication/submodules/a2a/` (5 files)
- `Dockerfile`, `docker-compose.yml`, `.dockerignore`
- `deploy/k8s/` (6 files)
- `src/modules/ingress/` (4 files)
- `src/modules/remote-node/` (4 files)
- `src/modules/meeting/` (5 files)
- `src/modules/disaster-recovery/` (5 files)

**Wave 5 (Docs + Tests):**
- `tests/e2e/lifecycle.test.ts`
- `tests/integration/` (3 files)
- `scripts/test-all.sh`

---

## Wave Gate Protocol

After each wave, run:
```bash
bun run build && vitest --run
```
Both must succeed (0 errors, 0 test failures) before starting the next wave.

---

## WAVE 1 — FOUNDATION

### Task 1: Fix Tests (Bun/Node Compatibility)

**Files:**
- Create: `src/shared/platform.ts`
- Modify: `src/shared/crypto.ts` (add password functions)
- Modify: `src/modules/auth/providers/local.ts:1-7` (use shared crypto)
- Modify: `vitest.config.ts` (add setup file)
- Create: `tests/setup.ts`
- Fix: All 43 failing test files (collection errors)

- [ ] **Step 1: Create platform detection**

```typescript
// src/shared/platform.ts
export const isBun = typeof globalThis.Bun !== 'undefined'

export const runtime = isBun ? 'bun' : 'node' as const
```

- [ ] **Step 2: Add cross-platform password hashing to shared/crypto.ts**

Add to existing `src/shared/crypto.ts` (which already has `sha256`, `generateId`, `constantTimeEqual`):

```typescript
import { isBun } from './platform.js'

export async function hashPassword(password: string): Promise<string> {
  if (isBun) {
    return Bun.password.hash(password, { algorithm: 'argon2id' })
  }
  const { hash } = await import('argon2')
  return hash(password)
}

export async function verifyPassword(password: string, hashed: string): Promise<boolean> {
  if (isBun) {
    return Bun.password.verify(password, hashed)
  }
  const { verify } = await import('argon2')
  return verify(hashed, password)
}
```

- [ ] **Step 3: Install argon2 as optional dependency**

```bash
bun add argon2
```

Verify it's MIT licensed: `cat node_modules/argon2/LICENSE` → MIT.

- [ ] **Step 4: Update auth local provider to use shared crypto**

Replace `src/modules/auth/providers/local.ts`:

```typescript
import { hashPassword, verifyPassword } from '@shared/crypto.js'

export { hashPassword, verifyPassword }
```

- [ ] **Step 5: Create vitest setup file for Bun API stubs**

```typescript
// tests/setup.ts
import { vi } from 'vitest'

// Stub Bun global if not present (running in Node via Vitest)
if (typeof globalThis.Bun === 'undefined') {
  // @ts-expect-error — stub for test environment
  globalThis.Bun = undefined
}
```

Update `vitest.config.ts` — add `setupFiles`:

```typescript
export default defineConfig({
  test: {
    setupFiles: ['./tests/setup.ts'],
    // ... rest stays the same
  },
})
```

- [ ] **Step 6: Fix all failing test files**

Run `vitest --run 2>&1 | grep FAIL` and fix each file:
- Most failures are from `Bun.password.hash` → now fixed by shared crypto
- Other collection errors: check import paths, missing type exports
- For each fix, run the specific test file to verify: `vitest --run tests/modules/<path>.test.ts`

- [ ] **Step 7: Run full test suite**

```bash
vitest --run
```

Expected: 0 FAIL, 234+ tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/shared/platform.ts src/shared/crypto.ts src/modules/auth/providers/local.ts tests/setup.ts vitest.config.ts
git add -u  # any other fixed test files
git commit -m "fix: cross-platform Bun/Node compatibility — all tests pass"
```

---

### Task 2: WebSocket Core Infrastructure

**Files:**
- Create: `src/core/http/websocket.ts`
- Create: `src/core/http/ws-bridge.ts`
- Modify: `src/core/http/server.ts:5-23` (add WS upgrade)
- Create: `src/web/src/hooks/use-websocket.ts`
- Create: `src/web/src/stores/websocket-store.ts`
- Create: `tests/core/websocket.test.ts`

- [ ] **Step 1: Write WebSocket connection test**

```typescript
// tests/core/websocket.test.ts
import { describe, it, expect, vi } from 'vitest'
import { createWSConnectionRegistry } from '@core/http/websocket.js'

describe('WebSocket Connection Registry', () => {
  it('registers and unregisters connections', () => {
    const registry = createWSConnectionRegistry()
    const mockWs = { send: vi.fn(), close: vi.fn(), readyState: 1 } as any
    
    registry.add('user1', mockWs)
    expect(registry.getConnections('user1')).toHaveLength(1)
    
    registry.remove('user1', mockWs)
    expect(registry.getConnections('user1')).toHaveLength(0)
  })

  it('subscribes to topics and receives messages', () => {
    const registry = createWSConnectionRegistry()
    const mockWs = { send: vi.fn(), close: vi.fn(), readyState: 1 } as any
    
    registry.add('user1', mockWs)
    registry.subscribe('user1', mockWs, 'board:project1')
    
    registry.broadcast('board:project1', { event: 'task.created', data: { id: '1' } })
    
    expect(mockWs.send).toHaveBeenCalledOnce()
    const sent = JSON.parse(mockWs.send.mock.calls[0][0])
    expect(sent.topic).toBe('board:project1')
    expect(sent.event).toBe('task.created')
  })

  it('does not send to unsubscribed connections', () => {
    const registry = createWSConnectionRegistry()
    const mockWs1 = { send: vi.fn(), close: vi.fn(), readyState: 1 } as any
    const mockWs2 = { send: vi.fn(), close: vi.fn(), readyState: 1 } as any
    
    registry.add('user1', mockWs1)
    registry.add('user2', mockWs2)
    registry.subscribe('user1', mockWs1, 'board:project1')
    
    registry.broadcast('board:project1', { event: 'test', data: {} })
    
    expect(mockWs1.send).toHaveBeenCalledOnce()
    expect(mockWs2.send).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
vitest --run tests/core/websocket.test.ts
```

Expected: FAIL — `createWSConnectionRegistry` not found.

- [ ] **Step 3: Implement WebSocket connection registry**

```typescript
// src/core/http/websocket.ts
import type { ServerWebSocket } from 'bun'

export interface WSConnection {
  send: (data: string) => void
  close: () => void
  readyState: number
}

export interface WSConnectionRegistry {
  add(userId: string, ws: WSConnection): void
  remove(userId: string, ws: WSConnection): void
  getConnections(userId: string): WSConnection[]
  subscribe(userId: string, ws: WSConnection, topic: string): void
  unsubscribe(userId: string, ws: WSConnection, topic: string): void
  broadcast(topic: string, message: { event: string; data: unknown }): void
  broadcastToUser(userId: string, message: { event: string; data: unknown }): void
}

export function createWSConnectionRegistry(): WSConnectionRegistry {
  const connections = new Map<string, Set<WSConnection>>()
  const subscriptions = new Map<WSConnection, Set<string>>()

  return {
    add(userId, ws) {
      if (!connections.has(userId)) connections.set(userId, new Set())
      connections.get(userId)!.add(ws)
      subscriptions.set(ws, new Set())
    },

    remove(userId, ws) {
      connections.get(userId)?.delete(ws)
      if (connections.get(userId)?.size === 0) connections.delete(userId)
      subscriptions.delete(ws)
    },

    getConnections(userId) {
      return [...(connections.get(userId) ?? [])]
    },

    subscribe(_userId, ws, topic) {
      subscriptions.get(ws)?.add(topic)
    },

    unsubscribe(_userId, ws, topic) {
      subscriptions.get(ws)?.delete(topic)
    },

    broadcast(topic, message) {
      const payload = JSON.stringify({ topic, ...message })
      for (const [ws, topics] of subscriptions) {
        if (topics.has(topic) && ws.readyState === 1) {
          ws.send(payload)
        }
      }
    },

    broadcastToUser(userId, message) {
      const payload = JSON.stringify(message)
      for (const ws of connections.get(userId) ?? []) {
        if (ws.readyState === 1) ws.send(payload)
      }
    },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
vitest --run tests/core/websocket.test.ts
```

Expected: PASS (3 tests).

- [ ] **Step 5: Implement Bus→WS bridge**

```typescript
// src/core/http/ws-bridge.ts
import type { EyasBus } from '@core/types.js'
import type { WSConnectionRegistry } from './websocket.js'

interface TopicMapping {
  busPattern: string
  topicExtractor: (subject: string, data: any) => string | null
}

const TOPIC_MAPPINGS: TopicMapping[] = [
  {
    busPattern: 'eyas.board.',
    topicExtractor: (_subject, data) => data?.projectId ? `board:${data.projectId}` : null,
  },
  {
    busPattern: 'eyas.notify',
    topicExtractor: (_subject, data) => data?.userId ? `notifications:${data.userId}` : null,
  },
  {
    busPattern: 'eyas.agent.',
    topicExtractor: (_subject, data) => data?.sessionId ? `agent:${data.sessionId}` : null,
  },
  {
    busPattern: 'eyas.conversation.',
    topicExtractor: (_subject, data) => data?.conversationId ? `chat:${data.conversationId}` : null,
  },
  {
    busPattern: 'eyas.module.',
    topicExtractor: () => 'system',
  },
  {
    busPattern: 'eyas.budget.',
    topicExtractor: () => 'system',
  },
]

export function createWSBridge(bus: EyasBus, registry: WSConnectionRegistry) {
  for (const mapping of TOPIC_MAPPINGS) {
    bus.on(mapping.busPattern + '*', (data: any, subject: string) => {
      const topic = mapping.topicExtractor(subject, data)
      if (topic) {
        registry.broadcast(topic, {
          event: subject.replace('eyas.', ''),
          data,
        })
      }
    })
  }
}
```

- [ ] **Step 6: Add WS upgrade to Hono server**

Modify `src/core/http/server.ts` — add WebSocket upgrade route. The exact integration depends on Hono's WS adapter for Bun. Add after the health endpoint:

```typescript
// Add to createApp() in server.ts
import { createWSConnectionRegistry } from './websocket.js'

// Export registry so bootstrap can access it
export const wsRegistry = createWSConnectionRegistry()

// WS upgrade endpoint (Bun native)
// The actual WS handling happens in bootstrap.ts where Bun.serve is called
```

Note: Bun's WebSocket is configured in `Bun.serve()` in `src/main.ts`, not in Hono routes. The subagent should read `src/main.ts` to understand the server setup and add WebSocket upgrade there.

- [ ] **Step 7: Create frontend WebSocket hook**

```typescript
// src/web/src/hooks/use-websocket.ts
import { useEffect, useRef, useCallback } from 'react'
import { useAuthStore } from '../stores/auth-store'

type MessageHandler = (data: { topic: string; event: string; data: unknown }) => void

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null)
  const handlersRef = useRef<Map<string, Set<MessageHandler>>>(new Map())
  const token = useAuthStore((s) => s.token)

  useEffect(() => {
    if (!token) return

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws?token=${token}`)
    wsRef.current = ws

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data)
        const handlers = handlersRef.current.get(msg.topic)
        handlers?.forEach((handler) => handler(msg))
      } catch { /* ignore parse errors */ }
    }

    ws.onclose = () => {
      // Reconnect after 3 seconds
      setTimeout(() => {
        wsRef.current = null
      }, 3000)
    }

    return () => {
      ws.close()
      wsRef.current = null
    }
  }, [token])

  const subscribe = useCallback((topic: string, handler: MessageHandler) => {
    if (!handlersRef.current.has(topic)) {
      handlersRef.current.set(topic, new Set())
      // Send subscribe message to server
      wsRef.current?.send(JSON.stringify({ type: 'subscribe', topic }))
    }
    handlersRef.current.get(topic)!.add(handler)

    return () => {
      handlersRef.current.get(topic)?.delete(handler)
      if (handlersRef.current.get(topic)?.size === 0) {
        handlersRef.current.delete(topic)
        wsRef.current?.send(JSON.stringify({ type: 'unsubscribe', topic }))
      }
    }
  }, [])

  return { subscribe }
}
```

- [ ] **Step 8: Commit**

```bash
git add src/core/http/websocket.ts src/core/http/ws-bridge.ts src/core/http/server.ts src/main.ts
git add src/web/src/hooks/use-websocket.ts tests/core/websocket.test.ts
git commit -m "feat: WebSocket core — connection registry, bus bridge, React hook"
```

---

### Task 3: CASL Permissions Engine

**Files:**
- Modify: `src/modules/permissions/ability-factory.ts` (already exists as `roles.ts`)
- Modify: `src/modules/permissions/middleware.ts:5-16` (enhance)
- Modify: `src/modules/permissions/schema.ts` (add overrides table)
- Modify: `src/modules/permissions/index.ts` (subject registry)
- Create: `config/personality/permissions.yaml`
- Modify: `src/modules/permissions/types.ts` (extend)
- Create: `tests/modules/permissions/ability-factory.test.ts`
- Modify: All route files (add permission middleware)

Note: `@casl/ability` is already in package.json dependencies.

- [ ] **Step 1: Write CASL ability factory test**

```typescript
// tests/modules/permissions/ability-factory.test.ts
import { describe, it, expect } from 'vitest'
import { buildAbilityForRole } from '@modules/permissions/ability-factory.js'

describe('CASL Ability Factory', () => {
  it('owner can manage everything', () => {
    const ability = buildAbilityForRole('owner')
    expect(ability.can('manage', 'all')).toBe(true)
    expect(ability.can('delete', 'User')).toBe(true)
    expect(ability.can('read', 'AuditEntry')).toBe(true)
  })

  it('guest can only read public resources', () => {
    const ability = buildAbilityForRole('guest')
    expect(ability.can('read', 'Conversation')).toBe(true)
    expect(ability.can('create', 'Conversation')).toBe(false)
    expect(ability.can('delete', 'User')).toBe(false)
    expect(ability.can('manage', 'Secret')).toBe(false)
  })

  it('user can CRUD own conversations but not users', () => {
    const ability = buildAbilityForRole('user')
    expect(ability.can('create', 'Conversation')).toBe(true)
    expect(ability.can('read', 'Conversation')).toBe(true)
    expect(ability.can('update', 'Conversation')).toBe(true)
    expect(ability.can('delete', 'Conversation')).toBe(true)
    expect(ability.can('create', 'User')).toBe(false)
    expect(ability.can('manage', 'Secret')).toBe(false)
  })

  it('admin can manage users but not secrets module config', () => {
    const ability = buildAbilityForRole('admin')
    expect(ability.can('create', 'User')).toBe(true)
    expect(ability.can('delete', 'User')).toBe(true)
    expect(ability.can('read', 'Secret')).toBe(true)
  })

  it('agent can use tools and conversations but not admin features', () => {
    const ability = buildAbilityForRole('agent')
    expect(ability.can('create', 'Conversation')).toBe(true)
    expect(ability.can('execute', 'Tool')).toBe(true)
    expect(ability.can('create', 'User')).toBe(false)
    expect(ability.can('manage', 'Module')).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
vitest --run tests/modules/permissions/ability-factory.test.ts
```

Expected: FAIL (function signature may differ from existing `roles.ts`).

- [ ] **Step 3: Implement ability factory**

Read existing `src/modules/permissions/roles.ts` (which already has `buildAbilityForRole`). Enhance it to cover all subjects:

```typescript
// src/modules/permissions/ability-factory.ts
import { AbilityBuilder, PureAbility } from '@casl/ability'

export type AppAbility = PureAbility<[string, string]>

// All subjects that modules can register
const ALL_SUBJECTS = [
  'Conversation', 'ConversationMessage', 'Project', 'ProjectType', 'Stage',
  'User', 'Session', 'ApiKey', 'Secret', 'Module',
  'Agent', 'AgentSession', 'Tool', 'Skill',
  'Document', 'KnowledgePage', 'KnowledgeSpace',
  'MemoryEntry', 'SearchSource',
  'AuditEntry', 'Notification', 'SchedulerJob',
  'Tag', 'Activity', 'ChatterMessage',
] as const

export function buildAbilityForRole(role: string, overrides?: Array<{ action: string; subject: string; allow: boolean }>): AppAbility {
  const { can, cannot, build } = new AbilityBuilder<AppAbility>(PureAbility)

  switch (role) {
    case 'owner':
      can('manage', 'all')
      break

    case 'admin':
      can('manage', 'User')
      can('manage', 'ApiKey')
      can('manage', 'Conversation')
      can('manage', 'Project')
      can('manage', 'ProjectType')
      can('manage', 'Stage')
      can('manage', 'Agent')
      can('manage', 'Skill')
      can('manage', 'Document')
      can('manage', 'KnowledgePage')
      can('manage', 'KnowledgeSpace')
      can('manage', 'Tag')
      can('manage', 'Activity')
      can('manage', 'SchedulerJob')
      can('read', 'Secret')
      can('create', 'Secret')
      can('read', 'AuditEntry')
      can('read', 'Module')
      can('manage', 'Notification')
      can('manage', 'SearchSource')
      break

    case 'user':
      can('create', 'Conversation')
      can('read', 'Conversation')
      can('update', 'Conversation')
      can('delete', 'Conversation')
      can('create', 'ConversationMessage')
      can('read', 'ConversationMessage')
      can('read', 'Project')
      can('read', 'Stage')
      can('read', 'Agent')
      can('read', 'Skill')
      can('manage', 'Document')
      can('manage', 'KnowledgePage')
      can('read', 'KnowledgeSpace')
      can('read', 'SearchSource')
      can('read', 'Tag')
      can('manage', 'Activity')
      can('read', 'Notification')
      can('update', 'Notification') // mark as read
      can('read', 'MemoryEntry')
      can('create', 'MemoryEntry')
      break

    case 'agent':
      can('create', 'Conversation')
      can('read', 'Conversation')
      can('update', 'Conversation')
      can('create', 'ConversationMessage')
      can('read', 'ConversationMessage')
      can('execute', 'Tool')
      can('read', 'Skill')
      can('read', 'MemoryEntry')
      can('create', 'MemoryEntry')
      can('read', 'Document')
      can('read', 'KnowledgePage')
      can('read', 'SearchSource')
      break

    case 'guest':
      can('read', 'Conversation')
      can('read', 'ConversationMessage')
      can('read', 'Project')
      can('read', 'KnowledgePage')
      break

    default:
      // Unknown role — no permissions
      break
  }

  // Apply overrides
  if (overrides) {
    for (const o of overrides) {
      if (o.allow) can(o.action, o.subject)
      else cannot(o.action, o.subject)
    }
  }

  return build()
}
```

- [ ] **Step 4: Run tests**

```bash
vitest --run tests/modules/permissions/ability-factory.test.ts
```

Expected: PASS.

- [ ] **Step 5: Enhance permission middleware**

Update `src/modules/permissions/middleware.ts` to use the new factory:

```typescript
import type { Context, Next } from 'hono'
import { buildAbilityForRole } from './ability-factory.js'

export function requirePermission(action: string, subject: string) {
  return async (c: Context, next: Next) => {
    const user = c.get('user')
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const ability = buildAbilityForRole(user.role)
    if (!ability.can(action, subject)) {
      return c.json({ error: 'Forbidden', detail: `Cannot ${action} ${subject}` }, 403)
    }

    await next()
  }
}
```

- [ ] **Step 6: Apply permission middleware to ALL existing route files**

For each route file in `src/modules/*/routes.ts`, add appropriate permission checks. Example for conversations:

```typescript
// In src/modules/conversations/routes.ts — add after auth middleware
import { requirePermission } from '@modules/permissions/middleware.js'

// GET /api/v1/conversations — add requirePermission('read', 'Conversation')
// POST /api/v1/conversations — add requirePermission('create', 'Conversation')
// PATCH /api/v1/conversations/:id — add requirePermission('update', 'Conversation')
// DELETE /api/v1/conversations/:id — add requirePermission('delete', 'Conversation')
```

Apply to: auth routes (admin), board routes (user), documents routes (user), knowledge routes (user), memory routes (user), model routes (admin for config, user for usage), search routes (user), secrets routes (admin), agent routes (user for run, admin for CRUD), scheduler routes (admin), skills routes (admin for CRUD, user for read).

- [ ] **Step 7: Create permissions config YAML**

```yaml
# config/personality/permissions.yaml
permissions:
  roles:
    owner:
      description: "Full system access"
    admin:
      description: "User and resource management"
    user:
      description: "Standard user access"
    agent:
      description: "AI agent execution access"
    guest:
      description: "Read-only access"
  ai_actions:
    file_write: ask
    shell_exec: ask_always
    git_push: ask_always
    db_delete: ask
```

- [ ] **Step 8: Commit**

```bash
git add src/modules/permissions/ config/personality/permissions.yaml tests/modules/permissions/
git add -u  # modified route files
git commit -m "feat: CASL permissions engine — role-based access control on all routes"
```

---

### Task 4: Ollama Provider

**Files:**
- Create: `src/modules/model/submodules/ollama/manifest.ts`
- Create: `src/modules/model/submodules/ollama/provider.ts`
- Create: `src/modules/model/submodules/ollama/adapter.ts`
- Create: `src/modules/model/submodules/ollama/index.ts`
- Modify: `src/modules/model/index.ts:22` (add ollama to submodule list)
- Create: `tests/modules/model/ollama-adapter.test.ts`

- [ ] **Step 1: Write Ollama adapter test**

```typescript
// tests/modules/model/ollama-adapter.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createOllamaAdapter } from '@modules/model/submodules/ollama/adapter.js'

// Mock fetch
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

describe('Ollama Adapter', () => {
  beforeEach(() => {
    mockFetch.mockReset()
  })

  it('lists available models', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        models: [
          { name: 'llama3.2:latest', size: 2000000000, details: { family: 'llama', parameter_size: '3B' } },
          { name: 'nomic-embed-text:latest', size: 500000000, details: { family: 'nomic', parameter_size: '137M' } },
        ],
      }),
    })

    const adapter = createOllamaAdapter('http://localhost:11434')
    const models = await adapter.listModels()

    expect(models).toHaveLength(2)
    expect(models[0].id).toBe('llama3.2:latest')
    expect(mockFetch).toHaveBeenCalledWith('http://localhost:11434/api/tags')
  })

  it('sends chat completion request', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        message: { role: 'assistant', content: 'Hello!' },
        total_duration: 1000000000,
        eval_count: 10,
        prompt_eval_count: 5,
      }),
    })

    const adapter = createOllamaAdapter('http://localhost:11434')
    const result = await adapter.complete({
      model: 'llama3.2:latest',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }],
    })

    expect(result.content).toContain('Hello!')
    expect(result.usage.outputTokens).toBe(10)
  })

  it('generates embeddings', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        embeddings: [[0.1, 0.2, 0.3, 0.4]],
      }),
    })

    const adapter = createOllamaAdapter('http://localhost:11434')
    const embeddings = await adapter.embed('nomic-embed-text', 'Hello world')

    expect(embeddings).toHaveLength(4)
    expect(embeddings[0]).toBe(0.1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
vitest --run tests/modules/model/ollama-adapter.test.ts
```

- [ ] **Step 3: Implement Ollama adapter**

```typescript
// src/modules/model/submodules/ollama/adapter.ts
import type { ModelRequest, ModelResponse, ModelInfo, StreamEvent } from '../../types.js'

export interface OllamaAdapter {
  listModels(): Promise<ModelInfo[]>
  complete(request: ModelRequest): Promise<ModelResponse>
  stream(request: ModelRequest): AsyncIterable<StreamEvent>
  embed(model: string, text: string): Promise<number[]>
  ping(): Promise<boolean>
}

export function createOllamaAdapter(baseUrl: string): OllamaAdapter {
  async function listModels(): Promise<ModelInfo[]> {
    const res = await fetch(`${baseUrl}/api/tags`)
    if (!res.ok) throw new Error(`Ollama API error: ${res.status}`)
    const data = await res.json() as { models: Array<{ name: string; size: number; details: { family: string; parameter_size: string } }> }
    return data.models.map((m) => ({
      id: m.name,
      name: m.name,
      provider: 'ollama',
      contextWindow: 4096, // Ollama doesn't expose this, use default
      maxOutput: 4096,
      supportsStreaming: true,
      supportsTools: true,
      supportsVision: false,
    }))
  }

  async function complete(request: ModelRequest): Promise<ModelResponse> {
    const messages = request.messages.map((m) => ({
      role: m.role,
      content: m.content.map((c) => c.type === 'text' ? c.text : '').join(''),
    }))

    const res = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: request.model,
        messages,
        stream: false,
        ...(request.tools?.length ? { tools: request.tools } : {}),
      }),
    })

    if (!res.ok) throw new Error(`Ollama chat error: ${res.status}`)
    const data = await res.json() as any

    return {
      content: [{ type: 'text', text: data.message.content }],
      model: request.model,
      stopReason: 'end_turn',
      usage: {
        inputTokens: data.prompt_eval_count ?? 0,
        outputTokens: data.eval_count ?? 0,
      },
    }
  }

  async function* stream(request: ModelRequest): AsyncIterable<StreamEvent> {
    const messages = request.messages.map((m) => ({
      role: m.role,
      content: m.content.map((c) => c.type === 'text' ? c.text : '').join(''),
    }))

    const res = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: request.model, messages, stream: true }),
    })

    if (!res.ok) throw new Error(`Ollama stream error: ${res.status}`)
    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop()!
      for (const line of lines) {
        if (!line.trim()) continue
        const chunk = JSON.parse(line)
        if (chunk.message?.content) {
          yield { type: 'text', text: chunk.message.content }
        }
        if (chunk.done) {
          yield {
            type: 'message_stop',
            usage: {
              inputTokens: chunk.prompt_eval_count ?? 0,
              outputTokens: chunk.eval_count ?? 0,
            },
          }
        }
      }
    }
  }

  async function embed(model: string, text: string): Promise<number[]> {
    const res = await fetch(`${baseUrl}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, input: text }),
    })
    if (!res.ok) throw new Error(`Ollama embed error: ${res.status}`)
    const data = await res.json() as { embeddings: number[][] }
    return data.embeddings[0]
  }

  async function ping(): Promise<boolean> {
    try {
      const res = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(3000) })
      return res.ok
    } catch {
      return false
    }
  }

  return { listModels, complete, stream, embed, ping }
}
```

- [ ] **Step 4: Create provider and manifest**

```typescript
// src/modules/model/submodules/ollama/provider.ts
import type { SubmoduleManifest, ModuleContext } from '@core/types.js'
import { createOllamaAdapter } from './adapter.js'
import type { ModelGateway } from '../../types.js'

export const ollamaManifest: SubmoduleManifest = {
  id: 'ollama',
  name: 'Ollama',
  description: 'Local LLM via Ollama',
  type: 'provider',
  parentModule: 'model',
  enabled: true,
}

export async function registerOllamaProvider(ctx: ModuleContext, gateway: ModelGateway) {
  const baseUrl = process.env.OLLAMA_HOST ?? 'http://localhost:11434'
  const adapter = createOllamaAdapter(baseUrl)

  // Auto-detect: ping Ollama, skip if not available
  const available = await adapter.ping()
  if (!available) {
    ctx.logger.info('Ollama not available at %s — skipping', baseUrl)
    return
  }

  ctx.logger.info('Ollama detected at %s — registering provider', baseUrl)

  const models = await adapter.listModels()
  gateway.registerProvider({
    id: 'ollama',
    name: 'Ollama (Local)',
    listModels: () => adapter.listModels(),
    complete: (req) => adapter.complete(req),
    stream: (req) => adapter.stream(req),
  })

  ctx.logger.info('Ollama registered with %d models', models.length)
}
```

```typescript
// src/modules/model/submodules/ollama/index.ts
export { ollamaManifest, registerOllamaProvider } from './provider.js'
export { createOllamaAdapter } from './adapter.js'
```

- [ ] **Step 5: Register Ollama in model module**

Modify `src/modules/model/index.ts` — add Ollama to submodule registration (after the existing 5 providers). Read the file to find the exact pattern used for other providers and follow it.

- [ ] **Step 6: Run tests**

```bash
vitest --run tests/modules/model/ollama-adapter.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/modules/model/submodules/ollama/ tests/modules/model/ollama-adapter.test.ts src/modules/model/index.ts
git commit -m "feat: Ollama provider — local LLM support with auto-detection, chat, streaming, embeddings"
```

---

### Wave 1 Gate Check

```bash
bun run build && vitest --run
```

Both must pass. Fix any issues before proceeding to Wave 2.

---

## WAVE 2 — CORE MISSING MODULES

### Task 5: Audit Module

**Files:**
- Create: `src/modules/audit/schema.ts`
- Create: `src/modules/audit/service.ts`
- Create: `src/modules/audit/retention-service.ts`
- Create: `src/modules/audit/routes.ts`
- Create: `src/modules/audit/index.ts`
- Create: `tests/modules/audit/audit-service.test.ts`
- Modify: `src/core/bootstrap.ts` (register audit module)
- Create: `src/web/src/pages/audit/audit-page.tsx`

The subagent should:

1. Read the existing module pattern (e.g., `src/modules/chatter/` or `src/modules/activity/`) to follow conventions
2. Create DB schema with `audit_entries` and `audit_snapshots` tables (see spec for exact columns)
3. Implement `AuditService` with: `log(entry)`, `snapshot(entryId, type, data, path)`, `rollback(entryId)`, `query(filters)`
4. Add bus listener: subscribe to `eyas.*` events, auto-create audit entries
5. Implement retention service: scheduler job moves old entries through hot→warm→cold→delete
6. Add diff tracking using `fast-json-patch` (MIT) — `bun add fast-json-patch`
7. Create REST routes: GET /api/v1/audit, GET /api/v1/audit/:id, POST /api/v1/audit/:id/rollback, GET /api/v1/audit/stats
8. Add permission checks: `requirePermission('read', 'AuditEntry')` on all routes
9. Create frontend audit page with table, filters, rollback button
10. Register module in bootstrap.ts
11. Write tests for service (log, query, rollback)
12. Commit

**Acceptance:** Create conversation → audit entry logged → query returns it → rollback works.

---

### Task 6: Notifications Module

**Files:**
- Create: `src/modules/notifications/schema.ts`
- Create: `src/modules/notifications/router.ts`
- Create: `src/modules/notifications/channels/web.ts`
- Create: `src/modules/notifications/channels/telegram.ts`
- Create: `src/modules/notifications/channels/email.ts`
- Create: `src/modules/notifications/routes.ts`
- Create: `src/modules/notifications/index.ts`
- Create: `tests/modules/notifications/router.test.ts`
- Modify: `src/core/bootstrap.ts`
- Create: `src/web/src/components/layout/notification-bell.tsx`
- Create: `src/web/src/pages/settings/notification-settings.tsx`
- Create: `config/personality/notifications.yaml`

The subagent should:

1. Create DB schema: `notifications` + `notification_preferences` tables (see spec)
2. Implement NotificationRouter: bus listener on `eyas.notify` → preference check → severity filter → quiet hours → rate limit → channel dispatch → DB save
3. Implement 3 channel adapters:
   - Web: broadcast via WebSocket (`notifications:<userId>` topic)
   - Telegram: send via Grammy bot (reuse existing `communication/submodules/telegram/`)
   - Email: send via `nodemailer` — `bun add nodemailer @types/nodemailer`
4. Create routes: GET /api/v1/notifications, POST /api/v1/notifications/:id/read, POST /api/v1/notifications/read-all, GET/PATCH /api/v1/notification-preferences
5. Create notification bell component (topbar) with unread count badge
6. Create notification settings page (event pattern → channel matrix)
7. Create config YAML with default preferences
8. Register in bootstrap
9. Write tests
10. Commit

**Acceptance:** `bus.emit('eyas.notify', { event: 'test', severity: 'info', userId, title: 'Test' })` → notification in bell → WebSocket push.

---

### Task 7: Privacy Module

**Files:**
- Create: `src/modules/privacy/scanner-chain.ts`
- Create: `src/modules/privacy/scanners/regex-scanner.ts`
- Create: `src/modules/privacy/scanners/ner-scanner.ts`
- Create: `src/modules/privacy/scanners/custom-scanner.ts`
- Create: `src/modules/privacy/policy-engine.ts`
- Create: `src/modules/privacy/index.ts`
- Create: `src/modules/privacy/routes.ts`
- Create: `tests/modules/privacy/regex-scanner.test.ts`
- Create: `tests/modules/privacy/policy-engine.test.ts`
- Create: `config/personality/privacy.yaml`
- Modify: `src/modules/model/gateway.ts` (add privacy hook)
- Modify: `src/core/bootstrap.ts`

The subagent should:

1. Implement RegexScanner with Hungarian PII patterns (személyi: `\d{6}[A-Z]{2}`, TAJ: `\d{3}-\d{3}-\d{3}`, adószám: `\d{10}`, IBAN: `HU\d{2}\s?\d{4}(\s?\d{4}){5}\s?\d{4}`) + international (email, phone, credit card with Luhn, SSN)
2. Implement NerScanner (lazy-loads Ollama NER model, skip if unavailable)
3. Implement CustomScanner (reads patterns from privacy.yaml)
4. Implement ScannerChain: runs scanners sequentially, aggregates PiiMatch[] results
5. Implement PolicyEngine: for each PiiMatch, apply configured action (auto_local/warn/block/sanitize)
6. Hook into model gateway: before every cloud AI request, run privacy scan
7. Create config YAML (see spec for format)
8. Create routes: GET /api/v1/privacy/scan (test endpoint), GET /api/v1/privacy/stats
9. Write tests for regex scanner (all patterns) and policy engine
10. Register in bootstrap
11. Commit

**Acceptance:** "TAJ: 123-456-789" in message → regex scanner detects → policy action fires.

---

### Task 8: Config Hot-Reload

**Files:**
- Create: `src/core/config/watcher.ts`
- Modify: `src/core/config/index.ts` (integrate watcher)
- Modify: `src/core/bootstrap.ts` (start watcher after modules loaded)
- Create: `tests/core/config-watcher.test.ts`

The subagent should:

1. Create watcher using `fs.watch(configDir, { recursive: true })`
2. Implement debounce (300ms)
3. On change: load YAML → Zod validate → if fail: log warning + emit `eyas.config.reload.failed` → if pass: update config registry + emit `eyas.config.reloaded`
4. The watcher must handle: file rename, delete (ignore), create (reload)
5. Integrate into bootstrap: start watcher AFTER all modules are loaded
6. Write test: create temp config dir, write file, verify event emitted
7. Commit

**Acceptance:** Edit `config/personality/memory.yaml` → watcher detects → bus event fired → module can react.

---

### Task 9: AI Response Streaming

**Files:**
- Modify: `src/modules/model/gateway.ts` (ensure stream method works end-to-end)
- Modify: `src/modules/conversations/routes.ts:91-276` (SSE response)
- Modify: `src/modules/model/submodules/*/adapter.ts` (verify streaming works per provider)
- Create: `src/web/src/hooks/use-streaming.ts`
- Modify: `src/web/src/pages/conversations/components/` (token-by-token rendering)
- Create: `tests/modules/conversations/streaming.test.ts`

The subagent should:

1. Read existing conversation message route (`src/modules/conversations/routes.ts:91-276`) — it already has some streaming code. Verify it works end-to-end.
2. Ensure gateway.stream() returns proper AsyncIterable<StreamEvent> for all providers
3. Convert conversation message endpoint to SSE: `Content-Type: text/event-stream`, proper SSE format (`data: {...}\n\n`)
4. Create frontend `use-streaming.ts` hook: fetch with ReadableStream reader, parse SSE events, update Zustand store token-by-token
5. Modify conversation message component to support incremental rendering
6. Add cancel support (AbortController)
7. Write test for SSE parsing
8. Commit

**Acceptance:** Send message → response streams token-by-token → cancel works mid-stream.

---

### Wave 2 Gate Check

```bash
bun run build && vitest --run
```

---

## WAVE 3 — ADVANCED FEATURES

### Task 10: AI Observability

**Files:**
- Create: `src/modules/observability/schema.ts` (ai_traces table)
- Create: `src/modules/observability/trace-collector.ts`
- Create: `src/modules/observability/anomaly-detector.ts`
- Create: `src/modules/observability/quality-scorer.ts`
- Create: `src/modules/observability/routes.ts`
- Create: `src/modules/observability/index.ts`
- Create: `tests/modules/observability/trace-collector.test.ts`
- Modify: `src/core/bootstrap.ts`
- Create: `src/web/src/pages/observability/observability-page.tsx`

The subagent should follow the spec §46 design. Key:
1. Hook trace collector into model gateway — wrap every complete/stream call
2. Store AITrace records with full telemetria (see spec schema)
3. Anomaly detector: hourly scheduler job, 7-day rolling average, 2σ alert threshold
4. Quality scorer: optional auto-score via cheap model + user feedback (thumbs up/down)
5. Frontend: trace list, cost dashboard (recharts — `bun add recharts`), anomaly alerts
6. Tests, commit

**Acceptance:** Chat → trace in DB → visible on /observability → cost chart shows data.

---

### Task 11: Research Module

**Files:**
- Create: `src/modules/research/engine.ts`
- Create: `src/modules/research/providers/brave-search.ts`
- Create: `src/modules/research/providers/mock-search.ts`
- Create: `src/modules/research/source-evaluator.ts`
- Create: `src/modules/research/report-generator.ts`
- Create: `src/modules/research/routes.ts`
- Create: `src/modules/research/index.ts`
- Create: `tests/modules/research/engine.test.ts`
- Modify: `src/modules/tools/builtins/` (add research tool)
- Modify: `src/core/bootstrap.ts`
- Create: `src/web/src/pages/research/research-page.tsx`

The subagent should follow spec §21 design. Key:
1. Web search provider pattern (Brave API, mock for tests)
2. 8-step research workflow (query expansion → search → evaluate → extract → synthesize → cross-ref → report → save)
3. Register as agent tool: `research`
4. Frontend: research page with form, past research list, report viewer
5. Tests with mock search provider
6. Commit

**Acceptance:** Research query → 8-step workflow runs (mock search in tests) → structured report generated.

---

### Task 12: A2UI Components

**Files:**
- Create: `src/shared/a2ui-types.ts`
- Create: `src/web/src/components/a2ui/a2ui-renderer.tsx`
- Create: `src/web/src/components/a2ui/a2ui-buttons.tsx`
- Create: `src/web/src/components/a2ui/a2ui-table.tsx`
- Create: `src/web/src/components/a2ui/a2ui-form.tsx`
- Create: `src/web/src/components/a2ui/a2ui-chart.tsx`
- Create: `src/web/src/components/a2ui/a2ui-progress.tsx`
- Create: `src/web/src/components/a2ui/a2ui-card.tsx`
- Create: `src/web/src/components/a2ui/index.ts`
- Modify: `src/web/src/pages/conversations/components/` (integrate A2UI rendering in messages)
- Modify: `src/modules/communication/types.ts` (add A2UIMessage type)
- Modify: `src/modules/communication/submodules/telegram/bot.ts` (A2UI → inline keyboard)

The subagent should follow spec §48 design. Key:
1. Define A2UIMessage types in shared (7 widget types)
2. Create React components for each type (using shadcn/ui primitives)
3. Create A2UIRenderer switch component
4. Integrate into conversation message rendering: detect JSON A2UIMessage, render widgets
5. Telegram adapter: buttons→inline keyboard, table→markdown, others→fallback_text
6. Commit

**Acceptance:** Agent returns A2UIButtons message → buttons render in chat → click triggers action.

---

### Task 13: CLI Interface

**Files:**
- Create: `src/cli/index.ts`
- Create: `src/cli/commands/serve.ts`
- Create: `src/cli/commands/doctor.ts`
- Create: `src/cli/commands/status.ts`
- Create: `src/cli/commands/config.ts`
- Create: `src/cli/commands/module.ts`
- Create: `src/cli/commands/version.ts`
- Create: `src/cli/utils/api-client.ts`
- Create: `bin/eyas`
- Modify: `package.json` (add bin field)
- Create: `tests/cli/doctor.test.ts`

The subagent should:
1. Install citty: `bun add citty`
2. Create CLI entry point with subcommands
3. `eyas serve` — imports and calls bootstrap from `src/core/bootstrap.ts`
4. `eyas doctor` — checks platform, config, DB path, lists modules
5. `eyas status` — HTTP GET to running server's /api/v1/health
6. `eyas config validate` — load all YAML files, Zod validate
7. `eyas config reload` — HTTP POST to /api/v1/config/reload
8. `eyas module list|enable|disable` — HTTP calls to module API
9. `eyas version` — reads package.json version
10. Create `bin/eyas` shebang script
11. Add `"bin": { "eyas": "./bin/eyas" }` to package.json
12. Test doctor command
13. Commit

**Acceptance:** `bun run src/cli/index.ts doctor` → outputs system diagnostics. `bun run src/cli/index.ts version` → outputs version.

---

### Wave 3 Gate Check

```bash
bun run build && vitest --run
```

---

## WAVE 4 — PROTOCOLS & DEPLOY

### Task 14: A2A Protocol

**Files:**
- Create: `src/modules/communication/submodules/a2a/server.ts`
- Create: `src/modules/communication/submodules/a2a/client.ts`
- Create: `src/modules/communication/submodules/a2a/agent-card.ts`
- Create: `src/modules/communication/submodules/a2a/types.ts`
- Create: `src/modules/communication/submodules/a2a/manifest.ts`
- Create: `tests/modules/communication/a2a-server.test.ts`
- Modify: `src/modules/communication/index.ts` (register A2A submodule)
- Modify: `src/core/http/server.ts` (add /.well-known route)

The subagent should:
1. Read A2A spec at https://a2a-protocol.org/latest/ (or use the design spec description)
2. Create agent card generator: builds JSON from registered agents/skills
3. Add `GET /.well-known/agent-card.json` route to Hono server
4. Create A2A server: JSON-RPC endpoint at `/api/v1/a2a` with tasks/send, tasks/get, tasks/cancel
5. Create A2A client: discover remote agent cards, send tasks, poll status
6. Register `a2a-delegate` as agent tool
7. Test agent card endpoint
8. Commit

**Acceptance:** GET `/.well-known/agent-card.json` returns valid agent card with EYAS capabilities.

---

### Task 15: Docker & Kubernetes

**Files:**
- Create: `Dockerfile`
- Create: `docker-compose.yml`
- Create: `.dockerignore`
- Create: `deploy/k8s/deployment.yaml`
- Create: `deploy/k8s/service.yaml`
- Create: `deploy/k8s/pvc.yaml`
- Create: `deploy/k8s/configmap.yaml`
- Create: `deploy/k8s/secret.yaml`
- Create: `deploy/k8s/ingress.yaml`

The subagent should:
1. Create multi-stage Dockerfile (deps → build → runtime) using `oven/bun:1` base
2. Runtime: non-root user, HEALTHCHECK, EXPOSE 3000
3. Create docker-compose with eyas + ollama (optional profile)
4. Create .dockerignore (node_modules, .git, data/, tests/, docs/)
5. Create K8s manifests following CLAUDE.md rules: resources block, securityContext (runAsNonRoot, readOnlyRootFilesystem), readinessProbe + livenessProbe → /api/v1/health, oci-bv storageClass for OKE
6. Test: `docker build -t eyas:test .` must succeed
7. Commit

**Acceptance:** `docker compose up` → EYAS starts → health check passes → frontend at localhost:3000.

---

### Task 16: Extra Modules (ingress, remote-node, meeting, disaster-recovery)

**Files:**
- Create: `src/modules/ingress/` (4 files: index, manager, providers/cloudflare, routes)
- Create: `src/modules/remote-node/` (4 files: index, registry, routes, types)
- Create: `src/modules/meeting/` (5 files: index, types, providers/fireflies, providers/local-stub, routes)
- Create: `src/modules/disaster-recovery/` (5 files: index, backup-service, providers/local, providers/s3-stub, routes)
- Create: `config/personality/backup.yaml`
- Create: `config/personality/meeting.yaml`
- Create: `config/personality/ingress.yaml`
- Modify: `src/core/bootstrap.ts` (register all 4 modules)
- Create: `tests/modules/disaster-recovery/backup-service.test.ts`

The subagent should implement 4 small modules following existing patterns:

**Ingress:** Provider pattern (Cloudflare Tunnel spawning `cloudflared`, manual no-op). Routes: start/stop/status.

**Remote Node:** Node registry DB table, WebSocket client, capabilities (shell, docker, browser). Routes: CRUD + invoke.

**Meeting:** MeetingProvider interface, Fireflies provider (GraphQL stub), Local provider (Whisper+Ollama stub). Integration: action items→scheduler, transcript→memory.

**Disaster Recovery:** BackupProvider pattern, LocalBackupProvider (tar.gz), S3 stub. Full backup of SQLite+config+vault+documents. Routes: create/list/restore. Scheduler job for auto-backup.

Each module: index.ts with EyasModule, schema if needed, routes, tests for critical paths.

Commit each module separately:
```bash
git commit -m "feat: ingress module — Cloudflare Tunnel provider"
git commit -m "feat: remote-node module — node registry and invocation"  
git commit -m "feat: meeting module — MeetingProvider interface with Fireflies"
git commit -m "feat: disaster-recovery module — backup/restore with local provider"
```

---

### Wave 4 Gate Check

```bash
bun run build && vitest --run
docker build -t eyas:test .
```

---

## WAVE 5 — DOCS & POLISH

### Task 17: Full Integration Tests

**Files:**
- Create: `tests/e2e/lifecycle.test.ts`
- Create: `tests/integration/module-interaction.test.ts`
- Create: `tests/integration/security.test.ts`
- Create: `scripts/test-all.sh`

The subagent should:

1. **E2E lifecycle test:** Bootstrap with mock config → create user (setup) → login → create conversation → send message (mock AI) → verify audit entry → verify search indexing → shutdown cleanly

2. **Module interaction test:** Agent run (mock) → audit entry created → notification emitted → verify bus events flow

3. **Security test:** Build CASL abilities for each role → verify allowed/denied actions → test privacy scanner → test permission middleware returns 403

4. **CI script:** `scripts/test-all.sh`:
```bash
#!/bin/bash
set -e
echo "=== TypeScript check ===" && bun run typecheck
echo "=== Tests ===" && vitest --run
echo "=== Build ===" && bun run build
echo "=== All passed ==="
```

5. Run full suite, fix any failures
6. Commit

**Acceptance:** `bash scripts/test-all.sh` exits 0.

---

### Task 18: Architecture Spec Sync

**Files:**
- Modify: `docs/eyas-architecture.md` (update all 48 sections with status)
- Modify: `docs/eyas-specification.html` (sync new modules)

The subagent should:

1. Read current `docs/eyas-architecture.md` (all 48 sections)
2. For each section, add implementation status tag:
   - `[DONE]` — fully implemented
   - `[PARTIAL]` — partially implemented (note what's missing)
   - `[STUB]` — exists but minimal implementation
3. Add new section §49: A2A Protocol (based on Task 14 implementation)
4. Update §31 (Implementation Phases) with completion status
5. Fix any discrepancies between spec descriptions and actual code
6. Update `docs/eyas-specification.html` — add new modules to feature lists
7. Commit

**Acceptance:** Every section in architecture spec has accurate implementation status.

---

### Task 19: Documentation Update

**Files:**
- Modify: `README.md` (or create if missing)
- Modify: `CLAUDE.md` (add new modules, routes, CLI)
- Modify: `docs/eyas-overview.html` (add new modules)
- Create: `CHANGELOG.md`

The subagent should:

1. **README.md:** Quick start with docker compose, feature list, tech stack, license (MIT)
2. **CLAUDE.md:** Add new modules to module list, add new CLI commands, add new API routes, update "Current State" section
3. **docs/eyas-overview.html:** Add new feature cards for: audit, notifications, privacy, observability, research, A2UI, CLI, A2A, ingress, remote-node, meeting, disaster-recovery
4. **CHANGELOG.md:** Wave-by-wave summary:
   - Wave 1: Test fixes, WebSocket, CASL, Ollama
   - Wave 2: Audit, Notifications, Privacy, Hot-reload, Streaming
   - Wave 3: Observability, Research, A2UI, CLI
   - Wave 4: A2A, Docker/K8s, Ingress, Remote Node, Meeting, DR
   - Wave 5: Integration tests, Docs
5. Commit

**Acceptance:** README has working quick start. CLAUDE.md is accurate. CHANGELOG covers all waves.

---

### Final Wave 5 Gate

```bash
bash scripts/test-all.sh
docker build -t eyas:test .
```

All must pass. Project is complete.

---

## Execution Summary

| Wave | Tasks | Parallel Agents | Gate |
|------|-------|----------------|------|
| 1 | 1-4 | 4 worktree agents | build + test |
| 2 | 5-9 | 5 worktree agents | build + test |
| 3 | 10-13 | 4 worktree agents | build + test |
| 4 | 14-16 | 3 worktree agents | build + test + docker |
| 5 | 17-19 | 2 sequential agents | test-all.sh + docker |

**Total: 19 tasks, ~210 new files, 5 waves with gates.**

## New Dependencies Checklist

Before starting, install all new dependencies:
```bash
bun add argon2 fast-json-patch nodemailer citty recharts
bun add -d @types/nodemailer
```

Verify all are MIT-compatible:
```bash
for pkg in argon2 fast-json-patch nodemailer citty recharts; do
  echo "$pkg: $(cat node_modules/$pkg/LICENSE | head -1)"
done
```

# Team Sessions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add provider-agnostic agent team sessions with shared memory, real-time UI, and capability gap detection to EYAS conversations.

**Architecture:** A new `team_sessions` entity anchors the lifecycle; child conversations reference it via `teamSessionId`. The orchestrator streams events to the bus; the frontend subscribes per-session via WebSocket. Team memory uses a two-layer write model (system + agent) with role-based context injection.

**Tech Stack:** Bun + TypeScript, Drizzle ORM (raw SQL pattern), Hono routes, Vitest, React 19 + Zustand + shadcn/ui + Tailwind

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/modules/agent/schema.ts` | Modify | Add `teamSessions` + `teamMemory` Drizzle table defs |
| `src/modules/conversations/schema.ts` | Modify | Add `teamSessionId` column to `conversations` |
| `src/modules/agent/index.ts` | Modify | CREATE TABLE migrations + register service + orchestrator + routes |
| `src/modules/agent/team-session-service.ts` | Create | CRUD, memory ops, checkpoint await/resume |
| `src/modules/agent/team-session-service.test.ts` | Create | Unit tests for service |
| `src/modules/agent/orchestrator.ts` | Modify | async analyzeAndPropose, parallel event streaming, checkpoint, session tracking |
| `src/modules/agent/orchestrator.test.ts` | Create | Tests for proposal + event streaming |
| `src/modules/agent/routes-team.ts` | Create | API endpoints for team sessions |
| `src/modules/tools/builtin/team-tools.ts` | Create | `propose_team`, `write_team_memory`, `read_team_memory` tools |
| `src/modules/tools/index.ts` | Modify | Register team tools when agent module is present |
| `src/web/src/stores/team-session-store.ts` | Create | Zustand store: active session, agent states, memory |
| `src/web/src/pages/conversations/components/team-proposal-card.tsx` | Create | Interactive proposal card rendered in chat |
| `src/web/src/pages/conversations/components/sub-conversation-tree.tsx` | Modify | Real-time agent progress per node |
| `src/web/src/pages/conversations/components/team-dashboard.tsx` | Create | Full-width expand view with agent cards |
| `src/web/src/pages/conversations/conversation-page.tsx` | Modify | Wire store subscription + render proposal card + dashboard toggle |

---

## Task 1: DB Schema

**Files:**
- Modify: `src/modules/agent/schema.ts`
- Modify: `src/modules/conversations/schema.ts`
- Modify: `src/modules/agent/index.ts`

- [ ] **Step 1: Add Drizzle table definitions to agent schema**

In `src/modules/agent/schema.ts`, append after the existing `agentMessages` table:

```typescript
export const teamSessions = sqliteTable('team_sessions', {
  id: text('id').primaryKey(),
  parentConversationId: text('parent_conversation_id').notNull(),
  status: text('status').notNull().default('proposing'),
  config: text('config').notNull().default('{}'),  // JSON TeamConfig
  reasoning: text('reasoning'),
  estimatedTokens: integer('estimated_tokens').default(0),
  totalTokens: integer('total_tokens').default(0),
  totalCostUsd: real('total_cost_usd').default(0),
  createdAt: text('created_at').notNull(),
  completedAt: text('completed_at'),
})

export const teamMemory = sqliteTable('team_memory', {
  id: text('id').primaryKey(),
  teamSessionId: text('team_session_id').notNull(),
  key: text('key').notNull(),
  value: text('value').notNull().default('null'),  // JSON
  layer: text('layer').notNull().default('system'),  // system | agent
  category: text('category').notNull().default('fact'),  // finding | decision | blocker | question | fact
  authorAgentId: text('author_agent_id'),
  visibility: text('visibility').notNull().default('all'),  // all | role:X
  createdAt: text('created_at').notNull(),
})
```

- [ ] **Step 2: Add teamSessionId to conversations schema**

In `src/modules/conversations/schema.ts`, add one field to the `conversations` table after `totalCostUsd`:

```typescript
  teamSessionId: text('team_session_id'),
```

- [ ] **Step 3: Add CREATE TABLE + migration in agent/index.ts**

In `src/modules/agent/index.ts`, inside `onRegister` after the existing `agent_messages` CREATE TABLE:

```typescript
    ctx.db.run(sql`CREATE TABLE IF NOT EXISTS team_sessions (
      id TEXT PRIMARY KEY,
      parent_conversation_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'proposing',
      config TEXT NOT NULL DEFAULT '{}',
      reasoning TEXT,
      estimated_tokens INTEGER DEFAULT 0,
      total_tokens INTEGER DEFAULT 0,
      total_cost_usd REAL DEFAULT 0,
      created_at TEXT NOT NULL,
      completed_at TEXT
    )`)

    ctx.db.run(sql`CREATE TABLE IF NOT EXISTS team_memory (
      id TEXT PRIMARY KEY,
      team_session_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL DEFAULT 'null',
      layer TEXT NOT NULL DEFAULT 'system',
      category TEXT NOT NULL DEFAULT 'fact',
      author_agent_id TEXT,
      visibility TEXT NOT NULL DEFAULT 'all',
      created_at TEXT NOT NULL
    )`)

    ctx.db.run(sql`CREATE INDEX IF NOT EXISTS idx_team_memory_session ON team_memory(team_session_id)`)
    ctx.db.run(sql`CREATE INDEX IF NOT EXISTS idx_team_sessions_conv ON team_sessions(parent_conversation_id)`)
```

And add the conversations migration (try/catch pattern) after the existing agent_definitions migrations:

```typescript
    // Migration: add team_session_id to conversations
    try {
      ctx.db.run(sql`ALTER TABLE conversations ADD COLUMN team_session_id TEXT`)
    } catch { /* column already exists */ }
```

- [ ] **Step 4: Verify tables are created**

```bash
cd /Users/eyssen/GitHub/eyas && bun run src/cli/index.ts doctor 2>&1 | head -30
```

Expected: no errors about missing tables.

- [ ] **Step 5: Commit**

```bash
git add src/modules/agent/schema.ts src/modules/conversations/schema.ts src/modules/agent/index.ts
git commit -m "feat(agent): add team_sessions and team_memory DB tables"
```

---

## Task 2: TeamSessionService

**Files:**
- Create: `src/modules/agent/team-session-service.ts`
- Create: `src/modules/agent/team-session-service.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/modules/agent/team-session-service.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { Database } from 'bun:sqlite'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { sql } from 'drizzle-orm'
import { createTeamSessionService } from './team-session-service.js'

function makeDb() {
  const sqlite = new Database(':memory:')
  const db = drizzle(sqlite)
  db.run(sql`CREATE TABLE team_sessions (
    id TEXT PRIMARY KEY, parent_conversation_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'proposing', config TEXT NOT NULL DEFAULT '{}',
    reasoning TEXT, estimated_tokens INTEGER DEFAULT 0,
    total_tokens INTEGER DEFAULT 0, total_cost_usd REAL DEFAULT 0,
    created_at TEXT NOT NULL, completed_at TEXT
  )`)
  db.run(sql`CREATE TABLE team_memory (
    id TEXT PRIMARY KEY, team_session_id TEXT NOT NULL,
    key TEXT NOT NULL, value TEXT NOT NULL DEFAULT 'null',
    layer TEXT NOT NULL DEFAULT 'system', category TEXT NOT NULL DEFAULT 'fact',
    author_agent_id TEXT, visibility TEXT NOT NULL DEFAULT 'all',
    created_at TEXT NOT NULL
  )`)
  return db
}

describe('TeamSessionService', () => {
  let service: ReturnType<typeof createTeamSessionService>

  beforeEach(() => {
    service = createTeamSessionService(makeDb())
  })

  it('creates a session with proposing status', () => {
    const session = service.create('conv-1', {
      config: { phases: [], maxParallelAgents: 3, conflictStrategy: 'human-review', replanAfterPhase: false, modelRouting: 'auto', useWorktrees: false },
      reasoning: 'test reason',
      estimatedTokens: 5000,
    })
    expect(session.id).toBeDefined()
    expect(session.status).toBe('proposing')
    expect(session.parentConversationId).toBe('conv-1')
    expect(session.estimatedTokens).toBe(5000)
  })

  it('get returns null for unknown id', () => {
    expect(service.get('nope')).toBeNull()
  })

  it('approve sets status to running', () => {
    const s = service.create('conv-1', { config: {}, reasoning: '', estimatedTokens: 0 })
    service.approve(s.id)
    expect(service.get(s.id)!.status).toBe('running')
  })

  it('reject sets status to failed', () => {
    const s = service.create('conv-1', { config: {}, reasoning: '', estimatedTokens: 0 })
    service.reject(s.id)
    expect(service.get(s.id)!.status).toBe('failed')
  })

  it('pause returns a promise that resolves when resume is called', async () => {
    const s = service.create('conv-1', { config: {}, reasoning: '', estimatedTokens: 0 })
    service.approve(s.id)
    let resolved = false
    const p = service.pause(s.id).then(() => { resolved = true })
    expect(resolved).toBe(false)
    service.resume(s.id)
    await p
    expect(resolved).toBe(true)
    expect(service.get(s.id)!.status).toBe('running')
  })

  it('listByConversation returns sessions for parent', () => {
    service.create('conv-A', { config: {}, reasoning: '', estimatedTokens: 0 })
    service.create('conv-A', { config: {}, reasoning: '', estimatedTokens: 0 })
    service.create('conv-B', { config: {}, reasoning: '', estimatedTokens: 0 })
    expect(service.listByConversation('conv-A')).toHaveLength(2)
    expect(service.listByConversation('conv-B')).toHaveLength(1)
  })

  it('writeMemory stores a system-layer entry', () => {
    const s = service.create('conv-1', { config: {}, reasoning: '', estimatedTokens: 0 })
    const entry = service.writeMemory(s.id, {
      key: 'arch-decision',
      value: { decision: 'use REST' },
      layer: 'system',
      category: 'decision',
    })
    expect(entry.id).toBeDefined()
    expect(entry.layer).toBe('system')
    expect(entry.category).toBe('decision')
    expect(JSON.parse(entry.value)).toEqual({ decision: 'use REST' })
  })

  it('readMemory returns entries filtered by category', () => {
    const s = service.create('conv-1', { config: {}, reasoning: '', estimatedTokens: 0 })
    service.writeMemory(s.id, { key: 'k1', value: 'v1', layer: 'agent', category: 'finding' })
    service.writeMemory(s.id, { key: 'k2', value: 'v2', layer: 'system', category: 'decision' })
    const findings = service.readMemory(s.id, { category: 'finding' })
    expect(findings).toHaveLength(1)
    expect(findings[0].key).toBe('k1')
  })

  it('readMemory filters by visibility for agent role', () => {
    const s = service.create('conv-1', { config: {}, reasoning: '', estimatedTokens: 0 })
    service.writeMemory(s.id, { key: 'k1', value: 'v1', layer: 'system', category: 'fact', visibility: 'all' })
    service.writeMemory(s.id, { key: 'k2', value: 'v2', layer: 'agent', category: 'fact', visibility: 'role:reviewer' })
    service.writeMemory(s.id, { key: 'k3', value: 'v3', layer: 'agent', category: 'fact', visibility: 'role:engineer' })

    const reviewerEntries = service.readMemory(s.id, { agentRole: 'reviewer' })
    expect(reviewerEntries.map(e => e.key)).toEqual(['k1', 'k2'])  // all + reviewer

    const engineerEntries = service.readMemory(s.id, { agentRole: 'engineer' })
    expect(engineerEntries.map(e => e.key)).toEqual(['k1', 'k3'])  // all + engineer
  })

  it('injectTeamMemory returns empty string when no entries', () => {
    const s = service.create('conv-1', { config: {}, reasoning: '', estimatedTokens: 0 })
    expect(service.injectTeamMemory(s.id)).toBe('')
  })

  it('injectTeamMemory returns formatted <team-context> block', () => {
    const s = service.create('conv-1', { config: {}, reasoning: '', estimatedTokens: 0 })
    service.writeMemory(s.id, { key: 'approach', value: 'REST API', layer: 'system', category: 'decision' })
    const injected = service.injectTeamMemory(s.id)
    expect(injected).toContain('<team-context>')
    expect(injected).toContain('DECISION "approach"')
    expect(injected).toContain('[system]')
    expect(injected).toContain('</team-context>')
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd /Users/eyssen/GitHub/eyas && bun test src/modules/agent/team-session-service.test.ts 2>&1 | tail -20
```

Expected: FAIL with "Cannot find module './team-session-service.js'"

- [ ] **Step 3: Implement TeamSessionService**

Create `src/modules/agent/team-session-service.ts`:

```typescript
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'
import { generateId } from '@shared/crypto.js'
import type { TeamConfig } from './orchestrator.js'

export interface TeamSession {
  id: string
  parentConversationId: string
  status: 'proposing' | 'awaiting_approval' | 'running' | 'paused' | 'completed' | 'failed'
  config: string
  reasoning: string | null
  estimatedTokens: number
  totalTokens: number
  totalCostUsd: number
  createdAt: string
  completedAt: string | null
}

export interface TeamMemoryEntry {
  id: string
  teamSessionId: string
  key: string
  value: string
  layer: 'system' | 'agent'
  category: 'finding' | 'decision' | 'blocker' | 'question' | 'fact'
  authorAgentId: string | null
  visibility: string
  createdAt: string
}

export interface CreateSessionInput {
  config: unknown
  reasoning: string
  estimatedTokens: number
}

export interface WriteMemoryInput {
  key: string
  value: unknown
  layer: 'system' | 'agent'
  category: 'finding' | 'decision' | 'blocker' | 'question' | 'fact'
  authorAgentId?: string
  visibility?: string
}

export interface ReadMemoryFilter {
  category?: string
  key?: string
  agentRole?: string
}

function toSession(raw: any): TeamSession {
  return {
    id: raw.id,
    parentConversationId: raw.parent_conversation_id,
    status: raw.status,
    config: raw.config,
    reasoning: raw.reasoning ?? null,
    estimatedTokens: raw.estimated_tokens ?? 0,
    totalTokens: raw.total_tokens ?? 0,
    totalCostUsd: raw.total_cost_usd ?? 0,
    createdAt: raw.created_at,
    completedAt: raw.completed_at ?? null,
  }
}

function toMemoryEntry(raw: any): TeamMemoryEntry {
  return {
    id: raw.id,
    teamSessionId: raw.team_session_id,
    key: raw.key,
    value: raw.value,
    layer: raw.layer,
    category: raw.category,
    authorAgentId: raw.author_agent_id ?? null,
    visibility: raw.visibility,
    createdAt: raw.created_at,
  }
}

export function createTeamSessionService(db: any) {
  const checkpointResolvers = new Map<string, () => void>()

  return {
    create(parentConversationId: string, input: CreateSessionInput): TeamSession {
      const id = generateId()
      const now = new Date().toISOString()
      db.run(sql`INSERT INTO team_sessions
        (id, parent_conversation_id, status, config, reasoning, estimated_tokens, total_tokens, total_cost_usd, created_at)
        VALUES (${id}, ${parentConversationId}, 'proposing', ${JSON.stringify(input.config)},
                ${input.reasoning}, ${input.estimatedTokens}, 0, 0, ${now})`)
      return this.get(id)!
    },

    get(id: string): TeamSession | null {
      const raw = db.get(sql`SELECT * FROM team_sessions WHERE id = ${id}`)
      return raw ? toSession(raw) : null
    },

    listByConversation(parentConversationId: string): TeamSession[] {
      const rows = db.all(sql`SELECT * FROM team_sessions
        WHERE parent_conversation_id = ${parentConversationId}
        ORDER BY created_at DESC`)
      return (rows as any[]).map(toSession)
    },

    setStatus(id: string, status: TeamSession['status']): void {
      db.run(sql`UPDATE team_sessions SET status = ${status} WHERE id = ${id}`)
    },

    approve(id: string): void { this.setStatus(id, 'running') },
    reject(id: string): void { this.setStatus(id, 'failed') },

    pause(id: string): Promise<void> {
      this.setStatus(id, 'paused')
      return new Promise<void>((resolve) => { checkpointResolvers.set(id, resolve) })
    },

    resume(id: string): void {
      this.setStatus(id, 'running')
      const resolve = checkpointResolvers.get(id)
      if (resolve) { checkpointResolvers.delete(id); resolve() }
    },

    complete(id: string, totalTokens: number, totalCostUsd: number): void {
      const now = new Date().toISOString()
      db.run(sql`UPDATE team_sessions SET status = 'completed', total_tokens = ${totalTokens},
        total_cost_usd = ${totalCostUsd}, completed_at = ${now} WHERE id = ${id}`)
    },

    writeMemory(teamSessionId: string, input: WriteMemoryInput): TeamMemoryEntry {
      const id = generateId()
      const now = new Date().toISOString()
      db.run(sql`INSERT INTO team_memory
        (id, team_session_id, key, value, layer, category, author_agent_id, visibility, created_at)
        VALUES (${id}, ${teamSessionId}, ${input.key}, ${JSON.stringify(input.value)},
                ${input.layer}, ${input.category}, ${input.authorAgentId ?? null},
                ${input.visibility ?? 'all'}, ${now})`)
      const raw = db.get(sql`SELECT * FROM team_memory WHERE id = ${id}`)
      return toMemoryEntry(raw)
    },

    readMemory(teamSessionId: string, filter?: ReadMemoryFilter): TeamMemoryEntry[] {
      let rows: any[]
      if (filter?.agentRole) {
        rows = db.all(sql`SELECT * FROM team_memory
          WHERE team_session_id = ${teamSessionId}
          AND (visibility = 'all' OR visibility = ${'role:' + filter.agentRole})
          ${filter.category ? sql`AND category = ${filter.category}` : sql``}
          ${filter.key ? sql`AND key = ${filter.key}` : sql``}
          ORDER BY created_at ASC`)
      } else {
        rows = db.all(sql`SELECT * FROM team_memory
          WHERE team_session_id = ${teamSessionId}
          ${filter?.category ? sql`AND category = ${filter.category}` : sql``}
          ${filter?.key ? sql`AND key = ${filter.key}` : sql``}
          ORDER BY created_at ASC`)
      }
      return (rows as any[]).map(toMemoryEntry)
    },

    injectTeamMemory(teamSessionId: string, agentRole?: string): string {
      const entries = this.readMemory(teamSessionId, agentRole ? { agentRole } : undefined)
      if (entries.length === 0) return ''
      const lines = entries.map(e => {
        const author = e.authorAgentId ? `[${e.authorAgentId}]` : '[system]'
        let val: string
        try { val = JSON.parse(e.value) !== null && typeof JSON.parse(e.value) === 'object'
          ? JSON.stringify(JSON.parse(e.value)) : String(JSON.parse(e.value)) }
        catch { val = e.value }
        return `  ${author} ${e.category.toUpperCase()} "${e.key}": ${val}`
      })
      return `\n<team-context>\n${lines.join('\n')}\n</team-context>`
    },
  }
}

export type TeamSessionService = ReturnType<typeof createTeamSessionService>
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd /Users/eyssen/GitHub/eyas && bun test src/modules/agent/team-session-service.test.ts 2>&1 | tail -20
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/agent/team-session-service.ts src/modules/agent/team-session-service.test.ts
git commit -m "feat(agent): add TeamSessionService with checkpoint await/resume and team memory"
```

---

## Task 3: Rewrite analyzeAndPropose to LLM-based

**Files:**
- Modify: `src/modules/agent/orchestrator.ts`
- Create: `src/modules/agent/orchestrator.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/modules/agent/orchestrator.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createOrchestrator } from './orchestrator.js'

function makeGateway(responseText: string) {
  return {
    complete: vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: responseText }],
    }),
    list: vi.fn().mockResolvedValue([]),
    getProvider: vi.fn(),
  }
}

function makeRegistry(agents = [
  { id: 'agent-1', name: 'Developer', agentType: 'engineer', capabilities: '["code-analysis"]', enabled: true },
  { id: 'agent-2', name: 'Reviewer', agentType: 'reviewer', capabilities: '["security-audit"]', enabled: true },
]) {
  return { list: vi.fn().mockReturnValue(agents), get: vi.fn(), addTokenUsage: vi.fn() }
}

const VALID_PROPOSAL_JSON = JSON.stringify({
  phases: [
    { name: 'plan', agentIds: ['agent-1'], parallel: false, checkpoint: true, replanOnComplete: false, reasoning: 'plan first' },
    { name: 'build', agentIds: ['agent-1', 'agent-2'], parallel: true, checkpoint: false, replanOnComplete: true, reasoning: 'parallel build' },
  ],
  agentGaps: [
    { suggestedName: 'DB Specialist', suggestedRole: 'Handles migrations', capabilities: ['sql'], reason: 'no SQL expert', canProceedWithout: true, proposedAgentType: 'engineer' },
  ],
  reasoning: 'Complex task needs pipeline',
  estimatedTokensPerAgent: 8000,
})

describe('analyzeAndPropose', () => {
  it('returns a TeamProposal with phases and agentGaps from LLM', async () => {
    const orchestrator = createOrchestrator({
      agentRegistry: makeRegistry() as any,
      agentRunner: {} as any,
      gateway: makeGateway(VALID_PROPOSAL_JSON) as any,
      conversations: {} as any,
      toolRegistry: {} as any,
      toolExecutor: {} as any,
    })

    const proposal = await orchestrator.analyzeAndPropose('Build a complex system', 'complex')
    expect(proposal.config.phases).toHaveLength(2)
    expect(proposal.config.phases[0].name).toBe('plan')
    expect(proposal.config.phases[1].parallel).toBe(true)
    expect(proposal.agentGaps).toHaveLength(1)
    expect(proposal.agentGaps[0].suggestedName).toBe('DB Specialist')
    expect(proposal.estimatedTokens).toBe(3 * 8000)  // 3 agent slots across phases
  })

  it('falls back to single-agent when LLM returns invalid JSON', async () => {
    const orchestrator = createOrchestrator({
      agentRegistry: makeRegistry() as any,
      agentRunner: {} as any,
      gateway: makeGateway('not json at all') as any,
      conversations: {} as any,
      toolRegistry: {} as any,
      toolExecutor: {} as any,
    })

    const proposal = await orchestrator.analyzeAndPropose('Simple task', 'simple')
    expect(proposal.config.phases).toHaveLength(1)
    expect(proposal.agentGaps).toHaveLength(0)
    expect(proposal.reasoning).toContain('Fallback')
  })

  it('falls back gracefully when LLM call throws', async () => {
    const gateway = { complete: vi.fn().mockRejectedValue(new Error('LLM error')), list: vi.fn(), getProvider: vi.fn() }
    const orchestrator = createOrchestrator({
      agentRegistry: makeRegistry() as any,
      agentRunner: {} as any,
      gateway: gateway as any,
      conversations: {} as any,
      toolRegistry: {} as any,
      toolExecutor: {} as any,
    })

    const proposal = await orchestrator.analyzeAndPropose('Task', 'moderate')
    expect(proposal.config.phases).toHaveLength(1)
    expect(proposal.agentGaps).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
cd /Users/eyssen/GitHub/eyas && bun test src/modules/agent/orchestrator.test.ts 2>&1 | tail -15
```

Expected: FAIL — `analyzeAndPropose` is synchronous and returns wrong shape.

- [ ] **Step 3: Update TeamProposal type and rewrite analyzeAndPropose**

In `src/modules/agent/orchestrator.ts`, replace the `TeamProposal` interface and `analyzeAndPropose` method.

Replace the existing `TeamProposal` interface (around line 77):

```typescript
export interface AgentGap {
  suggestedName: string
  suggestedRole: string
  capabilities: string[]
  reason: string
  canProceedWithout: boolean
  proposedAgentType: string
}

export interface TeamProposal {
  config: TeamConfig
  reasoning: string
  estimatedTokens: number
  estimatedCostUsd: number
  agentGaps: AgentGap[]
}
```

Add Zod import at the top (it's already used in re-planner, add to orchestrator imports):

```typescript
import { z } from 'zod'
```

Replace the entire `analyzeAndPropose` method (lines 120-193):

```typescript
    /**
     * Analyze a complex task via LLM and propose an optimal team configuration.
     * Identifies agent gaps — specialists not yet in the registry.
     */
    async analyzeAndPropose(goalDescription: string, complexity: string): Promise<TeamProposal> {
      const enabledAgents = agentRegistry.list({ enabled: true })

      const agentList = enabledAgents.map(a => {
        const caps = (() => { try { return (JSON.parse(a.capabilities ?? '[]') as string[]).join(', ') } catch { return '' } })()
        return `- ID: ${a.id}, Name: ${a.name}, Type: ${a.agentType}, Capabilities: ${caps}`
      }).join('\n')

      const systemPrompt = `You are a team orchestration planner. Given a task and available agents, propose the optimal team. Output ONLY valid JSON, no markdown.

JSON schema:
{
  "phases": [{"name":"string","agentIds":["string"],"parallel":boolean,"checkpoint":boolean,"replanOnComplete":boolean,"reasoning":"string"}],
  "agentGaps": [{"suggestedName":"string","suggestedRole":"string","capabilities":["string"],"reason":"string","canProceedWithout":boolean,"proposedAgentType":"string"}],
  "reasoning": "string",
  "estimatedTokensPerAgent": number
}`

      const userMessage = `## Task\n${goalDescription}\n\n## Complexity\n${complexity}\n\n## Available Agents\n${agentList || '(none)'}\n\nPropose a team using only the listed agent IDs. If a specialist is clearly missing for this task, add it to agentGaps.`

      const proposalSchema = z.object({
        phases: z.array(z.object({
          name: z.string(),
          agentIds: z.array(z.string()),
          parallel: z.boolean().default(false),
          checkpoint: z.boolean().default(false),
          replanOnComplete: z.boolean().default(false),
          reasoning: z.string().default(''),
        })).default([]),
        agentGaps: z.array(z.object({
          suggestedName: z.string(),
          suggestedRole: z.string(),
          capabilities: z.array(z.string()).default([]),
          reason: z.string(),
          canProceedWithout: z.boolean().default(true),
          proposedAgentType: z.string().default('assistant'),
        })).default([]),
        reasoning: z.string().default(''),
        estimatedTokensPerAgent: z.number().default(10000),
      })

      const fallback = (): TeamProposal => {
        const agent = enabledAgents[0]
        return {
          config: {
            phases: agent ? [{ name: 'execute', agents: [agent.id], parallel: false, checkpoint: false, replanOnComplete: false }] : [],
            maxParallelAgents: 1, conflictStrategy: 'first-wins',
            replanAfterPhase: false, modelRouting: 'auto', useWorktrees: false,
          },
          reasoning: 'Fallback to single-agent (proposal generation failed)',
          estimatedTokens: 10000,
          estimatedCostUsd: 0.03,
          agentGaps: [],
        }
      }

      try {
        const response = await gateway.complete({
          messages: [{ role: 'user', content: userMessage }],
          system: systemPrompt,
          provider: 'anthropic',
          model: 'claude-haiku-4-5-20251001',
          temperature: 0.2,
        })
        const text = response.content.find((b: any) => b.type === 'text')?.text ?? ''
        const jsonMatch = text.match(/\{[\s\S]*\}/)
        if (!jsonMatch) return fallback()

        const parsed = proposalSchema.safeParse(JSON.parse(jsonMatch[0]))
        if (!parsed.success) return fallback()

        const phases: TeamPhase[] = parsed.data.phases.map(p => ({
          name: p.name,
          agents: p.agentIds,
          parallel: p.parallel,
          checkpoint: p.checkpoint,
          replanOnComplete: p.replanOnComplete,
        }))

        const totalAgentSlots = phases.reduce((sum, p) => sum + p.agents.length, 0)
        const estimatedTokens = totalAgentSlots * parsed.data.estimatedTokensPerAgent
        const isComplex = complexity === 'complex' || complexity === 'epic'

        return {
          config: {
            phases,
            maxParallelAgents: 3,
            conflictStrategy: 'human-review',
            replanAfterPhase: isComplex,
            modelRouting: 'auto',
            useWorktrees: complexity === 'epic',
          },
          reasoning: parsed.data.reasoning,
          estimatedTokens,
          estimatedCostUsd: estimatedTokens * 0.000003,
          agentGaps: parsed.data.agentGaps,
        }
      } catch {
        return fallback()
      }
    },
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd /Users/eyssen/GitHub/eyas && bun test src/modules/agent/orchestrator.test.ts 2>&1 | tail -15
```

Expected: all 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/agent/orchestrator.ts src/modules/agent/orchestrator.test.ts
git commit -m "feat(agent): rewrite analyzeAndPropose to LLM-based with AgentGap detection"
```

---

## Task 4: Orchestrator executeTeam — parallel streaming + checkpoint + session tracking

**Files:**
- Modify: `src/modules/agent/orchestrator.ts`
- Modify: `src/modules/agent/orchestrator.test.ts`

- [ ] **Step 1: Add failing tests for executeTeam**

Append to `src/modules/agent/orchestrator.test.ts`:

```typescript
describe('executeTeam parallel streaming', () => {
  it('yields agent_completed events as each agent finishes, not all at once', async () => {
    let resolveA: () => void
    let resolveB: () => void
    const agentADone = new Promise<void>(r => { resolveA = r })
    const agentBDone = new Promise<void>(r => { resolveB = r })

    const runner = {
      run: vi.fn()
        .mockImplementationOnce(async function* () {
          await agentADone
          yield { type: 'done', response: { content: [{ type: 'text', text: 'A done' }] } }
        })
        .mockImplementationOnce(async function* () {
          await agentBDone
          yield { type: 'done', response: { content: [{ type: 'text', text: 'B done' }] } }
        }),
    }

    const conversations = {
      create: vi.fn().mockReturnValue({ id: 'child-conv' }),
      update: vi.fn(),
      addMessage: vi.fn(),
    }

    const orchestrator = createOrchestrator({
      agentRegistry: makeRegistry() as any,
      agentRunner: runner as any,
      gateway: makeGateway('{}') as any,
      conversations: conversations as any,
      toolRegistry: { toToolDefinitions: vi.fn().mockReturnValue([]) } as any,
      toolExecutor: {} as any,
    })

    const config = {
      phases: [{ name: 'build', agents: ['agent-1', 'agent-2'], parallel: true, checkpoint: false, replanOnComplete: false }],
      maxParallelAgents: 2, conflictStrategy: 'first-wins' as const,
      replanAfterPhase: false, modelRouting: 'auto' as const, useWorktrees: false,
    }

    const events: any[] = []
    const gen = orchestrator.executeTeam(config, 'parent-conv', 'Build it', 'session-1')

    // Collect events in background
    const collecting = (async () => {
      for await (const e of gen) events.push(e)
    })()

    // Resolve A first, then B
    await new Promise(r => setTimeout(r, 10))
    resolveA!()
    await new Promise(r => setTimeout(r, 10))

    // A should be completed before B
    const completedSoFar = events.filter(e => e.type === 'agent_completed')
    expect(completedSoFar).toHaveLength(1)
    expect(completedSoFar[0].agentId).toBe('agent-1')

    resolveB!()
    await collecting

    const allCompleted = events.filter(e => e.type === 'agent_completed')
    expect(allCompleted).toHaveLength(2)
    expect(allCompleted[1].agentId).toBe('agent-2')
  })
})
```

- [ ] **Step 2: Run tests to confirm new test fails**

```bash
cd /Users/eyssen/GitHub/eyas && bun test src/modules/agent/orchestrator.test.ts 2>&1 | tail -20
```

Expected: the new parallel streaming test FAILS.

- [ ] **Step 3: Fix executeTeam — update signature and parallel execution**

In `src/modules/agent/orchestrator.ts`, update `executeTeam`:

Change the signature to accept `teamSessionId`:

```typescript
    async *executeTeam(
      config: TeamConfig,
      parentConversationId: string,
      goalDescription: string,
      teamSessionId: string,
    ): AsyncGenerator<OrchestratorEvent> {
```

Replace the parallel execution block (the `if (phase.parallel)` branch) with:

```typescript
        if (phase.parallel) {
          // Yield agent_started for all agents immediately
          for (const agentId of phase.agents) {
            yield { type: 'agent_started', agentId, conversationId: '', phase: phase.name }
          }

          // Stream completions as they arrive (not batched)
          type AgentCompletion = { agentId: string; result: Awaited<ReturnType<typeof this.runAgentInConversation>> | null; error: Error | null }
          const completionQueue: AgentCompletion[] = []
          let notifyCompletion: (() => void) | null = null

          const waitForNext = () => new Promise<void>(resolve => { notifyCompletion = resolve })

          // Launch all agents, push to queue as each finishes
          const promises = phase.agents.map(agentId =>
            this.runAgentInConversation(
              agentId, parentConversationId, goalDescription,
              config.modelRouting === 'auto', worktreeOpts,
            ).then(
              result => { completionQueue.push({ agentId, result, error: null }); notifyCompletion?.() },
              err => { completionQueue.push({ agentId, result: null, error: err }); notifyCompletion?.() },
            )
          )

          let processed = 0
          while (processed < phase.agents.length) {
            if (completionQueue.length > processed) {
              const { agentId, result, error } = completionQueue[processed++]
              if (result) {
                phaseResults.agentResults.push(result)
                totalTokens += result.tokensUsed
                yield { type: 'agent_completed', agentId, conversationId: result.conversationId, status: result.status }
              } else {
                phaseResults.agentResults.push({ agentId, conversationId: '', status: 'failed', summary: error?.message ?? 'Unknown error', tokensUsed: 0 })
                yield { type: 'agent_completed', agentId, conversationId: '', status: 'failed' }
              }
            } else {
              await waitForNext()
            }
          }
          await Promise.all(promises)
```

Replace the checkpoint block (near the end of the for-each-phase loop):

```typescript
        // Checkpoint: pause for human approval via TeamSessionService
        if (phase.checkpoint && deps.teamSessions) {
          yield { type: 'checkpoint', phase: phase.name, message: `Phase "${phase.name}" completed. Approve to continue?` }
          await deps.teamSessions.pause(teamSessionId)
        }
```

Add `teamSessions` to `OrchestratorDeps`:

```typescript
interface OrchestratorDeps {
  agentRegistry: AgentRegistry
  agentRunner: ReturnType<typeof createAgentRunner>
  gateway: ModelGateway
  conversations: ConversationService
  toolRegistry: ToolRegistry
  toolExecutor: ReturnType<typeof createToolExecutor>
  bus?: { emit(subject: string, data: unknown): void }
  teamSessions?: { pause(id: string): Promise<void> }  // ← add
}
```

Also wire `teamSessionId` into child conversations in `runAgentInConversation` — add after `conversations.update(childConv.id, {...})`:

```typescript
      if (teamSessionId) {
        conversations.update(childConv.id, { teamSessionId } as any)
      }
```

Pass `teamSessionId` via options to `runAgentInConversation`:

Change `runAgentInConversation` signature:
```typescript
    async runAgentInConversation(
      agentId: string,
      parentConversationId: string,
      goalDescription: string,
      autoRouteModel: boolean,
      options?: { useWorktree?: boolean; worktreeBasePath?: string; teamSessionId?: string },
    ) {
```

And in the conversations.update call add `teamSessionId: options?.teamSessionId ?? null`.

Emit bus events for team monitoring — add at top of `executeTeam` and per completion:

```typescript
      const emit = (event: string, data: unknown) => deps.bus?.emit(`team:${teamSessionId}:${event}`, data)
```

Call `emit('agent_completed', { agentId, status, conversationId })` after each yield.

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd /Users/eyssen/GitHub/eyas && bun test src/modules/agent/orchestrator.test.ts 2>&1 | tail -20
```

Expected: all tests PASS.

- [ ] **Step 5: Run full test suite to check for regressions**

```bash
cd /Users/eyssen/GitHub/eyas && bun test 2>&1 | tail -10
```

Expected: same number of tests passing as before.

- [ ] **Step 6: Commit**

```bash
git add src/modules/agent/orchestrator.ts src/modules/agent/orchestrator.test.ts
git commit -m "feat(agent): fix executeTeam parallel streaming, checkpoint await, session tracking"
```

---

## Task 5: API Routes for Team Sessions

**Files:**
- Create: `src/modules/agent/routes-team.ts`
- Modify: `src/modules/agent/index.ts`

- [ ] **Step 1: Write failing route tests**

Create `src/modules/agent/routes-team.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { createTeamRoutes } from './routes-team.js'

// Mock requirePermission to pass through
vi.mock('@modules/permissions/middleware', () => ({
  requirePermission: () => async (_c: any, next: any) => next(),
}))

function makeTeamService(sessionOverride?: any) {
  const session = { id: 'sess-1', parentConversationId: 'conv-1', status: 'proposing', config: '{}', reasoning: 'test', estimatedTokens: 5000, totalTokens: 0, totalCostUsd: 0, createdAt: '2026-01-01', completedAt: null, ...sessionOverride }
  return {
    create: vi.fn().mockReturnValue(session),
    get: vi.fn().mockReturnValue(session),
    listByConversation: vi.fn().mockReturnValue([session]),
    approve: vi.fn(),
    reject: vi.fn(),
    resume: vi.fn(),
    writeMemory: vi.fn().mockReturnValue({ id: 'mem-1', key: 'k', value: '"v"', layer: 'system', category: 'fact', teamSessionId: 'sess-1', authorAgentId: null, visibility: 'all', createdAt: '2026-01-01' }),
    readMemory: vi.fn().mockReturnValue([]),
  }
}

function makeOrchestrator(proposal?: any) {
  return {
    analyzeAndPropose: vi.fn().mockResolvedValue(proposal ?? {
      config: { phases: [], maxParallelAgents: 1, conflictStrategy: 'first-wins', replanAfterPhase: false, modelRouting: 'auto', useWorktrees: false },
      reasoning: 'test', estimatedTokens: 5000, estimatedCostUsd: 0.01, agentGaps: [],
    }),
    executeTeam: vi.fn().mockReturnValue((async function* () { yield { type: 'team_completed', totalTokens: 0, totalCostUsd: 0 } })()),
  }
}

describe('Team Routes', () => {
  let app: Hono

  beforeEach(() => {
    app = new Hono()
    createTeamRoutes(app, makeTeamService() as any, makeOrchestrator() as any)
  })

  it('POST /conversations/:id/team/propose creates a session', async () => {
    const res = await app.request('/conversations/conv-1/team/propose', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ goalDescription: 'Build something', complexity: 'complex' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.session.id).toBe('sess-1')
    expect(body.proposal).toBeDefined()
  })

  it('GET /team-sessions/:id returns session', async () => {
    const res = await app.request('/team-sessions/sess-1')
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.session.id).toBe('sess-1')
  })

  it('POST /team-sessions/:id/approve triggers execution', async () => {
    const res = await app.request('/team-sessions/sess-1/approve', { method: 'POST' })
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.status).toBe('running')
  })

  it('POST /team-sessions/:id/reject sets failed status', async () => {
    const res = await app.request('/team-sessions/sess-1/reject', { method: 'POST' })
    expect(res.status).toBe(200)
  })

  it('GET /conversations/:id/team-sessions returns list', async () => {
    const res = await app.request('/conversations/conv-1/team-sessions')
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.sessions).toHaveLength(1)
  })

  it('POST /team-sessions/:id/memory adds entry', async () => {
    const res = await app.request('/team-sessions/sess-1/memory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'note', value: 'important', layer: 'system', category: 'fact' }),
    })
    expect(res.status).toBe(201)
  })

  it('GET /team-sessions/:id/memory returns entries', async () => {
    const res = await app.request('/team-sessions/sess-1/memory')
    expect(res.status).toBe(200)
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd /Users/eyssen/GitHub/eyas && bun test src/modules/agent/routes-team.test.ts 2>&1 | tail -10
```

Expected: FAIL with "Cannot find module './routes-team.js'"

- [ ] **Step 3: Implement routes-team.ts**

Create `src/modules/agent/routes-team.ts`:

```typescript
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { Hono } from 'hono'
import { requirePermission } from '@modules/permissions/middleware'
import type { TeamSessionService } from './team-session-service.js'
import type { createOrchestrator } from './orchestrator.js'

export function createTeamRoutes(
  app: Hono,
  teamSessions: TeamSessionService,
  orchestrator: ReturnType<typeof createOrchestrator>,
  bus?: { emit(subject: string, data: unknown): void },
) {
  const api = new Hono()

  // Propose a team for a conversation
  api.post('/conversations/:id/team/propose', requirePermission('create', 'Conversation'), async (c) => {
    const conversationId = c.req.param('id')
    const { goalDescription, complexity } = await c.req.json()
    if (!goalDescription) return c.json({ error: 'goalDescription required' }, 400)

    const proposal = await orchestrator.analyzeAndPropose(goalDescription, complexity ?? 'moderate')
    const session = teamSessions.create(conversationId, {
      config: proposal.config,
      reasoning: proposal.reasoning,
      estimatedTokens: proposal.estimatedTokens,
    })

    bus?.emit(`team:${session.id}:proposed`, { session, proposal })
    return c.json({ session, proposal })
  })

  // Get a team session
  api.get('/team-sessions/:id', requirePermission('read', 'Conversation'), (c) => {
    const session = teamSessions.get(c.req.param('id'))
    if (!session) return c.json({ error: 'Session not found' }, 404)
    return c.json({ session })
  })

  // List team sessions for a conversation
  api.get('/conversations/:id/team-sessions', requirePermission('read', 'Conversation'), (c) => {
    const sessions = teamSessions.listByConversation(c.req.param('id'))
    return c.json({ sessions })
  })

  // Approve and start execution
  api.post('/team-sessions/:id/approve', requirePermission('update', 'Conversation'), async (c) => {
    const id = c.req.param('id')
    const session = teamSessions.get(id)
    if (!session) return c.json({ error: 'Session not found' }, 404)

    teamSessions.approve(id)

    // Start execution in background — fire and forget, events go to bus
    const config = JSON.parse(session.config)
    ;(async () => {
      try {
        for await (const event of orchestrator.executeTeam(config, session.parentConversationId, '', id)) {
          bus?.emit(`team:${id}:event`, event)
          if (event.type === 'team_completed') {
            teamSessions.complete(id, event.totalTokens, event.totalCostUsd)
          }
          if (event.type === 'team_failed') {
            teamSessions.setStatus(id, 'failed')
          }
        }
      } catch (err: any) {
        teamSessions.setStatus(id, 'failed')
        bus?.emit(`team:${id}:event`, { type: 'team_failed', error: err.message })
      }
    })()

    return c.json({ status: 'running' })
  })

  // Reject proposal
  api.post('/team-sessions/:id/reject', requirePermission('update', 'Conversation'), (c) => {
    teamSessions.reject(c.req.param('id'))
    return c.json({ status: 'rejected' })
  })

  // Resume after checkpoint
  api.post('/team-sessions/:id/resume', requirePermission('update', 'Conversation'), (c) => {
    teamSessions.resume(c.req.param('id'))
    return c.json({ status: 'resumed' })
  })

  // Write memory entry
  api.post('/team-sessions/:id/memory', requirePermission('update', 'Conversation'), async (c) => {
    const id = c.req.param('id')
    const body = await c.req.json()
    const entry = teamSessions.writeMemory(id, body)
    bus?.emit(`team:${id}:memory_written`, { entry })
    return c.json({ entry }, 201)
  })

  // Read memory entries
  api.get('/team-sessions/:id/memory', requirePermission('read', 'Conversation'), (c) => {
    const id = c.req.param('id')
    const category = c.req.query('category')
    const key = c.req.query('key')
    const entries = teamSessions.readMemory(id, {
      category: category ?? undefined,
      key: key ?? undefined,
    })
    return c.json({ entries })
  })

  app.route('/api/v1', api)
}
```

- [ ] **Step 4: Register service + orchestrator + routes in agent/index.ts**

In `src/modules/agent/index.ts`, import the new files:

```typescript
import { createTeamSessionService } from './team-session-service.js'
import { createOrchestrator } from './orchestrator.js'
```

In `onRegister`, after creating `messaging`, add:

```typescript
    const teamSessionService = createTeamSessionService(ctx.db)

    const orchestrator = createOrchestrator({
      agentRegistry: registry,
      agentRunner: runner,
      gateway: ctx.model,
      get conversations() { return (ctx as any).conversations },
      get toolRegistry() { return (ctx as any).tools?.registry },
      get toolExecutor() { return (ctx as any).tools?.executor },
      bus: ctx.bus,
      teamSessions: teamSessionService,
    })

    ;(ctx as any).agents = { registry, runner, messaging, orchestrator, teamSessions: teamSessionService }
```

In `onStart`, after the memory routes block:

```typescript
    const { createTeamRoutes } = await import('./routes-team.js')
    createTeamRoutes(ctx.http, (ctx as any).agents.teamSessions, (ctx as any).agents.orchestrator, ctx.bus)
    ctx.logger.info('Team session routes registered')
```

- [ ] **Step 5: Run tests**

```bash
cd /Users/eyssen/GitHub/eyas && bun test src/modules/agent/routes-team.test.ts 2>&1 | tail -15
```

Expected: all route tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/modules/agent/routes-team.ts src/modules/agent/routes-team.test.ts src/modules/agent/index.ts
git commit -m "feat(agent): add team session API routes and wire orchestrator + TeamSessionService"
```

---

## Task 6: Team Tools

**Files:**
- Create: `src/modules/tools/builtin/team-tools.ts`
- Modify: `src/modules/tools/index.ts`

- [ ] **Step 1: Write failing tests**

Create `src/modules/tools/builtin/team-tools.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { createTeamTools, createProposeTeamTool } from './team-tools.js'

function makeTeamService(sessionId = 'sess-1') {
  return {
    writeMemory: vi.fn().mockReturnValue({ id: 'mem-1', key: 'k', value: '"v"', layer: 'agent', category: 'finding', teamSessionId: sessionId, authorAgentId: 'agent-1', visibility: 'all', createdAt: '2026-01-01' }),
    readMemory: vi.fn().mockReturnValue([{ id: 'mem-1', key: 'k', value: '"v"', category: 'finding', layer: 'agent', teamSessionId: sessionId, authorAgentId: null, visibility: 'all', createdAt: '2026-01-01' }]),
    create: vi.fn(),
    get: vi.fn().mockReturnValue({ id: sessionId, status: 'running', parentConversationId: 'conv-1', config: '{}', reasoning: '', estimatedTokens: 0, totalTokens: 0, totalCostUsd: 0, createdAt: '2026-01-01', completedAt: null }),
  }
}

function makeOrchestrator() {
  return {
    analyzeAndPropose: vi.fn().mockResolvedValue({
      config: { phases: [], maxParallelAgents: 1, conflictStrategy: 'first-wins', replanAfterPhase: false, modelRouting: 'auto', useWorktrees: false },
      reasoning: 'test', estimatedTokens: 5000, estimatedCostUsd: 0.01, agentGaps: [],
    }),
  }
}

describe('createTeamTools', () => {
  it('write_team_memory calls writeMemory with correct args', async () => {
    const service = makeTeamService()
    const tools = createTeamTools(service as any)
    const writeTool = tools.find(t => t.name === 'write_team_memory')!

    const ctx = { agentId: 'agent-1', teamSessionId: 'sess-1' } as any
    await writeTool.execute({ key: 'finding-1', value: 'XSS vulnerability found', category: 'finding' }, ctx)

    expect(service.writeMemory).toHaveBeenCalledWith('sess-1', {
      key: 'finding-1', value: 'XSS vulnerability found', layer: 'agent',
      category: 'finding', authorAgentId: 'agent-1', visibility: undefined,
    })
  })

  it('write_team_memory returns error when no teamSessionId in context', async () => {
    const tools = createTeamTools(makeTeamService() as any)
    const writeTool = tools.find(t => t.name === 'write_team_memory')!
    const result = await writeTool.execute({ key: 'k', value: 'v', category: 'fact' }, {} as any)
    expect(result.error).toContain('No active team session')
  })

  it('read_team_memory calls readMemory with category filter', async () => {
    const service = makeTeamService()
    const tools = createTeamTools(service as any)
    const readTool = tools.find(t => t.name === 'read_team_memory')!

    const ctx = { agentId: 'agent-1', teamSessionId: 'sess-1', agentRole: 'reviewer' } as any
    const result = await readTool.execute({ category: 'finding' }, ctx) as any
    expect(service.readMemory).toHaveBeenCalledWith('sess-1', { category: 'finding', key: undefined, agentRole: 'reviewer' })
    expect(result.entries).toHaveLength(1)
  })
})

describe('createProposeTeamTool', () => {
  it('propose_team creates a team session and returns proposal', async () => {
    const service = makeTeamService()
    const orchestrator = makeOrchestrator()
    const tools = createProposeTeamTool(orchestrator as any, service as any)
    const tool = tools[0]

    const ctx = { conversationId: 'conv-1' } as any
    const result = await tool.execute({ goalDescription: 'Build it', complexity: 'complex' }, ctx) as any
    expect(result.teamSessionId).toBeDefined()
    expect(result.proposal).toBeDefined()
    expect(result.agentGaps).toBeDefined()
  })

  it('propose_team returns error when no conversationId', async () => {
    const tools = createProposeTeamTool(makeOrchestrator() as any, makeTeamService() as any)
    const result = await tools[0].execute({ goalDescription: 'test', complexity: 'simple' }, {} as any) as any
    expect(result.error).toContain('conversation context')
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd /Users/eyssen/GitHub/eyas && bun test src/modules/tools/builtin/team-tools.test.ts 2>&1 | tail -10
```

Expected: FAIL with "Cannot find module './team-tools.js'"

- [ ] **Step 3: Implement team-tools.ts**

Create `src/modules/tools/builtin/team-tools.ts`:

```typescript
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { ToolImplementation, ToolContext } from '../types.js'
import type { TeamSessionService } from '@modules/agent/team-session-service.js'
import type { createOrchestrator } from '@modules/agent/orchestrator.js'

export function createTeamTools(teamSessions: TeamSessionService): ToolImplementation[] {
  return [
    {
      name: 'write_team_memory',
      description: 'Write a finding, decision, blocker, or question to the shared team memory. Other agents in the team can read it.',
      category: 'agent',
      riskTier: 'green',
      inputSchema: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'Unique identifier for this memory entry, e.g. "security-finding-001"' },
          value: { description: 'The content to store (string, object, or any JSON value)' },
          category: { type: 'string', enum: ['finding', 'decision', 'blocker', 'question', 'fact'], description: 'Category of this memory entry' },
          visibility: { type: 'string', description: 'Who can read this: "all" (default) or "role:engineer", "role:reviewer", etc.' },
        },
        required: ['key', 'value', 'category'],
      },
      execute: async (input, ctx?: ToolContext) => {
        const teamSessionId = (ctx as any)?.teamSessionId as string | undefined
        if (!teamSessionId) return { error: 'No active team session in context' }

        const entry = teamSessions.writeMemory(teamSessionId, {
          key: input.key as string,
          value: input.value,
          layer: 'agent',
          category: input.category as any,
          authorAgentId: ctx?.agentId ?? undefined,
          visibility: input.visibility as string | undefined,
        })
        return { written: true, entryId: entry.id, key: entry.key }
      },
    },
    {
      name: 'read_team_memory',
      description: 'Read shared team memory entries. Filter by category or key to get relevant context from other agents.',
      category: 'agent',
      riskTier: 'green',
      inputSchema: {
        type: 'object',
        properties: {
          category: { type: 'string', enum: ['finding', 'decision', 'blocker', 'question', 'fact'], description: 'Filter by category (optional)' },
          key: { type: 'string', description: 'Filter by exact key (optional)' },
        },
      },
      execute: async (input, ctx?: ToolContext) => {
        const teamSessionId = (ctx as any)?.teamSessionId as string | undefined
        if (!teamSessionId) return { entries: [] }

        const agentRole = (ctx as any)?.agentRole as string | undefined
        const entries = teamSessions.readMemory(teamSessionId, {
          category: input.category as string | undefined,
          key: input.key as string | undefined,
          agentRole,
        })
        return {
          entries: entries.map(e => ({
            key: e.key,
            category: e.category,
            value: (() => { try { return JSON.parse(e.value) } catch { return e.value } })(),
            author: e.authorAgentId ?? 'system',
            createdAt: e.createdAt,
          })),
        }
      },
    },
  ]
}

export function createProposeTeamTool(
  orchestrator: ReturnType<typeof createOrchestrator>,
  teamSessions: TeamSessionService,
): ToolImplementation[] {
  return [
    {
      name: 'propose_team',
      description: 'Analyze the current task and propose a team of agents to tackle it collaboratively. Call this when a task is complex enough to benefit from multiple specialized agents. The user will see the proposal and can approve, modify, or reject it.',
      category: 'agent',
      riskTier: 'yellow',
      inputSchema: {
        type: 'object',
        properties: {
          goalDescription: { type: 'string', description: 'Clear description of the task to be accomplished' },
          complexity: { type: 'string', enum: ['simple', 'moderate', 'complex', 'epic'], description: 'Estimated task complexity' },
        },
        required: ['goalDescription', 'complexity'],
      },
      execute: async (input, ctx?: ToolContext) => {
        const conversationId = ctx?.conversationId
        if (!conversationId) return { error: 'No conversation context — cannot propose team' }

        const proposal = await orchestrator.analyzeAndPropose(
          input.goalDescription as string,
          input.complexity as string,
        )

        const session = teamSessions.create(conversationId, {
          config: proposal.config,
          reasoning: proposal.reasoning,
          estimatedTokens: proposal.estimatedTokens,
        })

        return {
          teamSessionId: session.id,
          proposal: {
            phases: proposal.config.phases,
            estimatedTokens: proposal.estimatedTokens,
            estimatedCostUsd: proposal.estimatedCostUsd,
            reasoning: proposal.reasoning,
          },
          agentGaps: proposal.agentGaps,
          message: `Team proposal created. The user will see this proposal and can approve or modify it.`,
        }
      },
    },
  ]
}
```

- [ ] **Step 4: Register team tools in tools/index.ts**

In `src/modules/tools/index.ts`, in the `registerBuiltins` function, inside the `if (ctx.hasModule('agent'))` block after the messaging tools:

```typescript
      if (ctx.hasModule('agent')) {
        // ... existing messaging tools registration ...

        const teamService = (ctx as any).agents?.teamSessions
        const orchestratorRef = (ctx as any).agents?.orchestrator
        if (teamService) {
          const { createTeamTools, createProposeTeamTool } = await import('./builtin/team-tools.js')
          for (const tool of createTeamTools(teamService)) registry.register(tool)
          if (orchestratorRef) {
            for (const tool of createProposeTeamTool(orchestratorRef, teamService)) registry.register(tool)
          }
        }
      }
```

- [ ] **Step 5: Run tests**

```bash
cd /Users/eyssen/GitHub/eyas && bun test src/modules/tools/builtin/team-tools.test.ts 2>&1 | tail -15
```

Expected: all tests PASS.

- [ ] **Step 6: Run full test suite**

```bash
cd /Users/eyssen/GitHub/eyas && bun test 2>&1 | tail -10
```

Expected: no regressions.

- [ ] **Step 7: Commit**

```bash
git add src/modules/tools/builtin/team-tools.ts src/modules/tools/builtin/team-tools.test.ts src/modules/tools/index.ts
git commit -m "feat(tools): add propose_team, write_team_memory, read_team_memory tools"
```

---

## Task 7: Frontend — team-session-store

**Files:**
- Create: `src/web/src/stores/team-session-store.ts`

- [ ] **Step 1: Create the Zustand store**

Create `src/web/src/stores/team-session-store.ts`:

```typescript
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { create } from 'zustand'

export interface AgentState {
  agentId: string
  conversationId: string
  phase: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  turn: number
  currentTool: string | null
  tokensUsed: number
  summary: string | null
}

export interface TeamMemoryEntry {
  id: string
  key: string
  value: unknown
  category: 'finding' | 'decision' | 'blocker' | 'question' | 'fact'
  layer: 'system' | 'agent'
  authorAgentId: string | null
  createdAt: string
}

export interface TeamSessionState {
  sessionId: string | null
  parentConversationId: string | null
  status: 'proposing' | 'awaiting_approval' | 'running' | 'paused' | 'completed' | 'failed' | null
  proposal: {
    phases: { name: string; agents: string[]; parallel: boolean }[]
    estimatedTokens: number
    estimatedCostUsd: number
    reasoning: string
    agentGaps: {
      suggestedName: string
      suggestedRole: string
      capabilities: string[]
      reason: string
      canProceedWithout: boolean
      proposedAgentType: string
    }[]
  } | null
  currentPhase: string | null
  agentStates: AgentState[]
  memoryEntries: TeamMemoryEntry[]
  isExpanded: boolean  // true = show team dashboard
}

interface TeamSessionActions {
  setProposal(sessionId: string, parentConversationId: string, proposal: TeamSessionState['proposal']): void
  handleEvent(event: any): void
  setExpanded(expanded: boolean): void
  reset(): void
}

const initialState: TeamSessionState = {
  sessionId: null,
  parentConversationId: null,
  status: null,
  proposal: null,
  currentPhase: null,
  agentStates: [],
  memoryEntries: [],
  isExpanded: false,
}

export const useTeamSessionStore = create<TeamSessionState & TeamSessionActions>((set, get) => ({
  ...initialState,

  setProposal(sessionId, parentConversationId, proposal) {
    set({ sessionId, parentConversationId, proposal, status: 'proposing' })
  },

  handleEvent(event: any) {
    const { type } = event
    if (type === 'team:proposed') {
      const { session, proposal } = event
      set({ sessionId: session.id, parentConversationId: session.parentConversationId, proposal, status: 'proposing' })
    }
    else if (type === 'phase_started') {
      set({ currentPhase: event.phase, status: 'running' })
      // Initialize pending agent states for this phase
      set(state => ({
        agentStates: [
          ...state.agentStates.filter(a => a.phase !== event.phase),
          ...event.agents.map((agentId: string) => ({
            agentId, conversationId: '', phase: event.phase,
            status: 'pending' as const, turn: 0, currentTool: null, tokensUsed: 0, summary: null,
          })),
        ],
      }))
    }
    else if (type === 'agent_started') {
      set(state => ({
        agentStates: state.agentStates.map(a =>
          a.agentId === event.agentId
            ? { ...a, status: 'running', conversationId: event.conversationId }
            : a
        ),
      }))
    }
    else if (type === 'agent_progress') {
      set(state => ({
        agentStates: state.agentStates.map(a =>
          a.agentId === event.agentId
            ? { ...a, turn: event.turn, currentTool: event.toolCall ?? null }
            : a
        ),
      }))
    }
    else if (type === 'agent_completed') {
      set(state => ({
        agentStates: state.agentStates.map(a =>
          a.agentId === event.agentId
            ? { ...a, status: event.status, currentTool: null, summary: event.summary ?? null }
            : a
        ),
      }))
    }
    else if (type === 'memory_written') {
      const entry = event.entry
      set(state => ({
        memoryEntries: [...state.memoryEntries, {
          id: entry.id, key: entry.key,
          value: (() => { try { return JSON.parse(entry.value) } catch { return entry.value } })(),
          category: entry.category, layer: entry.layer,
          authorAgentId: entry.authorAgentId, createdAt: entry.createdAt,
        }],
      }))
    }
    else if (type === 'checkpoint') {
      set({ status: 'paused' })
    }
    else if (type === 'team_completed') {
      set({ status: 'completed' })
    }
    else if (type === 'team_failed') {
      set({ status: 'failed' })
    }
  },

  setExpanded(expanded) { set({ isExpanded: expanded }) },
  reset() { set(initialState) },
}))
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/eyssen/GitHub/eyas && bunx tsc --noEmit --project src/web/tsconfig.json 2>&1 | grep team-session-store
```

Expected: no errors for this file.

- [ ] **Step 3: Commit**

```bash
git add src/web/src/stores/team-session-store.ts
git commit -m "feat(frontend): add team-session-store for real-time team state"
```

---

## Task 8: TeamProposalCard

**Files:**
- Create: `src/web/src/pages/conversations/components/team-proposal-card.tsx`

- [ ] **Step 1: Create the component**

Create `src/web/src/pages/conversations/components/team-proposal-card.tsx`:

```typescript
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Users, AlertTriangle, CheckCircle, XCircle, Edit2, ChevronDown, ChevronUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { api } from '@/lib/api'
import { useConversationStore } from '@/stores/conversation-store'
import type { TeamSessionState } from '@/stores/team-session-store'

interface TeamProposalCardProps {
  sessionId: string
  proposal: NonNullable<TeamSessionState['proposal']>
  onApproved(): void
  onRejected(): void
}

export function TeamProposalCard({ sessionId, proposal, onApproved, onRejected }: TeamProposalCardProps) {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)
  const [gapsDismissed, setGapsDismissed] = useState<Set<number>>(new Set())
  const [showPhases, setShowPhases] = useState(true)

  const activeGaps = proposal.agentGaps.filter((_, i) => !gapsDismissed.has(i))

  const handleApprove = async () => {
    setLoading(true)
    try {
      await api.post(`/team-sessions/${sessionId}/approve`, {})
      onApproved()
    } finally {
      setLoading(false)
    }
  }

  const handleReject = async () => {
    await api.post(`/team-sessions/${sessionId}/reject`, {})
    onRejected()
  }

  const handleCreateAgent = (gap: TeamSessionState['proposal']['agentGaps'][0]) => {
    const pendingMessage = `Create a new agent with the following profile:
Name: ${gap.suggestedName}
Role: ${gap.suggestedRole}
Capabilities: ${gap.capabilities.join(', ')}
Context: ${gap.reason}`

    useConversationStore.getState().setPendingMessage(pendingMessage)
    navigate({ to: '/agents/new' })
  }

  const estimatedCost = proposal.estimatedCostUsd < 0.01
    ? '<$0.01'
    : `~$${proposal.estimatedCostUsd.toFixed(2)}`

  return (
    <div className="glass-card border border-primary/20 rounded-lg overflow-hidden my-2">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 bg-primary/5 border-b border-primary/10">
        <Users className="h-4 w-4 text-primary" />
        <span className="text-sm font-medium">Team javaslat</span>
        <span className="ml-auto text-xs text-muted-foreground">
          ~{proposal.estimatedTokens.toLocaleString()} token · {estimatedCost}
        </span>
      </div>

      {/* Reasoning */}
      <div className="px-4 py-2 text-xs text-muted-foreground border-b border-border/30">
        {proposal.reasoning}
      </div>

      {/* Phases */}
      <div className="px-4 py-2 border-b border-border/30">
        <button
          type="button"
          className="flex items-center gap-1.5 text-xs font-medium text-foreground mb-2 hover:text-primary transition-colors"
          onClick={() => setShowPhases(!showPhases)}
        >
          {showPhases ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          Fázisok ({proposal.phases.length})
        </button>

        {showPhases && (
          <div className="space-y-2">
            {proposal.phases.map((phase, i) => (
              <div key={i} className="flex items-start gap-3">
                <span className="text-[10px] text-muted-foreground mt-0.5 w-12 text-right shrink-0">
                  Fázis {i + 1}
                </span>
                <div className="flex-1">
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className="text-xs font-medium capitalize">{phase.name}</span>
                    <Badge variant="outline" className="text-[9px]">
                      {phase.parallel ? 'párhuzamos' : 'sorban'}
                    </Badge>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {phase.agents.map(agentId => (
                      <Badge key={agentId} variant="secondary" className="text-[9px]">
                        {agentId}
                      </Badge>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Agent Gaps */}
      {activeGaps.length > 0 && (
        <div className="px-4 py-2 border-b border-border/30 bg-amber-500/5">
          <div className="flex items-center gap-1.5 text-xs font-medium text-amber-500 mb-2">
            <AlertTriangle className="h-3.5 w-3.5" />
            Hiányzó specialista{activeGaps.length > 1 ? 'k' : ''} ({activeGaps.length})
          </div>
          <div className="space-y-2">
            {proposal.agentGaps.map((gap, i) => {
              if (gapsDismissed.has(i)) return null
              return (
                <div key={i} className="text-xs space-y-1">
                  <div className="font-medium">{gap.suggestedName}</div>
                  <div className="text-muted-foreground">{gap.reason}</div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 text-[10px]"
                      onClick={() => handleCreateAgent(gap)}
                    >
                      Létrehozom most
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 text-[10px] text-muted-foreground"
                      onClick={() => setGapsDismissed(prev => new Set([...prev, i]))}
                    >
                      {gap.canProceedWithout ? 'Kihagyom' : 'Kihagyom (kockázatos)'}
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2 px-4 py-3">
        <Button
          size="sm"
          onClick={handleApprove}
          disabled={loading}
          className="h-7 text-xs"
        >
          <CheckCircle className="h-3.5 w-3.5 mr-1" />
          Elfogadom
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          disabled
          title="Szerkesztés hamarosan"
        >
          <Edit2 className="h-3.5 w-3.5 mr-1" />
          Módosítom
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-xs text-muted-foreground"
          onClick={handleReject}
        >
          <XCircle className="h-3.5 w-3.5 mr-1" />
          Mégse
        </Button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
cd /Users/eyssen/GitHub/eyas && bunx tsc --noEmit --project src/web/tsconfig.json 2>&1 | grep team-proposal-card
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/web/src/pages/conversations/components/team-proposal-card.tsx
git commit -m "feat(frontend): add TeamProposalCard with agent gap actions"
```

---

## Task 9: SubConversationTree Enhancement

**Files:**
- Modify: `src/web/src/pages/conversations/components/sub-conversation-tree.tsx`

- [ ] **Step 1: Update the component with real-time agent progress**

Replace the entire content of `src/web/src/pages/conversations/components/sub-conversation-tree.tsx`:

```typescript
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useApi } from '@/hooks/use-api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Bot, ChevronDown, ChevronRight, MessageSquare, Expand } from 'lucide-react'
import { useTeamSessionStore } from '@/stores/team-session-store'

interface SubConversation {
  id: string
  title: string | null
  status: string
  agentId: string | null
  messageCount: number
  teamSessionId: string | null
}

interface SubConversationTreeProps {
  conversationId: string
}

const STATUS_COLORS: Record<string, string> = {
  working: 'text-blue-400',
  running: 'text-blue-400',
  idle: 'text-zinc-400',
  pending: 'text-zinc-400',
  completed: 'text-emerald-400',
  failed: 'text-red-400',
  archived: 'text-zinc-600',
}

const STATUS_DOT_COLORS: Record<string, string> = {
  working: 'bg-blue-400 animate-pulse',
  running: 'bg-blue-400 animate-pulse',
  idle: 'bg-zinc-400',
  pending: 'bg-zinc-300',
  completed: 'bg-emerald-400',
  failed: 'bg-red-400',
  archived: 'bg-zinc-600',
}

export function SubConversationTree({ conversationId }: SubConversationTreeProps) {
  const navigate = useNavigate()
  const { data, refetch } = useApi<{ conversations: SubConversation[] }>(
    `/conversations?parentId=${conversationId}`
  )
  const [expanded, setExpanded] = useState(true)
  const { agentStates, sessionId, status, setExpanded: setDashboardExpanded } = useTeamSessionStore()

  const children = data?.conversations ?? []
  if (children.length === 0) return null

  const isTeamSession = children.some(c => c.teamSessionId !== null)
  const activeTeamSessionId = children.find(c => c.teamSessionId)?.teamSessionId

  // Merge DB status with real-time agent states
  const enrichedChildren = children.map(child => {
    const agentState = agentStates.find(a => a.conversationId === child.id)
    return { ...child, agentState }
  })

  return (
    <div className="glass-card p-3">
      <div className="flex items-center gap-2 w-full mb-2">
        <button
          type="button"
          className="flex items-center gap-2 flex-1 text-left text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          {isTeamSession ? 'Team' : 'Sub-conversations'} ({children.length})
        </button>

        {isTeamSession && (
          <Button
            size="sm"
            variant="ghost"
            className="h-5 px-1.5 text-[10px] text-muted-foreground"
            onClick={() => setDashboardExpanded(true)}
            title="Team Dashboard megnyitása"
          >
            <Expand className="h-3 w-3 mr-1" />
            Expand
          </Button>
        )}
      </div>

      {expanded && (
        <div className="space-y-1">
          {enrichedChildren.map((child) => {
            const effectiveStatus = child.agentState?.status ?? child.status
            const currentTool = child.agentState?.currentTool
            const turn = child.agentState?.turn

            return (
              <button
                key={child.id}
                type="button"
                className="flex items-start gap-2.5 w-full px-2 py-1.5 rounded-md text-left text-xs hover:bg-accent/30 transition-colors"
                onClick={() =>
                  navigate({ to: '/conversations/$conversationId', params: { conversationId: child.id } })
                }
              >
                <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 mt-1 ${STATUS_DOT_COLORS[effectiveStatus] ?? 'bg-zinc-400'}`} />

                {child.agentId ? (
                  <Bot className={`h-3.5 w-3.5 flex-shrink-0 mt-0.5 ${STATUS_COLORS[effectiveStatus] ?? 'text-zinc-400'}`} />
                ) : (
                  <MessageSquare className="h-3.5 w-3.5 flex-shrink-0 mt-0.5 text-muted-foreground" />
                )}

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate">{child.title || 'Untitled'}</span>
                    <Badge variant="outline" className={`text-[9px] shrink-0 ${STATUS_COLORS[effectiveStatus] ?? ''}`}>
                      {effectiveStatus}
                    </Badge>
                  </div>
                  {/* Real-time tool call display */}
                  {currentTool && (
                    <div className="text-[10px] text-blue-400 mt-0.5 truncate">
                      {turn && <span className="text-muted-foreground mr-1">turn {turn}</span>}
                      {currentTool}...
                    </div>
                  )}
                </div>

                <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
                  {child.messageCount}m
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
cd /Users/eyssen/GitHub/eyas && bunx tsc --noEmit --project src/web/tsconfig.json 2>&1 | grep sub-conversation-tree
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/web/src/pages/conversations/components/sub-conversation-tree.tsx
git commit -m "feat(frontend): enhance SubConversationTree with real-time agent progress and team expand button"
```

---

## Task 10: TeamDashboard

**Files:**
- Create: `src/web/src/pages/conversations/components/team-dashboard.tsx`

- [ ] **Step 1: Create the component**

Create `src/web/src/pages/conversations/components/team-dashboard.tsx`:

```typescript
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { useNavigate } from '@tanstack/react-router'
import { Minimize2, Bot, Clock, Zap, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useTeamSessionStore, type AgentState, type TeamMemoryEntry } from '@/stores/team-session-store'

const CATEGORY_COLORS: Record<string, string> = {
  finding: 'text-blue-400',
  decision: 'text-emerald-400',
  blocker: 'text-red-400',
  question: 'text-amber-400',
  fact: 'text-muted-foreground',
}

const CATEGORY_LABELS: Record<string, string> = {
  finding: 'Megállapítás',
  decision: 'Döntés',
  blocker: 'Blokkoló',
  question: 'Kérdés',
  fact: 'Adat',
}

function AgentCard({ agent }: { agent: AgentState }) {
  const navigate = useNavigate()

  const statusColor = {
    pending: 'text-zinc-400',
    running: 'text-blue-400',
    completed: 'text-emerald-400',
    failed: 'text-red-400',
  }[agent.status] ?? 'text-zinc-400'

  const statusDot = {
    pending: 'bg-zinc-400',
    running: 'bg-blue-400 animate-pulse',
    completed: 'bg-emerald-400',
    failed: 'bg-red-400',
  }[agent.status] ?? 'bg-zinc-400'

  return (
    <div className="glass-card p-3 flex flex-col gap-2 min-w-[180px]">
      {/* Header */}
      <div className="flex items-center gap-2">
        <div className={`w-2 h-2 rounded-full shrink-0 ${statusDot}`} />
        <Bot className={`h-4 w-4 shrink-0 ${statusColor}`} />
        <span className="text-xs font-medium truncate flex-1">{agent.agentId}</span>
      </div>

      {/* Status badge */}
      <Badge variant="outline" className={`self-start text-[9px] ${statusColor}`}>
        {agent.status}
      </Badge>

      {/* Phase */}
      <div className="text-[10px] text-muted-foreground">
        Fázis: <span className="text-foreground">{agent.phase}</span>
      </div>

      {/* Turn counter */}
      {agent.turn > 0 && (
        <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
          <Clock className="h-3 w-3" />
          {agent.turn} turn
        </div>
      )}

      {/* Token usage */}
      {agent.tokensUsed > 0 && (
        <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
          <Zap className="h-3 w-3" />
          {agent.tokensUsed.toLocaleString()} token
        </div>
      )}

      {/* Current tool */}
      {agent.currentTool && (
        <div className="text-[10px] text-blue-400 truncate">
          {agent.currentTool}...
        </div>
      )}

      {/* Summary */}
      {agent.summary && (
        <div className="text-[10px] text-muted-foreground line-clamp-2">
          {agent.summary}
        </div>
      )}

      {/* View chat */}
      {agent.conversationId && (
        <Button
          size="sm"
          variant="outline"
          className="h-6 text-[10px] mt-auto"
          onClick={() => navigate({ to: '/conversations/$conversationId', params: { conversationId: agent.conversationId } })}
        >
          View chat
        </Button>
      )}
    </div>
  )
}

function MemoryEntry({ entry }: { entry: TeamMemoryEntry }) {
  const colorClass = CATEGORY_COLORS[entry.category] ?? 'text-muted-foreground'
  const label = CATEGORY_LABELS[entry.category] ?? entry.category
  const valueStr = typeof entry.value === 'object' ? JSON.stringify(entry.value) : String(entry.value)
  const author = entry.authorAgentId ?? 'system'

  return (
    <div className="flex items-start gap-2 text-[11px] py-1 border-b border-border/20 last:border-0">
      <span className={`shrink-0 font-medium ${colorClass}`}>{label}</span>
      <span className="text-muted-foreground shrink-0">[{author}]</span>
      <span className="font-mono text-foreground/80 truncate">{entry.key}:</span>
      <span className="text-muted-foreground truncate flex-1">{valueStr}</span>
    </div>
  )
}

interface TeamDashboardProps {
  onCollapse(): void
}

export function TeamDashboard({ onCollapse }: TeamDashboardProps) {
  const { sessionId, status, currentPhase, agentStates, memoryEntries } = useTeamSessionStore()

  const memoryCounts = {
    finding: memoryEntries.filter(e => e.category === 'finding').length,
    decision: memoryEntries.filter(e => e.category === 'decision').length,
    blocker: memoryEntries.filter(e => e.category === 'blocker').length,
  }

  const recentMemory = [...memoryEntries].reverse().slice(0, 10)

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border/50 shrink-0">
        <div className="flex items-center gap-2 flex-1">
          <span className="text-sm font-medium">Team Dashboard</span>
          {currentPhase && (
            <Badge variant="outline" className="text-[10px]">
              {currentPhase}
            </Badge>
          )}
          {status && (
            <Badge
              variant={status === 'running' ? 'default' : 'outline'}
              className="text-[10px]"
            >
              {status}
            </Badge>
          )}
        </div>
        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={onCollapse}>
          <Minimize2 className="h-3.5 w-3.5 mr-1" />
          Collapse
        </Button>
      </div>

      {/* Agent cards */}
      <div className="flex gap-3 p-4 overflow-x-auto shrink-0 border-b border-border/30">
        {agentStates.length === 0 ? (
          <div className="text-xs text-muted-foreground">Nincs aktív agent.</div>
        ) : (
          agentStates.map(agent => <AgentCard key={`${agent.agentId}-${agent.phase}`} agent={agent} />)
        )}
      </div>

      {/* Team Memory */}
      <div className="flex-1 overflow-hidden flex flex-col">
        <div className="flex items-center gap-3 px-4 py-2 border-b border-border/30 text-xs shrink-0">
          <span className="font-medium">Team Memory</span>
          <span className="text-blue-400">megállapítás ({memoryCounts.finding})</span>
          <span className="text-emerald-400">döntés ({memoryCounts.decision})</span>
          {memoryCounts.blocker > 0 && (
            <span className="text-red-400 flex items-center gap-1">
              <AlertCircle className="h-3 w-3" />
              blokkoló ({memoryCounts.blocker})
            </span>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-2">
          {recentMemory.length === 0 ? (
            <div className="text-xs text-muted-foreground py-4">Még nincs bejegyzés.</div>
          ) : (
            recentMemory.map(entry => <MemoryEntry key={entry.id} entry={entry} />)
          )}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
cd /Users/eyssen/GitHub/eyas && bunx tsc --noEmit --project src/web/tsconfig.json 2>&1 | grep team-dashboard
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/web/src/pages/conversations/components/team-dashboard.tsx
git commit -m "feat(frontend): add TeamDashboard with agent cards and team memory panel"
```

---

## Task 11: conversation-page.tsx Integration

**Files:**
- Modify: `src/web/src/pages/conversations/conversation-page.tsx`

- [ ] **Step 1: Add imports**

At the top of `src/web/src/pages/conversations/conversation-page.tsx`, add after the existing imports:

```typescript
import { TeamProposalCard } from './components/team-proposal-card'
import { TeamDashboard } from './components/team-dashboard'
import { useTeamSessionStore } from '@/stores/team-session-store'
import { useWebSocket } from '@/hooks/use-websocket'
```

- [ ] **Step 2: Subscribe to team session WebSocket events**

Inside the `ConversationPage` component, after the existing state declarations, add:

```typescript
  const {
    sessionId: teamSessionId,
    proposal: teamProposal,
    status: teamStatus,
    isExpanded: isTeamExpanded,
    setExpanded: setTeamExpanded,
    handleEvent: handleTeamEvent,
    reset: resetTeamSession,
  } = useTeamSessionStore()

  // Subscribe to team session events for this conversation
  useEffect(() => {
    if (!teamSessionId) return
    return subscribe(`team:${teamSessionId}:event`, (data: any) => {
      handleTeamEvent(data)
    })
  }, [teamSessionId, subscribe, handleTeamEvent])

  // Subscribe to team:proposed events from the conversation's agent
  useEffect(() => {
    if (!conversationId) return
    return subscribe(`team:proposed:${conversationId}`, (data: any) => {
      handleTeamEvent({ type: 'team:proposed', ...data })
    })
  }, [conversationId, subscribe, handleTeamEvent])
```

- [ ] **Step 3: Render TeamProposalCard in chat messages area**

In the `ConversationChat` section, after the `ConversationChat` component, check if there is a pending proposal and render the card. The proposal card should appear above the chat input — modify the chat panel to include it:

Find the `<ConversationChat` block and replace it with:

```typescript
            <ConversationChat
              messages={conv?.messages ?? []}
              streamingText={streamingText}
              isStreaming={isStreaming}
              onSend={handleSend}
              onCancel={cancel}
              disabled={isStreaming || conv?.status === 'working'}
              conversationId={conversationId}
            />

            {/* Team proposal card — shown when agent proposes a team */}
            {teamProposal && teamSessionId && teamStatus === 'proposing' && (
              <div className="px-4 pb-2">
                <TeamProposalCard
                  sessionId={teamSessionId}
                  proposal={teamProposal}
                  onApproved={() => handleTeamEvent({ type: 'team_approved' })}
                  onRejected={() => resetTeamSession()}
                />
              </div>
            )}
```

- [ ] **Step 4: Replace right panel with TeamDashboard when expanded**

Find the right `<Panel>` (the one with `defaultSize={34}`) and replace its content:

```typescript
        <Panel defaultSize={34} minSize={20}>
          {isTeamExpanded ? (
            <TeamDashboard onCollapse={() => setTeamExpanded(false)} />
          ) : (
            <div className="flex flex-col h-full overflow-y-auto">
              {/* Agent progress panel */}
              {agentProgress && (
                <div className="p-3 border-b border-border/30">
                  <AgentProgress
                    agentName={agentProgress.agentName}
                    turn={agentProgress.turn}
                    maxTurns={agentProgress.maxTurns}
                    toolCalls={agentProgress.toolCalls}
                    tokensUsed={agentProgress.tokensUsed}
                    isRunning={agentProgress.isRunning}
                    onCancel={() => {
                      cancel()
                      setAgentProgress({ ...agentProgress, isRunning: false })
                    }}
                  />
                </div>
              )}

              {/* Sub-conversation tree */}
              {conv?.parentConversationId === null && (
                <div className="p-3 border-b border-border/30">
                  <SubConversationTree conversationId={conversationId} />
                </div>
              )}

              <ChatterPanel conversationId={conversationId} externalRefreshKey={chatterRefreshKey} />
            </div>
          )}
        </Panel>
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
cd /Users/eyssen/GitHub/eyas && bunx tsc --noEmit --project src/web/tsconfig.json 2>&1 | grep -E "error|conversation-page"
```

Expected: no errors.

- [ ] **Step 6: Start the dev server and verify UI renders**

```bash
cd /Users/eyssen/GitHub/eyas && bun run serve &
sleep 3
```

Open `http://localhost:3000` in the browser. Navigate to any conversation. Verify:
- The right panel still shows the sub-conversation tree and chatter (no regressions)
- TypeScript didn't introduce runtime errors visible in the browser console

- [ ] **Step 7: Run full test suite**

```bash
cd /Users/eyssen/GitHub/eyas && bun test 2>&1 | tail -10
```

Expected: same or more tests passing than before.

- [ ] **Step 8: Commit**

```bash
git add src/web/src/pages/conversations/conversation-page.tsx
git commit -m "feat(frontend): integrate team session store, proposal card, and dashboard toggle into conversation page"
```

---

## Post-Implementation Verification

After all tasks are complete:

- [ ] Start the server: `bun run serve`
- [ ] Open a conversation in `managed` or `autonomous` mode
- [ ] In the chat, type: "Hozz létre egy team javaslatot erre a feladatra" — verify the agent calls `propose_team` and the proposal card appears
- [ ] Click "Elfogadom" — verify the team starts executing and the tree shows running agents
- [ ] Click "Expand" in the tree — verify the TeamDashboard opens with agent cards
- [ ] Verify team memory entries appear in the dashboard when agents write them
- [ ] Click "Collapse" — verify the standard view returns
- [ ] Run `bun test` one final time — all existing tests must still pass

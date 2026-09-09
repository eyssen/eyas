# Forge — Unified Evolution System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a unified evolution module ("Forge") that replaces the existing skill-evolution module and adds tool evolution — both driven by agent reasoning, not genetic algorithms.

**Architecture:** Three-phase pipeline: Observe (structured feedback from tool/skill usage) → Forge (agent-driven analysis, hypothesis, sandbox testing) → Adopt (user approval, update, memory). The existing `skill-evolution` module is absorbed — its `skill_candidates` table is migrated to a new `forge_proposals` table that handles both skills and tools. The `self-learning` module's execution insights feed into Forge's observation layer.

**Tech Stack:** TypeScript, Bun, Drizzle ORM, SQLite, Hono, React 19, shadcn/ui, Vitest

---

## File Map

### Wave 1 — Observe: Feedback Collection

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `src/modules/forge/types.ts` | All Forge type definitions |
| Create | `src/modules/forge/schema.ts` | DB tables: forge_feedback, forge_proposals, forge_experiments |
| Create | `src/modules/forge/feedback-collector.ts` | Collect structured feedback after tool/skill usage |
| Create | `tests/modules/forge/feedback-collector.test.ts` | Test feedback collection |

### Wave 2 — Forge: Analysis & Proposal Engine

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `src/modules/forge/friction-analyzer.ts` | Aggregate feedback, detect friction patterns |
| Create | `src/modules/forge/proposal-engine.ts` | Generate improvement proposals from friction analysis |
| Create | `src/modules/forge/proposal-store.ts` | CRUD for forge_proposals (replaces approval-store) |
| Create | `tests/modules/forge/friction-analyzer.test.ts` | Test friction detection |
| Create | `tests/modules/forge/proposal-engine.test.ts` | Test proposal generation |

### Wave 3 — Adopt: Approval, Experiment & Apply

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `src/modules/forge/experiment-runner.ts` | Run A/B sandbox tests via delegation |
| Create | `src/modules/forge/applier.ts` | Apply approved proposals to tools/skills |
| Create | `tests/modules/forge/experiment-runner.test.ts` | Test experiment lifecycle |

### Wave 4 — Module Wiring & Migration

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `src/modules/forge/index.ts` | Module registration, scheduler, bus events |
| Create | `src/modules/forge/routes.ts` | REST API endpoints |
| Modify | `src/modules/skill-evolution/index.ts` | Deprecate — redirect to forge |
| Create | `tests/modules/forge/integration.test.ts` | Full pipeline test |

### Wave 5 — Frontend

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `src/web/src/pages/forge/forge-page.tsx` | Main Forge dashboard |
| Create | `src/web/src/pages/forge/proposal-detail.tsx` | Proposal detail + approve/reject |

---

## Wave 1: Observe — Feedback Collection

### Task 1.1: Forge Types

**Files:**
- Create: `src/modules/forge/types.ts`

- [ ] **Step 1: Create type definitions**

```typescript
// src/modules/forge/types.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.

/** What kind of thing is being evolved */
export type ForgeTarget = 'skill' | 'tool'

/** Evolution scope — what aspect is being improved */
export type ForgeScope = 'description' | 'schema' | 'prompt' | 'behavior' | 'code'

/** Feedback after a tool/skill usage */
export interface ForgeFeedback {
  id: string
  target: ForgeTarget
  targetId: string            // tool name or skill id
  conversationId: string
  agentId: string | null
  useful: boolean
  friction: string | null     // what went wrong or was awkward
  betterApproach: string | null  // what the agent would do differently
  createdAt: string
}

export interface CreateFeedbackInput {
  target: ForgeTarget
  targetId: string
  conversationId: string
  agentId?: string
  useful: boolean
  friction?: string
  betterApproach?: string
}

/** A detected friction pattern — aggregated from multiple feedbacks */
export interface FrictionPattern {
  targetId: string
  target: ForgeTarget
  frictionCount: number
  totalUsages: number
  frictionRate: number        // 0-1
  topFrictions: string[]      // most common friction descriptions
  topSuggestions: string[]    // most common betterApproach values
  sampleFeedbackIds: string[]
}

/** A proposed improvement */
export interface ForgeProposal {
  id: string
  target: ForgeTarget
  targetId: string
  scope: ForgeScope
  title: string
  description: string
  currentValue: string        // what it is now
  proposedValue: string       // what it should become
  reasoning: string           // why this change helps
  confidence: number          // 0-1
  basedOnFeedbacks: number
  status: 'pending' | 'testing' | 'approved' | 'rejected' | 'applied'
  experimentId: string | null
  createdAt: string
  reviewedAt: string | null
}

export interface CreateProposalInput {
  target: ForgeTarget
  targetId: string
  scope: ForgeScope
  title: string
  description: string
  currentValue: string
  proposedValue: string
  reasoning: string
  confidence: number
  basedOnFeedbacks: number
}

/** A sandbox experiment to validate a proposal */
export interface ForgeExperiment {
  id: string
  proposalId: string
  conversationId: string      // child conversation used for testing
  status: 'running' | 'passed' | 'failed'
  result: string | null       // summary of outcome
  startedAt: string
  completedAt: string | null
}

/** Configuration for the Forge module */
export interface ForgeConfig {
  minFeedbacksForAnalysis: number    // min feedbacks before analyzing (default: 5)
  frictionRateThreshold: number      // min friction rate to trigger proposal (default: 0.3)
  autoApproveConfidence: number      // auto-approve if confidence >= (default: 0.95)
  analysisWindowDays: number         // look back period (default: 30)
  maxProposalsPerRun: number         // limit proposals per scan (default: 10)
}
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/forge/types.ts
git commit -m "feat(forge): type definitions for unified evolution system"
```

### Task 1.2: Forge Schema

**Files:**
- Create: `src/modules/forge/schema.ts`

- [ ] **Step 1: Create DB table creation function**

```typescript
// src/modules/forge/schema.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'
import type { EyasDb } from '@core/types'

export function createForgeTables(db: EyasDb) {
  db.run(sql`CREATE TABLE IF NOT EXISTS forge_feedback (
    id TEXT PRIMARY KEY,
    target TEXT NOT NULL,
    target_id TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    agent_id TEXT,
    useful INTEGER NOT NULL,
    friction TEXT,
    better_approach TEXT,
    created_at TEXT NOT NULL
  )`)
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_forge_fb_target ON forge_feedback(target, target_id)`)
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_forge_fb_created ON forge_feedback(created_at)`)

  db.run(sql`CREATE TABLE IF NOT EXISTS forge_proposals (
    id TEXT PRIMARY KEY,
    target TEXT NOT NULL,
    target_id TEXT NOT NULL,
    scope TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    current_value TEXT NOT NULL,
    proposed_value TEXT NOT NULL,
    reasoning TEXT NOT NULL,
    confidence REAL NOT NULL DEFAULT 0,
    based_on_feedbacks INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending',
    experiment_id TEXT,
    created_at TEXT NOT NULL,
    reviewed_at TEXT
  )`)
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_forge_prop_status ON forge_proposals(status)`)
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_forge_prop_target ON forge_proposals(target, target_id)`)

  db.run(sql`CREATE TABLE IF NOT EXISTS forge_experiments (
    id TEXT PRIMARY KEY,
    proposal_id TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'running',
    result TEXT,
    started_at TEXT NOT NULL,
    completed_at TEXT
  )`)
}
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/forge/schema.ts
git commit -m "feat(forge): database schema — feedback, proposals, experiments tables"
```

### Task 1.3: Feedback Collector (TDD)

**Files:**
- Create: `src/modules/forge/feedback-collector.ts`
- Create: `tests/modules/forge/feedback-collector.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// tests/modules/forge/feedback-collector.test.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, it, expect, beforeEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { createFeedbackCollector } from '@modules/forge/feedback-collector'

function createTestDb() {
  const { Database } = require('bun:sqlite')
  const sqlite = new Database(':memory:')
  sqlite.run(`CREATE TABLE forge_feedback (
    id TEXT PRIMARY KEY, target TEXT NOT NULL, target_id TEXT NOT NULL,
    conversation_id TEXT NOT NULL, agent_id TEXT, useful INTEGER NOT NULL,
    friction TEXT, better_approach TEXT, created_at TEXT NOT NULL
  )`)
  return {
    run(query: any) { sqlite.run(query.sql ?? query, ...(query.params ? [query.params] : [])) },
    all(query: any) { return sqlite.prepare(query.sql ?? query).all(...(query.params ? [query.params] : [])) },
  }
}

describe('FeedbackCollector', () => {
  let db: any
  let collector: ReturnType<typeof createFeedbackCollector>

  beforeEach(() => {
    db = createTestDb()
    collector = createFeedbackCollector(db)
  })

  it('records positive feedback', () => {
    const fb = collector.record({
      target: 'tool', targetId: 'shell_exec', conversationId: 'conv-1',
      agentId: 'agent-a', useful: true,
    })
    expect(fb.id).toBeTruthy()
    expect(fb.useful).toBe(true)
    expect(fb.friction).toBeNull()
  })

  it('records feedback with friction', () => {
    const fb = collector.record({
      target: 'tool', targetId: 'shell_exec', conversationId: 'conv-1',
      useful: false, friction: 'timeout too short', betterApproach: 'increase timeout to 60s',
    })
    expect(fb.useful).toBe(false)
    expect(fb.friction).toBe('timeout too short')
    expect(fb.betterApproach).toBe('increase timeout to 60s')
  })

  it('lists feedback for a target', () => {
    collector.record({ target: 'tool', targetId: 'shell_exec', conversationId: 'c1', useful: true })
    collector.record({ target: 'tool', targetId: 'shell_exec', conversationId: 'c2', useful: false, friction: 'slow' })
    collector.record({ target: 'skill', targetId: 'code-review', conversationId: 'c3', useful: true })

    const toolFb = collector.listForTarget('tool', 'shell_exec')
    expect(toolFb.length).toBe(2)

    const skillFb = collector.listForTarget('skill', 'code-review')
    expect(skillFb.length).toBe(1)
  })

  it('computes stats for a target', () => {
    collector.record({ target: 'tool', targetId: 'search', conversationId: 'c1', useful: true })
    collector.record({ target: 'tool', targetId: 'search', conversationId: 'c2', useful: false, friction: 'no results' })
    collector.record({ target: 'tool', targetId: 'search', conversationId: 'c3', useful: false, friction: 'wrong results' })

    const stats = collector.getStats('tool', 'search')
    expect(stats.total).toBe(3)
    expect(stats.useful).toBe(1)
    expect(stats.frictionCount).toBe(2)
    expect(stats.frictionRate).toBeCloseTo(0.667, 1)
  })
})
```

- [ ] **Step 2: Run test — verify it fails**

Run: `bun test tests/modules/forge/feedback-collector.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement feedback collector**

```typescript
// src/modules/forge/feedback-collector.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'
import { generateId } from '@shared/crypto.js'
import type { ForgeFeedback, CreateFeedbackInput, ForgeTarget } from './types.js'

function rowToFeedback(r: any): ForgeFeedback {
  return {
    id: r.id, target: r.target, targetId: r.target_id,
    conversationId: r.conversation_id, agentId: r.agent_id ?? null,
    useful: r.useful === 1, friction: r.friction ?? null,
    betterApproach: r.better_approach ?? null, createdAt: r.created_at,
  }
}

export function createFeedbackCollector(db: any) {
  return {
    record(input: CreateFeedbackInput): ForgeFeedback {
      const id = generateId()
      const now = new Date().toISOString()
      db.run(sql`INSERT INTO forge_feedback
        (id, target, target_id, conversation_id, agent_id, useful, friction, better_approach, created_at)
        VALUES (${id}, ${input.target}, ${input.targetId}, ${input.conversationId},
                ${input.agentId ?? null}, ${input.useful ? 1 : 0},
                ${input.friction ?? null}, ${input.betterApproach ?? null}, ${now})`)
      return {
        id, target: input.target, targetId: input.targetId,
        conversationId: input.conversationId, agentId: input.agentId ?? null,
        useful: input.useful, friction: input.friction ?? null,
        betterApproach: input.betterApproach ?? null, createdAt: now,
      }
    },

    listForTarget(target: ForgeTarget, targetId: string, limit = 50): ForgeFeedback[] {
      const rows = (db as any).all(
        sql`SELECT * FROM forge_feedback WHERE target = ${target} AND target_id = ${targetId}
            ORDER BY created_at DESC LIMIT ${limit}`
      ) as any[]
      return rows.map(rowToFeedback)
    },

    getStats(target: ForgeTarget, targetId: string) {
      const rows = (db as any).all(
        sql`SELECT COUNT(*) as total,
                   SUM(CASE WHEN useful = 1 THEN 1 ELSE 0 END) as useful_count,
                   SUM(CASE WHEN friction IS NOT NULL THEN 1 ELSE 0 END) as friction_count
            FROM forge_feedback WHERE target = ${target} AND target_id = ${targetId}`
      ) as any[]
      const row = rows[0] ?? { total: 0, useful_count: 0, friction_count: 0 }
      return {
        total: row.total,
        useful: row.useful_count,
        frictionCount: row.friction_count,
        frictionRate: row.total > 0 ? row.friction_count / row.total : 0,
      }
    },

    /** List all targets that have enough feedback for analysis */
    listAnalyzableTargets(minFeedbacks: number, windowDays: number): { target: ForgeTarget; targetId: string; count: number }[] {
      const cutoff = new Date(Date.now() - windowDays * 86400_000).toISOString()
      const rows = (db as any).all(
        sql`SELECT target, target_id, COUNT(*) as cnt
            FROM forge_feedback WHERE created_at > ${cutoff}
            GROUP BY target, target_id HAVING cnt >= ${minFeedbacks}
            ORDER BY cnt DESC`
      ) as any[]
      return rows.map((r: any) => ({ target: r.target as ForgeTarget, targetId: r.target_id, count: r.cnt }))
    },
  }
}
```

- [ ] **Step 4: Run test — verify it passes**

Run: `bun test tests/modules/forge/feedback-collector.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/modules/forge/feedback-collector.ts tests/modules/forge/feedback-collector.test.ts
git commit -m "feat(forge): feedback collector — structured feedback after tool/skill usage"
```

---

## Wave 2: Forge — Analysis & Proposal Engine

### Task 2.1: Friction Analyzer (TDD)

**Files:**
- Create: `src/modules/forge/friction-analyzer.ts`
- Create: `tests/modules/forge/friction-analyzer.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// tests/modules/forge/friction-analyzer.test.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, it, expect, vi } from 'vitest'
import { createFrictionAnalyzer } from '@modules/forge/friction-analyzer'
import type { ForgeConfig } from '@modules/forge/types'

const DEFAULT_CONFIG: ForgeConfig = {
  minFeedbacksForAnalysis: 3,
  frictionRateThreshold: 0.3,
  autoApproveConfidence: 0.95,
  analysisWindowDays: 30,
  maxProposalsPerRun: 10,
}

describe('FrictionAnalyzer', () => {
  it('detects friction patterns above threshold', () => {
    const mockCollector = {
      listAnalyzableTargets: vi.fn().mockReturnValue([
        { target: 'tool', targetId: 'shell_exec', count: 10 },
        { target: 'tool', targetId: 'search', count: 5 },
      ]),
      listForTarget: vi.fn().mockImplementation((_t: string, id: string) => {
        if (id === 'shell_exec') return [
          { useful: false, friction: 'timeout', betterApproach: 'increase timeout' },
          { useful: false, friction: 'timeout', betterApproach: 'increase timeout' },
          { useful: false, friction: 'permission denied', betterApproach: null },
          { useful: true, friction: null, betterApproach: null },
          { useful: true, friction: null, betterApproach: null },
        ]
        return [
          { useful: true, friction: null, betterApproach: null },
          { useful: true, friction: null, betterApproach: null },
          { useful: true, friction: null, betterApproach: null },
        ]
      }),
      getStats: vi.fn().mockImplementation((_t: string, id: string) => {
        if (id === 'shell_exec') return { total: 10, useful: 7, frictionCount: 4, frictionRate: 0.4 }
        return { total: 5, useful: 5, frictionCount: 0, frictionRate: 0 }
      }),
    }

    const analyzer = createFrictionAnalyzer(mockCollector as any, DEFAULT_CONFIG)
    const patterns = analyzer.analyze()

    expect(patterns.length).toBe(1) // only shell_exec above threshold
    expect(patterns[0].targetId).toBe('shell_exec')
    expect(patterns[0].frictionRate).toBe(0.4)
    expect(patterns[0].topFrictions).toContain('timeout')
  })

  it('returns empty when no friction above threshold', () => {
    const mockCollector = {
      listAnalyzableTargets: vi.fn().mockReturnValue([
        { target: 'tool', targetId: 'search', count: 10 },
      ]),
      getStats: vi.fn().mockReturnValue({ total: 10, useful: 9, frictionCount: 1, frictionRate: 0.1 }),
      listForTarget: vi.fn().mockReturnValue([]),
    }

    const analyzer = createFrictionAnalyzer(mockCollector as any, DEFAULT_CONFIG)
    expect(analyzer.analyze().length).toBe(0)
  })
})
```

- [ ] **Step 2: Run test — verify it fails**

Run: `bun test tests/modules/forge/friction-analyzer.test.ts`

- [ ] **Step 3: Implement friction analyzer**

```typescript
// src/modules/forge/friction-analyzer.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { FrictionPattern, ForgeConfig } from './types.js'
import type { createFeedbackCollector } from './feedback-collector.js'

type FeedbackCollector = ReturnType<typeof createFeedbackCollector>

/** Count occurrences of each string, return top N */
function topStrings(items: (string | null)[], n: number): string[] {
  const counts = new Map<string, number>()
  for (const item of items) {
    if (!item) continue
    counts.set(item, (counts.get(item) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([str]) => str)
}

export function createFrictionAnalyzer(collector: FeedbackCollector, config: ForgeConfig) {
  return {
    analyze(): FrictionPattern[] {
      const targets = collector.listAnalyzableTargets(config.minFeedbacksForAnalysis, config.analysisWindowDays)
      const patterns: FrictionPattern[] = []

      for (const { target, targetId } of targets) {
        const stats = collector.getStats(target, targetId)
        if (stats.frictionRate < config.frictionRateThreshold) continue

        const feedbacks = collector.listForTarget(target, targetId, 50)
        const frictions = feedbacks.map(f => f.friction)
        const suggestions = feedbacks.map(f => f.betterApproach)

        patterns.push({
          target,
          targetId,
          frictionCount: stats.frictionCount,
          totalUsages: stats.total,
          frictionRate: stats.frictionRate,
          topFrictions: topStrings(frictions, 5),
          topSuggestions: topStrings(suggestions, 5),
          sampleFeedbackIds: feedbacks.slice(0, 5).map(f => f.id),
        })
      }

      return patterns.slice(0, config.maxProposalsPerRun)
    },
  }
}
```

- [ ] **Step 4: Run test — verify it passes**

Run: `bun test tests/modules/forge/friction-analyzer.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/modules/forge/friction-analyzer.ts tests/modules/forge/friction-analyzer.test.ts
git commit -m "feat(forge): friction analyzer — detects recurring problems from feedback"
```

### Task 2.2: Proposal Store

**Files:**
- Create: `src/modules/forge/proposal-store.ts`

- [ ] **Step 1: Implement proposal CRUD**

```typescript
// src/modules/forge/proposal-store.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'
import { generateId } from '@shared/crypto.js'
import type { ForgeProposal, CreateProposalInput } from './types.js'

function rowToProposal(r: any): ForgeProposal {
  return {
    id: r.id, target: r.target, targetId: r.target_id, scope: r.scope,
    title: r.title, description: r.description,
    currentValue: r.current_value, proposedValue: r.proposed_value,
    reasoning: r.reasoning, confidence: r.confidence,
    basedOnFeedbacks: r.based_on_feedbacks, status: r.status,
    experimentId: r.experiment_id ?? null,
    createdAt: r.created_at, reviewedAt: r.reviewed_at ?? null,
  }
}

export function createProposalStore(db: any) {
  return {
    add(input: CreateProposalInput): ForgeProposal {
      const id = generateId()
      const now = new Date().toISOString()
      db.run(sql`INSERT INTO forge_proposals
        (id, target, target_id, scope, title, description, current_value, proposed_value,
         reasoning, confidence, based_on_feedbacks, status, created_at)
        VALUES (${id}, ${input.target}, ${input.targetId}, ${input.scope},
                ${input.title}, ${input.description}, ${input.currentValue}, ${input.proposedValue},
                ${input.reasoning}, ${input.confidence}, ${input.basedOnFeedbacks}, 'pending', ${now})`)
      return { id, ...input, status: 'pending', experimentId: null, createdAt: now, reviewedAt: null }
    },

    get(id: string): ForgeProposal | undefined {
      const rows = (db as any).all(sql`SELECT * FROM forge_proposals WHERE id = ${id}`) as any[]
      return rows.length > 0 ? rowToProposal(rows[0]) : undefined
    },

    list(status?: string): ForgeProposal[] {
      const rows = status
        ? (db as any).all(sql`SELECT * FROM forge_proposals WHERE status = ${status} ORDER BY created_at DESC`) as any[]
        : (db as any).all(sql`SELECT * FROM forge_proposals ORDER BY created_at DESC`) as any[]
      return rows.map(rowToProposal)
    },

    updateStatus(id: string, status: ForgeProposal['status']) {
      const now = new Date().toISOString()
      db.run(sql`UPDATE forge_proposals SET status = ${status}, reviewed_at = ${now} WHERE id = ${id}`)
    },

    setExperiment(id: string, experimentId: string) {
      db.run(sql`UPDATE forge_proposals SET experiment_id = ${experimentId}, status = 'testing' WHERE id = ${id}`)
    },

    /** Check if a proposal already exists for this target+scope */
    hasPending(target: string, targetId: string, scope: string): boolean {
      const rows = (db as any).all(
        sql`SELECT 1 FROM forge_proposals WHERE target = ${target} AND target_id = ${targetId}
            AND scope = ${scope} AND status IN ('pending', 'testing') LIMIT 1`
      ) as any[]
      return rows.length > 0
    },
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/forge/proposal-store.ts
git commit -m "feat(forge): proposal store — CRUD for improvement proposals"
```

### Task 2.3: Proposal Engine (TDD)

**Files:**
- Create: `src/modules/forge/proposal-engine.ts`
- Create: `tests/modules/forge/proposal-engine.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// tests/modules/forge/proposal-engine.test.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, it, expect, vi } from 'vitest'
import { createProposalEngine } from '@modules/forge/proposal-engine'

describe('ProposalEngine', () => {
  it('generates description-scope proposal from friction pattern', () => {
    const mockStore = {
      hasPending: vi.fn().mockReturnValue(false),
      add: vi.fn().mockImplementation((input: any) => ({ id: 'prop-1', ...input, status: 'pending' })),
    }
    const mockToolRegistry = {
      get: vi.fn().mockReturnValue({ name: 'shell_exec', description: 'Execute shell commands' }),
    }

    const engine = createProposalEngine(mockStore as any, { toolRegistry: mockToolRegistry as any })

    const proposals = engine.generateFromFriction({
      target: 'tool', targetId: 'shell_exec',
      frictionCount: 8, totalUsages: 20, frictionRate: 0.4,
      topFrictions: ['timeout too short', 'permission denied'],
      topSuggestions: ['increase timeout to 60s'],
      sampleFeedbackIds: ['fb-1', 'fb-2'],
    })

    expect(proposals.length).toBeGreaterThanOrEqual(1)
    expect(mockStore.add).toHaveBeenCalled()
    const call = mockStore.add.mock.calls[0][0]
    expect(call.target).toBe('tool')
    expect(call.targetId).toBe('shell_exec')
    expect(call.scope).toBe('description')
    expect(call.reasoning).toContain('timeout')
  })

  it('skips if proposal already pending', () => {
    const mockStore = {
      hasPending: vi.fn().mockReturnValue(true),
      add: vi.fn(),
    }

    const engine = createProposalEngine(mockStore as any, {})
    const proposals = engine.generateFromFriction({
      target: 'tool', targetId: 'shell_exec',
      frictionCount: 5, totalUsages: 10, frictionRate: 0.5,
      topFrictions: ['slow'], topSuggestions: [], sampleFeedbackIds: [],
    })

    expect(proposals.length).toBe(0)
    expect(mockStore.add).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test — verify it fails**

Run: `bun test tests/modules/forge/proposal-engine.test.ts`

- [ ] **Step 3: Implement proposal engine**

```typescript
// src/modules/forge/proposal-engine.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { FrictionPattern, ForgeProposal, ForgeScope } from './types.js'
import type { createProposalStore } from './proposal-store.js'

type ProposalStore = ReturnType<typeof createProposalStore>

interface ProposalEngineDeps {
  toolRegistry?: { get(name: string): { name: string; description: string } | undefined }
  skillRegistry?: { get(id: string): { id: string; name: string; description: string; content: string } | undefined }
}

export function createProposalEngine(store: ProposalStore, deps: ProposalEngineDeps) {
  return {
    generateFromFriction(pattern: FrictionPattern): ForgeProposal[] {
      const proposals: ForgeProposal[] = []

      // Determine scope based on friction content
      const scope: ForgeScope = 'description'
      if (store.hasPending(pattern.target, pattern.targetId, scope)) return proposals

      // Get current value
      let currentValue = ''
      if (pattern.target === 'tool' && deps.toolRegistry) {
        const tool = deps.toolRegistry.get(pattern.targetId)
        currentValue = tool?.description ?? ''
      } else if (pattern.target === 'skill' && deps.skillRegistry) {
        const skill = deps.skillRegistry.get(pattern.targetId)
        currentValue = skill?.description ?? ''
      }

      const topFriction = pattern.topFrictions[0] ?? 'unknown friction'
      const topSuggestion = pattern.topSuggestions[0]
      const confidence = Math.min(pattern.frictionCount / 20, 0.9)

      // Build improved description incorporating feedback
      const proposedValue = topSuggestion
        ? `${currentValue}. Note: ${topSuggestion}`
        : `${currentValue}. Common issue: ${topFriction} — consider alternatives when this occurs.`

      const proposal = store.add({
        target: pattern.target,
        targetId: pattern.targetId,
        scope,
        title: `Improve ${pattern.targetId} description — ${topFriction}`,
        description: `${pattern.frictionCount}/${pattern.totalUsages} usages reported friction. Top issue: ${topFriction}.`,
        currentValue,
        proposedValue,
        reasoning: `Friction rate ${(pattern.frictionRate * 100).toFixed(0)}% over ${pattern.totalUsages} usages. Top frictions: ${pattern.topFrictions.join(', ')}. ${topSuggestion ? `Suggested improvement: ${topSuggestion}` : ''}`,
        confidence,
        basedOnFeedbacks: pattern.frictionCount,
      })

      proposals.push(proposal)
      return proposals
    },
  }
}
```

- [ ] **Step 4: Run test — verify it passes**

Run: `bun test tests/modules/forge/proposal-engine.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/modules/forge/proposal-engine.ts tests/modules/forge/proposal-engine.test.ts
git commit -m "feat(forge): proposal engine — generates improvement proposals from friction patterns"
```

---

## Wave 3: Adopt — Experiment & Apply

### Task 3.1: Experiment Runner

**Files:**
- Create: `src/modules/forge/experiment-runner.ts`
- Create: `tests/modules/forge/experiment-runner.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// tests/modules/forge/experiment-runner.test.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, it, expect, vi } from 'vitest'
import { createExperimentRunner } from '@modules/forge/experiment-runner'

describe('ExperimentRunner', () => {
  it('creates experiment and stores result', async () => {
    const mockDb = {
      run: vi.fn(),
      all: vi.fn().mockReturnValue([]),
    }
    const mockProposalStore = {
      get: vi.fn().mockReturnValue({
        id: 'prop-1', target: 'tool', targetId: 'shell_exec',
        scope: 'description', proposedValue: 'improved description',
      }),
      setExperiment: vi.fn(),
      updateStatus: vi.fn(),
    }

    const runner = createExperimentRunner(mockDb as any, mockProposalStore as any)
    const experiment = runner.create('prop-1')

    expect(experiment.proposalId).toBe('prop-1')
    expect(experiment.status).toBe('running')
    expect(mockProposalStore.setExperiment).toHaveBeenCalledWith('prop-1', experiment.id)
  })

  it('completes experiment with pass/fail', () => {
    const mockDb = {
      run: vi.fn(),
      all: vi.fn().mockReturnValue([{ id: 'exp-1', proposal_id: 'prop-1', conversation_id: 'conv-1', status: 'running', result: null, started_at: '2026-01-01', completed_at: null }]),
    }
    const mockProposalStore = {
      updateStatus: vi.fn(),
    }

    const runner = createExperimentRunner(mockDb as any, mockProposalStore as any)
    runner.complete('exp-1', 'passed', 'Tool worked better with new description')
    expect(mockDb.run).toHaveBeenCalled()
    expect(mockProposalStore.updateStatus).not.toHaveBeenCalled() // manual approval still needed
  })
})
```

- [ ] **Step 2: Run test — verify it fails**

- [ ] **Step 3: Implement experiment runner**

```typescript
// src/modules/forge/experiment-runner.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'
import { generateId } from '@shared/crypto.js'
import type { ForgeExperiment } from './types.js'
import type { createProposalStore } from './proposal-store.js'

type ProposalStore = ReturnType<typeof createProposalStore>

function rowToExperiment(r: any): ForgeExperiment {
  return {
    id: r.id, proposalId: r.proposal_id, conversationId: r.conversation_id,
    status: r.status, result: r.result ?? null,
    startedAt: r.started_at, completedAt: r.completed_at ?? null,
  }
}

export function createExperimentRunner(db: any, proposalStore: ProposalStore) {
  return {
    create(proposalId: string): ForgeExperiment {
      const id = generateId()
      const conversationId = `forge-exp-${id}`
      const now = new Date().toISOString()

      db.run(sql`INSERT INTO forge_experiments
        (id, proposal_id, conversation_id, status, started_at)
        VALUES (${id}, ${proposalId}, ${conversationId}, 'running', ${now})`)

      proposalStore.setExperiment(proposalId, id)

      return { id, proposalId, conversationId, status: 'running', result: null, startedAt: now, completedAt: null }
    },

    get(id: string): ForgeExperiment | undefined {
      const rows = (db as any).all(sql`SELECT * FROM forge_experiments WHERE id = ${id}`) as any[]
      return rows.length > 0 ? rowToExperiment(rows[0]) : undefined
    },

    complete(id: string, status: 'passed' | 'failed', result: string) {
      const now = new Date().toISOString()
      db.run(sql`UPDATE forge_experiments SET status = ${status}, result = ${result}, completed_at = ${now} WHERE id = ${id}`)
    },

    listForProposal(proposalId: string): ForgeExperiment[] {
      const rows = (db as any).all(
        sql`SELECT * FROM forge_experiments WHERE proposal_id = ${proposalId} ORDER BY started_at DESC`
      ) as any[]
      return rows.map(rowToExperiment)
    },
  }
}
```

- [ ] **Step 4: Run test — verify it passes**

Run: `bun test tests/modules/forge/experiment-runner.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/modules/forge/experiment-runner.ts tests/modules/forge/experiment-runner.test.ts
git commit -m "feat(forge): experiment runner — sandbox testing for proposals"
```

### Task 3.2: Proposal Applier

**Files:**
- Create: `src/modules/forge/applier.ts`

- [ ] **Step 1: Implement applier**

```typescript
// src/modules/forge/applier.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { ForgeProposal } from './types.js'

interface ApplierDeps {
  toolRegistry?: {
    get(name: string): { name: string; description: string } | undefined
    updateDescription?(name: string, description: string): void
  }
  skillRegistry?: {
    get(id: string): { id: string; description: string } | undefined
    update?(id: string, patch: { description?: string; content?: string }): void
  }
}

export interface ApplyResult {
  success: boolean
  message: string
}

export function createProposalApplier(deps: ApplierDeps) {
  return {
    apply(proposal: ForgeProposal): ApplyResult {
      if (proposal.scope === 'description') {
        if (proposal.target === 'tool' && deps.toolRegistry?.updateDescription) {
          deps.toolRegistry.updateDescription(proposal.targetId, proposal.proposedValue)
          return { success: true, message: `Updated tool ${proposal.targetId} description` }
        }
        if (proposal.target === 'skill' && deps.skillRegistry?.update) {
          deps.skillRegistry.update(proposal.targetId, { description: proposal.proposedValue })
          return { success: true, message: `Updated skill ${proposal.targetId} description` }
        }
      }

      // For higher scopes (schema, prompt, behavior, code) — return instructions for manual apply
      return {
        success: false,
        message: `Scope "${proposal.scope}" requires manual application. Proposed change: ${proposal.proposedValue}`,
      }
    },
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/forge/applier.ts
git commit -m "feat(forge): proposal applier — applies approved changes to tools/skills"
```

---

## Wave 4: Module Wiring & Migration

### Task 4.1: Forge Module Entry

**Files:**
- Create: `src/modules/forge/index.ts`

- [ ] **Step 1: Create module**

```typescript
// src/modules/forge/index.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { EyasModule, ModuleContext } from '@core/types'
import { createForgeTables } from './schema.js'
import { createFeedbackCollector } from './feedback-collector.js'
import { createFrictionAnalyzer } from './friction-analyzer.js'
import { createProposalEngine } from './proposal-engine.js'
import { createProposalStore } from './proposal-store.js'
import { createExperimentRunner } from './experiment-runner.js'
import { createProposalApplier } from './applier.js'
import { createForgeRoutes } from './routes.js'
import type { ForgeConfig } from './types.js'

const DEFAULT_CONFIG: ForgeConfig = {
  minFeedbacksForAnalysis: 5,
  frictionRateThreshold: 0.3,
  autoApproveConfidence: 0.95,
  analysisWindowDays: 30,
  maxProposalsPerRun: 10,
}

export const forgeModule: EyasModule = {
  id: 'forge',
  name: 'Forge',
  version: '1.0.0',
  type: 'extra',
  required: false,
  description: 'Unified evolution system — agents improve their own tools and skills through observe→forge→adopt',
  dependencies: ['conversations'],
  optional: ['tools', 'skills', 'scheduler', 'agent'],

  async onRegister(ctx: ModuleContext) {
    createForgeTables(ctx.db)

    const config: ForgeConfig = { ...DEFAULT_CONFIG, ...(ctx.config as any).forge }
    const collector = createFeedbackCollector(ctx.db)
    const proposalStore = createProposalStore(ctx.db)
    const analyzer = createFrictionAnalyzer(collector, config)
    const experimentRunner = createExperimentRunner(ctx.db, proposalStore)

    const toolsModule = ctx.hasModule('tools') ? ctx.getModule<any>('tools') : null
    const skillsModule = ctx.hasModule('skills') ? ctx.getModule<any>('skills') : null

    const proposalEngine = createProposalEngine(proposalStore, {
      toolRegistry: toolsModule?.registry,
      skillRegistry: skillsModule?.registry,
    })
    const applier = createProposalApplier({
      toolRegistry: toolsModule?.registry,
      skillRegistry: skillsModule?.registry,
    })

    ;(ctx as any).forge = { collector, analyzer, proposalEngine, proposalStore, experimentRunner, applier, config }
    ctx.logger.info('Forge module registered')
  },

  async onStart(ctx: ModuleContext) {
    const forge = (ctx as any).forge as any

    // Mount REST routes
    createForgeRoutes(ctx.http, forge)

    // Listen for tool execution events — auto-collect feedback from tool_executions
    ctx.bus.on('tools:executed', (data: any) => {
      if (!data?.toolName || !data?.conversationId) return
      forge.collector.record({
        target: 'tool',
        targetId: data.toolName,
        conversationId: data.conversationId,
        agentId: data.agentId,
        useful: data.success !== false,
        friction: data.error ? String(data.error).slice(0, 500) : undefined,
      })
    })

    // Scheduler: weekly forge scan
    ctx.bus.on('scheduler:job', async (data: any) => {
      if (data?.jobId !== 'forge-scan') return
      ctx.logger.info('Forge scan triggered')

      const patterns = forge.analyzer.analyze()
      let created = 0

      for (const pattern of patterns) {
        const proposals = forge.proposalEngine.generateFromFriction(pattern)
        created += proposals.length

        // Auto-approve high-confidence proposals
        for (const p of proposals) {
          if (p.confidence >= forge.config.autoApproveConfidence) {
            forge.proposalStore.updateStatus(p.id, 'approved')
            const result = forge.applier.apply(p)
            if (result.success) {
              forge.proposalStore.updateStatus(p.id, 'applied')
              ctx.logger.info({ proposal: p.title }, 'Forge auto-applied proposal')
            }
          }
        }
      }

      ctx.logger.info({ patterns: patterns.length, proposals: created }, 'Forge scan complete')
      ctx.bus.emit('forge:scan-complete', { patterns: patterns.length, proposals: created })
    })

    // Register scheduler job
    if (ctx.hasModule('scheduler')) {
      const scheduler = (ctx as any).scheduler
      const existing = scheduler.list()
      if (!existing.some((j: any) => j.handler === 'forge.scan')) {
        scheduler.registerHandler('forge.scan', async () => {
          ctx.bus.emit('scheduler:job', { jobId: 'forge-scan' })
          return { triggered: true }
        })
        scheduler.create({
          name: 'Forge Evolution Scan',
          description: 'Analyze tool/skill feedback and generate improvement proposals',
          triggerType: 'cron',
          triggerConfig: JSON.stringify({ cron: '0 4 * * 0' }), // Weekly Sunday 04:00
          handler: 'forge.scan',
        })
        ctx.logger.info('Seeded Forge scan job')
      }
    }

    ctx.logger.info('Forge module started')
  },

  async onStop() {},
}
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/forge/index.ts
git commit -m "feat(forge): module entry — wiring, scheduler, bus event integration"
```

### Task 4.2: Forge REST Routes

**Files:**
- Create: `src/modules/forge/routes.ts`

- [ ] **Step 1: Create routes**

```typescript
// src/modules/forge/routes.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { Hono } from 'hono'
import { requirePermission } from '@modules/permissions/middleware.js'

export function createForgeRoutes(app: Hono, forge: any) {
  const api = new Hono()

  // ─── Feedback ───
  api.get('/forge/feedback', requirePermission('read', 'Forge'), (c) => {
    const target = c.req.query('target')
    const targetId = c.req.query('targetId')
    if (target && targetId) {
      return c.json({ feedback: forge.collector.listForTarget(target, targetId) })
    }
    return c.json({ error: 'target and targetId required' }, 400)
  })

  api.post('/forge/feedback', requirePermission('write', 'Forge'), async (c) => {
    const body = await c.req.json()
    const fb = forge.collector.record(body)
    return c.json({ feedback: fb })
  })

  api.get('/forge/feedback/stats', requirePermission('read', 'Forge'), (c) => {
    const target = c.req.query('target') ?? 'tool'
    const targetId = c.req.query('targetId') ?? ''
    const stats = forge.collector.getStats(target, targetId)
    return c.json(stats)
  })

  // ─── Proposals ───
  api.get('/forge/proposals', requirePermission('read', 'Forge'), (c) => {
    const status = c.req.query('status')
    return c.json({ proposals: forge.proposalStore.list(status) })
  })

  api.get('/forge/proposals/:id', requirePermission('read', 'Forge'), (c) => {
    const proposal = forge.proposalStore.get(c.req.param('id'))
    if (!proposal) return c.json({ error: 'Not found' }, 404)
    return c.json({ proposal })
  })

  api.post('/forge/proposals/:id/approve', requirePermission('write', 'Forge'), (c) => {
    const id = c.req.param('id')
    forge.proposalStore.updateStatus(id, 'approved')
    const proposal = forge.proposalStore.get(id)
    if (!proposal) return c.json({ error: 'Not found' }, 404)
    // Apply immediately on approval
    const result = forge.applier.apply(proposal)
    if (result.success) {
      forge.proposalStore.updateStatus(id, 'applied')
    }
    return c.json({ proposal: forge.proposalStore.get(id), applied: result })
  })

  api.post('/forge/proposals/:id/reject', requirePermission('write', 'Forge'), (c) => {
    forge.proposalStore.updateStatus(c.req.param('id'), 'rejected')
    return c.json({ proposal: forge.proposalStore.get(c.req.param('id')) })
  })

  // ─── Experiments ───
  api.get('/forge/experiments/:proposalId', requirePermission('read', 'Forge'), (c) => {
    return c.json({ experiments: forge.experimentRunner.listForProposal(c.req.param('proposalId')) })
  })

  api.post('/forge/proposals/:id/test', requirePermission('write', 'Forge'), (c) => {
    const experiment = forge.experimentRunner.create(c.req.param('id'))
    return c.json({ experiment })
  })

  // ─── Scan (manual trigger) ───
  api.post('/forge/scan', requirePermission('manage', 'Forge'), (c) => {
    const patterns = forge.analyzer.analyze()
    let created = 0
    for (const pattern of patterns) {
      created += forge.proposalEngine.generateFromFriction(pattern).length
    }
    return c.json({ patterns: patterns.length, proposals: created })
  })

  app.route('/api/v1', api)
}
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/forge/routes.ts
git commit -m "feat(forge): REST API — feedback, proposals, experiments, manual scan"
```

### Task 4.3: Deprecate skill-evolution Module

**Files:**
- Modify: `src/modules/skill-evolution/index.ts`

- [ ] **Step 1: Mark skill-evolution as deprecated — redirect to forge**

Replace the skill-evolution module body with a redirect:

```typescript
// src/modules/skill-evolution/index.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
// DEPRECATED: This module is superseded by the Forge module.
// Kept for backward compatibility — routes redirect to forge endpoints.

import type { EyasModule, ModuleContext } from '@core/types'

export const skillEvolutionModule: EyasModule = {
  id: 'skill-evolution',
  name: 'Skill Evolution (deprecated → Forge)',
  version: '1.0.0',
  type: 'extra',
  required: false,
  description: 'DEPRECATED — use the Forge module for unified skill+tool evolution',
  dependencies: [],

  async onRegister(ctx: ModuleContext) {
    ctx.logger.warn('skill-evolution module is deprecated — use forge module instead')
  },

  async onStart(ctx: ModuleContext) {
    // Legacy API redirect: /api/v1/skill-evolution/candidates → /api/v1/forge/proposals
    ctx.http.get('/api/v1/skill-evolution/candidates', (c) => {
      return c.redirect('/api/v1/forge/proposals', 301)
    })
  },

  async onStop() {},
}
```

- [ ] **Step 2: Run full test suite**

Run: `bun test --run`
Expected: All pass (skill-evolution tests may need updating if they test the old module).

- [ ] **Step 3: Commit**

```bash
git add src/modules/skill-evolution/index.ts
git commit -m "refactor(skill-evolution): deprecate — redirect to forge module"
```

---

## Wave 5: Frontend

### Task 5.1: Forge Dashboard Page

**Files:**
- Create: `src/web/src/pages/forge/forge-page.tsx`

- [ ] **Step 1: Create Forge page**

The page should show:
1. **Summary stats** — total feedback count, active proposals, applied changes
2. **Proposals list** — filterable by status (pending/testing/approved/rejected/applied)
3. **Each proposal card:** target type badge, target name, scope badge, confidence meter, approve/reject buttons

Follow the existing page patterns in the project (glass-card styling, useApi hook, etc.). Read `src/web/src/pages/agents/agent-detail-page.tsx` for reference on tabs and data fetching.

```tsx
// src/web/src/pages/forge/forge-page.tsx
// Structure outline — implement following project patterns:

// 1. Page header: "Forge" title + "Scan Now" button (POST /forge/scan)
// 2. Stats bar: feedback count, pending proposals, applied changes
// 3. Tabs: "Proposals" | "Feedback" | "Experiments"
// 4. Proposals tab: list of ProposalCard components
//    - Each card: target badge (tool/skill), scope badge, confidence bar
//    - Status: pending (approve/reject buttons), testing (spinner), applied (checkmark)
// 5. Feedback tab: table of recent feedback entries
// 6. Experiments tab: list of experiments with status
```

- [ ] **Step 2: Register route in router**

Add the Forge page to the TanStack Router configuration.

- [ ] **Step 3: Add nav item**

Add "Forge" to the sidebar under "AI" section (next to "Skill Evolution" which can be hidden).

- [ ] **Step 4: Verify in browser**

Run: `cd src/web && bun run dev`
Navigate to the Forge page and verify it renders.

- [ ] **Step 5: Build check**

Run: `cd src/web && bun run build`
Expected: Build succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/web/src/pages/forge/
git commit -m "feat(forge): frontend dashboard — proposals, feedback, experiments"
```

### Task 5.2: Register Forge Module in Bootstrap

**Files:**
- Modify: `src/main.ts` or wherever modules are registered

- [ ] **Step 1: Import and register forge module**

Find where modules are imported/registered (likely `src/core/bootstrap.ts` or `src/main.ts`). Add:

```typescript
import { forgeModule } from '@modules/forge/index.js'
// Add to modules array
```

- [ ] **Step 2: Run full test suite**

Run: `bun test --run`

- [ ] **Step 3: Start server and verify**

Run: `bun run dev`
Expected: "Forge module registered" and "Forge module started" in logs.

- [ ] **Step 4: Commit**

```bash
git add src/core/bootstrap.ts  # or wherever modules are registered
git commit -m "feat(forge): register module in bootstrap"
```

---

## Dependency Graph

```
Wave 1 (Types + Schema + Feedback) ─── foundation
   │
   └──→ Wave 2 (Friction + Proposals) ─── analysis layer
           │
           └──→ Wave 3 (Experiments + Applier) ─── action layer
                   │
                   └──→ Wave 4 (Module + Routes + Migration) ─── wiring
                           │
                           └──→ Wave 5 (Frontend) ─── UI
```

All waves are sequential — each depends on the previous.

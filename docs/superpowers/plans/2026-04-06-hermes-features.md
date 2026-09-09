# Hermes-Inspired Features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add dynamic skill generation, 5 new communication channels (Discord, Slack, WhatsApp, Signal, Email), and a `create-eyas` scaffolding CLI to the EYAS platform.

**Architecture:** Three independent subsystems: (1) skill-evolution module listens to agent sessions via bus events, detects patterns, auto-generates skills with user approval; (2) communication submodules follow the existing Channel interface + SubmoduleManifest pattern used by Telegram; (3) create-eyas is a standalone package that scaffolds a new EYAS project. Docs HTML files updated at the end.

**Tech Stack:** TypeScript, Bun, Hono, Drizzle ORM, Grammy (Telegram), discord.js (Discord), @slack/bolt (Slack), nodemailer+imapflow (Email), signal-cli bridge (Signal), whatsapp-web.js or WA Business Cloud API (WhatsApp).

---

## File Structure

### Feature 1: Skill Evolution Module
```
src/modules/skill-evolution/
  index.ts             — Module definition (EyasModule)
  types.ts             — EvolutionCandidate, EvolutionConfig interfaces
  pattern-detector.ts  — Detects recurring multi-step patterns from agent sessions
  skill-composer.ts    — Generates SKILL.md content from detected patterns
  approval-store.ts    — DB table for pending/approved/rejected candidates
  routes.ts            — REST API for listing candidates, approve/reject
tests/modules/skill-evolution/
  pattern-detector.test.ts
  skill-composer.test.ts
  approval-store.test.ts
  routes.test.ts
```

### Feature 2: Communication Channels (5 submodules)
```
src/modules/communication/submodules/
  discord/
    manifest.ts        — SubmoduleManifest
    bot.ts             — Discord.js Channel adapter
  slack/
    manifest.ts
    bot.ts             — Slack Bolt Channel adapter
  email/
    manifest.ts
    adapter.ts         — IMAP poll + SMTP send Channel adapter
  whatsapp/
    manifest.ts
    adapter.ts         — WhatsApp Business Cloud API Channel adapter
  signal/
    manifest.ts
    adapter.ts         — signal-cli HTTP bridge Channel adapter
src/modules/communication/types.ts  — Add new ChannelType values
src/modules/communication/index.ts  — Register new submodules
tests/modules/communication/
  discord-bot.test.ts
  slack-bot.test.ts
  email-adapter.test.ts
  whatsapp-adapter.test.ts
  signal-adapter.test.ts
```

### Feature 3: create-eyas CLI
```
packages/create-eyas/
  package.json         — bin: create-eyas
  index.ts             — Main scaffolding script
  templates/
    config.yaml        — Default config template
    docker-compose.yml — Docker template
```

### Feature 4: Documentation Updates
```
docs/eyas-overview.html       — Add skill evolution, channels, create-eyas sections
docs/eyas-specification.html  — Add technical spec sections
```

---

## Task 1: Skill Evolution — Types & Approval Store

**Files:**
- Create: `src/modules/skill-evolution/types.ts`
- Create: `src/modules/skill-evolution/approval-store.ts`
- Create: `tests/modules/skill-evolution/approval-store.test.ts`

- [ ] **Step 1: Write the failing test for approval store**

```typescript
// tests/modules/skill-evolution/approval-store.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { createMemoryDb } from '../../helpers/test-db'
import { createApprovalStore } from '../../../src/modules/skill-evolution/approval-store.js'

describe('ApprovalStore', () => {
  let db: ReturnType<typeof createMemoryDb>
  let store: ReturnType<typeof createApprovalStore>

  beforeEach(() => {
    db = createMemoryDb()
    db.run(sql`CREATE TABLE IF NOT EXISTS skill_candidates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      trigger_patterns TEXT NOT NULL DEFAULT '[]',
      content TEXT NOT NULL,
      reasoning TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 0,
      based_on_sessions INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
      created_at TEXT NOT NULL,
      reviewed_at TEXT
    )`)
    store = createApprovalStore(db)
  })

  it('adds a candidate with pending status', () => {
    const id = store.add({
      name: 'deploy-k8s',
      description: 'Deploy to Kubernetes cluster',
      triggerPatterns: ['deploy to k8s', 'kubernetes deploy'],
      content: '# Deploy to K8s\n\nSteps...',
      reasoning: 'Detected 5 similar sessions in 7 days',
      confidence: 0.85,
      basedOnSessions: 5,
    })
    const candidate = store.get(id)
    expect(candidate).toBeDefined()
    expect(candidate!.status).toBe('pending')
    expect(candidate!.name).toBe('deploy-k8s')
  })

  it('lists pending candidates', () => {
    store.add({ name: 'a', description: 'd', triggerPatterns: [], content: 'c', reasoning: 'r', confidence: 0.5, basedOnSessions: 3 })
    store.add({ name: 'b', description: 'd', triggerPatterns: [], content: 'c', reasoning: 'r', confidence: 0.7, basedOnSessions: 5 })
    const pending = store.list('pending')
    expect(pending).toHaveLength(2)
  })

  it('approves a candidate', () => {
    const id = store.add({ name: 'test', description: 'd', triggerPatterns: ['t'], content: 'c', reasoning: 'r', confidence: 0.8, basedOnSessions: 4 })
    store.approve(id)
    const candidate = store.get(id)
    expect(candidate!.status).toBe('approved')
    expect(candidate!.reviewedAt).toBeTruthy()
  })

  it('rejects a candidate', () => {
    const id = store.add({ name: 'test', description: 'd', triggerPatterns: ['t'], content: 'c', reasoning: 'r', confidence: 0.6, basedOnSessions: 2 })
    store.reject(id)
    expect(store.get(id)!.status).toBe('rejected')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/modules/skill-evolution/approval-store.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Create types**

```typescript
// src/modules/skill-evolution/types.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.

export interface EvolutionCandidate {
  id: string
  name: string
  description: string
  triggerPatterns: string[]
  content: string
  reasoning: string
  confidence: number
  basedOnSessions: number
  status: 'pending' | 'approved' | 'rejected'
  createdAt: string
  reviewedAt?: string
}

export interface EvolutionCandidateInput {
  name: string
  description: string
  triggerPatterns: string[]
  content: string
  reasoning: string
  confidence: number
  basedOnSessions: number
}

export interface EvolutionConfig {
  minSessionsForPattern: number    // Default: 3
  minConfidence: number            // Default: 0.6
  analysisWindowDays: number       // Default: 14
  autoApproveThreshold: number     // Default: 0.95 (very high confidence = auto-approve)
}
```

- [ ] **Step 4: Create approval store**

```typescript
// src/modules/skill-evolution/approval-store.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'
import { generateId } from '@shared/crypto'
import type { EvolutionCandidate, EvolutionCandidateInput } from './types.js'

function toCandidate(row: any): EvolutionCandidate {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    triggerPatterns: JSON.parse(row.trigger_patterns),
    content: row.content,
    reasoning: row.reasoning,
    confidence: row.confidence,
    basedOnSessions: row.based_on_sessions,
    status: row.status,
    createdAt: row.created_at,
    reviewedAt: row.reviewed_at ?? undefined,
  }
}

export function createApprovalStore(db: any) {
  return {
    add(input: EvolutionCandidateInput): string {
      const id = generateId()
      const now = new Date().toISOString()
      db.run(sql`INSERT INTO skill_candidates (id, name, description, trigger_patterns, content, reasoning, confidence, based_on_sessions, status, created_at)
        VALUES (${id}, ${input.name}, ${input.description}, ${JSON.stringify(input.triggerPatterns)},
                ${input.content}, ${input.reasoning}, ${input.confidence}, ${input.basedOnSessions}, 'pending', ${now})`)
      return id
    },

    get(id: string): EvolutionCandidate | null {
      const rows = db.all(sql`SELECT * FROM skill_candidates WHERE id = ${id}`) as any[]
      return rows.length > 0 ? toCandidate(rows[0]) : null
    },

    list(status?: 'pending' | 'approved' | 'rejected'): EvolutionCandidate[] {
      const rows = status
        ? db.all(sql`SELECT * FROM skill_candidates WHERE status = ${status} ORDER BY created_at DESC`) as any[]
        : db.all(sql`SELECT * FROM skill_candidates ORDER BY created_at DESC`) as any[]
      return rows.map(toCandidate)
    },

    approve(id: string): void {
      const now = new Date().toISOString()
      db.run(sql`UPDATE skill_candidates SET status = 'approved', reviewed_at = ${now} WHERE id = ${id}`)
    },

    reject(id: string): void {
      const now = new Date().toISOString()
      db.run(sql`UPDATE skill_candidates SET status = 'rejected', reviewed_at = ${now} WHERE id = ${id}`)
    },
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test tests/modules/skill-evolution/approval-store.test.ts`
Expected: 4 PASS

- [ ] **Step 6: Commit**

```bash
git add src/modules/skill-evolution/types.ts src/modules/skill-evolution/approval-store.ts tests/modules/skill-evolution/approval-store.test.ts
git commit -m "feat(skill-evolution): types and approval store with CRUD"
```

---

## Task 2: Skill Evolution — Pattern Detector

**Files:**
- Create: `src/modules/skill-evolution/pattern-detector.ts`
- Create: `tests/modules/skill-evolution/pattern-detector.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// tests/modules/skill-evolution/pattern-detector.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { createMemoryDb } from '../../helpers/test-db'
import { createPatternDetector } from '../../../src/modules/skill-evolution/pattern-detector.js'

describe('PatternDetector', () => {
  let db: ReturnType<typeof createMemoryDb>
  let detector: ReturnType<typeof createPatternDetector>

  beforeEach(() => {
    db = createMemoryDb()
    // Minimal conversations + messages tables
    db.run(sql`CREATE TABLE IF NOT EXISTS conversations (id TEXT PRIMARY KEY, title TEXT, status TEXT DEFAULT 'idle', user_id TEXT NOT NULL, tokens_used INTEGER DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`)
    db.run(sql`CREATE TABLE IF NOT EXISTS conversation_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, conversation_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, tokens_in INTEGER DEFAULT 0, tokens_out INTEGER DEFAULT 0, created_at TEXT NOT NULL)`)
    detector = createPatternDetector(db, { minSessionsForPattern: 2, analysisWindowDays: 30, minConfidence: 0.5, autoApproveThreshold: 0.95 })
  })

  it('detects recurring conversation titles as patterns', () => {
    const now = new Date().toISOString()
    for (let i = 0; i < 3; i++) {
      db.run(sql`INSERT INTO conversations (id, title, status, user_id, created_at, updated_at) VALUES (${`c${i}`}, 'Deploy to staging', 'complete', 'u1', ${now}, ${now})`)
    }
    const patterns = detector.detect()
    expect(patterns.length).toBeGreaterThan(0)
    expect(patterns[0].title).toContain('Deploy')
    expect(patterns[0].occurrences).toBe(3)
  })

  it('ignores patterns below minSessionsForPattern', () => {
    const now = new Date().toISOString()
    db.run(sql`INSERT INTO conversations (id, title, status, user_id, created_at, updated_at) VALUES ('c1', 'Unique task', 'complete', 'u1', ${now}, ${now})`)
    const patterns = detector.detect()
    expect(patterns).toHaveLength(0)
  })

  it('calculates confidence based on occurrence frequency', () => {
    const now = new Date().toISOString()
    for (let i = 0; i < 10; i++) {
      db.run(sql`INSERT INTO conversations (id, title, status, user_id, created_at, updated_at) VALUES (${`c${i}`}, 'Run tests', 'complete', 'u1', ${now}, ${now})`)
    }
    const patterns = detector.detect()
    expect(patterns[0].confidence).toBeGreaterThanOrEqual(0.8)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/modules/skill-evolution/pattern-detector.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement pattern detector**

```typescript
// src/modules/skill-evolution/pattern-detector.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'
import type { EvolutionConfig } from './types.js'

export interface DetectedPattern {
  title: string
  occurrences: number
  confidence: number
  avgTokens: number
  sampleConversationIds: string[]
}

export function createPatternDetector(db: any, config: EvolutionConfig) {
  return {
    detect(): DetectedPattern[] {
      const cutoff = new Date(Date.now() - config.analysisWindowDays * 86400_000).toISOString()

      const rows = db.all(sql`
        SELECT title, COUNT(*) as cnt, AVG(tokens_used) as avg_tokens,
               GROUP_CONCAT(id) as ids
        FROM conversations
        WHERE title IS NOT NULL AND title != '' AND created_at > ${cutoff}
        GROUP BY title
        HAVING cnt >= ${config.minSessionsForPattern}
        ORDER BY cnt DESC
        LIMIT 20
      `) as any[]

      return rows.map((row: any) => {
        const ids = (row.ids ?? '').split(',').filter(Boolean)
        const confidence = Math.min(row.cnt / 10, 1)
        return {
          title: row.title,
          occurrences: row.cnt,
          confidence,
          avgTokens: Math.round(row.avg_tokens ?? 0),
          sampleConversationIds: ids.slice(0, 5),
        }
      }).filter((p: DetectedPattern) => p.confidence >= config.minConfidence)
    },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/modules/skill-evolution/pattern-detector.test.ts`
Expected: 3 PASS

- [ ] **Step 5: Commit**

```bash
git add src/modules/skill-evolution/pattern-detector.ts tests/modules/skill-evolution/pattern-detector.test.ts
git commit -m "feat(skill-evolution): pattern detector analyzes recurring conversations"
```

---

## Task 3: Skill Evolution — Skill Composer

**Files:**
- Create: `src/modules/skill-evolution/skill-composer.ts`
- Create: `tests/modules/skill-evolution/skill-composer.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// tests/modules/skill-evolution/skill-composer.test.ts
import { describe, it, expect } from 'vitest'
import { composeSkillContent } from '../../../src/modules/skill-evolution/skill-composer.js'

describe('SkillComposer', () => {
  it('composes valid skill markdown from a pattern', () => {
    const content = composeSkillContent({
      title: 'Deploy to staging',
      occurrences: 5,
      confidence: 0.8,
      avgTokens: 1200,
      sampleConversationIds: ['c1', 'c2', 'c3'],
    })
    expect(content).toContain('# Deploy to staging')
    expect(content).toContain('## When to Use')
    expect(content).toContain('## Procedure')
  })

  it('generates slug-based name', () => {
    const result = composeSkillContent({
      title: 'Run CI/CD Pipeline Tests',
      occurrences: 3,
      confidence: 0.6,
      avgTokens: 800,
      sampleConversationIds: [],
    })
    expect(result).toContain('run-ci-cd-pipeline-tests')
  })

  it('includes trigger patterns derived from title', () => {
    const result = composeSkillContent({
      title: 'Analyze code quality',
      occurrences: 4,
      confidence: 0.75,
      avgTokens: 1500,
      sampleConversationIds: ['c1'],
    })
    expect(result).toContain('analyze code quality')
  })
})
```

- [ ] **Step 2: Run test — expected FAIL**

- [ ] **Step 3: Implement skill composer**

```typescript
// src/modules/skill-evolution/skill-composer.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { DetectedPattern } from './pattern-detector.js'

function toSlug(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

export function composeSkillContent(pattern: DetectedPattern): string {
  const slug = toSlug(pattern.title)
  const trigger = pattern.title.toLowerCase()

  return `---
id: auto-${slug}
name: ${pattern.title}
description: Auto-generated skill from ${pattern.occurrences} recurring sessions
trigger_patterns:
  - "${trigger}"
capabilities: []
version: "1.0.0"
---

# ${pattern.title}

## When to Use

This skill was auto-detected from ${pattern.occurrences} similar conversations
(confidence: ${(pattern.confidence * 100).toFixed(0)}%, avg tokens: ${pattern.avgTokens}).

Use when the user asks to: ${trigger}.

## Procedure

1. Analyze the user's request
2. Follow the established pattern from previous sessions
3. Verify the result

## Notes

- Auto-generated by EYAS skill-evolution module
- Based on ${pattern.sampleConversationIds.length} sample conversations
- Review and customize this skill to improve accuracy
`
}
```

- [ ] **Step 4: Run test — expected 3 PASS**

- [ ] **Step 5: Commit**

```bash
git add src/modules/skill-evolution/skill-composer.ts tests/modules/skill-evolution/skill-composer.test.ts
git commit -m "feat(skill-evolution): skill composer generates SKILL.md from patterns"
```

---

## Task 4: Skill Evolution — Routes & Module Registration

**Files:**
- Create: `src/modules/skill-evolution/routes.ts`
- Create: `src/modules/skill-evolution/index.ts`
- Modify: `src/modules/communication/types.ts` — extend ChannelType
- Modify: `src/core/bootstrap.ts` — register skill-evolution module
- Create: `tests/modules/skill-evolution/routes.test.ts`

- [ ] **Step 1: Write failing route test**

```typescript
// tests/modules/skill-evolution/routes.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { createTestDb } from '../../helpers/test-db'
import { createSkillEvolutionRoutes } from '../../../src/modules/skill-evolution/routes.js'
import { createApprovalStore } from '../../../src/modules/skill-evolution/approval-store.js'

const testDb = createTestDb('skill-evolution-routes')

describe('Skill Evolution Routes', () => {
  let app: Hono
  let store: ReturnType<typeof createApprovalStore>

  beforeEach(() => {
    const db = testDb.open()
    db.run(sql`CREATE TABLE IF NOT EXISTS skill_candidates (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL, trigger_patterns TEXT NOT NULL DEFAULT '[]', content TEXT NOT NULL, reasoning TEXT NOT NULL, confidence REAL NOT NULL DEFAULT 0, based_on_sessions INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL, reviewed_at TEXT)`)
    store = createApprovalStore(db)
    app = new Hono()
    createSkillEvolutionRoutes(app, { store })
  })

  it('GET /api/v1/skill-evolution/candidates lists candidates', async () => {
    store.add({ name: 'test', description: 'd', triggerPatterns: [], content: 'c', reasoning: 'r', confidence: 0.7, basedOnSessions: 3 })
    const res = await app.request('/api/v1/skill-evolution/candidates')
    expect(res.status).toBe(200)
    const data = await res.json() as any
    expect(data.candidates).toHaveLength(1)
  })

  it('POST /api/v1/skill-evolution/candidates/:id/approve approves', async () => {
    const id = store.add({ name: 'test', description: 'd', triggerPatterns: ['t'], content: 'c', reasoning: 'r', confidence: 0.8, basedOnSessions: 4 })
    const res = await app.request(`/api/v1/skill-evolution/candidates/${id}/approve`, { method: 'POST' })
    expect(res.status).toBe(200)
    expect(store.get(id)!.status).toBe('approved')
  })

  it('POST /api/v1/skill-evolution/candidates/:id/reject rejects', async () => {
    const id = store.add({ name: 'test', description: 'd', triggerPatterns: ['t'], content: 'c', reasoning: 'r', confidence: 0.6, basedOnSessions: 2 })
    const res = await app.request(`/api/v1/skill-evolution/candidates/${id}/reject`, { method: 'POST' })
    expect(res.status).toBe(200)
    expect(store.get(id)!.status).toBe('rejected')
  })
})
```

- [ ] **Step 2: Run test — expected FAIL**

- [ ] **Step 3: Create routes**

```typescript
// src/modules/skill-evolution/routes.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { Hono } from 'hono'
import type { createApprovalStore } from './approval-store.js'

export function createSkillEvolutionRoutes(
  app: Hono,
  deps: { store: ReturnType<typeof createApprovalStore> },
) {
  const { store } = deps

  app.get('/api/v1/skill-evolution/candidates', (c) => {
    const status = c.req.query('status') as 'pending' | 'approved' | 'rejected' | undefined
    return c.json({ candidates: store.list(status) })
  })

  app.get('/api/v1/skill-evolution/candidates/:id', (c) => {
    const candidate = store.get(c.req.param('id'))
    if (!candidate) return c.json({ error: 'Not found' }, 404)
    return c.json(candidate)
  })

  app.post('/api/v1/skill-evolution/candidates/:id/approve', (c) => {
    const id = c.req.param('id')
    const candidate = store.get(id)
    if (!candidate) return c.json({ error: 'Not found' }, 404)
    store.approve(id)
    return c.json({ message: 'Candidate approved', id })
  })

  app.post('/api/v1/skill-evolution/candidates/:id/reject', (c) => {
    const id = c.req.param('id')
    const candidate = store.get(id)
    if (!candidate) return c.json({ error: 'Not found' }, 404)
    store.reject(id)
    return c.json({ message: 'Candidate rejected', id })
  })
}
```

- [ ] **Step 4: Create module index**

```typescript
// src/modules/skill-evolution/index.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { EyasModule, ModuleContext } from '@core/types'
import { sql } from 'drizzle-orm'
import { createPatternDetector } from './pattern-detector.js'
import { createApprovalStore } from './approval-store.js'
import { composeSkillContent } from './skill-composer.js'
import { createSkillEvolutionRoutes } from './routes.js'
import type { EvolutionConfig } from './types.js'

const DEFAULT_CONFIG: EvolutionConfig = {
  minSessionsForPattern: 3,
  minConfidence: 0.6,
  analysisWindowDays: 14,
  autoApproveThreshold: 0.95,
}

export const skillEvolutionModule: EyasModule = {
  id: 'skill-evolution',
  name: 'Skill Evolution',
  version: '1.0.0',
  type: 'extra',
  required: false,
  description: 'Auto-detects recurring patterns and generates skills from agent sessions',
  dependencies: ['conversations'],
  optional: ['skills', 'scheduler'],

  async onRegister(ctx: ModuleContext) {
    ctx.db.run(sql`CREATE TABLE IF NOT EXISTS skill_candidates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      trigger_patterns TEXT NOT NULL DEFAULT '[]',
      content TEXT NOT NULL,
      reasoning TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 0,
      based_on_sessions INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
      created_at TEXT NOT NULL,
      reviewed_at TEXT
    )`)

    const store = createApprovalStore(ctx.db)
    const detector = createPatternDetector(ctx.db, DEFAULT_CONFIG)
    ;(ctx as any).skillEvolution = { store, detector, config: DEFAULT_CONFIG }
    ctx.logger.info('Skill Evolution module registered')
  },

  async onStart(ctx: ModuleContext) {
    const { store, detector, config } = (ctx as any).skillEvolution
    const skillsModule = ctx.hasModule('skills') ? ctx.getModule<any>('skills') : null

    // Listen for completed conversations — run detection periodically via scheduler
    ctx.bus.on('scheduler:job', async (event: any) => {
      if (event.jobId !== 'skill-evolution-scan') return

      const patterns = detector.detect()
      for (const pattern of patterns) {
        // Check if we already have a candidate for this pattern
        const existing = store.list().find((c: any) => c.name === pattern.title)
        if (existing) continue

        const content = composeSkillContent(pattern)
        const id = store.add({
          name: pattern.title,
          description: `Auto-detected from ${pattern.occurrences} sessions`,
          triggerPatterns: [pattern.title.toLowerCase()],
          content,
          reasoning: `Detected ${pattern.occurrences} similar conversations in last ${config.analysisWindowDays} days`,
          confidence: pattern.confidence,
          basedOnSessions: pattern.occurrences,
        })

        // Auto-approve very high confidence patterns
        if (pattern.confidence >= config.autoApproveThreshold && skillsModule) {
          store.approve(id)
          const candidate = store.get(id)!
          skillsModule.loader.create({
            name: candidate.name,
            description: candidate.description,
            triggerPatterns: candidate.triggerPatterns,
            content: candidate.content,
          })
          ctx.logger.info({ name: candidate.name, confidence: pattern.confidence }, 'Skill auto-approved and created')
        } else {
          ctx.bus.emit('skill-evolution:candidate', { id, name: pattern.title, confidence: pattern.confidence })
          ctx.logger.info({ name: pattern.title, confidence: pattern.confidence }, 'Skill candidate created — awaiting approval')
        }
      }
    })

    createSkillEvolutionRoutes(ctx.http, { store })
    ctx.logger.info('Skill Evolution module started')
  },

  async onStop() {},
}
```

- [ ] **Step 5: Register in bootstrap.ts**

Add import and registration for `skillEvolutionModule` in `src/core/bootstrap.ts`:

```typescript
// Add import at top
import { skillEvolutionModule } from '@modules/skill-evolution/index'

// Add registration (after selfLearningModule)
if (!moduleLoader.hasModule(skillEvolutionModule.id)) {
  moduleLoader.register(skillEvolutionModule)
}
```

- [ ] **Step 6: Run tests — expected PASS**

Run: `bun test tests/modules/skill-evolution/`
Expected: all PASS

- [ ] **Step 7: Commit**

```bash
git add src/modules/skill-evolution/routes.ts src/modules/skill-evolution/index.ts src/core/bootstrap.ts tests/modules/skill-evolution/routes.test.ts
git commit -m "feat(skill-evolution): module index, routes, bootstrap registration"
```

---

## Task 5: Communication — Extend ChannelType & Add Discord

**Files:**
- Modify: `src/modules/communication/types.ts` — add 'whatsapp' | 'signal' to ChannelType
- Create: `src/modules/communication/submodules/discord/manifest.ts`
- Create: `src/modules/communication/submodules/discord/bot.ts`
- Create: `tests/modules/communication/discord-bot.test.ts`

- [ ] **Step 1: Extend ChannelType**

```typescript
// src/modules/communication/types.ts — update ChannelType
export type ChannelType = 'telegram' | 'slack' | 'discord' | 'email' | 'webchat' | 'mcp' | 'whatsapp' | 'signal'
```

- [ ] **Step 2: Write failing Discord test**

```typescript
// tests/modules/communication/discord-bot.test.ts
import { describe, it, expect, vi } from 'vitest'
import { createDiscordBot } from '../../../src/modules/communication/submodules/discord/bot.js'
import pino from 'pino'

describe('DiscordBot', () => {
  it('creates a channel with correct type and id', () => {
    const bot = createDiscordBot({ logger: pino({ level: 'silent' }) })
    expect(bot.id).toBe('discord')
    expect(bot.type).toBe('discord')
    expect(bot.name).toBe('Discord')
    expect(bot.connected).toBe(false)
  })

  it('is not configured without token', () => {
    const bot = createDiscordBot({ logger: pino({ level: 'silent' }) })
    expect(bot.isConfigured).toBe(false)
  })

  it('registers message handlers', () => {
    const bot = createDiscordBot({ logger: pino({ level: 'silent' }) })
    const handler = vi.fn()
    bot.onMessage(handler)
    // Handler registered but not called until connected
    expect(bot.connected).toBe(false)
  })
})
```

- [ ] **Step 3: Create Discord manifest**

```typescript
// src/modules/communication/submodules/discord/manifest.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { SubmoduleManifest } from '@core/types'

export const discordManifest: SubmoduleManifest = {
  id: 'communication.discord',
  name: 'Discord Bot',
  parentModule: 'communication',
  enabled: true,
}
```

- [ ] **Step 4: Create Discord bot adapter**

```typescript
// src/modules/communication/submodules/discord/bot.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { Logger } from 'pino'
import type { Channel, ChannelContent, ChannelMessage } from '../../types.js'

export function createDiscordBot(config: {
  botToken?: string
  logger: Logger
}): Channel & { isConfigured: boolean } {
  const { botToken, logger } = config
  const handlers: ((msg: ChannelMessage) => Promise<void>)[] = []
  let client: any = null
  let connected = false

  return {
    get id() { return 'discord' },
    get type() { return 'discord' as const },
    get name() { return 'Discord' },
    get connected() { return connected },
    get isConfigured() { return !!botToken },

    async connect() {
      if (!botToken) {
        logger.warn('Discord bot token not configured — skipping')
        return
      }
      try {
        const { Client, GatewayIntentBits } = await import('discord.js')
        client = new Client({
          intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMessages,
            GatewayIntentBits.MessageContent,
            GatewayIntentBits.DirectMessages,
          ],
        })

        client.on('messageCreate', async (msg: any) => {
          if (msg.author.bot) return
          const channelMsg: ChannelMessage = {
            id: msg.id,
            channelType: 'discord',
            channelId: msg.channelId,
            senderId: msg.author.id,
            senderName: msg.author.username,
            content: msg.content,
            attachments: msg.attachments?.map((a: any) => ({
              filename: a.name ?? 'file',
              mimeType: a.contentType ?? 'application/octet-stream',
              url: a.url,
            })),
            replyToId: msg.reference?.messageId,
            timestamp: msg.createdAt.toISOString(),
          }
          for (const handler of handlers) {
            await handler(channelMsg).catch((err) => logger.error({ err }, 'Discord message handler error'))
          }
        })

        await client.login(botToken)
        connected = true
        logger.info('Discord bot connected')
      } catch (err) {
        logger.error({ err }, 'Discord bot connection failed')
      }
    },

    async disconnect() {
      if (client) {
        client.destroy()
        connected = false
        logger.info('Discord bot disconnected')
      }
    },

    async send(target: string, content: ChannelContent) {
      if (!client) return
      const channel = await client.channels.fetch(target)
      if (channel?.isTextBased()) {
        await channel.send(content.text ?? '')
      }
    },

    async reply(originalMsg: ChannelMessage, content: ChannelContent) {
      if (!client) return
      const channel = await client.channels.fetch(originalMsg.channelId)
      if (channel?.isTextBased()) {
        await channel.send({
          content: content.text ?? '',
          reply: { messageReference: originalMsg.id },
        })
      }
    },

    onMessage(handler: (msg: ChannelMessage) => Promise<void>) {
      handlers.push(handler)
    },
  }
}
```

- [ ] **Step 5: Run test — expected 3 PASS**

- [ ] **Step 6: Commit**

```bash
git add src/modules/communication/types.ts src/modules/communication/submodules/discord/ tests/modules/communication/discord-bot.test.ts
git commit -m "feat(communication): Discord bot channel adapter"
```

---

## Task 6: Communication — Slack, Email, WhatsApp, Signal Adapters

**Files:**
- Create: `src/modules/communication/submodules/slack/manifest.ts`
- Create: `src/modules/communication/submodules/slack/bot.ts`
- Create: `src/modules/communication/submodules/email/manifest.ts`
- Create: `src/modules/communication/submodules/email/adapter.ts`
- Create: `src/modules/communication/submodules/whatsapp/manifest.ts`
- Create: `src/modules/communication/submodules/whatsapp/adapter.ts`
- Create: `src/modules/communication/submodules/signal/manifest.ts`
- Create: `src/modules/communication/submodules/signal/adapter.ts`
- Create: `tests/modules/communication/slack-bot.test.ts`
- Create: `tests/modules/communication/email-adapter.test.ts`
- Create: `tests/modules/communication/whatsapp-adapter.test.ts`
- Create: `tests/modules/communication/signal-adapter.test.ts`

Each adapter follows the exact same pattern as Task 5 (Discord): manifest.ts + adapter implementing Channel interface. Each adapter:
- Returns `isConfigured: false` without credentials
- Connects only when token/config is present
- Maps platform-specific message format to ChannelMessage
- Implements send/reply/onMessage

The adapters differ only in:
- **Slack**: Uses `@slack/bolt` AsyncApp with Socket Mode, `mrkdwn` formatting, thread_ts threading
- **Email**: Uses `nodemailer` for SMTP send, IMAP polling for receive (In-Reply-To headers for threading)
- **WhatsApp**: Uses WhatsApp Business Cloud API (HTTP webhook for receive, REST API for send)
- **Signal**: Uses signal-cli HTTP daemon bridge (SSE for receive, JSON-RPC for send)

- [ ] **Step 1: Create all 4 manifests** (same pattern as Discord manifest)

- [ ] **Step 2: Create Slack bot adapter**

```typescript
// src/modules/communication/submodules/slack/bot.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { Logger } from 'pino'
import type { Channel, ChannelContent, ChannelMessage } from '../../types.js'

export function createSlackBot(config: {
  botToken?: string
  appToken?: string
  logger: Logger
}): Channel & { isConfigured: boolean } {
  const { botToken, appToken, logger } = config
  const handlers: ((msg: ChannelMessage) => Promise<void>)[] = []
  let app: any = null
  let connected = false

  return {
    get id() { return 'slack' },
    get type() { return 'slack' as const },
    get name() { return 'Slack' },
    get connected() { return connected },
    get isConfigured() { return !!(botToken && appToken) },

    async connect() {
      if (!botToken || !appToken) {
        logger.warn('Slack bot/app token not configured — skipping')
        return
      }
      try {
        const { App } = await import('@slack/bolt')
        app = new App({ token: botToken, appToken, socketMode: true })

        app.message(async ({ message, say }: any) => {
          if (message.subtype) return
          const channelMsg: ChannelMessage = {
            id: message.ts,
            channelType: 'slack',
            channelId: message.channel,
            senderId: message.user,
            content: message.text ?? '',
            replyToId: message.thread_ts,
            timestamp: new Date(parseFloat(message.ts) * 1000).toISOString(),
          }
          for (const handler of handlers) {
            await handler(channelMsg).catch((err) => logger.error({ err }, 'Slack handler error'))
          }
        })

        await app.start()
        connected = true
        logger.info('Slack bot connected via Socket Mode')
      } catch (err) {
        logger.error({ err }, 'Slack bot connection failed')
      }
    },

    async disconnect() {
      if (app) { await app.stop(); connected = false }
    },

    async send(target: string, content: ChannelContent) {
      if (!app) return
      await app.client.chat.postMessage({ channel: target, text: content.text ?? '' })
    },

    async reply(originalMsg: ChannelMessage, content: ChannelContent) {
      if (!app) return
      await app.client.chat.postMessage({
        channel: originalMsg.channelId,
        text: content.text ?? '',
        thread_ts: originalMsg.id,
      })
    },

    onMessage(handler) { handlers.push(handler) },
  }
}
```

- [ ] **Step 3: Create Email adapter**

```typescript
// src/modules/communication/submodules/email/adapter.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { Logger } from 'pino'
import type { Channel, ChannelContent, ChannelMessage } from '../../types.js'

export function createEmailAdapter(config: {
  smtpHost?: string; smtpPort?: number; smtpUser?: string; smtpPass?: string
  imapHost?: string; imapPort?: number; imapUser?: string; imapPass?: string
  pollIntervalMs?: number
  logger: Logger
}): Channel & { isConfigured: boolean } {
  const { logger, pollIntervalMs = 60_000 } = config
  const handlers: ((msg: ChannelMessage) => Promise<void>)[] = []
  let transporter: any = null
  let pollTimer: ReturnType<typeof setInterval> | null = null
  let connected = false

  return {
    get id() { return 'email' },
    get type() { return 'email' as const },
    get name() { return 'Email' },
    get connected() { return connected },
    get isConfigured() { return !!(config.smtpHost && config.imapHost) },

    async connect() {
      if (!config.smtpHost || !config.imapHost) {
        logger.warn('Email SMTP/IMAP not configured — skipping')
        return
      }
      try {
        const nodemailer = await import('nodemailer')
        transporter = nodemailer.createTransport({
          host: config.smtpHost, port: config.smtpPort ?? 587,
          auth: { user: config.smtpUser, pass: config.smtpPass },
        })

        // IMAP polling for incoming mail
        pollTimer = setInterval(async () => {
          try {
            const { ImapFlow } = await import('imapflow')
            const client = new ImapFlow({
              host: config.imapHost!, port: config.imapPort ?? 993,
              auth: { user: config.imapUser!, pass: config.imapPass! },
              secure: true, logger: false as any,
            })
            await client.connect()
            const lock = await client.getMailboxLock('INBOX')
            try {
              for await (const msg of client.fetch({ seen: false }, { envelope: true, source: true })) {
                const envelope = msg.envelope
                const channelMsg: ChannelMessage = {
                  id: envelope.messageId ?? String(msg.seq),
                  channelType: 'email',
                  channelId: envelope.from?.[0]?.address ?? 'unknown',
                  senderId: envelope.from?.[0]?.address ?? 'unknown',
                  senderName: envelope.from?.[0]?.name,
                  content: envelope.subject ?? '',
                  replyToId: envelope.inReplyTo,
                  timestamp: envelope.date?.toISOString() ?? new Date().toISOString(),
                }
                for (const handler of handlers) {
                  await handler(channelMsg).catch((err) => logger.error({ err }, 'Email handler error'))
                }
              }
            } finally { lock.release() }
            await client.logout()
          } catch (err) {
            logger.error({ err }, 'Email IMAP poll error')
          }
        }, pollIntervalMs)

        connected = true
        logger.info('Email adapter connected')
      } catch (err) {
        logger.error({ err }, 'Email adapter connection failed')
      }
    },

    async disconnect() {
      if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
      connected = false
    },

    async send(target: string, content: ChannelContent) {
      if (!transporter) return
      await transporter.sendMail({
        to: target,
        subject: 'EYAS Notification',
        text: content.text ?? '',
        html: content.html,
      })
    },

    async reply(originalMsg: ChannelMessage, content: ChannelContent) {
      if (!transporter) return
      await transporter.sendMail({
        to: originalMsg.senderId,
        subject: `Re: ${originalMsg.content.slice(0, 80)}`,
        text: content.text ?? '',
        html: content.html,
        inReplyTo: originalMsg.id,
        references: originalMsg.id,
      })
    },

    onMessage(handler) { handlers.push(handler) },
  }
}
```

- [ ] **Step 4: Create WhatsApp adapter**

```typescript
// src/modules/communication/submodules/whatsapp/adapter.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { Logger } from 'pino'
import type { Channel, ChannelContent, ChannelMessage } from '../../types.js'

export function createWhatsAppAdapter(config: {
  phoneNumberId?: string
  accessToken?: string
  verifyToken?: string
  logger: Logger
  http?: any // Hono instance for webhook registration
}): Channel & { isConfigured: boolean } {
  const { phoneNumberId, accessToken, verifyToken, logger, http } = config
  const handlers: ((msg: ChannelMessage) => Promise<void>)[] = []
  let connected = false
  const apiBase = 'https://graph.facebook.com/v21.0'

  return {
    get id() { return 'whatsapp' },
    get type() { return 'whatsapp' as const },
    get name() { return 'WhatsApp' },
    get connected() { return connected },
    get isConfigured() { return !!(phoneNumberId && accessToken) },

    async connect() {
      if (!phoneNumberId || !accessToken) {
        logger.warn('WhatsApp credentials not configured — skipping')
        return
      }

      // Register webhook endpoint for incoming messages
      if (http) {
        http.get('/api/v1/webhooks/whatsapp', (c: any) => {
          const mode = c.req.query('hub.mode')
          const token = c.req.query('hub.verify_token')
          const challenge = c.req.query('hub.challenge')
          if (mode === 'subscribe' && token === verifyToken) return c.text(challenge ?? '')
          return c.text('Forbidden', 403)
        })

        http.post('/api/v1/webhooks/whatsapp', async (c: any) => {
          const body = await c.req.json()
          const entries = body.entry ?? []
          for (const entry of entries) {
            for (const change of entry.changes ?? []) {
              const messages = change.value?.messages ?? []
              for (const msg of messages) {
                const channelMsg: ChannelMessage = {
                  id: msg.id,
                  channelType: 'whatsapp',
                  channelId: msg.from,
                  senderId: msg.from,
                  senderName: change.value?.contacts?.[0]?.profile?.name,
                  content: msg.text?.body ?? '',
                  timestamp: new Date(parseInt(msg.timestamp) * 1000).toISOString(),
                }
                for (const handler of handlers) {
                  await handler(channelMsg).catch((err) => logger.error({ err }, 'WhatsApp handler error'))
                }
              }
            }
          }
          return c.json({ status: 'ok' })
        })
      }

      connected = true
      logger.info('WhatsApp adapter connected')
    },

    async disconnect() { connected = false },

    async send(target: string, content: ChannelContent) {
      await fetch(`${apiBase}/${phoneNumberId}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messaging_product: 'whatsapp', to: target,
          type: 'text', text: { body: content.text ?? '' },
        }),
      })
    },

    async reply(originalMsg: ChannelMessage, content: ChannelContent) {
      await fetch(`${apiBase}/${phoneNumberId}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messaging_product: 'whatsapp', to: originalMsg.senderId,
          type: 'text', text: { body: content.text ?? '' },
          context: { message_id: originalMsg.id },
        }),
      })
    },

    onMessage(handler) { handlers.push(handler) },
  }
}
```

- [ ] **Step 5: Create Signal adapter**

```typescript
// src/modules/communication/submodules/signal/adapter.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { Logger } from 'pino'
import type { Channel, ChannelContent, ChannelMessage } from '../../types.js'

export function createSignalAdapter(config: {
  signalCliUrl?: string  // e.g. http://localhost:8080
  accountNumber?: string // e.g. +1234567890
  logger: Logger
}): Channel & { isConfigured: boolean } {
  const { signalCliUrl, accountNumber, logger } = config
  const handlers: ((msg: ChannelMessage) => Promise<void>)[] = []
  let connected = false
  let abortController: AbortController | null = null

  return {
    get id() { return 'signal' },
    get type() { return 'signal' as const },
    get name() { return 'Signal' },
    get connected() { return connected },
    get isConfigured() { return !!(signalCliUrl && accountNumber) },

    async connect() {
      if (!signalCliUrl || !accountNumber) {
        logger.warn('Signal CLI URL not configured — skipping')
        return
      }

      // SSE event stream from signal-cli REST API
      abortController = new AbortController()
      const startSSE = async () => {
        try {
          const res = await fetch(`${signalCliUrl}/api/v1/receive/${accountNumber}`, {
            signal: abortController!.signal,
          })
          const reader = res.body?.getReader()
          if (!reader) return
          const decoder = new TextDecoder()
          let buffer = ''

          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            buffer += decoder.decode(value, { stream: true })
            const lines = buffer.split('\n')
            buffer = lines.pop() ?? ''
            for (const line of lines) {
              if (!line.startsWith('data:')) continue
              try {
                const event = JSON.parse(line.slice(5))
                if (!event.envelope?.dataMessage) continue
                const dm = event.envelope.dataMessage
                const channelMsg: ChannelMessage = {
                  id: String(event.envelope.timestamp),
                  channelType: 'signal',
                  channelId: event.envelope.source ?? event.envelope.sourceNumber ?? '',
                  senderId: event.envelope.source ?? event.envelope.sourceNumber ?? '',
                  senderName: event.envelope.sourceName,
                  content: dm.message ?? '',
                  timestamp: new Date(event.envelope.timestamp).toISOString(),
                }
                for (const handler of handlers) {
                  await handler(channelMsg).catch((err) => logger.error({ err }, 'Signal handler error'))
                }
              } catch { /* skip malformed SSE lines */ }
            }
          }
        } catch (err: any) {
          if (err.name !== 'AbortError') {
            logger.error({ err }, 'Signal SSE error — will retry in 5s')
            setTimeout(startSSE, 5000)
          }
        }
      }

      startSSE()
      connected = true
      logger.info('Signal adapter connected via signal-cli')
    },

    async disconnect() {
      abortController?.abort()
      connected = false
    },

    async send(target: string, content: ChannelContent) {
      if (!signalCliUrl || !accountNumber) return
      await fetch(`${signalCliUrl}/api/v2/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: content.text ?? '',
          number: accountNumber,
          recipients: [target],
        }),
      })
    },

    async reply(originalMsg: ChannelMessage, content: ChannelContent) {
      await this.send(originalMsg.senderId, content)
    },

    onMessage(handler) { handlers.push(handler) },
  }
}
```

- [ ] **Step 6: Write tests for all 4 adapters** (same pattern as Discord test)

Each test verifies: correct id/type/name, isConfigured false without creds, onMessage registers handlers.

- [ ] **Step 7: Register all new submodules in communication/index.ts**

Add imports and registration for all 5 new submodules (Discord, Slack, Email, WhatsApp, Signal) following the existing Telegram pattern in `src/modules/communication/index.ts`.

- [ ] **Step 8: Run all tests**

Run: `bun test tests/modules/communication/`
Expected: all PASS

- [ ] **Step 9: Commit**

```bash
git add src/modules/communication/ tests/modules/communication/
git commit -m "feat(communication): Discord, Slack, Email, WhatsApp, Signal channel adapters"
```

---

## Task 7: create-eyas CLI Package

**Files:**
- Create: `packages/create-eyas/package.json`
- Create: `packages/create-eyas/index.ts`
- Create: `packages/create-eyas/templates/config.yaml`
- Create: `packages/create-eyas/templates/docker-compose.yml`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "create-eyas",
  "version": "0.8.1-beta",
  "description": "Scaffold a new EYAS project",
  "type": "module",
  "bin": { "create-eyas": "./index.ts" },
  "files": ["index.ts", "templates/"],
  "license": "MIT",
  "author": "eYssen",
  "repository": { "type": "git", "url": "https://github.com/eyssen/eyas" }
}
```

- [ ] **Step 2: Create scaffolding script**

```typescript
#!/usr/bin/env bun
// packages/create-eyas/index.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs'
import { join, resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const projectName = args[0] ?? 'my-eyas'
const targetDir = resolve(process.cwd(), projectName)

console.log(`\n🦅 Creating EYAS project in ${targetDir}\n`)

if (existsSync(targetDir)) {
  console.error(`Error: Directory ${projectName} already exists`)
  process.exit(1)
}

// Create directory structure
const dirs = ['config', 'data', 'config/skills']
mkdirSync(targetDir, { recursive: true })
for (const dir of dirs) mkdirSync(join(targetDir, dir), { recursive: true })

// Copy templates
const templates = ['config.yaml', 'docker-compose.yml']
for (const tpl of templates) {
  const src = join(__dirname, 'templates', tpl)
  const dest = tpl === 'config.yaml' ? join(targetDir, 'config', 'default.yaml') : join(targetDir, tpl)
  writeFileSync(dest, readFileSync(src, 'utf-8'))
}

// Create package.json
writeFileSync(join(targetDir, 'package.json'), JSON.stringify({
  name: projectName,
  version: '0.1.0',
  private: true,
  type: 'module',
  scripts: {
    start: 'eyas serve',
    doctor: 'eyas doctor',
  },
  dependencies: {
    eyas: 'latest',
  },
}, null, 2) + '\n')

// Create .gitignore
writeFileSync(join(targetDir, '.gitignore'), [
  'node_modules/', 'data/', '*.db', '*.db-wal', '*.db-shm',
  '.env', 'master.key',
].join('\n') + '\n')

console.log('Created:')
console.log(`  ${projectName}/config/default.yaml`)
console.log(`  ${projectName}/docker-compose.yml`)
console.log(`  ${projectName}/package.json`)
console.log(`  ${projectName}/.gitignore`)
console.log(`\nNext steps:`)
console.log(`  cd ${projectName}`)
console.log(`  bun install`)
console.log(`  bun start`)
console.log()
```

- [ ] **Step 3: Create config template**

```yaml
# packages/create-eyas/templates/config.yaml
# EYAS — Personal AI Agent Platform
# See docs for all options: https://github.com/eyssen/eyas

server:
  host: "0.0.0.0"
  port: 3000

database:
  path: "./data/eyas.db"

log:
  level: info
  pretty: true

i18n:
  defaultLanguage: en
  fallbackLanguage: en

modules:
  disabled: []
```

- [ ] **Step 4: Create docker-compose template**

```yaml
# packages/create-eyas/templates/docker-compose.yml
services:
  eyas:
    image: eyssen/eyas:latest
    ports:
      - "3000:3000"
    volumes:
      - ./data:/app/data
      - ./config:/app/config
    environment:
      - NODE_ENV=production
    restart: unless-stopped

  # Optional: Ollama for local LLM
  # ollama:
  #   image: ollama/ollama:latest
  #   ports:
  #     - "11434:11434"
  #   volumes:
  #     - ollama_data:/root/.ollama

# volumes:
#   ollama_data:
```

- [ ] **Step 5: Test the scaffolding script**

```bash
cd /tmp && bun /Users/eyssen/GitHub/eyas/packages/create-eyas/index.ts test-eyas-project
ls -la /tmp/test-eyas-project/
cat /tmp/test-eyas-project/config/default.yaml
rm -rf /tmp/test-eyas-project
```

- [ ] **Step 6: Commit**

```bash
git add packages/create-eyas/
git commit -m "feat: create-eyas scaffolding CLI package"
```

---

## Task 8: Update Documentation HTML Files

**Files:**
- Modify: `docs/eyas-overview.html` — add skill evolution, channels, create-eyas sections
- Modify: `docs/eyas-specification.html` — add technical spec sections

- [ ] **Step 1: Add Skill Evolution section to overview**

Add a feature card for "Skill Evolution" in the features grid, describing auto-learning from agent sessions.

- [ ] **Step 2: Add Communication Channels section to overview**

Update the communication feature card to list all 8 channels: Telegram, Discord, Slack, WhatsApp, Signal, Email, MCP, A2A.

- [ ] **Step 3: Add Quick Start section with create-eyas**

Add/update the quickstart section:
```
bunx create-eyas my-project
cd my-project
bun install && bun start
```

- [ ] **Step 4: Update specification with technical details**

Add specification sections for:
- Skill Evolution module (pattern detection, approval workflow, auto-generation)
- Communication adapters (Channel interface, adapter pattern, supported platforms)
- create-eyas package (scaffolding, templates)

- [ ] **Step 5: Commit**

```bash
git add docs/
git commit -m "docs: add skill evolution, communication channels, create-eyas to HTML docs"
```

---

## Task 9: Full Test Suite Verification

- [ ] **Step 1: Run full test suite**

```bash
bun test
```
Expected: 830+ pass, 0 fail

- [ ] **Step 2: TypeScript check**

```bash
bunx tsc --noEmit 2>&1 | grep -v "documents\|observability\|communication/index" | head -5
```
Expected: No new errors

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "feat: Hermes-inspired features — skill evolution, 5 channels, create-eyas"
```

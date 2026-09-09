# Agent System Overhaul — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove all hardcoded agent names (Jarvis/R2D2), introduce agent-scoped memory, strengthen agent↔project↔channel bindings, and add inter-agent delegation.

**Architecture:** Five waves executed sequentially. Wave 1 (US-1) removes hardcoded names and consolidates seed logic into TypeScript templates. Wave 2 (US-2) adds agent selector UI to projects/conversations. Wave 3 (US-3) adds `agent_id` to all memory tiers. Wave 4 (US-4) binds communication channels to agents via DB config. Wave 5 (US-5) adds agent discovery and delegation protocol. Data directory can be deleted — fresh DB on start.

**Tech Stack:** TypeScript, Bun, Drizzle ORM, SQLite, Hono, React 19, shadcn/ui, Vitest

---

## File Map

### Wave 1 — Hardcoded Names Removal (US-1)

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `src/modules/agent/agent-templates.ts` | Remove "Jarvis"/"R2D2" names, use role-based defaults |
| Delete | `config/agents/jarvis.yaml` | Remove hardcoded YAML seed |
| Delete | `config/agents/r2d2.yaml` | Remove hardcoded YAML seed |
| Modify | `src/modules/agent/agent-registry.ts` | Remove `seedFromDirectory()`, simplify to template-only seeding |
| Modify | `src/modules/board/index.ts:100-128` | Remove hardcoded `agentId: 'jarvis'`/`'r2d2'` from seed types |
| Modify | `src/modules/auth/index.ts:92-93` | Update placeholder text |
| Modify | `src/web/src/pages/login/login-page.tsx` | Rename import/alt from jarvis to generic |
| Modify | `src/web/src/globals.css:135-157` | Rename `jarvis-float` → `mascot-float` |
| Rename | `src/web/src/assets/jarvis.png` → `mascot.png` | Generic asset name |
| Modify | `scripts/install.sh:61` | Change default from "Jarvis" to "Assistant" |
| Modify | `tests/e2e/system.test.ts:46` | Test for `is_agent` flag, not name |
| Modify | `tests/modules/prompt-wizard/integration.test.ts` | Use generic agent IDs in fixtures |
| Create | `tests/modules/agent/templates.test.ts` | Test templates have no hardcoded user-facing names |

### Wave 2 — Agent ↔ Project UI (US-2)

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `src/modules/board/services/project-service.ts` | Expose `defaultAgentId` in update |
| Modify | `src/modules/board/services/project-type-service.ts` | Expose `defaultAgentId` in update |
| Create | `src/modules/agent/agent-resolver.ts` | Central agent resolution: conv → project → type → first primary |
| Modify | `src/modules/conversations/conversation-service.ts` | Auto-assign agent on create via resolver |
| Modify | `src/modules/prompt-wizard/assembler.ts` | Use resolver instead of inline chain |
| Modify | `src/web/src/pages/board/project-settings.tsx` | Add agent selector dropdown |
| Modify | `src/web/src/pages/conversations/conversation-header.tsx` | Show agent chip, click to change |
| Create | `tests/modules/agent/agent-resolver.test.ts` | Test resolution chain |

### Wave 3 — Agent Memory (US-3)

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `src/modules/memory/schema.ts` | Add `agent_id` column to all 3 tables + indexes |
| Modify | `src/modules/memory/tiers/working-memory.ts` | Agent-scoped key prefix pattern |
| Modify | `src/modules/memory/tiers/episodic-memory.ts` | Add `agentId` param to create/list/search |
| Modify | `src/modules/memory/tiers/archive-memory.ts` | Add `agentId` param |
| Modify | `src/modules/memory/context-builder-v2.ts` | Add `agentId` to `ContextAssemblyOptions`, query agent-scoped + shared |
| Create | `src/modules/agent/routes-memory.ts` | `GET /api/v1/agents/:id/memories` endpoint |
| Modify | `src/web/src/pages/agents/agent-detail.tsx` | Add "Memories" tab |
| Create | `tests/modules/memory/agent-scoped.test.ts` | Test agent isolation + shared fallback |

### Wave 4 — Agent ↔ Channel Binding (US-4)

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `src/modules/communication/index.ts` | Create `channel_configs` table, load on start |
| Create | `src/modules/communication/channel-config-service.ts` | CRUD for channel↔agent mapping |
| Modify | `src/modules/communication/channel-router.ts` | Resolve agent from channel config on message |
| Modify | `src/modules/communication/routes.ts` | `GET/PATCH /api/v1/channels/:id` for agent assignment |
| Modify | `src/web/src/pages/settings/communication-settings.tsx` | Agent selector per channel |
| Create | `tests/modules/communication/channel-agent.test.ts` | Test routing resolves correct agent |

### Wave 5 — Agent Directory & Delegation (US-5)

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `src/modules/agent/agent-directory.ts` | `listAvailable()` returning capability summaries |
| Create | `src/modules/agent/delegation.ts` | `delegateTask()` — create child conversation, execute, summarize |
| Modify | `src/modules/agent/orchestrator.ts` | Wire delegation as a tool callable by agents |
| Modify | `src/modules/prompt-wizard/assembler.ts` | Inject agent directory into prompt when agent has `delegation` capability |
| Create | `src/modules/tools/builtin/delegate-tool.ts` | `delegate_to_agent` tool definition |
| Modify | `src/web/src/pages/conversations/message-list.tsx` | Show delegation trace (child link) |
| Create | `tests/modules/agent/delegation.test.ts` | Test delegation chain, max depth, cycle detection |

---

## Wave 1: Hardcoded Names Removal (US-1)

### Task 1.1: Remove Hardcoded Names from Agent Templates

**Files:**
- Modify: `src/modules/agent/agent-templates.ts:31,85`
- Create: `tests/modules/agent/templates.test.ts`

- [ ] **Step 1: Write test — templates must not contain user-facing hardcoded names**

```typescript
// tests/modules/agent/templates.test.ts
import { describe, it, expect } from 'vitest'
import { PRIMARY_TEMPLATES, RECOMMENDED_TEMPLATES, SPECIALIST_TEMPLATES, ALL_TEMPLATES } from '@modules/agent/agent-templates'

describe('Agent templates', () => {
  const FORBIDDEN_NAMES = ['jarvis', 'r2d2', 'r2-d2', 'friday', 'alexa', 'siri', 'cortana']

  it('primary templates have generic placeholder names, not character names', () => {
    for (const t of PRIMARY_TEMPLATES) {
      const lower = t.name.toLowerCase()
      for (const forbidden of FORBIDDEN_NAMES) {
        expect(lower).not.toContain(forbidden)
      }
    }
  })

  it('all templates have unique IDs', () => {
    const ids = ALL_TEMPLATES.map(t => t.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('primary templates have tier "primary"', () => {
    for (const t of PRIMARY_TEMPLATES) {
      expect(t.tier).toBe('primary')
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/modules/agent/templates.test.ts`
Expected: FAIL — "Jarvis" and "R2D2" match the forbidden list.

- [ ] **Step 3: Update template names to generic role-based defaults**

In `src/modules/agent/agent-templates.ts`, change line 31 and line 85:

```typescript
// Line 31 — was: name: 'Jarvis',
name: 'Personal Assistant',

// Line 85 — was: name: 'R2D2',
name: 'System Engineer',
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/modules/agent/templates.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/modules/agent/agent-templates.ts tests/modules/agent/templates.test.ts
git commit -m "refactor(agent): remove hardcoded Jarvis/R2D2 names from templates"
```

### Task 1.2: Delete YAML Seed Files and Remove seedFromDirectory

**Files:**
- Delete: `config/agents/jarvis.yaml`
- Delete: `config/agents/r2d2.yaml`
- Modify: `src/modules/agent/agent-registry.ts:247-298`

- [ ] **Step 1: Delete YAML seed files for primary agents**

Delete `config/agents/jarvis.yaml` and `config/agents/r2d2.yaml`. Keep the other YAML files (`code-reviewer.yaml`, `general-assistant.yaml`, `researcher.yaml`) — they are optional specialist seeds.

- [ ] **Step 2: Update agent-registry.ts — make seedFromDirectory skip primary agents**

The `seedFromDirectory` function should remain for optional YAML agents (specialists users may add), but the primary agent creation now happens exclusively via the setup wizard. No code change needed in the function itself — removing the YAML files is enough since `readdir` simply won't find them.

- [ ] **Step 3: Verify no import errors**

Run: `bun test --run 2>&1 | head -30`
Expected: No import errors related to missing YAML files.

- [ ] **Step 4: Commit**

```bash
git rm config/agents/jarvis.yaml config/agents/r2d2.yaml
git add src/modules/agent/agent-registry.ts
git commit -m "refactor(agent): delete hardcoded jarvis/r2d2 YAML seeds"
```

### Task 1.3: Fix Board Seed — Remove Hardcoded Agent IDs

**Files:**
- Modify: `src/modules/board/index.ts:100-128`

This is also a **bugfix**: the current `agentId: 'jarvis'`/`'r2d2'` values never match the actual agent IDs created by the setup wizard (which uses `generateId()`).

- [ ] **Step 1: Remove agentId from seed project types**

Replace the seed types block in `src/modules/board/index.ts` (lines 103-119):

```typescript
const seedTypes = [
  {
    id: 'general',
    name: 'General',
    prompt: 'General-purpose project for quick conversations and tasks.',
    icon: 'folder',
    stages: '["Backlog","To Do","In Progress","Review","Done"]',
  },
  {
    id: 'eyas',
    name: 'EYAS',
    prompt: 'EYAS platform internal operations — agents, skills, prompts, system maintenance.',
    icon: 'settings',
    stages: '["Backlog","To Do","In Progress","Review","Done"]',
  },
]
```

And update the INSERT to remove the `default_agent_id` column (lines 121-123):

```typescript
for (const t of seedTypes) {
  ctx.db.run(sql`INSERT OR IGNORE INTO project_types (id, name, prompt, icon, default_stages, default_priority, source, created_at)
    VALUES (${t.id}, ${t.name}, ${t.prompt}, ${t.icon}, ${t.stages}, 'normal', 'seed', ${now})`)
}
```

The `default_agent_id` will be set by the auth setup wizard's `onComplete` callback (which already updates the 'general' type on line 126 of `auth/index.ts`).

- [ ] **Step 2: Fix auth wizard to also set 'eyas' project type agent**

In `src/modules/auth/index.ts`, inside the `primary-agents` step's `onComplete` (around line 124-127), update both project types:

```typescript
// First primary agent → General project type
if (i === 0) {
  ctx.db.run(sql`UPDATE project_types SET default_agent_id = ${agentDefId} WHERE id = 'general'`)
}
// Second primary agent → EYAS project type
if (i === 1) {
  ctx.db.run(sql`UPDATE project_types SET default_agent_id = ${agentDefId} WHERE id = 'eyas'`)
}
```

- [ ] **Step 3: Run full test suite**

Run: `bun test --run`
Expected: All existing tests pass (the hardcoded 'jarvis'/'r2d2' strings are no longer referenced in board seed).

- [ ] **Step 4: Commit**

```bash
git add src/modules/board/index.ts src/modules/auth/index.ts
git commit -m "fix(board): remove hardcoded agent IDs from seed project types

The previous 'jarvis'/'r2d2' strings never matched the actual agent IDs
created by the setup wizard (which uses generateId()). This caused the
prompt assembler to silently lose the agent persona for conversations
in the 'eyas' project type."
```

### Task 1.4: Update Auth Wizard Placeholders

**Files:**
- Modify: `src/modules/auth/index.ts:92-93`

- [ ] **Step 1: Change placeholder text**

```typescript
// Line 92 — was: placeholder: 'Jarvis'
{ name: 'assistantName', type: 'text', label: 'Primary Assistant Name', required: true, placeholder: 'e.g. Friday' },
// Line 93 — was: placeholder: 'R2D2'
{ name: 'engineerName', type: 'text', label: 'System Engineer Name', required: true, placeholder: 'e.g. Scotty' },
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/auth/index.ts
git commit -m "refactor(auth): use generic placeholders in agent name wizard"
```

### Task 1.5: Rename Login Page Assets

**Files:**
- Rename: `src/web/src/assets/jarvis.png` → `src/web/src/assets/mascot.png`
- Modify: `src/web/src/pages/login/login-page.tsx:11,38-47`
- Modify: `src/web/src/globals.css:135-157`

- [ ] **Step 1: Rename the image file**

```bash
mv src/web/src/assets/jarvis.png src/web/src/assets/mascot.png
```

- [ ] **Step 2: Update login-page.tsx imports and references**

```typescript
// Line 11 — was: import jarvisImg from '@/assets/jarvis.png'
import mascotImg from '@/assets/mascot.png'

// Line 38 — was: {/* Warm glow behind Jarvis */}
{/* Warm glow behind mascot */}

// Line 42 — was: {/* Jarvis — floating above the card, right side */}
{/* Mascot — floating above the card, right side */}

// Line 45 — was: src={jarvisImg}
src={mascotImg}

// Line 46 — was: alt="Jarvis"
alt="EYAS Assistant"

// Line 47 — was: animate-[jarvis-float_12s_ease-in-out_infinite]
className="absolute -top-[140px] -right-[100px] w-[200px] pointer-events-none select-none animate-[mascot-float_12s_ease-in-out_infinite]"
```

- [ ] **Step 3: Rename CSS animation**

In `src/web/src/globals.css`, replace all occurrences:

```css
/* was: Jarvis robot arm — Y-axis rotation, short bursts with idle gaps */
/* Mascot — Y-axis rotation, short bursts with idle gaps */
/* was: @keyframes jarvis-float { */
@keyframes mascot-float {
```

- [ ] **Step 4: Update .gitignore references**

In `.gitignore`, lines 42-44 reference old filenames. Remove them (they were alternative assets during development):

```
# Remove these lines:
login-jarvis-rotate.png
login-jarvis-y-rotate.png
login-with-jarvis.png
```

- [ ] **Step 5: Verify frontend builds**

Run: `cd src/web && bun run build`
Expected: Build succeeds with no missing import errors.

- [ ] **Step 6: Commit**

```bash
git add -A src/web/src/assets/ src/web/src/pages/login/ src/web/src/globals.css .gitignore
git commit -m "refactor(ui): rename jarvis assets to generic mascot"
```

### Task 1.6: Update Install Script

**Files:**
- Modify: `scripts/install.sh:61,334`

- [ ] **Step 1: Change default agent name**

```bash
# Line 61 — was: CFG_AGENT_NAME="Jarvis"
CFG_AGENT_NAME="Assistant"

# Line 334 (approximately) — was: ask "AI assistant name" "Jarvis" CFG_AGENT_NAME
ask "AI assistant name" "Assistant" CFG_AGENT_NAME
```

- [ ] **Step 2: Commit**

```bash
git add scripts/install.sh
git commit -m "refactor(install): use generic default agent name"
```

### Task 1.7: Fix Tests — Remove Hardcoded Agent Names

**Files:**
- Modify: `tests/e2e/system.test.ts:46`
- Modify: `tests/modules/prompt-wizard/integration.test.ts:15,22,81`

- [ ] **Step 1: Fix E2E system test**

In `tests/e2e/system.test.ts`, line 46:

```typescript
// was: expect(usernames).toContain('jarvis')
// Check that at least one agent user exists
const agentUsers = body.users.filter((u: any) => u.isAgent || u.is_agent)
expect(agentUsers.length).toBeGreaterThanOrEqual(1)
```

- [ ] **Step 2: Fix prompt-wizard integration test**

In `tests/modules/prompt-wizard/integration.test.ts`, replace all hardcoded 'jarvis' references with generic test IDs:

```typescript
// Line 15 — was: defaultAgentId: 'jarvis',
defaultAgentId: 'agent-test-1',

// Line 22 — was: id: 'jarvis', role: 'Personal AI Assistant',
id: 'agent-test-1', role: 'Personal AI Assistant',

// Line 81 — was: agentId: 'jarvis',
agentId: 'agent-test-1',

// Line 89 — keep 'reviewer' as-is (it's a test-local ID, not a hardcoded name)
```

- [ ] **Step 3: Run all tests**

Run: `bun test --run`
Expected: ALL tests pass.

- [ ] **Step 4: Grep verification — no more hardcoded names in src/**

Run: `grep -ri 'jarvis\|r2d2' src/ --include='*.ts' --include='*.tsx' --include='*.css' | grep -v node_modules | grep -v dist`
Expected: Zero results.

- [ ] **Step 5: Commit**

```bash
git add tests/
git commit -m "test: remove hardcoded agent names from test fixtures"
```

---

## Wave 2: Agent ↔ Project Connection (US-2)

### Task 2.1: Create Agent Resolver Service

**Files:**
- Create: `src/modules/agent/agent-resolver.ts`
- Create: `tests/modules/agent/agent-resolver.test.ts`

- [ ] **Step 1: Write failing test for agent resolution chain**

```typescript
// tests/modules/agent/agent-resolver.test.ts
import { describe, it, expect, vi } from 'vitest'
import { createAgentResolver } from '@modules/agent/agent-resolver'

describe('AgentResolver', () => {
  function makeResolver(overrides: any = {}) {
    return createAgentResolver({
      getAgent: overrides.getAgent ?? vi.fn().mockReturnValue(undefined),
      getProject: overrides.getProject ?? vi.fn().mockReturnValue(null),
      getProjectType: overrides.getProjectType ?? vi.fn().mockReturnValue(null),
      listPrimaryAgents: overrides.listPrimaryAgents ?? vi.fn().mockReturnValue([]),
    })
  }

  it('returns conversation-level agentId first', () => {
    const resolver = makeResolver({
      getAgent: vi.fn().mockReturnValue({ id: 'conv-agent' }),
    })
    const result = resolver.resolve({ agentId: 'conv-agent', projectId: null })
    expect(result).toBe('conv-agent')
  })

  it('falls back to project defaultAgentId', () => {
    const resolver = makeResolver({
      getProject: vi.fn().mockReturnValue({ defaultAgentId: 'proj-agent', typeId: null }),
      getAgent: vi.fn().mockReturnValue({ id: 'proj-agent' }),
    })
    const result = resolver.resolve({ agentId: null, projectId: 'p1' })
    expect(result).toBe('proj-agent')
  })

  it('falls back to projectType defaultAgentId', () => {
    const resolver = makeResolver({
      getProject: vi.fn().mockReturnValue({ defaultAgentId: null, typeId: 'type-1' }),
      getProjectType: vi.fn().mockReturnValue({ defaultAgentId: 'type-agent' }),
      getAgent: vi.fn().mockReturnValue({ id: 'type-agent' }),
    })
    const result = resolver.resolve({ agentId: null, projectId: 'p1' })
    expect(result).toBe('type-agent')
  })

  it('falls back to first enabled primary agent', () => {
    const resolver = makeResolver({
      getProject: vi.fn().mockReturnValue({ defaultAgentId: null, typeId: null }),
      listPrimaryAgents: vi.fn().mockReturnValue([{ id: 'primary-1', enabled: true }]),
    })
    const result = resolver.resolve({ agentId: null, projectId: 'p1' })
    expect(result).toBe('primary-1')
  })

  it('returns null when no agent found', () => {
    const resolver = makeResolver()
    const result = resolver.resolve({ agentId: null, projectId: null })
    expect(result).toBeNull()
  })
})
```

- [ ] **Step 2: Run test — verify it fails**

Run: `bun test tests/modules/agent/agent-resolver.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement agent resolver**

```typescript
// src/modules/agent/agent-resolver.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.

export interface AgentResolverDeps {
  getAgent: (id: string) => { id: string } | undefined
  getProject: (id: string) => { defaultAgentId: string | null; typeId: string | null } | null
  getProjectType: (id: string) => { defaultAgentId: string | null } | null
  listPrimaryAgents: () => { id: string; enabled: boolean }[]
}

export function createAgentResolver(deps: AgentResolverDeps) {
  return {
    /**
     * Resolve which agent should handle a conversation.
     * Priority: explicit agentId → project default → projectType default → first primary.
     */
    resolve(input: { agentId: string | null; projectId: string | null }): string | null {
      // 1. Explicit agent
      if (input.agentId) {
        const agent = deps.getAgent(input.agentId)
        if (agent) return agent.id
      }

      // 2. Project default
      if (input.projectId) {
        const project = deps.getProject(input.projectId)
        if (project?.defaultAgentId) {
          const agent = deps.getAgent(project.defaultAgentId)
          if (agent) return agent.id
        }

        // 3. ProjectType default
        if (project?.typeId) {
          const pt = deps.getProjectType(project.typeId)
          if (pt?.defaultAgentId) {
            const agent = deps.getAgent(pt.defaultAgentId)
            if (agent) return agent.id
          }
        }
      }

      // 4. First enabled primary agent
      const primaries = deps.listPrimaryAgents()
      const first = primaries.find(a => a.enabled)
      return first?.id ?? null
    },
  }
}
```

- [ ] **Step 4: Run test — verify it passes**

Run: `bun test tests/modules/agent/agent-resolver.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/modules/agent/agent-resolver.ts tests/modules/agent/agent-resolver.test.ts
git commit -m "feat(agent): add centralized agent resolver with fallback chain"
```

### Task 2.2: Wire Agent Resolver into Prompt Assembler

**Files:**
- Modify: `src/modules/prompt-wizard/assembler.ts:71`

- [ ] **Step 1: Replace inline resolution with resolver**

In `assembler.ts`, the agent resolution on line 71 is already equivalent to the resolver logic. Add an optional `agentResolver` dependency and use it when available:

Add to `AssemblerDeps` interface (around line 9):

```typescript
agentResolver?: { resolve(input: { agentId: string | null; projectId: string | null }): string | null }
```

Replace line 71:

```typescript
// was: const agentId = conversation.agentId ?? project?.defaultAgentId ?? projectType?.defaultAgentId ?? null
const agentId = deps.agentResolver
  ? deps.agentResolver.resolve({ agentId: conversation.agentId, projectId: conversation.projectId })
  : (conversation.agentId ?? project?.defaultAgentId ?? projectType?.defaultAgentId ?? null)
```

- [ ] **Step 2: Run existing prompt-wizard tests**

Run: `bun test tests/modules/prompt-wizard/`
Expected: PASS (the fallback path preserves existing behavior).

- [ ] **Step 3: Commit**

```bash
git add src/modules/prompt-wizard/assembler.ts
git commit -m "feat(prompt): wire agent resolver into prompt assembler"
```

### Task 2.3: Frontend — Agent Selector on Project Settings

**Files:**
- Modify: `src/web/src/pages/board/project-settings.tsx`

- [ ] **Step 1: Add agent selector dropdown to project settings**

Locate the project settings form. Add a `<Select>` component bound to `defaultAgentId`:

```tsx
// Add import
import { useQuery, useMutation } from '@tanstack/react-query'

// Inside the settings form, add:
const { data: agents } = useQuery({
  queryKey: ['agents'],
  queryFn: () => api.get('/api/v1/agents').then(r => r.json()),
})

// In the JSX form:
<div className="space-y-2">
  <Label htmlFor="defaultAgent">Default Agent</Label>
  <Select
    value={project.defaultAgentId ?? ''}
    onValueChange={(val) => updateProject({ defaultAgentId: val || null })}
  >
    <SelectTrigger>
      <SelectValue placeholder="Inherit from project type" />
    </SelectTrigger>
    <SelectContent>
      <SelectItem value="">Inherit from project type</SelectItem>
      {agents?.agents?.filter((a: any) => a.enabled).map((a: any) => (
        <SelectItem key={a.id} value={a.id}>{a.name} — {a.role}</SelectItem>
      ))}
    </SelectContent>
  </Select>
</div>
```

- [ ] **Step 2: Verify in browser**

Run dev server: `cd src/web && bun run dev`
Navigate to a project → Settings → verify agent dropdown appears and saves.

- [ ] **Step 3: Commit**

```bash
git add src/web/src/pages/board/project-settings.tsx
git commit -m "feat(ui): add default agent selector to project settings"
```

### Task 2.4: Frontend — Agent Chip on Conversation Header

**Files:**
- Modify: `src/web/src/pages/conversations/conversation-header.tsx`

- [ ] **Step 1: Add agent name/avatar chip to conversation header**

Add a small chip next to the conversation title showing the active agent. Use the existing conversation data which already has `agentId`:

```tsx
// Fetch agent details
const { data: agent } = useQuery({
  queryKey: ['agent', conversation?.agentId],
  queryFn: () => conversation?.agentId
    ? api.get(`/api/v1/agents/${conversation.agentId}`).then(r => r.json())
    : null,
  enabled: !!conversation?.agentId,
})

// In JSX, next to title:
{agent && (
  <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
    {agent.name}
  </span>
)}
```

- [ ] **Step 2: Test in browser**

Open a conversation → verify agent chip appears next to title.

- [ ] **Step 3: Commit**

```bash
git add src/web/src/pages/conversations/conversation-header.tsx
git commit -m "feat(ui): show active agent chip on conversation header"
```

---

## Wave 3: Agent Memory (US-3)

### Task 3.1: Add agent_id to Memory Schema

**Files:**
- Modify: `src/modules/memory/schema.ts`
- Create: `tests/modules/memory/agent-scoped.test.ts`

- [ ] **Step 1: Write failing test for agent-scoped memory**

```typescript
// tests/modules/memory/agent-scoped.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { createTestDb } from '../../helpers/test-db'
import { createMemoryTables } from '@modules/memory/schema'
import { createWorkingMemoryService } from '@modules/memory/tiers/working-memory'
import { createEpisodicMemoryService } from '@modules/memory/tiers/episodic-memory'

describe('Agent-scoped memory', () => {
  let db: any

  beforeEach(() => {
    db = createTestDb()
    createMemoryTables(db)
  })

  describe('Working memory', () => {
    it('isolates keys by agent prefix', () => {
      const wm = createWorkingMemoryService(db, { ttlHours: 24, maxTokensPerBlock: 500 })
      wm.set('agent-a:mood', 'happy')
      wm.set('agent-b:mood', 'focused')
      wm.set('shared:date', '2026-04-13')

      expect(wm.get('agent-a:mood')?.content).toBe('happy')
      expect(wm.get('agent-b:mood')?.content).toBe('focused')
      expect(wm.get('shared:date')?.content).toBe('2026-04-13')

      const agentAKeys = wm.listByPrefix('agent-a:')
      expect(agentAKeys.length).toBe(1)
      expect(agentAKeys[0].key).toBe('agent-a:mood')
    })
  })

  describe('Episodic memory', () => {
    it('filters by agent_id', () => {
      const em = createEpisodicMemoryService(db)
      em.create({ content: 'Agent A saw rain', sourceType: 'observation', agentId: 'agent-a' })
      em.create({ content: 'Agent B saw sun', sourceType: 'observation', agentId: 'agent-b' })
      em.create({ content: 'Shared fact', sourceType: 'system' }) // null agentId = shared

      const agentAMemories = em.list({ agentId: 'agent-a' })
      expect(agentAMemories.length).toBe(1)
      expect(agentAMemories[0].content).toBe('Agent A saw rain')

      // Shared memories visible to all
      const withShared = em.list({ agentId: 'agent-a', includeShared: true })
      expect(withShared.length).toBe(2)
    })
  })
})
```

- [ ] **Step 2: Run test — verify it fails**

Run: `bun test tests/modules/memory/agent-scoped.test.ts`
Expected: FAIL — `listByPrefix` doesn't exist, `agentId` param not supported.

- [ ] **Step 3: Add agent_id column migration to schema.ts**

In `src/modules/memory/schema.ts`, add after existing migrations (around line 20):

```typescript
// Migration: add agent_id to episodic_memories
try {
  db.run(sql`ALTER TABLE episodic_memories ADD COLUMN agent_id TEXT`)
} catch { /* column already exists */ }
db.run(sql`CREATE INDEX IF NOT EXISTS idx_episodic_agent ON episodic_memories(agent_id)`)

// Migration: add agent_id to archive_memories
try {
  db.run(sql`ALTER TABLE archive_memories ADD COLUMN agent_id TEXT`)
} catch { /* column already exists */ }
db.run(sql`CREATE INDEX IF NOT EXISTS idx_archive_agent ON archive_memories(agent_id)`)
```

Note: Working memory uses the key-prefix pattern (`agent-id:key`) instead of a separate column, since the PK is the `key` field.

- [ ] **Step 4: Add `listByPrefix` to working-memory.ts**

In `src/modules/memory/tiers/working-memory.ts`, add to the returned object (after the `delete` method, around line 58):

```typescript
listByPrefix(prefix: string): WorkingMemoryBlock[] {
  const rows = (db as any).all(
    sql`SELECT * FROM working_memory WHERE key LIKE ${prefix + '%'} AND expires_at > ${new Date().toISOString()}`
  ) as any[]
  return rows.map(rowToBlock)
},
```

- [ ] **Step 5: Add `agentId` to episodic-memory.ts create and list**

In `src/modules/memory/tiers/episodic-memory.ts`:

Update `CreateEpisodicInput` in `types.ts` (add `agentId?: string`).

Update `create()` method — add `agent_id` to INSERT:

```typescript
create(input: CreateEpisodicInput): EpisodicMemory {
  const id = generateId()
  const now = new Date().toISOString()
  const tags = input.tags ? JSON.stringify(input.tags) : null
  const validFrom = input.validFrom ?? now

  db.run(sql`INSERT INTO episodic_memories
    (id, content, source_type, source_id, salience, access_count, valid_from, valid_until, tags, agent_id, created_at, last_accessed_at)
    VALUES (${id}, ${input.content}, ${input.sourceType}, ${input.sourceId ?? null},
            1.0, 0, ${validFrom}, ${null}, ${tags}, ${input.agentId ?? null}, ${now}, ${now})`)

  return this.get(id)!
},
```

Update `list()` method — support `agentId` and `includeShared` filters:

```typescript
list(opts: { validOnly?: boolean; limit?: number; agentId?: string; includeShared?: boolean } = {}): EpisodicMemory[] {
  const limit = opts.limit ?? 50
  let where = opts.validOnly ? 'WHERE valid_until IS NULL' : 'WHERE 1=1'

  if (opts.agentId) {
    if (opts.includeShared) {
      where += ` AND (agent_id = '${opts.agentId}' OR agent_id IS NULL)`
    } else {
      where += ` AND agent_id = '${opts.agentId}'`
    }
  }

  const query = `SELECT * FROM episodic_memories ${where} ORDER BY salience DESC LIMIT ${limit}`
  return ((db as any).all(sql.raw(query)) as any[]).map(rowToMemory)
},
```

Update `rowToMemory` to include `agentId`:

```typescript
function rowToMemory(r: any): EpisodicMemory {
  return {
    // ... existing fields ...
    agentId: r.agent_id ?? null,
  }
}
```

- [ ] **Step 6: Update EpisodicMemory type**

In `src/modules/memory/types.ts`, add to `EpisodicMemory` interface:

```typescript
agentId?: string | null
```

And to `CreateEpisodicInput`:

```typescript
agentId?: string
```

- [ ] **Step 7: Run test — verify it passes**

Run: `bun test tests/modules/memory/agent-scoped.test.ts`
Expected: PASS

- [ ] **Step 8: Run full test suite**

Run: `bun test --run`
Expected: All tests pass — existing code doesn't pass `agentId` so gets global behavior (null).

- [ ] **Step 9: Commit**

```bash
git add src/modules/memory/ tests/modules/memory/agent-scoped.test.ts
git commit -m "feat(memory): add agent-scoped memory — agent_id on episodic/archive, prefix pattern on working"
```

### Task 3.2: Update Context Builder with Agent Awareness

**Files:**
- Modify: `src/modules/memory/context-builder-v2.ts:8-14`

- [ ] **Step 1: Add agentId to ContextAssemblyOptions**

```typescript
export interface ContextAssemblyOptions {
  conversationId: string
  agentId?: string              // NEW: scope memory queries to this agent
  includeAncestry: boolean
  includeSiblingDiscoveries: boolean
  maxTokenBudget: number
  strategy: 'balanced' | 'recency' | 'relevance' | 'minimal'
}
```

- [ ] **Step 2: Pass agentId through to memory queries**

In the `assemble()` method, update the episodic search (around line 101):

```typescript
const episodic = await memory.search?.(query, {
  tier: 'episodic',
  limit: 5,
  agentId: options.agentId,
  includeShared: true,
})
```

And working memory (around line 82):

```typescript
// If agentId is set, fetch agent-prefixed keys
const prefix = options.agentId ? `${options.agentId}:` : undefined
const working = prefix
  ? await memory.listByPrefix?.(prefix)
  : await memory.getWorkingMemory?.(options.conversationId)
```

- [ ] **Step 3: Run full test suite**

Run: `bun test --run`
Expected: PASS — `agentId` is optional, existing callers unaffected.

- [ ] **Step 4: Commit**

```bash
git add src/modules/memory/context-builder-v2.ts
git commit -m "feat(memory): agent-aware context builder — scopes queries by agentId"
```

### Task 3.3: Agent Memory API Endpoint

**Files:**
- Create: `src/modules/agent/routes-memory.ts`

- [ ] **Step 1: Create the endpoint**

```typescript
// src/modules/agent/routes-memory.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { Hono } from 'hono'

export function createAgentMemoryRoutes(
  app: Hono,
  deps: { episodicMemory: any; workingMemory: any },
) {
  app.get('/api/v1/agents/:id/memories', (c) => {
    const agentId = c.req.param('id')
    const tier = c.req.query('tier') ?? 'episodic'
    const limit = parseInt(c.req.query('limit') ?? '20', 10)

    if (tier === 'working') {
      const blocks = deps.workingMemory.listByPrefix(`${agentId}:`)
      return c.json({ memories: blocks, tier: 'working', agentId })
    }

    const memories = deps.episodicMemory.list({
      agentId,
      includeShared: false,
      limit,
    })
    return c.json({ memories, tier: 'episodic', agentId })
  })
}
```

- [ ] **Step 2: Wire into agent module startup (register routes in the module's onStart)**

This will be wired when the agent module's `onStart` calls `createAgentMemoryRoutes`.

- [ ] **Step 3: Commit**

```bash
git add src/modules/agent/routes-memory.ts
git commit -m "feat(agent): add GET /api/v1/agents/:id/memories endpoint"
```

### Task 3.4: Frontend — Agent Memories Tab

**Files:**
- Modify: `src/web/src/pages/agents/agent-detail.tsx`

- [ ] **Step 1: Add "Memories" tab to agent detail page**

```tsx
// In the Tabs component, add:
<TabsTrigger value="memories">Memories</TabsTrigger>

// Tab content:
<TabsContent value="memories">
  <AgentMemoriesPanel agentId={agent.id} />
</TabsContent>

// Component:
function AgentMemoriesPanel({ agentId }: { agentId: string }) {
  const { data } = useQuery({
    queryKey: ['agent-memories', agentId],
    queryFn: () => api.get(`/api/v1/agents/${agentId}/memories`).then(r => r.json()),
  })

  if (!data?.memories?.length) {
    return <p className="text-muted-foreground text-sm p-4">No memories yet.</p>
  }

  return (
    <div className="space-y-2 p-4">
      {data.memories.map((m: any) => (
        <div key={m.id ?? m.key} className="border rounded p-3 text-sm">
          <p>{m.content}</p>
          <p className="text-xs text-muted-foreground mt-1">
            {m.sourceType ?? 'working'} · {m.createdAt ?? m.updatedAt}
          </p>
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Verify in browser**

Navigate to an agent detail page → Memories tab should render.

- [ ] **Step 3: Commit**

```bash
git add src/web/src/pages/agents/agent-detail.tsx
git commit -m "feat(ui): add Memories tab to agent detail page"
```

---

## Wave 4: Agent ↔ Channel Binding (US-4)

### Task 4.1: Create Channel Config Service

**Files:**
- Create: `src/modules/communication/channel-config-service.ts`
- Modify: `src/modules/communication/index.ts`
- Create: `tests/modules/communication/channel-agent.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// tests/modules/communication/channel-agent.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { createTestDb } from '../../helpers/test-db'
import { createChannelConfigService } from '@modules/communication/channel-config-service'

describe('Channel config service', () => {
  let db: any, service: any

  beforeEach(() => {
    db = createTestDb()
    // Create channel_configs table
    db.run({ sql: `CREATE TABLE IF NOT EXISTS channel_configs (
      id TEXT PRIMARY KEY,
      channel_type TEXT NOT NULL,
      channel_id TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      agent_id TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      config TEXT DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`, params: [] })
    service = createChannelConfigService(db)
  })

  it('stores and retrieves channel-agent mapping', () => {
    service.upsert({ channelType: 'telegram', channelId: 'tg-123', name: 'Telegram', agentId: 'agent-a' })
    const config = service.getByChannelId('tg-123')
    expect(config?.agentId).toBe('agent-a')
  })

  it('returns null agentId for unmapped channel', () => {
    const config = service.getByChannelId('unknown')
    expect(config).toBeNull()
  })

  it('updates agent assignment', () => {
    service.upsert({ channelType: 'telegram', channelId: 'tg-123', name: 'Telegram', agentId: 'agent-a' })
    service.upsert({ channelType: 'telegram', channelId: 'tg-123', name: 'Telegram', agentId: 'agent-b' })
    const config = service.getByChannelId('tg-123')
    expect(config?.agentId).toBe('agent-b')
  })

  it('lists all configs', () => {
    service.upsert({ channelType: 'telegram', channelId: 'tg-1', name: 'Telegram', agentId: 'a1' })
    service.upsert({ channelType: 'slack', channelId: 'sl-1', name: 'Slack', agentId: 'a2' })
    expect(service.list().length).toBe(2)
  })
})
```

- [ ] **Step 2: Run test — verify it fails**

Run: `bun test tests/modules/communication/channel-agent.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement channel config service**

```typescript
// src/modules/communication/channel-config-service.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'
import { generateId } from '@shared/crypto.js'
import type { EyasDb } from '@core/types'

export interface ChannelConfig {
  id: string
  channelType: string
  channelId: string
  name: string
  agentId: string | null
  enabled: boolean
  config: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

function rowToConfig(r: any): ChannelConfig {
  return {
    id: r.id,
    channelType: r.channel_type,
    channelId: r.channel_id,
    name: r.name,
    agentId: r.agent_id ?? null,
    enabled: r.enabled === 1,
    config: r.config ? JSON.parse(r.config) : {},
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

export function createChannelConfigService(db: EyasDb) {
  return {
    upsert(input: { channelType: string; channelId: string; name: string; agentId?: string | null }) {
      const now = new Date().toISOString()
      const existing = this.getByChannelId(input.channelId)

      if (existing) {
        db.run(sql`UPDATE channel_configs SET
          agent_id = ${input.agentId ?? null},
          name = ${input.name},
          updated_at = ${now}
          WHERE channel_id = ${input.channelId}`)
      } else {
        const id = generateId()
        db.run(sql`INSERT INTO channel_configs
          (id, channel_type, channel_id, name, agent_id, enabled, config, created_at, updated_at)
          VALUES (${id}, ${input.channelType}, ${input.channelId}, ${input.name},
                  ${input.agentId ?? null}, 1, '{}', ${now}, ${now})`)
      }
    },

    getByChannelId(channelId: string): ChannelConfig | null {
      const rows = (db as any).all(
        sql`SELECT * FROM channel_configs WHERE channel_id = ${channelId}`
      ) as any[]
      return rows.length > 0 ? rowToConfig(rows[0]) : null
    },

    list(): ChannelConfig[] {
      const rows = (db as any).all(
        sql`SELECT * FROM channel_configs ORDER BY name ASC`
      ) as any[]
      return rows.map(rowToConfig)
    },

    updateAgent(channelId: string, agentId: string | null) {
      const now = new Date().toISOString()
      db.run(sql`UPDATE channel_configs SET agent_id = ${agentId}, updated_at = ${now}
        WHERE channel_id = ${channelId}`)
    },
  }
}
```

- [ ] **Step 4: Add table creation to communication module's onRegister**

In `src/modules/communication/index.ts`, add to `onRegister` (after mcp_servers table):

```typescript
ctx.db.run(sql`CREATE TABLE IF NOT EXISTS channel_configs (
  id TEXT PRIMARY KEY,
  channel_type TEXT NOT NULL,
  channel_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  agent_id TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  config TEXT DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
)`)
```

- [ ] **Step 5: Run test — verify it passes**

Run: `bun test tests/modules/communication/channel-agent.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/modules/communication/channel-config-service.ts src/modules/communication/index.ts tests/modules/communication/channel-agent.test.ts
git commit -m "feat(communication): add channel_configs table and service for agent↔channel binding"
```

### Task 4.2: Wire Channel Router to Resolve Agent from Config

**Files:**
- Modify: `src/modules/communication/channel-router.ts`

- [ ] **Step 1: Add agentId to ChannelMessage type**

In `src/modules/communication/types.ts`, add to `ChannelMessage`:

```typescript
resolvedAgentId?: string  // Set by router from channel config
```

- [ ] **Step 2: Enhance router to enrich messages with agentId**

In `channel-router.ts`, modify the `register` method's `onMessage` callback to look up the channel config:

The router needs access to the config service. Update `createChannelRouter` signature:

```typescript
export function createChannelRouter(
  logger: Logger,
  channelConfigService?: { getByChannelId(id: string): { agentId: string | null } | null },
) {
```

In the `register` method's onMessage handler:

```typescript
channel.onMessage(async (msg) => {
  // Enrich message with resolved agent
  if (channelConfigService) {
    const config = channelConfigService.getByChannelId(msg.channelId)
    if (config?.agentId) {
      msg.resolvedAgentId = config.agentId
    }
  }
  for (const handler of messageHandlers) {
    // ... existing code
  }
})
```

- [ ] **Step 3: Run full test suite**

Run: `bun test --run`
Expected: PASS — the `channelConfigService` param is optional.

- [ ] **Step 4: Commit**

```bash
git add src/modules/communication/channel-router.ts src/modules/communication/types.ts
git commit -m "feat(communication): router resolves agent from channel config on incoming messages"
```

### Task 4.3: Channel Config API and Settings UI

**Files:**
- Modify: `src/modules/communication/routes.ts`
- Modify: `src/web/src/pages/settings/communication-settings.tsx`

- [ ] **Step 1: Add API endpoints for channel configs**

```typescript
// In routes.ts, add:
app.get('/api/v1/channels', (c) => {
  const configs = channelConfigService.list()
  return c.json({ channels: configs })
})

app.patch('/api/v1/channels/:channelId', async (c) => {
  const channelId = c.req.param('channelId')
  const body = await c.req.json()
  channelConfigService.updateAgent(channelId, body.agentId ?? null)
  return c.json({ ok: true })
})
```

- [ ] **Step 2: Add agent selector to communication settings page**

In the settings UI, for each channel, show a dropdown to pick the responsible agent.

- [ ] **Step 3: Verify in browser**

- [ ] **Step 4: Commit**

```bash
git add src/modules/communication/routes.ts src/web/src/pages/settings/communication-settings.tsx
git commit -m "feat(communication): channel config API + agent selector in settings UI"
```

---

## Wave 5: Agent Directory & Delegation (US-5)

### Task 5.1: Agent Directory Service

**Files:**
- Create: `src/modules/agent/agent-directory.ts`
- Create: `tests/modules/agent/agent-directory.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// tests/modules/agent/agent-directory.test.ts
import { describe, it, expect, vi } from 'vitest'
import { createAgentDirectory } from '@modules/agent/agent-directory'

describe('AgentDirectory', () => {
  it('lists available agents with capability summaries', () => {
    const registry = {
      list: vi.fn().mockReturnValue([
        { id: 'a1', name: 'Assistant', role: 'Helper', capabilities: ['code', 'research'], enabled: true, tier: 'primary' },
        { id: 'a2', name: 'Engineer', role: 'Builder', capabilities: ['code', 'test'], enabled: true, tier: 'primary' },
        { id: 'a3', name: 'Disabled', role: 'X', capabilities: [], enabled: false, tier: 'specialist' },
      ]),
    }
    const directory = createAgentDirectory(registry as any)
    const available = directory.listAvailable()

    expect(available.length).toBe(2) // excludes disabled
    expect(available[0]).toEqual({
      id: 'a1', name: 'Assistant', role: 'Helper',
      capabilities: ['code', 'research'], tier: 'primary',
    })
  })

  it('can check if an agent can handle a capability', () => {
    const registry = {
      list: vi.fn().mockReturnValue([
        { id: 'a1', name: 'A', role: 'R', capabilities: ['code', 'research'], enabled: true, tier: 'primary' },
      ]),
    }
    const directory = createAgentDirectory(registry as any)
    expect(directory.findByCapability('research')).toEqual([
      { id: 'a1', name: 'A', role: 'R', capabilities: ['code', 'research'], tier: 'primary' },
    ])
    expect(directory.findByCapability('music')).toEqual([])
  })
})
```

- [ ] **Step 2: Run test — verify it fails**

Run: `bun test tests/modules/agent/agent-directory.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```typescript
// src/modules/agent/agent-directory.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { AgentRegistry } from './agent-registry.js'

export interface AgentSummary {
  id: string
  name: string
  role: string
  capabilities: string[]
  tier: string
}

export function createAgentDirectory(registry: AgentRegistry) {
  return {
    listAvailable(): AgentSummary[] {
      return registry.list({ enabled: true }).map(a => ({
        id: a.id, name: a.name, role: a.role,
        capabilities: a.capabilities, tier: a.tier,
      }))
    },

    findByCapability(capability: string): AgentSummary[] {
      return this.listAvailable().filter(a => a.capabilities.includes(capability))
    },

    /** Format as text for prompt injection */
    toPromptText(): string {
      const agents = this.listAvailable()
      if (agents.length === 0) return ''
      return agents.map(a =>
        `- ${a.name} (${a.id}): ${a.role} [${a.capabilities.join(', ')}]`
      ).join('\n')
    },
  }
}
```

- [ ] **Step 4: Run test — verify it passes**

Run: `bun test tests/modules/agent/agent-directory.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/modules/agent/agent-directory.ts tests/modules/agent/agent-directory.test.ts
git commit -m "feat(agent): add agent directory for capability discovery"
```

### Task 5.2: Delegation Protocol

**Files:**
- Create: `src/modules/agent/delegation.ts`
- Create: `tests/modules/agent/delegation.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// tests/modules/agent/delegation.test.ts
import { describe, it, expect, vi } from 'vitest'
import { createDelegationService } from '@modules/agent/delegation'

describe('Delegation', () => {
  it('rejects delegation beyond max depth', () => {
    const service = createDelegationService({
      maxDepth: 3,
      getAncestry: vi.fn().mockReturnValue([
        { agentId: 'a1' }, { agentId: 'a2' }, { agentId: 'a3' },
      ]),
      createChildConversation: vi.fn(),
      executeAgent: vi.fn(),
    })

    expect(() => service.validate('a4', 'conv-deep')).toThrow('Maximum delegation depth (3) exceeded')
  })

  it('rejects circular delegation', () => {
    const service = createDelegationService({
      maxDepth: 3,
      getAncestry: vi.fn().mockReturnValue([
        { agentId: 'a1' }, { agentId: 'a2' },
      ]),
      createChildConversation: vi.fn(),
      executeAgent: vi.fn(),
    })

    // Trying to delegate back to a1 which is already in the chain
    expect(() => service.validate('a1', 'conv-mid')).toThrow('Circular delegation detected')
  })

  it('allows valid delegation', () => {
    const service = createDelegationService({
      maxDepth: 3,
      getAncestry: vi.fn().mockReturnValue([
        { agentId: 'a1' },
      ]),
      createChildConversation: vi.fn(),
      executeAgent: vi.fn(),
    })

    expect(() => service.validate('a3', 'conv-1')).not.toThrow()
  })
})
```

- [ ] **Step 2: Run test — verify it fails**

Run: `bun test tests/modules/agent/delegation.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement delegation service**

```typescript
// src/modules/agent/delegation.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.

export interface DelegationDeps {
  maxDepth: number
  getAncestry: (conversationId: string) => { agentId: string | null }[]
  createChildConversation: (parentId: string, agentId: string, task: string) => string
  executeAgent: (conversationId: string, agentId: string) => Promise<string>
}

export function createDelegationService(deps: DelegationDeps) {
  return {
    /**
     * Validate that a delegation is safe (no cycles, within depth).
     * Throws if invalid.
     */
    validate(targetAgentId: string, conversationId: string): void {
      const ancestry = deps.getAncestry(conversationId)

      // Depth check
      if (ancestry.length >= deps.maxDepth) {
        throw new Error(`Maximum delegation depth (${deps.maxDepth}) exceeded`)
      }

      // Cycle check
      const agentChain = ancestry.map(c => c.agentId).filter(Boolean)
      if (agentChain.includes(targetAgentId)) {
        throw new Error(`Circular delegation detected: ${targetAgentId} is already in the chain`)
      }
    },

    /**
     * Delegate a task to another agent. Creates a child conversation,
     * executes the agent, and returns the summary.
     */
    async delegate(
      fromConversationId: string,
      targetAgentId: string,
      task: string,
    ): Promise<{ conversationId: string; result: string }> {
      this.validate(targetAgentId, fromConversationId)

      const childId = deps.createChildConversation(fromConversationId, targetAgentId, task)
      const result = await deps.executeAgent(childId, targetAgentId)

      return { conversationId: childId, result }
    },
  }
}
```

- [ ] **Step 4: Run test — verify it passes**

Run: `bun test tests/modules/agent/delegation.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/modules/agent/delegation.ts tests/modules/agent/delegation.test.ts
git commit -m "feat(agent): delegation protocol with cycle detection and max depth"
```

### Task 5.3: Delegate Tool for Agent Use

**Files:**
- Create: `src/modules/tools/builtin/delegate-tool.ts`

- [ ] **Step 1: Create the tool definition**

```typescript
// src/modules/tools/builtin/delegate-tool.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { ToolDefinition } from '../types.js'

export const delegateToAgentTool: ToolDefinition = {
  name: 'delegate_to_agent',
  description: 'Delegate a task to another agent. Use when a task requires expertise outside your capabilities.',
  parameters: {
    type: 'object',
    properties: {
      agentId: { type: 'string', description: 'ID of the target agent (from agent directory)' },
      task: { type: 'string', description: 'Clear description of the task to delegate' },
      context: { type: 'string', description: 'Relevant context the target agent needs' },
    },
    required: ['agentId', 'task'],
  },
  category: 'agent',
  requiresApproval: true,
}
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/tools/builtin/delegate-tool.ts
git commit -m "feat(tools): add delegate_to_agent tool definition"
```

### Task 5.4: Inject Agent Directory into Prompt

**Files:**
- Modify: `src/modules/prompt-wizard/assembler.ts`

- [ ] **Step 1: Add agentDirectory to AssemblerDeps**

```typescript
// Add to AssemblerDeps interface:
agentDirectory?: { toPromptText(): string }
```

- [ ] **Step 2: Inject directory into agent persona section**

In the `build()` method, after the agent persona section (after line 121):

```typescript
// Agent directory (for delegation-capable agents)
if (agent && deps.agentDirectory) {
  const capabilities = agent.capabilities ?? []
  if (capabilities.includes('delegation') || capabilities.includes('general')) {
    const directoryText = deps.agentDirectory.toPromptText()
    if (directoryText) {
      sections.push({
        name: 'available-agents',
        content: `You can delegate tasks to these agents using the delegate_to_agent tool:\n${directoryText}`,
        source: 'dynamic',
      })
    }
  }
}
```

- [ ] **Step 3: Add 'available-agents' to SECTION_ORDER**

```typescript
const SECTION_ORDER = [
  'system-identity', 'core-rules', 'personality', 'domain-context',
  'project-context', 'agent-persona', 'available-agents', 'task-instructions',
  'memory-context', 'relevant-skills', 'available-tools',
] as const
```

- [ ] **Step 4: Run tests**

Run: `bun test tests/modules/prompt-wizard/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/prompt-wizard/assembler.ts
git commit -m "feat(prompt): inject agent directory for delegation-capable agents"
```

### Task 5.5: Final — Full Test Suite Verification

- [ ] **Step 1: Run full test suite**

Run: `bun test --run`
Expected: ALL tests pass.

- [ ] **Step 2: Grep for remaining hardcoded names**

Run: `grep -ri 'jarvis\|r2d2' src/ tests/ scripts/ --include='*.ts' --include='*.tsx' --include='*.css' --include='*.sh' | grep -v node_modules | grep -v dist | grep -v '.yaml'`
Expected: Zero results (or only in docs/plans which are historical).

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "feat(agent): complete agent system overhaul — 5 waves

- US-1: Removed all hardcoded Jarvis/R2D2 names (88+ occurrences)
- US-2: Agent↔Project connection with resolver + UI selector
- US-3: Agent-scoped memory (episodic/archive/working)
- US-4: Channel↔Agent binding via channel_configs table
- US-5: Agent directory + delegation protocol with cycle detection"
```

---

## Dependency Graph

```
Wave 1 (US-1) ─── hardcoded names removal
   │
   ├──→ Wave 2 (US-2) ─── agent↔project UI
   │
   ├──→ Wave 3 (US-3) ─── agent memory
   │
   ├──→ Wave 4 (US-4) ─── agent↔channel
   │
   └──→ Wave 5 (US-5) ─── delegation (depends on Wave 3 for agent memory context)
```

Wave 1 must be first. Waves 2-4 are independent of each other and could run in parallel. Wave 5 benefits from Wave 3 (agent memory for delegation context) but is not strictly blocked.

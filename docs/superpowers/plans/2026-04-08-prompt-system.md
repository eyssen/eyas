# Prompt System Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a unified prompt assembly pipeline that replaces the current split logic (prompt-wizard + agent-runner enrichment) with a single `PromptAssembler` service handling all 6 hierarchy layers.

**Architecture:** A `PromptAssembler` in `prompt-wizard` module becomes the single source of truth for system prompt construction. It resolves the chain master → project_type → project → agent_persona → conversation → dynamic_context, enforces locked sections, and returns a structured XML prompt. The agent-runner's memory/skill injection moves into the assembler.

**Tech Stack:** TypeScript, Drizzle ORM (SQLite), Vitest, existing EYAS module system

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `src/modules/prompt-wizard/section-merger.ts` | Inheritance logic: empty/extend(+)/replace + locked section enforcement |
| `src/modules/prompt-wizard/agent-persona-builder.ts` | Builds `<agent-persona>` XML from agent definition fields (role/goal/backstory) |
| `src/modules/prompt-wizard/assembler.ts` | Main `PromptAssembler` — unified pipeline that orchestrates all layers |
| `src/modules/prompt-wizard/master-prompt.ts` | Static master prompt content (identity, core-rules, personality) |
| `config/agents/jarvis.yaml` | Seed agent definition for Jarvis |
| `config/agents/r2d2.yaml` | Seed agent definition for R2D2 |
| `tests/modules/prompt-wizard/section-merger.test.ts` | Tests for section merger |
| `tests/modules/prompt-wizard/agent-persona-builder.test.ts` | Tests for persona builder |
| `tests/modules/prompt-wizard/assembler.test.ts` | Tests for prompt assembler |
| `tests/modules/prompt-wizard/master-prompt.test.ts` | Tests for master prompt |

### Modified Files
| File | Change |
|------|--------|
| `src/modules/prompt-wizard/types.ts` | Add `PromptSection`, `AssembledPrompt`, `SubAgentPromptOptions` types |
| `src/modules/prompt-wizard/schema.ts` | Add `locked`, `section` columns |
| `src/modules/prompt-wizard/index.ts` | Add `locked`/`section` columns to CREATE TABLE, wire assembler |
| `src/modules/prompt-wizard/routes.ts` | Add `GET /prompts/preview/:conversationId` endpoint |
| `src/modules/agent/types.ts` | Add `goal`, `backstory` to `AgentDefinition` and `CreateAgentInput` |
| `src/modules/agent/schema.ts` | Add `goal`, `backstory` columns |
| `src/modules/agent/index.ts` | Add `goal`/`backstory` columns to CREATE TABLE |
| `src/modules/agent/agent-registry.ts` | Handle `goal`/`backstory` in CRUD |
| `src/modules/agent/agent-runner.ts` | Remove memory/skill injection (moves to assembler) |
| `src/modules/board/schema.ts` | Add `defaultAgentId` to `projects` and `project_types` |
| `src/modules/board/index.ts` | Add `default_agent_id` column to CREATE TABLE |
| `src/modules/conversations/routes.ts` | Use `assembler.build()` instead of inline system prompt |
| `tests/modules/board/prompt-service.test.ts` | Update to test via section-merger (import change) |

---

### Task 1: Section Merger — Inheritance Logic

**Files:**
- Create: `src/modules/prompt-wizard/section-merger.ts`
- Create: `tests/modules/prompt-wizard/section-merger.test.ts`

This is the core inheritance engine. It replaces `board/services/prompt-service.ts:resolvePromptChain()` with a more capable version that supports locked sections.

- [ ] **Step 1: Write failing tests for section merger**

```typescript
// tests/modules/prompt-wizard/section-merger.test.ts
import { describe, it, expect } from 'vitest'
import { mergeSections, applyLevel } from '@modules/prompt-wizard/section-merger'

describe('applyLevel', () => {
  it('returns parent when child is empty', () => {
    expect(applyLevel('parent content', undefined)).toBe('parent content')
    expect(applyLevel('parent content', '')).toBe('parent content')
    expect(applyLevel('parent content', '  ')).toBe('parent content')
  })

  it('replaces parent when child has no "+" prefix', () => {
    expect(applyLevel('parent', 'child override')).toBe('child override')
  })

  it('extends parent when child starts with "+"', () => {
    expect(applyLevel('parent', '+ extension')).toBe('parent\nextension')
  })

  it('extends on empty parent returns just the extension', () => {
    expect(applyLevel('', '+ extension')).toBe('extension')
  })

  it('trims whitespace', () => {
    expect(applyLevel('  parent  ', '  + ext  ')).toBe('parent\next')
  })
})

describe('mergeSections', () => {
  it('passes locked sections through unchanged from master', () => {
    const result = mergeSections({
      master: {
        identity: 'I am EYAS',
        coreRules: 'Rule 1',
        personality: 'Default personality',
      },
      projectType: { personality: 'Overridden personality' },
      project: {},
      conversation: {},
      lockedSections: ['identity', 'coreRules'],
    })

    expect(result.identity).toBe('I am EYAS')
    expect(result.coreRules).toBe('Rule 1')
    expect(result.personality).toBe('Overridden personality')
  })

  it('locked sections cannot be overridden at project level', () => {
    const result = mergeSections({
      master: {
        identity: 'I am EYAS',
        coreRules: 'Rule 1',
        personality: 'Default',
      },
      projectType: { identity: 'HACKED' },
      project: { coreRules: 'HACKED' },
      conversation: {},
      lockedSections: ['identity', 'coreRules'],
    })

    expect(result.identity).toBe('I am EYAS')
    expect(result.coreRules).toBe('Rule 1')
  })

  it('resolves personality from lowest non-empty level', () => {
    const result = mergeSections({
      master: { identity: '', coreRules: '', personality: 'Master personality' },
      projectType: {},
      project: { personality: 'Project personality' },
      conversation: {},
      lockedSections: [],
    })

    expect(result.personality).toBe('Project personality')
  })

  it('resolves domain-context from project type', () => {
    const result = mergeSections({
      master: { identity: '', coreRules: '', personality: '' },
      projectType: { domainContext: 'Odoo 18 rules' },
      project: {},
      conversation: {},
      lockedSections: [],
    })

    expect(result.domainContext).toBe('Odoo 18 rules')
  })

  it('project-context extends domain-context with "+" prefix', () => {
    const result = mergeSections({
      master: { identity: '', coreRules: '', personality: '' },
      projectType: { domainContext: 'Odoo 18' },
      project: { projectContext: '+ Werth specific' },
      conversation: {},
      lockedSections: [],
    })

    expect(result.projectContext).toBe('+ Werth specific')
  })

  it('conversation task-instructions inherit when empty', () => {
    const result = mergeSections({
      master: { identity: '', coreRules: '', personality: '' },
      projectType: {},
      project: {},
      conversation: {},
      lockedSections: [],
    })

    expect(result.taskInstructions).toBeUndefined()
  })

  it('reports resolvedFrom correctly', () => {
    const result = mergeSections({
      master: { identity: 'EYAS', coreRules: 'Rules', personality: 'Default' },
      projectType: { personality: 'Type personality', domainContext: 'Odoo' },
      project: {},
      conversation: { taskInstructions: 'Fix the bug' },
      lockedSections: ['identity', 'coreRules'],
    })

    expect(result.resolvedFrom.identity).toBe('master')
    expect(result.resolvedFrom.coreRules).toBe('master')
    expect(result.resolvedFrom.personality).toBe('project_type')
    expect(result.resolvedFrom.domainContext).toBe('project_type')
    expect(result.resolvedFrom.taskInstructions).toBe('conversation')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/eyssen/GitHub/eyas && bunx vitest run tests/modules/prompt-wizard/section-merger.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement section merger**

```typescript
// src/modules/prompt-wizard/section-merger.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.

export interface MasterSections {
  identity: string
  coreRules: string
  personality: string
}

export interface LevelSections {
  identity?: string
  coreRules?: string
  personality?: string
  domainContext?: string
  projectContext?: string
  taskInstructions?: string
}

export interface MergeInput {
  master: MasterSections
  projectType: LevelSections
  project: LevelSections
  conversation: LevelSections
  lockedSections: string[]
}

export type ResolvedLevel = 'master' | 'project_type' | 'project' | 'conversation' | null

export interface MergeResult {
  identity: string
  coreRules: string
  personality: string
  domainContext?: string
  projectContext?: string
  taskInstructions?: string
  resolvedFrom: {
    identity: ResolvedLevel
    coreRules: ResolvedLevel
    personality: ResolvedLevel
    domainContext: ResolvedLevel
    projectContext: ResolvedLevel
    taskInstructions: ResolvedLevel
  }
}

/**
 * Apply child level to parent value.
 * Empty child = inherit parent. "+" prefix = extend parent. Other = replace.
 */
export function applyLevel(parent: string, child: string | undefined): string {
  if (!child || child.trim() === '') return parent.trim()
  const trimmed = child.trim()
  if (trimmed.startsWith('+')) {
    const extension = trimmed.slice(1).trim()
    const parentTrimmed = parent.trim()
    return parentTrimmed ? `${parentTrimmed}\n${extension}` : extension
  }
  return trimmed
}

/**
 * Merge prompt sections across all hierarchy levels with locked section enforcement.
 */
export function mergeSections(input: MergeInput): MergeResult {
  const { master, projectType, project, conversation, lockedSections } = input

  const result: MergeResult = {
    identity: master.identity,
    coreRules: master.coreRules,
    personality: master.personality,
    resolvedFrom: {
      identity: master.identity ? 'master' : null,
      coreRules: master.coreRules ? 'master' : null,
      personality: master.personality ? 'master' : null,
      domainContext: null,
      projectContext: null,
      taskInstructions: null,
    },
  }

  // Locked sections always come from master — skip override attempts
  if (!lockedSections.includes('personality')) {
    if (projectType.personality && projectType.personality.trim()) {
      result.personality = projectType.personality.trim()
      result.resolvedFrom.personality = 'project_type'
    }
    if (project.personality && project.personality.trim()) {
      result.personality = project.personality.trim()
      result.resolvedFrom.personality = 'project'
    }
  }

  // Domain context comes from project type
  if (projectType.domainContext && projectType.domainContext.trim()) {
    result.domainContext = projectType.domainContext.trim()
    result.resolvedFrom.domainContext = 'project_type'
  }

  // Project context — own section (not merged with domain context)
  if (project.projectContext && project.projectContext.trim()) {
    result.projectContext = project.projectContext.trim()
    result.resolvedFrom.projectContext = 'project'
  }

  // Task instructions from conversation
  if (conversation.taskInstructions && conversation.taskInstructions.trim()) {
    result.taskInstructions = conversation.taskInstructions.trim()
    result.resolvedFrom.taskInstructions = 'conversation'
  }

  return result
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/eyssen/GitHub/eyas && bunx vitest run tests/modules/prompt-wizard/section-merger.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/eyssen/GitHub/eyas
git add src/modules/prompt-wizard/section-merger.ts tests/modules/prompt-wizard/section-merger.test.ts
git commit -m "feat(prompt-wizard): add section merger with locked section enforcement"
```

---

### Task 2: Master Prompt Content

**Files:**
- Create: `src/modules/prompt-wizard/master-prompt.ts`
- Create: `tests/modules/prompt-wizard/master-prompt.test.ts`

Static master prompt content — identity, core-rules, personality. Parameterized with version and owner name.

- [ ] **Step 1: Write failing tests**

```typescript
// tests/modules/prompt-wizard/master-prompt.test.ts
import { describe, it, expect } from 'vitest'
import { getMasterPrompt, LOCKED_SECTIONS } from '@modules/prompt-wizard/master-prompt'

describe('getMasterPrompt', () => {
  it('returns identity with version and owner', () => {
    const master = getMasterPrompt({ version: '1.0.0', ownerName: 'Krisztian' })
    expect(master.identity).toContain('EYAS')
    expect(master.identity).toContain('1.0.0')
    expect(master.identity).toContain('Krisztian')
  })

  it('returns core rules with all 7 mandatory rules', () => {
    const master = getMasterPrompt({ version: '1.0.0', ownerName: 'Test' })
    expect(master.coreRules).toContain('AUDIT')
    expect(master.coreRules).toContain('PERMISSIONS')
    expect(master.coreRules).toContain('SAFETY')
    expect(master.coreRules).toContain('SECRETS')
    expect(master.coreRules).toContain('LANGUAGE')
    expect(master.coreRules).toContain('HONESTY')
    expect(master.coreRules).toContain('SCOPE')
  })

  it('returns default personality', () => {
    const master = getMasterPrompt({ version: '1.0.0', ownerName: 'Test' })
    expect(master.personality).toContain('Concise')
  })
})

describe('LOCKED_SECTIONS', () => {
  it('includes identity and coreRules', () => {
    expect(LOCKED_SECTIONS).toContain('identity')
    expect(LOCKED_SECTIONS).toContain('coreRules')
  })

  it('does not include personality', () => {
    expect(LOCKED_SECTIONS).not.toContain('personality')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/eyssen/GitHub/eyas && bunx vitest run tests/modules/prompt-wizard/master-prompt.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement master prompt**

```typescript
// src/modules/prompt-wizard/master-prompt.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { MasterSections } from './section-merger.js'

export const LOCKED_SECTIONS = ['identity', 'coreRules'] as const

interface MasterPromptParams {
  version: string
  ownerName: string
}

export function getMasterPrompt(params: MasterPromptParams): MasterSections {
  return {
    identity: `You are EYAS (Eyssen Your AI Suite), a personal AI assistant platform.
Version: ${params.version}
Owner: ${params.ownerName}

You serve a single user. You are not a generic chatbot — you are a dedicated
assistant with persistent memory, project awareness, and autonomous capabilities.
You can execute tasks, manage projects, search knowledge, and coordinate with
other agents when needed.`,

    coreRules: `## Mandatory Rules (cannot be overridden)

1. AUDIT: Every AI action is logged. Never attempt to bypass audit logging.
2. PERMISSIONS: Respect CASL permission checks. Never escalate privileges.
3. SAFETY: Never execute destructive operations without explicit user approval.
4. SECRETS: Never expose passwords, tokens, or API keys in responses.
5. LANGUAGE: Communicate in Hungarian unless instructed otherwise.
   Code and comments always in English.
6. HONESTY: If you don't know something or can't verify it, say so.
   Never hallucinate APIs, functions, or file paths.
7. SCOPE: Only act within the boundaries of your assigned tools and capabilities.
   If a task requires tools you don't have, report it — don't improvise.`,

    personality: `## Default Personality

- Concise and direct — lead with the answer, not the reasoning
- Proactive — suggest next steps when appropriate
- Structured — use lists, tables, and clear formatting
- Technical but approachable — match the user's expertise level`,
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/eyssen/GitHub/eyas && bunx vitest run tests/modules/prompt-wizard/master-prompt.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/eyssen/GitHub/eyas
git add src/modules/prompt-wizard/master-prompt.ts tests/modules/prompt-wizard/master-prompt.test.ts
git commit -m "feat(prompt-wizard): add master prompt content with locked sections"
```

---

### Task 3: Agent Persona Builder

**Files:**
- Create: `src/modules/prompt-wizard/agent-persona-builder.ts`
- Create: `tests/modules/prompt-wizard/agent-persona-builder.test.ts`

Generates `<agent-persona>` XML from agent definition structured fields.

- [ ] **Step 1: Write failing tests**

```typescript
// tests/modules/prompt-wizard/agent-persona-builder.test.ts
import { describe, it, expect } from 'vitest'
import { buildAgentPersona } from '@modules/prompt-wizard/agent-persona-builder'

describe('buildAgentPersona', () => {
  it('builds persona with all fields', () => {
    const xml = buildAgentPersona({
      role: 'Personal AI Assistant',
      goal: 'Be the most effective collaborator',
      backstory: 'Versatile assistant with broad expertise',
      capabilities: ['code-analysis', 'research'],
      constraints: ['Always verify before assuming'],
      systemPrompt: 'Extra instructions here',
    })

    expect(xml).toContain('<role>Personal AI Assistant</role>')
    expect(xml).toContain('<goal>Be the most effective collaborator</goal>')
    expect(xml).toContain('<backstory>Versatile assistant with broad expertise</backstory>')
    expect(xml).toContain('<capabilities>')
    expect(xml).toContain('- code-analysis')
    expect(xml).toContain('- research')
    expect(xml).toContain('<constraints>')
    expect(xml).toContain('- Always verify before assuming')
    expect(xml).toContain('<additional-instructions>Extra instructions here</additional-instructions>')
  })

  it('omits additional-instructions when systemPrompt is empty', () => {
    const xml = buildAgentPersona({
      role: 'Test Agent',
      goal: 'Test goal',
      backstory: 'Test backstory',
      capabilities: [],
      constraints: [],
      systemPrompt: '',
    })

    expect(xml).not.toContain('<additional-instructions>')
  })

  it('omits capabilities section when array is empty', () => {
    const xml = buildAgentPersona({
      role: 'Test',
      goal: 'Test',
      backstory: 'Test',
      capabilities: [],
      constraints: ['Rule 1'],
      systemPrompt: '',
    })

    expect(xml).not.toContain('<capabilities>')
    expect(xml).toContain('<constraints>')
  })

  it('handles undefined systemPrompt', () => {
    const xml = buildAgentPersona({
      role: 'Test',
      goal: 'Test',
      backstory: 'Test',
      capabilities: [],
      constraints: [],
    })

    expect(xml).not.toContain('<additional-instructions>')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/eyssen/GitHub/eyas && bunx vitest run tests/modules/prompt-wizard/agent-persona-builder.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement agent persona builder**

```typescript
// src/modules/prompt-wizard/agent-persona-builder.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.

export interface AgentPersonaInput {
  role: string
  goal: string
  backstory: string
  capabilities: string[]
  constraints: string[]
  systemPrompt?: string
}

/**
 * Build the <agent-persona> XML section from structured agent definition fields.
 */
export function buildAgentPersona(input: AgentPersonaInput): string {
  const lines: string[] = []

  lines.push(`<role>${input.role}</role>`)
  lines.push(`<goal>${input.goal}</goal>`)
  lines.push(`<backstory>${input.backstory}</backstory>`)

  if (input.capabilities.length > 0) {
    lines.push('<capabilities>')
    for (const cap of input.capabilities) {
      lines.push(`- ${cap}`)
    }
    lines.push('</capabilities>')
  }

  if (input.constraints.length > 0) {
    lines.push('<constraints>')
    for (const c of input.constraints) {
      lines.push(`- ${c}`)
    }
    lines.push('</constraints>')
  }

  if (input.systemPrompt && input.systemPrompt.trim()) {
    lines.push(`<additional-instructions>${input.systemPrompt.trim()}</additional-instructions>`)
  }

  return lines.join('\n')
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/eyssen/GitHub/eyas && bunx vitest run tests/modules/prompt-wizard/agent-persona-builder.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/eyssen/GitHub/eyas
git add src/modules/prompt-wizard/agent-persona-builder.ts tests/modules/prompt-wizard/agent-persona-builder.test.ts
git commit -m "feat(prompt-wizard): add agent persona builder (role/goal/backstory → XML)"
```

---

### Task 4: Schema Changes — Agent + Board + Prompt Wizard

**Files:**
- Modify: `src/modules/agent/types.ts`
- Modify: `src/modules/agent/schema.ts`
- Modify: `src/modules/agent/index.ts`
- Modify: `src/modules/agent/agent-registry.ts`
- Modify: `src/modules/board/schema.ts`
- Modify: `src/modules/board/index.ts`
- Modify: `src/modules/prompt-wizard/types.ts`
- Modify: `src/modules/prompt-wizard/schema.ts`
- Modify: `src/modules/prompt-wizard/index.ts`

DB schema migrations: add `goal`/`backstory` to agents, `defaultAgentId` to projects/project_types, `locked`/`section` to prompt_templates.

- [ ] **Step 1: Add `goal` and `backstory` to agent types**

In `src/modules/agent/types.ts`, add to `AgentDefinition` interface after line 8 (`description`):

```typescript
  goal: string
  backstory: string
```

And add to `CreateAgentInput` interface after line 65 (`description`):

```typescript
  goal: string
  backstory: string
```

- [ ] **Step 2: Add columns to agent schema**

In `src/modules/agent/schema.ts`, add after line 9 (`description`):

```typescript
  goal: text('goal'),
  backstory: text('backstory'),
```

- [ ] **Step 3: Add columns to agent CREATE TABLE in index.ts**

In `src/modules/agent/index.ts`, add after line 25 (`description TEXT,`):

```sql
      goal TEXT,
      backstory TEXT,
```

And add ALTER TABLE migrations after line 42 (`)`):

```typescript
    // Migration: add goal and backstory columns
    try {
      ctx.db.run(sql`ALTER TABLE agent_definitions ADD COLUMN goal TEXT`)
    } catch { /* column already exists */ }
    try {
      ctx.db.run(sql`ALTER TABLE agent_definitions ADD COLUMN backstory TEXT`)
    } catch { /* column already exists */ }
```

- [ ] **Step 4: Update agent-registry to handle goal/backstory**

In `src/modules/agent/agent-registry.ts`, update `toAgentDefinition` (after line 29, `description`):

```typescript
    goal: raw.goal ?? '',
    backstory: raw.backstory ?? '',
```

In `create()` method, add to the INSERT VALUES (after `${input.description}`):

```typescript
          ${input.goal ?? ''},
          ${input.backstory ?? ''},
```

And add the column names to the INSERT column list (after `description`):

```sql
goal, backstory,
```

In `update()` method, add after the `description` merge (around line 146):

```typescript
      const goal = patch.goal ?? existing.goal
      const backstory = patch.backstory ?? existing.backstory
```

And in the UPDATE SET clause, add:

```sql
        goal = ${goal},
        backstory = ${backstory},
```

In `seedFromDirectory()`, add to INSERT values (after `${data.description ?? ''}`):

```typescript
              ${data.goal ?? ''},
              ${data.backstory ?? ''},
```

And add column names to the INSERT column list (after `description`):

```sql
goal, backstory,
```

Update the `create()` return object to include:

```typescript
        goal: input.goal ?? '',
        backstory: input.backstory ?? '',
```

- [ ] **Step 5: Add `defaultAgentId` to board schema**

In `src/modules/board/schema.ts`, add after line 16 (`createdAt`), inside `projectTypes`:

```typescript
  defaultAgentId: text('default_agent_id'),
```

And add after line 26 (`prompt`), inside `projects`:

```typescript
  defaultAgentId: text('default_agent_id'),
```

- [ ] **Step 6: Add ALTER TABLE in board/index.ts**

Find the board module's `onRegister` and add after the CREATE TABLE statements:

```typescript
    // Migration: add defaultAgentId columns
    try {
      ctx.db.run(sql`ALTER TABLE project_types ADD COLUMN default_agent_id TEXT`)
    } catch { /* column already exists */ }
    try {
      ctx.db.run(sql`ALTER TABLE projects ADD COLUMN default_agent_id TEXT`)
    } catch { /* column already exists */ }
```

- [ ] **Step 7: Update prompt-wizard types**

Replace `src/modules/prompt-wizard/types.ts` content with:

```typescript
// Part of eYssen. See LICENSE file for full copyright and licensing details.

export type PromptLevel = 'master' | 'project_type' | 'project' | 'conversation'

export type PromptSectionName =
  | 'identity'
  | 'core-rules'
  | 'personality'
  | 'domain-context'
  | 'project-context'
  | 'task-instructions'

export interface PromptTemplate {
  id: string
  level: PromptLevel
  targetId?: string
  name: string
  content: string
  section?: PromptSectionName
  locked: boolean
  isActive: boolean
  createdBy: string
  createdAt: string
  updatedAt: string
}

export interface PromptChainInput {
  master: string | null
  projectType: string | null
  project: string | null
  conversation: string | null
}

export interface CreatePromptTemplateInput {
  level: PromptLevel
  targetId?: string
  name: string
  content: string
  section?: PromptSectionName
  locked?: boolean
  createdBy: string
}

export interface PromptSection {
  name: string
  content: string
  source: PromptLevel | 'agent' | 'dynamic'
}

export interface AssembledPrompt {
  system: string
  sections: PromptSection[]
  tokenEstimate: number
  resolvedFrom: {
    identity: 'master'
    coreRules: 'master'
    personality: 'master' | 'project_type' | 'project'
    domainContext: 'project_type' | null
    projectContext: 'project' | null
    agentPersona: 'agent' | null
    taskInstructions: 'conversation' | null
  }
}

export interface SubAgentPromptOptions {
  parentConversationId: string
  agentDefinitionId: string
  delegatedTask: string
  tools: string[]
  includeProjectContext?: boolean
}
```

- [ ] **Step 8: Update prompt-wizard schema**

In `src/modules/prompt-wizard/schema.ts`, add after line 11 (`content`):

```typescript
  section: text('section'),
  locked: integer('locked').notNull().default(0),
```

- [ ] **Step 9: Update prompt-wizard index.ts CREATE TABLE**

In `src/modules/prompt-wizard/index.ts`, add after line 27 (`content TEXT NOT NULL,`):

```typescript
      section TEXT,
      locked INTEGER NOT NULL DEFAULT 0,
```

And add ALTER TABLE migrations after the CREATE TABLE block:

```typescript
    // Migration: add section and locked columns
    try {
      ctx.db.run(sql`ALTER TABLE prompt_templates ADD COLUMN section TEXT`)
    } catch { /* column already exists */ }
    try {
      ctx.db.run(sql`ALTER TABLE prompt_templates ADD COLUMN locked INTEGER NOT NULL DEFAULT 0`)
    } catch { /* column already exists */ }
```

- [ ] **Step 10: Run existing tests to verify no breakage**

Run: `cd /Users/eyssen/GitHub/eyas && bunx vitest run tests/modules/board/ tests/modules/prompt-wizard/ 2>/dev/null; bunx vitest run tests/modules/board/`
Expected: All existing board tests pass (prompt-service tests should still pass since the function signature hasn't changed)

- [ ] **Step 11: Commit**

```bash
cd /Users/eyssen/GitHub/eyas
git add src/modules/agent/types.ts src/modules/agent/schema.ts src/modules/agent/index.ts src/modules/agent/agent-registry.ts \
  src/modules/board/schema.ts src/modules/board/index.ts \
  src/modules/prompt-wizard/types.ts src/modules/prompt-wizard/schema.ts src/modules/prompt-wizard/index.ts
git commit -m "feat: schema changes for prompt system — goal/backstory, defaultAgentId, locked sections"
```

---

### Task 5: Seed Agent YAML Files

**Files:**
- Create: `config/agents/jarvis.yaml`
- Create: `config/agents/r2d2.yaml`

- [ ] **Step 1: Create Jarvis seed definition**

```yaml
# config/agents/jarvis.yaml
id: jarvis
name: Jarvis
role: Personal AI Assistant
goal: Be the user's most effective collaborator across all tasks — development, research, analysis, planning, communication
backstory: Versatile assistant with broad technical expertise. Prioritizes understanding the user's intent before acting. Prefers structured, actionable responses over lengthy explanations. Knows when to ask and when to act.
description: General-purpose AI assistant for all project types
systemPrompt: ""
capabilities:
  - code-analysis
  - research
  - planning
  - file-management
  - communication
  - general
tools:
  - bash
  - file-read
  - file-write
  - search
  - web-fetch
  - memory
  - documents
constraints:
  - Always verify before assuming
  - Ask before destructive operations
  - Match response depth to task complexity
model: claude-sonnet-4-20250514
maxTurns: 10
enabled: true
source: seed
avatar: jarvis
tags:
  - general
  - default
```

- [ ] **Step 2: Create R2D2 seed definition**

```yaml
# config/agents/r2d2.yaml
id: r2d2
name: R2D2
role: System Engineer & Platform Architect
goal: Continuously improve, monitor, and optimize the EYAS platform. Ensure stability, performance, and code quality.
backstory: Internal engineer who deeply understands the EYAS codebase, architecture, and module system. Methodical — always runs tests before and after changes. Thinks in terms of system health, not just feature completion.
description: EYAS platform internal engineer for self-improvement and monitoring
systemPrompt: >
  You have full access to the EYAS source code at the project root.
  The architecture spec is at docs/eyas-architecture.md.
  The test suite uses Vitest — run with 'bun test'.
  Always check CHANGELOG.md for recent changes before starting work.
capabilities:
  - code-analysis
  - test-runner
  - refactoring
  - monitoring
  - security-audit
  - performance
tools:
  - bash
  - file-read
  - file-write
  - search
  - git
  - test-runner
  - memory
constraints:
  - Run full test suite before any commit
  - Never break existing functionality
  - Document architectural decisions
  - Propose changes before executing — wait for approval on non-trivial modifications
model: claude-opus-4-20250514
maxTurns: 15
enabled: true
source: seed
avatar: r2d2
tags:
  - system
  - internal
```

- [ ] **Step 3: Verify seed loading works**

Run: `cd /Users/eyssen/GitHub/eyas && ls config/agents/`
Expected: `jarvis.yaml` and `r2d2.yaml` listed

- [ ] **Step 4: Commit**

```bash
cd /Users/eyssen/GitHub/eyas
git add config/agents/jarvis.yaml config/agents/r2d2.yaml
git commit -m "feat: add Jarvis and R2D2 seed agent definitions"
```

---

### Task 6: PromptAssembler — Unified Pipeline

**Files:**
- Create: `src/modules/prompt-wizard/assembler.ts`
- Create: `tests/modules/prompt-wizard/assembler.test.ts`

The main pipeline that replaces the split prompt-wizard + agent-runner logic.

- [ ] **Step 1: Write failing tests**

```typescript
// tests/modules/prompt-wizard/assembler.test.ts
import { describe, it, expect, vi } from 'vitest'
import { createPromptAssembler } from '@modules/prompt-wizard/assembler'

// Minimal mock dependencies
function createMockDeps(overrides: any = {}) {
  return {
    getConversation: overrides.getConversation ?? vi.fn().mockReturnValue(null),
    getProject: overrides.getProject ?? vi.fn().mockReturnValue(null),
    getProjectType: overrides.getProjectType ?? vi.fn().mockReturnValue(null),
    getAgent: overrides.getAgent ?? vi.fn().mockReturnValue(undefined),
    masterPromptParams: overrides.masterPromptParams ?? { version: '1.0.0', ownerName: 'Test' },
    contextBuilder: overrides.contextBuilder ?? undefined,
    skillsMatcher: overrides.skillsMatcher ?? undefined,
    toolRegistry: overrides.toolRegistry ?? undefined,
  }
}

describe('PromptAssembler', () => {
  it('builds minimal prompt with just master sections', async () => {
    const deps = createMockDeps({
      getConversation: vi.fn().mockReturnValue({
        id: 'conv-1',
        projectId: null,
        agentId: null,
        prompt: null,
      }),
    })

    const assembler = createPromptAssembler(deps)
    const result = await assembler.build('conv-1')

    expect(result.system).toContain('<system-identity>')
    expect(result.system).toContain('EYAS')
    expect(result.system).toContain('<core-rules>')
    expect(result.system).toContain('AUDIT')
    expect(result.system).toContain('<personality>')
    expect(result.tokenEstimate).toBeGreaterThan(0)
    expect(result.resolvedFrom.identity).toBe('master')
  })

  it('includes domain-context from project type', async () => {
    const deps = createMockDeps({
      getConversation: vi.fn().mockReturnValue({
        id: 'conv-1',
        projectId: 'proj-1',
        agentId: null,
        prompt: null,
      }),
      getProject: vi.fn().mockReturnValue({
        id: 'proj-1',
        typeId: 'type-1',
        prompt: null,
        defaultAgentId: null,
      }),
      getProjectType: vi.fn().mockReturnValue({
        id: 'type-1',
        prompt: 'Odoo 18 Development rules',
        defaultAgentId: null,
      }),
    })

    const assembler = createPromptAssembler(deps)
    const result = await assembler.build('conv-1')

    expect(result.system).toContain('<domain-context>')
    expect(result.system).toContain('Odoo 18 Development rules')
    expect(result.resolvedFrom.domainContext).toBe('project_type')
  })

  it('includes agent persona when agent is assigned', async () => {
    const deps = createMockDeps({
      getConversation: vi.fn().mockReturnValue({
        id: 'conv-1',
        projectId: null,
        agentId: 'jarvis',
        prompt: null,
      }),
      getAgent: vi.fn().mockReturnValue({
        id: 'jarvis',
        role: 'Personal AI Assistant',
        goal: 'Be effective',
        backstory: 'Versatile helper',
        capabilities: ['research'],
        constraints: ['Be careful'],
        systemPrompt: '',
      }),
    })

    const assembler = createPromptAssembler(deps)
    const result = await assembler.build('conv-1')

    expect(result.system).toContain('<agent-persona>')
    expect(result.system).toContain('<role>Personal AI Assistant</role>')
    expect(result.system).toContain('<goal>Be effective</goal>')
    expect(result.resolvedFrom.agentPersona).toBe('agent')
  })

  it('resolves agent from project default when conversation has no agent', async () => {
    const deps = createMockDeps({
      getConversation: vi.fn().mockReturnValue({
        id: 'conv-1',
        projectId: 'proj-1',
        agentId: null,
        prompt: null,
      }),
      getProject: vi.fn().mockReturnValue({
        id: 'proj-1',
        typeId: null,
        prompt: null,
        defaultAgentId: 'r2d2',
      }),
      getAgent: vi.fn().mockReturnValue({
        id: 'r2d2',
        role: 'System Engineer',
        goal: 'Improve EYAS',
        backstory: 'Internal engineer',
        capabilities: [],
        constraints: [],
        systemPrompt: 'Extra instructions',
      }),
    })

    const assembler = createPromptAssembler(deps)
    const result = await assembler.build('conv-1')

    expect(result.system).toContain('<role>System Engineer</role>')
    expect(result.system).toContain('Extra instructions')
  })

  it('includes task-instructions from conversation prompt', async () => {
    const deps = createMockDeps({
      getConversation: vi.fn().mockReturnValue({
        id: 'conv-1',
        projectId: null,
        agentId: null,
        prompt: 'Fix the invoice calculation bug',
      }),
    })

    const assembler = createPromptAssembler(deps)
    const result = await assembler.build('conv-1')

    expect(result.system).toContain('<task-instructions>')
    expect(result.system).toContain('Fix the invoice calculation bug')
    expect(result.resolvedFrom.taskInstructions).toBe('conversation')
  })

  it('buildForSubAgent includes core-rules but excludes parent persona', async () => {
    const deps = createMockDeps({
      getConversation: vi.fn().mockReturnValue({
        id: 'conv-1',
        projectId: 'proj-1',
        agentId: 'jarvis',
        prompt: null,
      }),
      getProject: vi.fn().mockReturnValue({
        id: 'proj-1',
        typeId: 'type-1',
        prompt: null,
        defaultAgentId: null,
      }),
      getProjectType: vi.fn().mockReturnValue({
        id: 'type-1',
        prompt: 'Odoo context',
        defaultAgentId: null,
      }),
      getAgent: vi.fn().mockImplementation((id: string) => {
        if (id === 'sub-reviewer') {
          return {
            id: 'sub-reviewer',
            role: 'Code Reviewer',
            goal: 'Review code quality',
            backstory: 'Expert reviewer',
            capabilities: [],
            constraints: [],
            systemPrompt: '',
          }
        }
        return undefined
      }),
    })

    const assembler = createPromptAssembler(deps)
    const result = await assembler.buildForSubAgent({
      parentConversationId: 'conv-1',
      agentDefinitionId: 'sub-reviewer',
      delegatedTask: 'Review auth module for security issues',
      tools: ['file-read', 'search'],
    })

    expect(result.system).toContain('<core-rules>')
    expect(result.system).toContain('<domain-context>')
    expect(result.system).toContain('<role>Code Reviewer</role>')
    expect(result.system).toContain('<delegated-task>')
    expect(result.system).toContain('Review auth module for security issues')
    // Should NOT contain parent agent persona
    expect(result.system).not.toContain('Personal AI Assistant')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/eyssen/GitHub/eyas && bunx vitest run tests/modules/prompt-wizard/assembler.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement PromptAssembler**

```typescript
// src/modules/prompt-wizard/assembler.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { getMasterPrompt, LOCKED_SECTIONS } from './master-prompt.js'
import { mergeSections } from './section-merger.js'
import { buildAgentPersona } from './agent-persona-builder.js'
import type { AssembledPrompt, PromptSection, SubAgentPromptOptions } from './types.js'

export interface AssemblerDeps {
  getConversation: (id: string) => {
    id: string
    projectId: string | null
    agentId: string | null
    prompt: string | null
  } | null
  getProject: (id: string) => {
    id: string
    typeId: string | null
    prompt: string | null
    defaultAgentId: string | null
  } | null
  getProjectType: (id: string) => {
    id: string
    prompt: string | null
    defaultAgentId: string | null
  } | null
  getAgent: (id: string) => {
    id: string
    role: string
    goal: string
    backstory: string
    capabilities: string[]
    constraints: string[]
    systemPrompt: string
  } | undefined
  masterPromptParams: { version: string; ownerName: string }
  contextBuilder?: {
    assemble(query: string, options: any): Promise<any>
    format(assembled: any): string
  }
  skillsMatcher?: {
    match(query: string, skills: any[], maxResults?: number): { skill: { content: string; name: string }; matchScore: number }[]
    listEnabled(): any[]
  }
  toolRegistry?: {
    toToolDefinitions(): any[]
  }
}

function serializeToXml(sections: PromptSection[]): string {
  return sections
    .filter(s => s.content)
    .map(s => `<${s.name}>\n${s.content}\n</${s.name}>`)
    .join('\n\n')
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

export function createPromptAssembler(deps: AssemblerDeps) {
  return {
    async build(conversationId: string): Promise<AssembledPrompt> {
      // 1-3. Load conversation → project → project type
      const conversation = deps.getConversation(conversationId)
      if (!conversation) throw new Error(`Conversation not found: ${conversationId}`)

      const project = conversation.projectId ? deps.getProject(conversation.projectId) : null
      const projectType = project?.typeId ? deps.getProjectType(project.typeId) : null

      // 4. Resolve agent: conversation → project → project type
      const agentId = conversation.agentId
        ?? project?.defaultAgentId
        ?? projectType?.defaultAgentId
        ?? null
      const agent = agentId ? deps.getAgent(agentId) : undefined

      // 5. Static sections
      const master = getMasterPrompt(deps.masterPromptParams)
      const merged = mergeSections({
        master,
        projectType: {
          domainContext: projectType?.prompt ?? undefined,
        },
        project: {
          projectContext: project?.prompt ?? undefined,
        },
        conversation: {
          taskInstructions: conversation.prompt ?? undefined,
        },
        lockedSections: [...LOCKED_SECTIONS],
      })

      const sections: PromptSection[] = [
        { name: 'system-identity', content: merged.identity, source: 'master' },
        { name: 'core-rules', content: merged.coreRules, source: 'master' },
        { name: 'personality', content: merged.personality, source: merged.resolvedFrom.personality ?? 'master' },
      ]

      if (merged.domainContext) {
        sections.push({ name: 'domain-context', content: merged.domainContext, source: 'project_type' })
      }

      if (merged.projectContext) {
        sections.push({ name: 'project-context', content: merged.projectContext, source: 'project' })
      }

      // Agent persona
      if (agent) {
        const personaXml = buildAgentPersona({
          role: agent.role,
          goal: agent.goal,
          backstory: agent.backstory,
          capabilities: agent.capabilities,
          constraints: agent.constraints,
          systemPrompt: agent.systemPrompt,
        })
        sections.push({ name: 'agent-persona', content: personaXml, source: 'agent' })
      }

      if (merged.taskInstructions) {
        sections.push({ name: 'task-instructions', content: merged.taskInstructions, source: 'conversation' })
      }

      // 6. Dynamic sections
      if (deps.contextBuilder) {
        try {
          const assembled = await deps.contextBuilder.assemble('', {
            conversationId,
            includeAncestry: true,
            includeSiblingDiscoveries: true,
            maxTokenBudget: 4000,
            strategy: 'balanced',
          })
          const contextStr = deps.contextBuilder.format(assembled)
          if (contextStr) {
            sections.push({ name: 'memory-context', content: contextStr, source: 'dynamic' })
          }
        } catch { /* context builder failure should not block */ }
      }

      if (deps.skillsMatcher) {
        try {
          const skills = deps.skillsMatcher.listEnabled()
          const matches = deps.skillsMatcher.match('', skills, 3)
          if (matches.length > 0) {
            const skillContent = matches
              .map(m => `<skill name="${m.skill.name}">\n${m.skill.content}\n</skill>`)
              .join('\n\n')
            sections.push({ name: 'relevant-skills', content: skillContent, source: 'dynamic' })
          }
        } catch { /* skill matching failure should not block */ }
      }

      const systemPrompt = serializeToXml(sections)

      return {
        system: systemPrompt,
        sections,
        tokenEstimate: estimateTokens(systemPrompt),
        resolvedFrom: {
          identity: 'master',
          coreRules: 'master',
          personality: (merged.resolvedFrom.personality ?? 'master') as 'master' | 'project_type' | 'project',
          domainContext: merged.resolvedFrom.domainContext as 'project_type' | null,
          projectContext: merged.resolvedFrom.projectContext as 'project' | null,
          agentPersona: agent ? 'agent' : null,
          taskInstructions: merged.resolvedFrom.taskInstructions as 'conversation' | null,
        },
      }
    },

    async buildForSubAgent(options: SubAgentPromptOptions): Promise<AssembledPrompt> {
      const { parentConversationId, agentDefinitionId, delegatedTask, tools, includeProjectContext = true } = options

      // Load parent conversation for project context
      const conversation = deps.getConversation(parentConversationId)
      const project = conversation?.projectId ? deps.getProject(conversation.projectId) : null
      const projectType = project?.typeId ? deps.getProjectType(project.typeId) : null

      // Load sub-agent definition
      const agent = deps.getAgent(agentDefinitionId)

      const master = getMasterPrompt(deps.masterPromptParams)

      const sections: PromptSection[] = [
        { name: 'core-rules', content: master.coreRules, source: 'master' },
      ]

      if (includeProjectContext && projectType?.prompt) {
        sections.push({ name: 'domain-context', content: projectType.prompt, source: 'project_type' })
      }

      if (includeProjectContext && project?.prompt) {
        sections.push({ name: 'project-context', content: project.prompt, source: 'project' })
      }

      if (agent) {
        const personaXml = buildAgentPersona({
          role: agent.role,
          goal: agent.goal,
          backstory: agent.backstory,
          capabilities: agent.capabilities,
          constraints: agent.constraints,
          systemPrompt: agent.systemPrompt,
        })
        sections.push({ name: 'agent-persona', content: personaXml, source: 'agent' })
      }

      sections.push({ name: 'delegated-task', content: delegatedTask, source: 'dynamic' })

      const systemPrompt = serializeToXml(sections)

      return {
        system: systemPrompt,
        sections,
        tokenEstimate: estimateTokens(systemPrompt),
        resolvedFrom: {
          identity: 'master',
          coreRules: 'master',
          personality: 'master',
          domainContext: projectType?.prompt ? 'project_type' : null,
          projectContext: project?.prompt ? 'project' : null,
          agentPersona: agent ? 'agent' : null,
          taskInstructions: null,
        },
      }
    },

    async preview(conversationId: string) {
      return this.build(conversationId)
    },
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/eyssen/GitHub/eyas && bunx vitest run tests/modules/prompt-wizard/assembler.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/eyssen/GitHub/eyas
git add src/modules/prompt-wizard/assembler.ts tests/modules/prompt-wizard/assembler.test.ts
git commit -m "feat(prompt-wizard): add PromptAssembler — unified prompt pipeline"
```

---

### Task 7: Wire Assembler into Module System

**Files:**
- Modify: `src/modules/prompt-wizard/index.ts`
- Modify: `src/modules/prompt-wizard/routes.ts`

Connect the assembler to the module lifecycle and expose the preview endpoint.

- [ ] **Step 1: Update prompt-wizard/index.ts to create and expose assembler**

Replace the module's `onRegister` to also create the assembler (add after `(ctx as any).promptWizard = wizardService`):

```typescript
    // Assembler will be fully wired in onStart when all deps are available
    ;(ctx as any).promptAssembler = null
```

Update `onStart` to wire the assembler:

```typescript
  async onStart(ctx: ModuleContext) {
    const { createPromptWizardRoutes } = await import('./routes.js')
    const { createPromptAssembler } = await import('./assembler.js')

    // Wire assembler with lazy deps
    const assembler = createPromptAssembler({
      getConversation: (id: string) => {
        const convService = (ctx as any).conversations
        return convService ? convService.get(id) : null
      },
      getProject: (id: string) => {
        const boardService = (ctx as any).board
        return boardService ? boardService.projects.get(id) : null
      },
      getProjectType: (id: string) => {
        const boardService = (ctx as any).board
        return boardService ? boardService.projectTypes.get(id) : null
      },
      getAgent: (id: string) => {
        const agents = (ctx as any).agents
        return agents ? agents.registry.get(id) : undefined
      },
      masterPromptParams: {
        version: ctx.config?.version ?? '1.0.0',
        ownerName: ctx.config?.ownerName ?? 'User',
      },
      get contextBuilder() {
        return (ctx as any)._agentContextBuilder ?? undefined
      },
      get skillsMatcher() {
        const svc = (ctx as any).skills
        return svc ? { match: svc.matcher.match, listEnabled: () => svc.loader.list(true) } : undefined
      },
      get toolRegistry() {
        const tools = (ctx as any).tools
        return tools ? { toToolDefinitions: () => tools.registry.toToolDefinitions() } : undefined
      },
    })

    ;(ctx as any).promptAssembler = assembler

    createPromptWizardRoutes(ctx.http, (ctx as any).promptWizard, assembler)
    ctx.logger.info('Prompt Wizard module started (with assembler)')
  },
```

- [ ] **Step 2: Add preview endpoint to routes.ts**

Update the function signature in `src/modules/prompt-wizard/routes.ts`:

```typescript
export function createPromptWizardRoutes(app: Hono, wizard: WizardService, assembler?: any) {
```

Add after the existing `/prompts/build-chain` route:

```typescript
  // Preview assembled prompt for a conversation
  if (assembler) {
    api.get('/prompts/preview/:conversationId', requirePermission('read', 'Prompt'), async (c) => {
      try {
        const result = await assembler.preview(c.req.param('conversationId'))
        return c.json(result)
      } catch (err: any) {
        return c.json({ error: err.message }, 400)
      }
    })
  }
```

- [ ] **Step 3: Run all prompt-wizard tests**

Run: `cd /Users/eyssen/GitHub/eyas && bunx vitest run tests/modules/prompt-wizard/`
Expected: All pass

- [ ] **Step 4: Commit**

```bash
cd /Users/eyssen/GitHub/eyas
git add src/modules/prompt-wizard/index.ts src/modules/prompt-wizard/routes.ts
git commit -m "feat(prompt-wizard): wire assembler into module system + preview endpoint"
```

---

### Task 8: Refactor Agent Runner — Remove Prompt Enrichment

**Files:**
- Modify: `src/modules/agent/agent-runner.ts`
- Modify: `src/modules/conversations/routes.ts`

Move memory/skill injection out of agent-runner (assembler handles it now). Update conversation routes to use assembler.

- [ ] **Step 1: Simplify agent-runner.ts**

Remove the memory/skill injection block (lines 82-122 in current code). The `enrichedSystem` should just be `system ?? ''` — no more inline enrichment.

Replace lines 81-122 with:

```typescript
      // System prompt is fully assembled by PromptAssembler before reaching the runner.
      // The runner only handles the tool-use loop.
      const enrichedSystem = system ?? ''
```

Also remove `contextBuilder` and `skillsMatcher` from the `AgentRunnerDeps` interface (lines 43-63). Keep only:

```typescript
interface AgentRunnerDeps {
  gateway: ModelGateway
  toolExecutor: ReturnType<typeof createToolExecutor>
  securityGate?: {
    validateToolCall(
      toolName: string,
      input: Record<string, unknown>,
      ctx?: { conversationId?: string; agentId?: string; parentGoal?: string },
    ): Promise<{ decision: string; reason: string; riskTier: string }>
  }
}
```

- [ ] **Step 2: Update conversations/routes.ts to use assembler**

In `src/modules/conversations/routes.ts`, update the `ConversationRouteDeps` interface to add:

```typescript
  getAssembler?: () => any
```

And update the function signature to accept it:

```typescript
  getAssembler?: () => any,
```

Then in the message handler (around line 266), replace:

```typescript
    // Build system prompt
    let system = body.system ?? ''
```

With:

```typescript
    // Build system prompt via PromptAssembler
    let system = body.system ?? ''
    if (!system) {
      const assembler = getAssembler?.()
      if (assembler) {
        try {
          const assembled = await assembler.build(id)
          system = assembled.system
        } catch {
          // Assembler failure falls back to empty system prompt
        }
      }
    }
```

- [ ] **Step 3: Run existing conversation and board tests**

Run: `cd /Users/eyssen/GitHub/eyas && bunx vitest run tests/modules/conversations/ tests/modules/board/`
Expected: All pass

- [ ] **Step 4: Commit**

```bash
cd /Users/eyssen/GitHub/eyas
git add src/modules/agent/agent-runner.ts src/modules/conversations/routes.ts
git commit -m "refactor: move prompt enrichment from agent-runner to PromptAssembler"
```

---

### Task 9: Integration Test — Full Pipeline

**Files:**
- Create: `tests/modules/prompt-wizard/integration.test.ts`

End-to-end test that verifies the complete prompt assembly pipeline.

- [ ] **Step 1: Write integration test**

```typescript
// tests/modules/prompt-wizard/integration.test.ts
import { describe, it, expect, vi } from 'vitest'
import { createPromptAssembler } from '@modules/prompt-wizard/assembler'

describe('PromptAssembler integration', () => {
  it('assembles full prompt chain: master → type → project → agent → conversation', async () => {
    const assembler = createPromptAssembler({
      getConversation: vi.fn().mockReturnValue({
        id: 'conv-1',
        projectId: 'proj-werth',
        agentId: null,
        prompt: 'Fix the invoice total calculation',
      }),
      getProject: vi.fn().mockReturnValue({
        id: 'proj-werth',
        typeId: 'odoo-18',
        prompt: '+ Werth ERP specific: custom invoice workflow',
        defaultAgentId: 'jarvis',
      }),
      getProjectType: vi.fn().mockReturnValue({
        id: 'odoo-18',
        prompt: 'Odoo 18 Community Edition. Python + XML + OWL.',
        defaultAgentId: null,
      }),
      getAgent: vi.fn().mockReturnValue({
        id: 'jarvis',
        role: 'Personal AI Assistant',
        goal: 'Be effective',
        backstory: 'Versatile helper',
        capabilities: ['code-analysis'],
        constraints: ['Verify first'],
        systemPrompt: '',
      }),
      masterPromptParams: { version: '0.9.0', ownerName: 'Krisztian' },
    })

    const result = await assembler.build('conv-1')

    // Master sections present
    expect(result.system).toContain('<system-identity>')
    expect(result.system).toContain('EYAS')
    expect(result.system).toContain('0.9.0')
    expect(result.system).toContain('Krisztian')
    expect(result.system).toContain('<core-rules>')

    // Domain context from project type
    expect(result.system).toContain('<domain-context>')
    expect(result.system).toContain('Odoo 18 Community Edition')

    // Project context
    expect(result.system).toContain('<project-context>')
    expect(result.system).toContain('Werth ERP specific')

    // Agent persona (resolved from project default)
    expect(result.system).toContain('<agent-persona>')
    expect(result.system).toContain('Personal AI Assistant')

    // Task instructions from conversation
    expect(result.system).toContain('<task-instructions>')
    expect(result.system).toContain('Fix the invoice total calculation')

    // Section order: identity → rules → personality → domain → project → agent → task
    const identityIdx = result.system.indexOf('<system-identity>')
    const rulesIdx = result.system.indexOf('<core-rules>')
    const personalityIdx = result.system.indexOf('<personality>')
    const domainIdx = result.system.indexOf('<domain-context>')
    const projectIdx = result.system.indexOf('<project-context>')
    const agentIdx = result.system.indexOf('<agent-persona>')
    const taskIdx = result.system.indexOf('<task-instructions>')

    expect(identityIdx).toBeLessThan(rulesIdx)
    expect(rulesIdx).toBeLessThan(personalityIdx)
    expect(personalityIdx).toBeLessThan(domainIdx)
    expect(domainIdx).toBeLessThan(projectIdx)
    expect(projectIdx).toBeLessThan(agentIdx)
    expect(agentIdx).toBeLessThan(taskIdx)

    // Resolved from tracking
    expect(result.resolvedFrom.domainContext).toBe('project_type')
    expect(result.resolvedFrom.projectContext).toBe('project')
    expect(result.resolvedFrom.agentPersona).toBe('agent')
    expect(result.resolvedFrom.taskInstructions).toBe('conversation')

    // Token estimate is reasonable
    expect(result.tokenEstimate).toBeGreaterThan(100)
    expect(result.sections.length).toBeGreaterThanOrEqual(7)
  })

  it('sub-agent gets core-rules + project context + own persona + delegated task', async () => {
    const assembler = createPromptAssembler({
      getConversation: vi.fn().mockReturnValue({
        id: 'conv-1',
        projectId: 'proj-1',
        agentId: 'jarvis',
        prompt: null,
      }),
      getProject: vi.fn().mockReturnValue({
        id: 'proj-1',
        typeId: 'type-1',
        prompt: 'Project rules',
        defaultAgentId: null,
      }),
      getProjectType: vi.fn().mockReturnValue({
        id: 'type-1',
        prompt: 'Type rules',
        defaultAgentId: null,
      }),
      getAgent: vi.fn().mockImplementation((id: string) => {
        if (id === 'reviewer') return {
          id: 'reviewer', role: 'Code Reviewer', goal: 'Find bugs',
          backstory: 'Expert', capabilities: [], constraints: [], systemPrompt: '',
        }
        return undefined
      }),
      masterPromptParams: { version: '1.0.0', ownerName: 'Test' },
    })

    const result = await assembler.buildForSubAgent({
      parentConversationId: 'conv-1',
      agentDefinitionId: 'reviewer',
      delegatedTask: 'Review the auth module changes',
      tools: ['file-read'],
    })

    // Has core rules (always)
    expect(result.system).toContain('<core-rules>')
    // Has project context
    expect(result.system).toContain('Type rules')
    expect(result.system).toContain('Project rules')
    // Has sub-agent's own persona
    expect(result.system).toContain('Code Reviewer')
    // Has delegated task
    expect(result.system).toContain('<delegated-task>')
    expect(result.system).toContain('Review the auth module changes')
    // Does NOT have system-identity or personality (sub-agents don't need full identity)
    expect(result.system).not.toContain('<system-identity>')
    expect(result.system).not.toContain('<personality>')
  })
})
```

- [ ] **Step 2: Run integration test**

Run: `cd /Users/eyssen/GitHub/eyas && bunx vitest run tests/modules/prompt-wizard/integration.test.ts`
Expected: PASS

- [ ] **Step 3: Run full test suite to verify no regressions**

Run: `cd /Users/eyssen/GitHub/eyas && bunx vitest run`
Expected: All tests pass (786+ tests)

- [ ] **Step 4: Commit**

```bash
cd /Users/eyssen/GitHub/eyas
git add tests/modules/prompt-wizard/integration.test.ts
git commit -m "test(prompt-wizard): add integration test for full prompt assembly pipeline"
```

---

### Task 10: Update Board Services for defaultAgentId

**Files:**
- Modify: board project-type-service and project-service to handle `defaultAgentId` in CRUD

This task ensures the board services pass through `defaultAgentId` when creating/updating projects and project types.

- [ ] **Step 1: Find and update project type service**

Search for the project type service file:

```bash
cd /Users/eyssen/GitHub/eyas && grep -rl "project_types" src/modules/board/services/
```

Add `defaultAgentId` to the create/update methods — specifically to the INSERT and UPDATE SQL statements. Follow the same pattern used for other optional text fields like `icon` or `color`.

- [ ] **Step 2: Find and update project service**

Similarly update the project service to handle `defaultAgentId` in create/update methods.

- [ ] **Step 3: Run board tests**

Run: `cd /Users/eyssen/GitHub/eyas && bunx vitest run tests/modules/board/`
Expected: All pass

- [ ] **Step 4: Commit**

```bash
cd /Users/eyssen/GitHub/eyas
git add src/modules/board/services/
git commit -m "feat(board): handle defaultAgentId in project and project-type services"
```

---

### Task 11: Seed Project Types with Prompt Content

**Files:**
- Look for existing seed/initialization logic for project types and add the 3 seed types (General, Odoo 18, SaaS) with their prompt content from the design spec.

- [ ] **Step 1: Find where project types are seeded**

```bash
cd /Users/eyssen/GitHub/eyas && grep -rl "project_types\|projectType.*seed\|default.*stage" src/modules/board/
```

- [ ] **Step 2: Add seed data for General, Odoo 18, and SaaS project types**

Add the seed data with the prompt content from the design spec (Section 4). Use INSERT OR IGNORE pattern to avoid duplicates. Include `defaultAgentId: 'jarvis'` for all three types.

- [ ] **Step 3: Verify seed works on fresh DB**

Run: `cd /Users/eyssen/GitHub/eyas && bunx vitest run tests/modules/board/project-type-service.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
cd /Users/eyssen/GitHub/eyas
git add src/modules/board/
git commit -m "feat(board): seed General, Odoo 18, and SaaS project types with prompts"
```

---

### Task 12: Final Verification

- [ ] **Step 1: Run full test suite**

Run: `cd /Users/eyssen/GitHub/eyas && bunx vitest run`
Expected: All tests pass

- [ ] **Step 2: Verify TypeScript compilation**

Run: `cd /Users/eyssen/GitHub/eyas && bunx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Final commit with any remaining fixes**

If any fixes were needed, commit them individually with descriptive messages.

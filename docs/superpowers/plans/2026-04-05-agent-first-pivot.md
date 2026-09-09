# EYAS Agent-First Pivot — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform EYAS from a project-management + chat application into an autonomous AI agent platform where Conversations are the central task lifecycle element — from simple one-shot questions to complex multi-agent, long-running workflows.

**Architecture:** Three-phase pivot building on the existing Conversation + Model foundation. Phase I adds tool execution and agent definitions. Phase II adds orchestration, budgets, and security. Phase III adds proactive autonomy, self-learning, and multi-channel communication. Each phase produces a working, testable system.

**Tech Stack:** Bun 1.x, TypeScript 5.9+, Hono, Drizzle ORM, SQLite (WAL), Vitest, React 19 + shadcn/ui

**Decisions locked in:**
- Conversation is the single central entity (no separate `tasks` table) — `mode` field determines behavior
- Sub-agents create child Conversations (`parentConversationId`) with summary view on parent
- Prompt Wizard is a special conversation (`mode: 'wizard'`) that produces prompts for target conversations
- Prompt hierarchy: Master → ProjectType → Project → Conversation (inherited downward)
- Native orchestrator (Ralph TUI-inspired but fully EYAS-native, not a wrapper)

**Key differentiators vs. simple pipeline orchestration (Ralph TUI-inspired enhancements):**
1. **Adaptive re-planning** — Product Owner agent re-evaluates remaining tasks after each phase; plan mutates based on discoveries
2. **Cross-agent context sharing** — Parent conversation working memory accessible to all children; agent broadcast for critical discoveries
3. **Per-task AI model routing** — Orchestrator selects optimal model per task type (Opus for architecture, Sonnet for boilerplate, Haiku for docs)
4. **Execution learning** — Self-learning tracks success rate per agent per task type, adjusts prompts/constraints over time
5. **Incremental validation** — Runtime Monitor watches agent execution in real-time; early intervention if agent drifts or wastes tokens
6. **Partial result persistence** — Every tool call saved mid-flight; sessions resumable from last checkpoint; partial results usable by other agents

---

## File Structure Overview

### Phase I — Agent Core (new + modified files)

```
src/modules/
  tools/                              # NEW MODULE: Tool Registry
    index.ts                          # Module definition + lifecycle
    schema.ts                         # tool_executions table
    types.ts                          # ToolDefinition, ToolExecutor, ToolContext interfaces
    tool-registry.ts                  # Registry: register/get/list tools
    tool-executor.ts                  # Execute tools with timeout, error handling
    builtin/                          # Built-in tool implementations
      memory-tools.ts                 # search_memory, save_memory, list_memories
      knowledge-tools.ts              # search_knowledge, get_page, create_page
      search-tools.ts                 # search_files, search_code, search_web
      document-tools.ts               # upload_document, list_documents, read_document
      board-tools.ts                  # create_project, move_stage, list_tasks
      shell-tools.ts                  # run_command (sandboxed)
      browser-tools.ts                # navigate, click, screenshot (Playwright)
      conversation-tools.ts           # create_sub_conversation, get_status
    routes.ts                         # API: list tools, execution history
  
  agent/                              # NEW MODULE: Agent Framework
    index.ts                          # Module definition + lifecycle
    schema.ts                         # agent_definitions, agent_sessions, agent_messages tables
    types.ts                          # AgentDefinition, AgentSession, AgentTask interfaces
    agent-registry.ts                 # CRUD + YAML seed + toggle + budget check
    agent-runner.ts                   # THE CORE: tool-use loop execution engine
    complexity-analyzer.ts            # Analyzes task complexity → simple/managed/autonomous
    routes.ts                         # API: agents CRUD, sessions, run agent
    frontend/
      pages/
        agents-page.tsx               # Agent definitions list + CRUD
        agent-detail-page.tsx         # Agent config, execution history, budget
      components/
        agent-card.tsx                # Agent card in lists
        agent-session-view.tsx        # Live session progress view
        complexity-badge.tsx          # Visual complexity indicator

  prompt-wizard/                      # NEW MODULE: Prompt Wizard
    index.ts                          # Module definition
    schema.ts                         # prompt_templates table
    types.ts                          # PromptLevel, PromptTemplate interfaces
    wizard-service.ts                 # Wizard conversation flow logic
    prompt-builder.ts                 # Assembles inherited prompt chain
    routes.ts                         # API: templates CRUD, start wizard, build prompt
    frontend/
      components/
        wizard-dialog.tsx             # Wizard launch dialog
        prompt-chain-view.tsx         # Shows inheritance: master → project → conversation

  conversations/                      # MODIFIED: Add agent lifecycle fields
    schema.ts                         # + mode, agentId, parentConversationId, goalDescription, complexity
    conversation-service.ts           # + getChildren, getAncestry, updateMode
    routes.ts                         # + agent execution endpoint, child listing
    frontend/
      conversation-page.tsx           # + agent progress panel, sub-conversation tree
      components/
        agent-progress.tsx            # Real-time agent execution view
        sub-conversation-tree.tsx     # Tree view of child conversations
        tool-call-display.tsx         # Rich tool call result rendering
        complexity-indicator.tsx      # Shows simple/managed/autonomous
```

### Phase II — Orchestration (new + modified files)

```
src/modules/
  agent/                              # EXTENDED
    orchestrator.ts                   # Team assembly, parallel execution, conflict resolution
    budget-engine.ts                  # Token budget tracking, throttling, monthly reset
    
  security-gate/                      # NEW MODULE
    index.ts
    schema.ts                         # security_events, rate_limits tables
    types.ts                          # RiskTier, SecurityCheckpoint interfaces
    deterministic-gate.ts             # Checkpoint 1: regex blocklist, attack patterns
    llm-judge.ts                      # Checkpoint 2: separate AI context security evaluation
    runtime-monitor.ts                # Checkpoint 3: real-time action monitoring
    routes.ts                         # API: security events, config
    
  context-builder/                    # NEW MODULE (or memory submodule)
    index.ts
    context-assembler.ts              # Selects, compresses, prioritizes memory for prompts
    strategy-registry.ts              # Different assembly strategies per task type
    
  scheduler/                          # NEW MODULE
    index.ts
    schema.ts                         # scheduled_jobs, job_executions tables
    types.ts                          # TriggerType, JobChain interfaces
    scheduler-service.ts              # Croner-based with extended triggers
    routes.ts                         # API: jobs CRUD, execution history
```

### Phase III — Autonomy (new + modified files)

```
src/modules/
  self-learning/                      # NEW MODULE
    index.ts
    activity-analyzer.ts              # Pattern detection from audit logs
    skill-generator.ts                # Proposes new skills from patterns
    efficiency-reporter.ts            # Token efficiency, cost/benefit analysis
    
  communication/                      # NEW MODULE
    index.ts
    types.ts                          # Channel, ChannelMessage, ChannelContent interfaces
    channel-router.ts                 # Message routing + broadcast
    submodules/
      telegram/                       # Grammy integration
      mcp-server/                     # EYAS as MCP server
      mcp-client/                     # Connect to external MCP servers
      
  proactive-assistant/                # NEW MODULE
    index.ts
    source-adapters.ts                # Pluggable source adapters (internal + external)
    lesson-learner.ts                 # Weekly analysis of closed conversations
    bot-executor.ts                   # Autonomous task processing on bot_listen stages
```

---

## Phase I: Agent Core

### Task 1: Conversation Schema Extension

**Files:**
- Modify: `src/modules/conversations/schema.ts`
- Modify: `src/modules/conversations/conversation-service.ts`
- Modify: `src/modules/conversations/index.ts`
- Test: `src/modules/conversations/__tests__/conversation-agent-fields.test.ts`

**What:** Add agent lifecycle fields to the existing conversation table. This is the foundation — every subsequent task depends on it.

- [ ] **Step 1: Write tests for new conversation fields**

```typescript
// src/modules/conversations/__tests__/conversation-agent-fields.test.ts
import { describe, it, expect, beforeAll } from 'vitest'
import { createTestContext } from '@core/test-utils'
import { createConversationService } from '../conversation-service.js'

describe('Conversation agent fields', () => {
  let service: ReturnType<typeof createConversationService>
  let ctx: Awaited<ReturnType<typeof createTestContext>>

  beforeAll(async () => {
    ctx = await createTestContext()
    service = createConversationService(ctx.db, ctx.bus)
  })

  it('creates conversation with mode=simple by default', () => {
    const conv = service.create({ userId: 'user-1', title: 'Test' })
    expect(conv.mode).toBe('simple')
    expect(conv.agentId).toBeNull()
    expect(conv.parentConversationId).toBeNull()
  })

  it('creates managed conversation with agent', () => {
    const conv = service.create({ userId: 'user-1', title: 'Complex task' })
    service.update(conv.id, { mode: 'managed', agentId: 'code-reviewer', goalDescription: 'Review PR #42' })
    const updated = service.get(conv.id)!
    expect(updated.mode).toBe('managed')
    expect(updated.agentId).toBe('code-reviewer')
    expect(updated.goalDescription).toBe('Review PR #42')
  })

  it('creates child conversation with parentConversationId', () => {
    const parent = service.create({ userId: 'user-1', title: 'Parent task' })
    const child = service.create({ userId: 'user-1', title: 'Sub-task 1' })
    service.update(child.id, { parentConversationId: parent.id })
    
    const children = service.getChildren(parent.id)
    expect(children).toHaveLength(1)
    expect(children[0].id).toBe(child.id)
  })

  it('builds ancestry chain', () => {
    const root = service.create({ userId: 'user-1', title: 'Root' })
    const mid = service.create({ userId: 'user-1', title: 'Mid' })
    service.update(mid.id, { parentConversationId: root.id })
    const leaf = service.create({ userId: 'user-1', title: 'Leaf' })
    service.update(leaf.id, { parentConversationId: mid.id })

    const ancestry = service.getAncestry(leaf.id)
    expect(ancestry.map(c => c.title)).toEqual(['Root', 'Mid', 'Leaf'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/eyssen/GitHub/eyas && bun test src/modules/conversations/__tests__/conversation-agent-fields.test.ts`
Expected: FAIL — new fields and methods don't exist yet

- [ ] **Step 3: Add new columns to schema.ts**

Add these columns to the `conversations` table in `src/modules/conversations/schema.ts`:

```typescript
// After existing columns, add:
mode: text('mode').notNull().default('simple'),             // 'simple' | 'managed' | 'autonomous' | 'wizard'
agentId: text('agent_id'),                                   // References agent_definitions(id)
parentConversationId: text('parent_conversation_id'),        // Self-reference for sub-conversations
goalDescription: text('goal_description'),                   // What this conversation aims to achieve
complexity: text('complexity'),                              // 'trivial' | 'simple' | 'moderate' | 'complex' | 'epic'
totalCostUsd: real('total_cost_usd').default(0),            // Cumulative cost across all messages
```

- [ ] **Step 4: Add migration in index.ts onRegister**

In `src/modules/conversations/index.ts`, add ALTER TABLE statements in `onRegister` (same try-catch pattern as existing migrations):

```typescript
// Agent lifecycle fields
const agentColumns = [
  `ALTER TABLE conversations ADD COLUMN mode TEXT NOT NULL DEFAULT 'simple'`,
  `ALTER TABLE conversations ADD COLUMN agent_id TEXT`,
  `ALTER TABLE conversations ADD COLUMN parent_conversation_id TEXT`,
  `ALTER TABLE conversations ADD COLUMN goal_description TEXT`,
  `ALTER TABLE conversations ADD COLUMN complexity TEXT`,
  `ALTER TABLE conversations ADD COLUMN total_cost_usd REAL DEFAULT 0`,
]
for (const ddl of agentColumns) {
  try { ctx.db.run(sql.raw(ddl)) } catch { /* already exists */ }
}

// Index for parent lookups
ctx.db.run(sql`CREATE INDEX IF NOT EXISTS idx_conv_parent ON conversations(parent_conversation_id)`)
ctx.db.run(sql`CREATE INDEX IF NOT EXISTS idx_conv_agent ON conversations(agent_id)`)
ctx.db.run(sql`CREATE INDEX IF NOT EXISTS idx_conv_mode ON conversations(mode)`)
```

- [ ] **Step 5: Extend conversation-service.ts**

Add to the service factory function:

```typescript
// Add to the return object:
getChildren(parentId: string): ConversationWithCount[] {
  const rows = db.select().from(conversations)
    .where(and(
      eq(conversations.parentConversationId, parentId),
      ne(conversations.status, 'deleted')
    ))
    .orderBy(conversations.position)
    .all()
  return rows.map(parseConversation)
},

getAncestry(conversationId: string): Conversation[] {
  const chain: Conversation[] = []
  let current = this.get(conversationId)
  while (current) {
    chain.unshift(current)  // prepend
    if (current.parentConversationId) {
      current = this.get(current.parentConversationId)
    } else {
      break
    }
  }
  return chain
},
```

Also update the `update` method to handle the new fields: `mode`, `agentId`, `parentConversationId`, `goalDescription`, `complexity`, `totalCostUsd`.

Update the `parseConversation` helper to include the new fields.

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd /Users/eyssen/GitHub/eyas && bun test src/modules/conversations/__tests__/conversation-agent-fields.test.ts`
Expected: ALL PASS

- [ ] **Step 7: Commit**

```bash
git add src/modules/conversations/
git commit -m "feat(conversations): add agent lifecycle fields — mode, agentId, parentConversationId, complexity"
```

---

### Task 2: Tool Registry Module — Types & Registry

**Files:**
- Create: `src/modules/tools/types.ts`
- Create: `src/modules/tools/tool-registry.ts`
- Test: `src/modules/tools/__tests__/tool-registry.test.ts`

**What:** Define the tool system interfaces and create the registry that tools register into. This is the "catalog" — what tools exist, what they can do, what parameters they accept.

- [ ] **Step 1: Write tests for tool registry**

```typescript
// src/modules/tools/__tests__/tool-registry.test.ts
import { describe, it, expect } from 'vitest'
import { createToolRegistry } from '../tool-registry.js'
import type { ToolImplementation } from '../types.js'

describe('ToolRegistry', () => {
  it('registers and retrieves a tool', () => {
    const registry = createToolRegistry()
    const tool: ToolImplementation = {
      name: 'search_memory',
      description: 'Search episodic and semantic memory',
      category: 'memory',
      riskTier: 'green',
      inputSchema: {
        type: 'object',
        properties: { query: { type: 'string', description: 'Search query' } },
        required: ['query'],
      },
      execute: async (input) => ({ results: [] }),
    }
    registry.register(tool)
    expect(registry.get('search_memory')).toBeDefined()
    expect(registry.get('search_memory')!.category).toBe('memory')
  })

  it('lists tools filtered by category', () => {
    const registry = createToolRegistry()
    registry.register({ name: 'tool_a', description: 'A', category: 'memory', riskTier: 'green', inputSchema: {}, execute: async () => ({}) })
    registry.register({ name: 'tool_b', description: 'B', category: 'search', riskTier: 'green', inputSchema: {}, execute: async () => ({}) })
    registry.register({ name: 'tool_c', description: 'C', category: 'memory', riskTier: 'yellow', inputSchema: {}, execute: async () => ({}) })

    expect(registry.list({ category: 'memory' })).toHaveLength(2)
    expect(registry.list({ category: 'search' })).toHaveLength(1)
    expect(registry.list()).toHaveLength(3)
  })

  it('converts to ToolDefinition array for model requests', () => {
    const registry = createToolRegistry()
    registry.register({ name: 'test_tool', description: 'Test', category: 'test', riskTier: 'green', inputSchema: { type: 'object', properties: {} }, execute: async () => ({}) })
    
    const defs = registry.toToolDefinitions()
    expect(defs).toHaveLength(1)
    expect(defs[0]).toEqual({
      name: 'test_tool',
      description: 'Test',
      inputSchema: { type: 'object', properties: {} },
    })
  })

  it('converts filtered subset to ToolDefinitions', () => {
    const registry = createToolRegistry()
    registry.register({ name: 'a', description: 'A', category: 'memory', riskTier: 'green', inputSchema: {}, execute: async () => ({}) })
    registry.register({ name: 'b', description: 'B', category: 'shell', riskTier: 'red', inputSchema: {}, execute: async () => ({}) })
    
    const defs = registry.toToolDefinitions(['a'])
    expect(defs).toHaveLength(1)
    expect(defs[0].name).toBe('a')
  })

  it('rejects duplicate tool names', () => {
    const registry = createToolRegistry()
    registry.register({ name: 'dup', description: 'First', category: 'test', riskTier: 'green', inputSchema: {}, execute: async () => ({}) })
    expect(() => registry.register({ name: 'dup', description: 'Second', category: 'test', riskTier: 'green', inputSchema: {}, execute: async () => ({}) }))
      .toThrow('Tool already registered: dup')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/eyssen/GitHub/eyas && bun test src/modules/tools/__tests__/tool-registry.test.ts`
Expected: FAIL — files don't exist

- [ ] **Step 3: Create types.ts**

```typescript
// src/modules/tools/types.ts
import type { ToolDefinition } from '@modules/model/types.js'

/** Risk tier for security gate classification */
export type RiskTier = 'green' | 'yellow' | 'red'

/** Tool categories for filtering and organization */
export type ToolCategory = 'memory' | 'knowledge' | 'search' | 'documents' | 'board' | 'shell' | 'browser' | 'conversation' | 'communication' | 'custom'

/** Context passed to tool executors */
export interface ToolContext {
  conversationId: string
  userId: string
  agentId?: string
  parentGoal?: string
  logger: import('pino').Logger
}

/** Result of a tool execution */
export interface ToolResult {
  [key: string]: unknown
}

/** A fully implemented tool with execution logic */
export interface ToolImplementation {
  name: string
  description: string
  category: ToolCategory
  riskTier: RiskTier
  inputSchema: Record<string, unknown>
  execute: (input: Record<string, unknown>, ctx?: ToolContext) => Promise<ToolResult>
  timeoutMs?: number       // Default: 30000
  requiresApproval?: boolean  // Force human approval regardless of risk tier
}

/** Filter options for listing tools */
export interface ToolFilter {
  category?: ToolCategory
  riskTier?: RiskTier
  names?: string[]
}
```

- [ ] **Step 4: Create tool-registry.ts**

```typescript
// src/modules/tools/tool-registry.ts
import type { ToolDefinition } from '@modules/model/types.js'
import type { ToolImplementation, ToolFilter } from './types.js'

export interface ToolRegistry {
  register(tool: ToolImplementation): void
  get(name: string): ToolImplementation | undefined
  list(filter?: ToolFilter): ToolImplementation[]
  toToolDefinitions(names?: string[]): ToolDefinition[]
  has(name: string): boolean
}

export function createToolRegistry(): ToolRegistry {
  const tools = new Map<string, ToolImplementation>()

  return {
    register(tool: ToolImplementation) {
      if (tools.has(tool.name)) {
        throw new Error(`Tool already registered: ${tool.name}`)
      }
      tools.set(tool.name, tool)
    },

    get(name: string) {
      return tools.get(name)
    },

    has(name: string) {
      return tools.has(name)
    },

    list(filter?: ToolFilter) {
      let result = Array.from(tools.values())
      if (filter?.category) result = result.filter(t => t.category === filter.category)
      if (filter?.riskTier) result = result.filter(t => t.riskTier === filter.riskTier)
      if (filter?.names) result = result.filter(t => filter.names!.includes(t.name))
      return result
    },

    toToolDefinitions(names?: string[]) {
      const subset = names ? this.list({ names }) : this.list()
      return subset.map(t => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      }))
    },
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd /Users/eyssen/GitHub/eyas && bun test src/modules/tools/__tests__/tool-registry.test.ts`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add src/modules/tools/
git commit -m "feat(tools): add tool registry — types, register, list, filter, toToolDefinitions"
```

---

### Task 3: Tool Executor

**Files:**
- Create: `src/modules/tools/tool-executor.ts`
- Create: `src/modules/tools/schema.ts`
- Test: `src/modules/tools/__tests__/tool-executor.test.ts`

**What:** The execution engine that runs tools with timeout protection, error handling, and execution logging. This sits between the agent runner and the tool implementations.

- [ ] **Step 1: Write tests for tool executor**

```typescript
// src/modules/tools/__tests__/tool-executor.test.ts
import { describe, it, expect, vi } from 'vitest'
import { createToolExecutor } from '../tool-executor.js'
import { createToolRegistry } from '../tool-registry.js'
import type { ToolImplementation, ToolContext } from '../types.js'

describe('ToolExecutor', () => {
  function setup() {
    const registry = createToolRegistry()
    const executions: any[] = []
    const executor = createToolExecutor(registry, {
      logExecution: (entry) => executions.push(entry),
    })
    return { registry, executor, executions }
  }

  it('executes a tool and returns result', async () => {
    const { registry, executor } = setup()
    registry.register({
      name: 'echo',
      description: 'Echo input',
      category: 'custom',
      riskTier: 'green',
      inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
      execute: async (input) => ({ echoed: input.text }),
    })

    const result = await executor.execute('echo', { text: 'hello' })
    expect(result.success).toBe(true)
    expect(result.output).toEqual({ echoed: 'hello' })
  })

  it('returns error for unknown tool', async () => {
    const { executor } = setup()
    const result = await executor.execute('nonexistent', {})
    expect(result.success).toBe(false)
    expect(result.error).toContain('Tool not found')
  })

  it('catches tool execution errors', async () => {
    const { registry, executor } = setup()
    registry.register({
      name: 'fail_tool',
      description: 'Always fails',
      category: 'custom',
      riskTier: 'green',
      inputSchema: {},
      execute: async () => { throw new Error('Boom') },
    })

    const result = await executor.execute('fail_tool', {})
    expect(result.success).toBe(false)
    expect(result.error).toContain('Boom')
  })

  it('enforces timeout', async () => {
    const { registry, executor } = setup()
    registry.register({
      name: 'slow_tool',
      description: 'Takes forever',
      category: 'custom',
      riskTier: 'green',
      inputSchema: {},
      timeoutMs: 50,
      execute: async () => {
        await new Promise(r => setTimeout(r, 5000))
        return { done: true }
      },
    })

    const result = await executor.execute('slow_tool', {})
    expect(result.success).toBe(false)
    expect(result.error).toContain('timed out')
  })

  it('logs execution details', async () => {
    const { registry, executor, executions } = setup()
    registry.register({
      name: 'logged_tool',
      description: 'Logged',
      category: 'custom',
      riskTier: 'green',
      inputSchema: {},
      execute: async () => ({ ok: true }),
    })

    await executor.execute('logged_tool', { input: 1 }, { conversationId: 'conv-1', userId: 'user-1', logger: console as any })
    expect(executions).toHaveLength(1)
    expect(executions[0].toolName).toBe('logged_tool')
    expect(executions[0].conversationId).toBe('conv-1')
    expect(executions[0].durationMs).toBeGreaterThanOrEqual(0)
    expect(executions[0].success).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/eyssen/GitHub/eyas && bun test src/modules/tools/__tests__/tool-executor.test.ts`
Expected: FAIL

- [ ] **Step 3: Create schema.ts**

```typescript
// src/modules/tools/schema.ts
import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core'

export const toolExecutions = sqliteTable('tool_executions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  conversationId: text('conversation_id'),
  agentId: text('agent_id'),
  toolName: text('tool_name').notNull(),
  input: text('input'),                     // JSON
  output: text('output'),                   // JSON
  error: text('error'),
  success: integer('success').notNull(),     // 0 or 1
  durationMs: integer('duration_ms').notNull(),
  createdAt: text('created_at').notNull(),
})
```

- [ ] **Step 4: Create tool-executor.ts**

```typescript
// src/modules/tools/tool-executor.ts
import type { ToolRegistry } from './tool-registry.js'
import type { ToolContext, ToolResult } from './types.js'

export interface ExecutionResult {
  success: boolean
  output?: ToolResult
  error?: string
  durationMs: number
}

export interface ExecutionLogEntry {
  toolName: string
  conversationId?: string
  agentId?: string
  input: Record<string, unknown>
  output?: ToolResult
  error?: string
  success: boolean
  durationMs: number
  timestamp: string
}

interface ExecutorOptions {
  logExecution?: (entry: ExecutionLogEntry) => void
  defaultTimeoutMs?: number
}

export function createToolExecutor(registry: ToolRegistry, options: ExecutorOptions = {}) {
  const defaultTimeout = options.defaultTimeoutMs ?? 30_000

  return {
    async execute(
      toolName: string,
      input: Record<string, unknown>,
      ctx?: ToolContext,
    ): Promise<ExecutionResult> {
      const start = Date.now()
      const tool = registry.get(toolName)

      if (!tool) {
        const result: ExecutionResult = { success: false, error: `Tool not found: ${toolName}`, durationMs: Date.now() - start }
        options.logExecution?.({ toolName, input, ...result, timestamp: new Date().toISOString(), conversationId: ctx?.conversationId, agentId: ctx?.agentId })
        return result
      }

      const timeout = tool.timeoutMs ?? defaultTimeout

      try {
        const output = await Promise.race([
          tool.execute(input, ctx),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`Tool '${toolName}' timed out after ${timeout}ms`)), timeout)
          ),
        ])

        const result: ExecutionResult = { success: true, output, durationMs: Date.now() - start }
        options.logExecution?.({ toolName, input, ...result, timestamp: new Date().toISOString(), conversationId: ctx?.conversationId, agentId: ctx?.agentId })
        return result
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err)
        const result: ExecutionResult = { success: false, error, durationMs: Date.now() - start }
        options.logExecution?.({ toolName, input, ...result, timestamp: new Date().toISOString(), conversationId: ctx?.conversationId, agentId: ctx?.agentId })
        return result
      }
    },
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd /Users/eyssen/GitHub/eyas && bun test src/modules/tools/__tests__/tool-executor.test.ts`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add src/modules/tools/
git commit -m "feat(tools): add tool executor — timeout, error handling, execution logging"
```

---

### Task 4: Built-in Tools — Memory & Search

**Files:**
- Create: `src/modules/tools/builtin/memory-tools.ts`
- Create: `src/modules/tools/builtin/search-tools.ts`
- Create: `src/modules/tools/builtin/knowledge-tools.ts`
- Test: `src/modules/tools/__tests__/builtin-tools.test.ts`

**What:** Wrap existing EYAS modules (memory, search, knowledge) as tools that agents can call. These are the first concrete tools — they prove the tool system works end-to-end.

- [ ] **Step 1: Write tests for memory tools**

```typescript
// src/modules/tools/__tests__/builtin-tools.test.ts
import { describe, it, expect } from 'vitest'
import { createMemoryTools } from '../builtin/memory-tools.js'
import { createSearchTools } from '../builtin/search-tools.js'
import { createKnowledgeTools } from '../builtin/knowledge-tools.js'

describe('Built-in tools', () => {
  describe('memory tools', () => {
    it('creates search_memory tool with correct schema', () => {
      const tools = createMemoryTools({} as any) // mock memory service
      const searchTool = tools.find(t => t.name === 'search_memory')
      expect(searchTool).toBeDefined()
      expect(searchTool!.category).toBe('memory')
      expect(searchTool!.riskTier).toBe('green')
      expect(searchTool!.inputSchema.required).toContain('query')
    })

    it('creates save_memory tool as yellow risk', () => {
      const tools = createMemoryTools({} as any)
      const saveTool = tools.find(t => t.name === 'save_memory')
      expect(saveTool).toBeDefined()
      expect(saveTool!.riskTier).toBe('yellow')
    })
  })

  describe('search tools', () => {
    it('creates search_indexed tool', () => {
      const tools = createSearchTools({} as any)
      const tool = tools.find(t => t.name === 'search_indexed')
      expect(tool).toBeDefined()
      expect(tool!.category).toBe('search')
    })
  })

  describe('knowledge tools', () => {
    it('creates search_knowledge and get_page tools', () => {
      const tools = createKnowledgeTools({} as any)
      expect(tools.find(t => t.name === 'search_knowledge')).toBeDefined()
      expect(tools.find(t => t.name === 'get_page')).toBeDefined()
      expect(tools.find(t => t.name === 'create_page')!.riskTier).toBe('yellow')
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/eyssen/GitHub/eyas && bun test src/modules/tools/__tests__/builtin-tools.test.ts`
Expected: FAIL

- [ ] **Step 3: Create memory-tools.ts**

```typescript
// src/modules/tools/builtin/memory-tools.ts
import type { ToolImplementation } from '../types.js'
import type { MemoryService } from '@modules/memory/memory-service.js'

export function createMemoryTools(memory: MemoryService): ToolImplementation[] {
  return [
    {
      name: 'search_memory',
      description: 'Search episodic and semantic memory. Returns relevant memories ranked by salience and recency.',
      category: 'memory',
      riskTier: 'green',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Natural language search query' },
          tier: { type: 'string', enum: ['episodic', 'vault', 'all'], description: 'Memory tier to search (default: all)' },
          limit: { type: 'number', description: 'Max results (default: 10)' },
        },
        required: ['query'],
      },
      execute: async (input) => {
        const results = await memory.search(input.query as string, {
          tier: (input.tier as string) || 'all',
          limit: (input.limit as number) || 10,
        })
        return { results }
      },
    },
    {
      name: 'save_memory',
      description: 'Save a fact or insight to episodic memory with a salience score.',
      category: 'memory',
      riskTier: 'yellow',
      inputSchema: {
        type: 'object',
        properties: {
          content: { type: 'string', description: 'The fact or insight to remember' },
          salience: { type: 'number', description: 'Importance 0-1 (default: 0.5)' },
          tags: { type: 'array', items: { type: 'string' }, description: 'Tags for categorization' },
        },
        required: ['content'],
      },
      execute: async (input) => {
        const id = await memory.saveEpisodic({
          content: input.content as string,
          salience: (input.salience as number) ?? 0.5,
          tags: (input.tags as string[]) ?? [],
        })
        return { id, saved: true }
      },
    },
  ]
}
```

- [ ] **Step 4: Create search-tools.ts**

```typescript
// src/modules/tools/builtin/search-tools.ts
import type { ToolImplementation } from '../types.js'
import type { SearchContext } from '@modules/search/types.js'

export function createSearchTools(search: SearchContext): ToolImplementation[] {
  return [
    {
      name: 'search_indexed',
      description: 'Full-text search across all indexed sources (files, documents, code). Returns matching chunks with file paths and line numbers.',
      category: 'search',
      riskTier: 'green',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          sourceId: { type: 'string', description: 'Limit to specific source' },
          language: { type: 'string', description: 'Filter by programming language' },
          limit: { type: 'number', description: 'Max results (default: 20)' },
        },
        required: ['query'],
      },
      execute: async (input) => {
        const results = await search.engine.search(input.query as string, {
          sourceId: input.sourceId as string,
          language: input.language as string,
          limit: (input.limit as number) || 20,
        })
        return { results }
      },
    },
  ]
}
```

- [ ] **Step 5: Create knowledge-tools.ts**

```typescript
// src/modules/tools/builtin/knowledge-tools.ts
import type { ToolImplementation } from '../types.js'
import type { KnowledgeService } from '@modules/knowledge/knowledge-service.js'

export function createKnowledgeTools(knowledge: KnowledgeService): ToolImplementation[] {
  return [
    {
      name: 'search_knowledge',
      description: 'Search the knowledge wiki for relevant pages. Returns page titles, summaries, and content.',
      category: 'knowledge',
      riskTier: 'green',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          spaceSlug: { type: 'string', description: 'Limit to specific space' },
        },
        required: ['query'],
      },
      execute: async (input) => {
        const pages = await knowledge.searchPages(input.query as string, input.spaceSlug as string)
        return { pages }
      },
    },
    {
      name: 'get_page',
      description: 'Get full content of a knowledge page by ID.',
      category: 'knowledge',
      riskTier: 'green',
      inputSchema: {
        type: 'object',
        properties: { pageId: { type: 'string', description: 'Page ID' } },
        required: ['pageId'],
      },
      execute: async (input) => {
        const page = await knowledge.getPage(input.pageId as string)
        return page ? { page } : { error: 'Page not found' }
      },
    },
    {
      name: 'create_page',
      description: 'Create a new page in the knowledge wiki.',
      category: 'knowledge',
      riskTier: 'yellow',
      inputSchema: {
        type: 'object',
        properties: {
          spaceId: { type: 'string', description: 'Space ID' },
          title: { type: 'string', description: 'Page title' },
          content: { type: 'string', description: 'Page content (HTML)' },
          parentId: { type: 'string', description: 'Parent page ID (optional)' },
        },
        required: ['spaceId', 'title', 'content'],
      },
      execute: async (input) => {
        const page = await knowledge.createPage({
          spaceId: input.spaceId as string,
          title: input.title as string,
          body: input.content as string,
          parentId: input.parentId as string,
          createdBy: 'agent',
        })
        return { pageId: page.id, created: true }
      },
    },
  ]
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd /Users/eyssen/GitHub/eyas && bun test src/modules/tools/__tests__/builtin-tools.test.ts`
Expected: ALL PASS

- [ ] **Step 7: Commit**

```bash
git add src/modules/tools/builtin/
git commit -m "feat(tools): add built-in tools — memory, search, knowledge wrappers"
```

---

### Task 5: Built-in Tools — Board, Documents, Shell, Browser, Conversation

**Files:**
- Create: `src/modules/tools/builtin/board-tools.ts`
- Create: `src/modules/tools/builtin/document-tools.ts`
- Create: `src/modules/tools/builtin/shell-tools.ts`
- Create: `src/modules/tools/builtin/browser-tools.ts`
- Create: `src/modules/tools/builtin/conversation-tools.ts`
- Test: `src/modules/tools/__tests__/builtin-tools-extended.test.ts`

**What:** Complete the built-in tool set. Shell and browser are `red` risk tier. Conversation tools allow agents to create sub-conversations.

- [ ] **Step 1: Write tests for remaining tools**

Tests should verify: correct names, descriptions, categories, risk tiers, input schemas, and that execute functions exist. Follow the same pattern as Task 4 Step 1.

Key tools to implement:

| Tool | Category | Risk | Purpose |
|------|----------|------|---------|
| `create_project` | board | yellow | Create a project |
| `list_conversations` | board | green | List conversations in a project |
| `move_to_stage` | board | yellow | Move conversation to a stage |
| `upload_document` | documents | yellow | Upload/attach a file |
| `list_documents` | documents | green | List linked documents |
| `read_document` | documents | green | Read document content |
| `run_command` | shell | red | Execute shell command (sandboxed) |
| `browser_navigate` | browser | red | Navigate to URL |
| `browser_screenshot` | browser | red | Take screenshot |
| `create_sub_conversation` | conversation | yellow | Create child conversation |
| `get_conversation_status` | conversation | green | Check sub-conversation status |

- [ ] **Step 2: Implement each tool file**

Each file follows the same factory pattern: exports a `create*Tools(service)` function returning `ToolImplementation[]`.

**shell-tools.ts** — critical security note:
```typescript
// Shell commands run in a restricted environment:
// - Working directory locked to project root
// - No network access (optional flag to allow)
// - Timeout: 60 seconds max
// - Command allowlist configurable
// - ALWAYS riskTier: 'red'
```

**browser-tools.ts** — uses Playwright:
```typescript
// Browser tools require playwright to be installed
// - URL allowlist from config
// - Max session duration: 5 minutes
// - Screenshots saved to documents module
// - ALWAYS riskTier: 'red'
```

**conversation-tools.ts** — for sub-agent creation:
```typescript
export function createConversationTools(conversationService: ConversationService): ToolImplementation[] {
  return [
    {
      name: 'create_sub_conversation',
      description: 'Create a child conversation for a sub-task. The sub-conversation inherits the parent goal context.',
      category: 'conversation',
      riskTier: 'yellow',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Sub-task title' },
          goalDescription: { type: 'string', description: 'What this sub-task should achieve' },
          agentId: { type: 'string', description: 'Agent to assign (optional)' },
          parentConversationId: { type: 'string', description: 'Parent conversation ID' },
        },
        required: ['title', 'goalDescription', 'parentConversationId'],
      },
      execute: async (input) => {
        const conv = conversationService.create({
          userId: 'system',
          title: input.title as string,
        })
        conversationService.update(conv.id, {
          goalDescription: input.goalDescription as string,
          parentConversationId: input.parentConversationId as string,
          agentId: input.agentId as string,
          mode: 'managed',
        })
        return { conversationId: conv.id, taskId: conv.taskId }
      },
    },
    {
      name: 'get_conversation_status',
      description: 'Check the status and progress of a conversation (useful for monitoring sub-tasks).',
      category: 'conversation',
      riskTier: 'green',
      inputSchema: {
        type: 'object',
        properties: {
          conversationId: { type: 'string', description: 'Conversation ID to check' },
        },
        required: ['conversationId'],
      },
      execute: async (input) => {
        const conv = conversationService.get(input.conversationId as string)
        if (!conv) return { error: 'Conversation not found' }
        return {
          status: conv.status,
          mode: conv.mode,
          messageCount: conv.messages.length,
          tokensUsed: conv.tokensUsed,
          lastMessage: conv.messages.at(-1)?.content?.slice(0, 200),
        }
      },
    },
  ]
}
```

- [ ] **Step 3: Run tests**

Run: `cd /Users/eyssen/GitHub/eyas && bun test src/modules/tools/__tests__/builtin-tools-extended.test.ts`
Expected: ALL PASS

- [ ] **Step 4: Commit**

```bash
git add src/modules/tools/builtin/
git commit -m "feat(tools): add built-in tools — board, documents, shell, browser, conversation"
```

---

### Task 6: Tools Module Index & Routes

**Files:**
- Create: `src/modules/tools/index.ts`
- Create: `src/modules/tools/routes.ts`
- Test: `src/modules/tools/__tests__/tools-module.test.ts`

**What:** Wire everything together — module lifecycle, tool registration from available services, API routes.

- [ ] **Step 1: Write integration tests**

Test that the module registers tools from available services and exposes them via API.

- [ ] **Step 2: Create index.ts**

```typescript
// src/modules/tools/index.ts
import type { EyasModule, ModuleContext } from '@core/types.js'
import { sql } from 'drizzle-orm'
import { createToolRegistry } from './tool-registry.js'
import { createToolExecutor } from './tool-executor.js'

export const toolsModule: EyasModule = {
  id: 'tools',
  name: 'Tool Registry',
  version: '1.0.0',
  type: 'core',
  required: false,
  description: 'Central tool registry and execution engine for agent tool use',
  dependencies: [],  // No hard dependencies — tools register lazily from available modules
  optional: ['memory', 'search', 'knowledge', 'board', 'documents', 'conversations'],

  async onRegister(ctx: ModuleContext) {
    // Create tool_executions table
    ctx.db.run(sql`CREATE TABLE IF NOT EXISTS tool_executions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id TEXT,
      agent_id TEXT,
      tool_name TEXT NOT NULL,
      input TEXT,
      output TEXT,
      error TEXT,
      success INTEGER NOT NULL,
      duration_ms INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`)
    ctx.db.run(sql`CREATE INDEX IF NOT EXISTS idx_tool_exec_conv ON tool_executions(conversation_id)`)
    ctx.db.run(sql`CREATE INDEX IF NOT EXISTS idx_tool_exec_agent ON tool_executions(agent_id)`)

    const registry = createToolRegistry()
    const executor = createToolExecutor(registry, {
      logExecution: (entry) => {
        ctx.db.run(sql`INSERT INTO tool_executions (conversation_id, agent_id, tool_name, input, output, error, success, duration_ms, created_at)
          VALUES (${entry.conversationId ?? null}, ${entry.agentId ?? null}, ${entry.toolName},
                  ${JSON.stringify(entry.input)}, ${entry.output ? JSON.stringify(entry.output) : null},
                  ${entry.error ?? null}, ${entry.success ? 1 : 0}, ${entry.durationMs}, ${entry.timestamp})`)
      },
    })

    // Register built-in tools from available modules
    const registerBuiltins = async () => {
      if (ctx.hasModule('memory')) {
        const { createMemoryTools } = await import('./builtin/memory-tools.js')
        for (const tool of createMemoryTools(ctx.memory)) registry.register(tool)
      }
      if (ctx.hasModule('search')) {
        const { createSearchTools } = await import('./builtin/search-tools.js')
        for (const tool of createSearchTools(ctx.search)) registry.register(tool)
      }
      if (ctx.hasModule('knowledge')) {
        const { createKnowledgeTools } = await import('./builtin/knowledge-tools.js')
        for (const tool of createKnowledgeTools(ctx.knowledge)) registry.register(tool)
      }
      if (ctx.hasModule('conversations')) {
        const { createConversationTools } = await import('./builtin/conversation-tools.js')
        for (const tool of createConversationTools(ctx.conversations)) registry.register(tool)
      }
      // Board and Documents tools follow same pattern
      ctx.logger.info(`Tools module: ${registry.list().length} tools registered`)
    }
    await registerBuiltins()

    ctx.tools = { registry, executor }
    ctx.logger.info('Tools module registered')
  },

  async onStart(ctx: ModuleContext) {
    const { createToolRoutes } = await import('./routes.js')
    createToolRoutes(ctx.http, ctx.tools.registry, ctx.tools.executor)
    ctx.logger.info('Tools module started')
  },

  async onStop() {},
}
```

- [ ] **Step 3: Create routes.ts**

```typescript
// src/modules/tools/routes.ts
import { Hono } from 'hono'
import type { ToolRegistry } from './tool-registry.js'
import type { createToolExecutor } from './tool-executor.js'

export function createToolRoutes(
  app: Hono,
  registry: ToolRegistry,
  executor: ReturnType<typeof createToolExecutor>,
) {
  const api = new Hono()

  // List all available tools
  api.get('/tools', (c) => {
    const category = c.req.query('category')
    const tools = registry.list(category ? { category: category as any } : undefined)
    return c.json({
      tools: tools.map(t => ({
        name: t.name,
        description: t.description,
        category: t.category,
        riskTier: t.riskTier,
        inputSchema: t.inputSchema,
        requiresApproval: t.requiresApproval ?? false,
      })),
    })
  })

  // Get single tool details
  api.get('/tools/:name', (c) => {
    const tool = registry.get(c.req.param('name'))
    if (!tool) return c.json({ error: 'Tool not found' }, 404)
    return c.json({
      name: tool.name,
      description: tool.description,
      category: tool.category,
      riskTier: tool.riskTier,
      inputSchema: tool.inputSchema,
    })
  })

  app.route('/api/v1', api)
}
```

- [ ] **Step 4: Run tests, commit**

```bash
git add src/modules/tools/
git commit -m "feat(tools): complete tools module — index, routes, built-in tool registration"
```

---

### Task 7: Agent Registry Module

**Files:**
- Create: `src/modules/agent/types.ts`
- Create: `src/modules/agent/schema.ts`
- Create: `src/modules/agent/agent-registry.ts`
- Test: `src/modules/agent/__tests__/agent-registry.test.ts`

**What:** Agent definitions — who agents are, what they can do, what tools they have, their budgets. Database-backed with YAML seed.

- [ ] **Step 1: Write tests**

```typescript
// src/modules/agent/__tests__/agent-registry.test.ts
import { describe, it, expect, beforeAll } from 'vitest'
import { createTestContext } from '@core/test-utils'
import { createAgentRegistry } from '../agent-registry.js'

describe('AgentRegistry', () => {
  let registry: ReturnType<typeof createAgentRegistry>

  beforeAll(async () => {
    const ctx = await createTestContext()
    registry = createAgentRegistry(ctx.db)
  })

  it('creates and retrieves an agent', () => {
    registry.create({
      id: 'test-agent',
      name: 'Test Agent',
      role: 'Tester',
      description: 'Runs tests',
      systemPrompt: 'You are a test runner.',
      capabilities: ['testing'],
      tools: ['run_command', 'search_indexed'],
      constraints: ['Max 5 minutes'],
      model: 'sonnet',
      maxTurns: 10,
      source: 'user',
      enabled: true,
      monthlyTokenBudget: 100000,
    })
    const agent = registry.get('test-agent')
    expect(agent).toBeDefined()
    expect(agent!.name).toBe('Test Agent')
    expect(agent!.tools).toContain('run_command')
  })

  it('lists only enabled agents', () => {
    registry.create({ id: 'disabled-agent', name: 'Disabled', role: '', description: '', systemPrompt: '', capabilities: [], tools: [], constraints: [], source: 'user', enabled: false })
    const enabled = registry.list({ enabled: true })
    expect(enabled.every(a => a.enabled)).toBe(true)
  })

  it('finds agents by capability', () => {
    const agents = registry.getByCapability('testing')
    expect(agents.length).toBeGreaterThanOrEqual(1)
    expect(agents[0].id).toBe('test-agent')
  })

  it('tracks token usage and budget', () => {
    registry.addTokenUsage('test-agent', 5000)
    expect(registry.isWithinBudget('test-agent')).toBe(true)
    registry.addTokenUsage('test-agent', 96000) // Total: 101000 > 100000
    expect(registry.isWithinBudget('test-agent')).toBe(false)
  })

  it('seeds from YAML directory', async () => {
    // Test with config/agents/ directory
    await registry.seedFromDirectory('/path/to/agents')
    // Seed agents should have source='seed' and not be deletable
  })

  it('prevents deletion of seed agents', () => {
    expect(() => registry.delete('seed-agent-id')).toThrow()
  })

  it('allows toggling agents', () => {
    registry.toggle('test-agent')
    expect(registry.get('test-agent')!.enabled).toBe(false)
    registry.toggle('test-agent')
    expect(registry.get('test-agent')!.enabled).toBe(true)
  })
})
```

- [ ] **Step 2: Create types.ts**

```typescript
// src/modules/agent/types.ts
export interface AgentDefinition {
  id: string
  name: string
  role: string
  description: string
  systemPrompt: string
  capabilities: string[]
  tools: string[]              // Tool names from ToolRegistry
  constraints: string[]
  model?: string               // Model preference (e.g., 'opus', 'sonnet')
  maxTurns?: number            // Max tool-use loop iterations
  enabled: boolean
  source: 'seed' | 'user'
  avatar?: string
  tags?: string[]
  monthlyTokenBudget?: number  // 0 = unlimited
  tokensUsedThisMonth?: number
  budgetResetAt?: string
  createdAt?: string
  updatedAt?: string
}

export interface AgentSession {
  id: string
  conversationId: string
  agentId: string
  status: 'running' | 'completed' | 'failed' | 'cancelled' | 'waiting_approval'
  turnsUsed: number
  tokensUsed: number
  costUsd: number
  toolCalls: AgentToolCall[]
  startedAt: string
  completedAt?: string
  error?: string
}

export interface AgentToolCall {
  toolName: string
  input: Record<string, unknown>
  output?: Record<string, unknown>
  error?: string
  durationMs: number
  timestamp: string
}

export interface AgentMessage {
  id: number
  sessionId: string
  fromAgent: string
  toAgent?: string            // null = broadcast
  content: string
  timestamp: string
}

export type ConversationMode = 'simple' | 'managed' | 'autonomous' | 'wizard'
export type ConversationComplexity = 'trivial' | 'simple' | 'moderate' | 'complex' | 'epic'
```

- [ ] **Step 3: Create schema.ts**

```typescript
// src/modules/agent/schema.ts
import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core'

export const agentDefinitions = sqliteTable('agent_definitions', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  role: text('role'),
  description: text('description'),
  systemPrompt: text('system_prompt'),
  capabilities: text('capabilities'),    // JSON array
  tools: text('tools'),                  // JSON array
  constraints: text('constraints'),      // JSON array
  model: text('model'),
  maxTurns: integer('max_turns'),
  enabled: integer('enabled').notNull().default(1),
  source: text('source').notNull().default('seed'),
  avatar: text('avatar'),
  tags: text('tags'),                    // JSON array
  monthlyTokenBudget: integer('monthly_token_budget').default(0),
  tokensUsedMonth: integer('tokens_used_month').default(0),
  budgetResetAt: text('budget_reset_at'),
  config: text('config'),               // JSON extra config
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const agentSessions = sqliteTable('agent_sessions', {
  id: text('id').primaryKey(),
  conversationId: text('conversation_id').notNull(),
  agentId: text('agent_id').notNull(),
  status: text('status').notNull().default('running'),
  turnsUsed: integer('turns_used').default(0),
  tokensUsed: integer('tokens_used').default(0),
  costUsd: real('cost_usd').default(0),
  toolCalls: text('tool_calls'),         // JSON array
  error: text('error'),
  startedAt: text('started_at').notNull(),
  completedAt: text('completed_at'),
})

export const agentMessages = sqliteTable('agent_messages', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  sessionId: text('session_id').notNull(),
  fromAgent: text('from_agent').notNull(),
  toAgent: text('to_agent'),
  content: text('content').notNull(),
  createdAt: text('created_at').notNull(),
})
```

- [ ] **Step 4: Create agent-registry.ts**

Implements the full `AgentRegistry` interface from the architecture spec: `seedFromDirectory`, `get`, `list`, `getByCapability`, `create`, `update`, `delete`, `toggle`, `addTokenUsage`, `isWithinBudget`.

The `seedFromDirectory` method reads `config/agents/*.yaml` files, parses them, and does `INSERT OR IGNORE` into the database.

- [ ] **Step 5: Run tests, commit**

```bash
git add src/modules/agent/
git commit -m "feat(agent): add agent registry — definitions, sessions, YAML seed, budget tracking"
```

---

### Task 8: Agent Runner — The Core Tool-Use Loop

**Files:**
- Create: `src/modules/agent/agent-runner.ts`
- Create: `src/modules/agent/complexity-analyzer.ts`
- Test: `src/modules/agent/__tests__/agent-runner.test.ts`

**What:** THIS IS THE HEART OF THE SYSTEM. The agent runner takes a conversation, an agent definition, and executes the tool-use loop: send to model → get tool_use → execute tool → send tool_result → repeat until done or maxTurns.

**Enhancement: Partial result persistence** — Every tool call is persisted to the conversation mid-flight. If the agent crashes, times out, or is cancelled, the session is resumable from the last completed tool call. Partial results (e.g., 3 out of 5 files reviewed) are usable by other agents.

**Enhancement: Cross-agent context sharing** — The runner injects the parent conversation's working memory and goal ancestry into each model request. If the agent discovers something important (high-salience memory), it saves it to the parent's working memory where sibling agents can see it.

- [ ] **Step 1: Write tests for agent runner**

```typescript
// src/modules/agent/__tests__/agent-runner.test.ts
import { describe, it, expect, vi } from 'vitest'
import { createAgentRunner } from '../agent-runner.js'

describe('AgentRunner', () => {
  // Mock gateway that returns tool_use on first call, text on second
  function createMockGateway(toolCalls: number = 1) {
    let callCount = 0
    return {
      async *stream(request: any) {
        callCount++
        if (callCount <= toolCalls) {
          // Return tool_use
          yield { type: 'tool_use_start' as const, id: `tool-${callCount}`, name: 'search_memory' }
          yield { type: 'tool_use_input' as const, delta: '{"query":"test"}' }
          yield { type: 'tool_use_end' as const }
          yield {
            type: 'done' as const,
            response: {
              id: `resp-${callCount}`,
              provider: 'anthropic',
              model: 'sonnet',
              content: [{ type: 'tool_use' as const, id: `tool-${callCount}`, name: 'search_memory', input: { query: 'test' } }],
              stopReason: 'tool_use' as const,
              usage: { inputTokens: 100, outputTokens: 50 },
            },
          }
        } else {
          // Return final text
          yield { type: 'text' as const, text: 'Task complete.' }
          yield {
            type: 'done' as const,
            response: {
              id: `resp-${callCount}`,
              provider: 'anthropic',
              model: 'sonnet',
              content: [{ type: 'text' as const, text: 'Task complete.' }],
              stopReason: 'end' as const,
              usage: { inputTokens: 200, outputTokens: 100 },
            },
          }
        }
      },
    }
  }

  it('executes single tool-use loop and completes', async () => {
    const gateway = createMockGateway(1)
    const toolExecutor = {
      execute: vi.fn().mockResolvedValue({ success: true, output: { results: ['found it'] }, durationMs: 10 }),
    }

    const runner = createAgentRunner({ gateway: gateway as any, toolExecutor: toolExecutor as any })
    const events: any[] = []

    for await (const event of runner.run({
      messages: [{ role: 'user', content: 'Find memories about testing' }],
      tools: [{ name: 'search_memory', description: 'Search memory', inputSchema: {} }],
      system: 'You are a helpful agent.',
      maxTurns: 5,
      provider: 'anthropic',
      model: 'sonnet',
    })) {
      events.push(event)
    }

    // Should have: tool_use events, tool_result event, then final text
    expect(toolExecutor.execute).toHaveBeenCalledOnce()
    expect(toolExecutor.execute).toHaveBeenCalledWith('search_memory', { query: 'test' }, undefined)
    
    const doneEvents = events.filter(e => e.type === 'done')
    expect(doneEvents).toHaveLength(1)
    expect(doneEvents[0].response.stopReason).toBe('end')
    
    const toolResultEvents = events.filter(e => e.type === 'tool_result')
    expect(toolResultEvents).toHaveLength(1)
  })

  it('respects maxTurns limit', async () => {
    const gateway = createMockGateway(100) // Would loop forever
    const toolExecutor = {
      execute: vi.fn().mockResolvedValue({ success: true, output: {}, durationMs: 1 }),
    }

    const runner = createAgentRunner({ gateway: gateway as any, toolExecutor: toolExecutor as any })
    const events: any[] = []

    for await (const event of runner.run({
      messages: [{ role: 'user', content: 'Do something' }],
      tools: [{ name: 'search_memory', description: 'Search', inputSchema: {} }],
      maxTurns: 3,
      provider: 'anthropic',
      model: 'sonnet',
    })) {
      events.push(event)
    }

    expect(toolExecutor.execute).toHaveBeenCalledTimes(3)
    const maxTurnsEvent = events.find(e => e.type === 'max_turns_reached')
    expect(maxTurnsEvent).toBeDefined()
  })

  it('handles tool execution errors gracefully', async () => {
    const gateway = createMockGateway(1)
    const toolExecutor = {
      execute: vi.fn().mockResolvedValue({ success: false, error: 'Permission denied', durationMs: 1 }),
    }

    const runner = createAgentRunner({ gateway: gateway as any, toolExecutor: toolExecutor as any })
    const events: any[] = []

    for await (const event of runner.run({
      messages: [{ role: 'user', content: 'Do something' }],
      tools: [{ name: 'search_memory', description: 'Search', inputSchema: {} }],
      maxTurns: 5,
      provider: 'anthropic',
      model: 'sonnet',
    })) {
      events.push(event)
    }

    // Tool error should be sent back as tool_result with isError=true
    const toolResultEvents = events.filter(e => e.type === 'tool_result')
    expect(toolResultEvents).toHaveLength(1)
    expect(toolResultEvents[0].isError).toBe(true)
  })
})
```

- [ ] **Step 2: Create agent-runner.ts**

```typescript
// src/modules/agent/agent-runner.ts
import type { ModelGateway, ModelMessage, ModelResponse, StreamEvent, ToolDefinition, ContentBlock, ToolUseBlock, ToolResultBlock } from '@modules/model/types.js'
import type { createToolExecutor } from '@modules/tools/tool-executor.js'
import type { ToolContext } from '@modules/tools/types.js'

export type AgentEvent =
  | StreamEvent                                           // Pass-through from model
  | { type: 'tool_result'; toolUseId: string; content: string; isError: boolean; durationMs: number }
  | { type: 'turn_complete'; turn: number; tokensUsed: number }
  | { type: 'max_turns_reached'; turns: number }

export interface AgentRunOptions {
  messages: ModelMessage[]
  tools: ToolDefinition[]
  system?: string
  maxTurns: number
  provider?: string
  model?: string
  toolContext?: ToolContext
  onTurnComplete?: (turn: number, response: ModelResponse) => void
}

interface AgentRunnerDeps {
  gateway: ModelGateway
  toolExecutor: ReturnType<typeof createToolExecutor>
}

export function createAgentRunner(deps: AgentRunnerDeps) {
  const { gateway, toolExecutor } = deps

  return {
    async *run(options: AgentRunOptions): AsyncIterable<AgentEvent> {
      const { tools, system, maxTurns, provider, model, toolContext } = options
      const messages: ModelMessage[] = [...options.messages]
      let turn = 0

      while (turn < maxTurns) {
        // Send to model
        const request = { messages, tools, system, provider, model }
        let response: ModelResponse | null = null

        for await (const event of gateway.stream(request)) {
          if (event.type === 'done') {
            response = event.response
          }
          yield event as AgentEvent
        }

        if (!response) break

        turn++
        const tokensUsed = response.usage.inputTokens + response.usage.outputTokens
        yield { type: 'turn_complete', turn, tokensUsed }
        options.onTurnComplete?.(turn, response)

        // If model didn't request tools, we're done
        if (response.stopReason !== 'tool_use') break

        // Extract tool_use blocks from response
        const toolUseBlocks = response.content.filter(
          (b): b is ToolUseBlock => b.type === 'tool_use'
        )

        if (toolUseBlocks.length === 0) break

        // Add assistant message with tool_use blocks
        messages.push({ role: 'assistant', content: response.content })

        // Execute each tool and collect results
        const toolResults: ToolResultBlock[] = []

        for (const toolUse of toolUseBlocks) {
          const result = await toolExecutor.execute(
            toolUse.name,
            toolUse.input,
            toolContext,
          )

          const content = result.success
            ? JSON.stringify(result.output)
            : `Error: ${result.error}`

          const toolResult: ToolResultBlock = {
            type: 'tool_result',
            toolUseId: toolUse.id,
            content,
            isError: !result.success,
          }

          toolResults.push(toolResult)

          yield {
            type: 'tool_result',
            toolUseId: toolUse.id,
            content,
            isError: !result.success,
            durationMs: result.durationMs,
          }
        }

        // Add tool results as user message (Anthropic convention)
        messages.push({ role: 'user', content: toolResults as ContentBlock[] })
      }

      if (turn >= maxTurns) {
        yield { type: 'max_turns_reached', turns: turn }
      }
    },
  }
}
```

- [ ] **Step 3: Create complexity-analyzer.ts**

```typescript
// src/modules/agent/complexity-analyzer.ts
import type { ConversationComplexity, ConversationMode } from './types.js'

interface AnalysisInput {
  userMessage: string
  conversationHistory?: { role: string; content: string }[]
  hasProject?: boolean
  hasAgent?: boolean
}

interface ComplexityResult {
  complexity: ConversationComplexity
  suggestedMode: ConversationMode
  reasoning: string
  suggestedTools?: string[]
  needsClarification: boolean
  clarificationQuestion?: string
}

/**
 * Heuristic complexity analysis. Can be enhanced with LLM-based analysis later.
 * For now uses keyword patterns and message structure.
 */
export function analyzeComplexity(input: AnalysisInput): ComplexityResult {
  const msg = input.userMessage.toLowerCase()
  const wordCount = msg.split(/\s+/).length

  // Quick questions — trivial
  if (wordCount < 15 && (msg.includes('?') || msg.startsWith('mi ') || msg.startsWith('what ') || msg.startsWith('how '))) {
    return { complexity: 'trivial', suggestedMode: 'simple', reasoning: 'Short question', needsClarification: false }
  }

  // Multi-step indicators
  const complexIndicators = [
    'create a module', 'build', 'implement', 'develop', 'design',
    'refactor', 'migrate', 'upgrade', 'review and fix',
    'modul', 'fejlessz', 'tervezz', 'építs', 'készíts',
  ]
  const hasComplexIndicator = complexIndicators.some(i => msg.includes(i))

  // Multi-file indicators
  const multiFileIndicators = ['module', 'modul', 'system', 'rendszer', 'workflow', 'pipeline']
  const isMultiFile = multiFileIndicators.some(i => msg.includes(i))

  if (hasComplexIndicator && isMultiFile) {
    return {
      complexity: 'complex',
      suggestedMode: 'autonomous',
      reasoning: 'Multi-file development task detected',
      needsClarification: true,
      clarificationQuestion: 'This looks like a complex task. Should I help you refine the requirements first with the Prompt Wizard?',
    }
  }

  if (hasComplexIndicator) {
    return {
      complexity: 'moderate',
      suggestedMode: 'managed',
      reasoning: 'Development task with tool use needed',
      needsClarification: false,
    }
  }

  // Default: simple
  return { complexity: 'simple', suggestedMode: 'simple', reasoning: 'Standard interaction', needsClarification: false }
}
```

- [ ] **Step 4: Run tests, commit**

```bash
git add src/modules/agent/
git commit -m "feat(agent): add agent runner — tool-use loop engine with maxTurns, error handling, complexity analyzer"
```

---

### Task 9: Agent Module Index, Routes & Conversation Integration

**Files:**
- Create: `src/modules/agent/index.ts`
- Create: `src/modules/agent/routes.ts`
- Modify: `src/modules/conversations/routes.ts`
- Create: `config/agents/general-assistant.yaml`
- Create: `config/agents/code-reviewer.yaml`
- Create: `config/agents/researcher.yaml`

**What:** Wire the agent module, create API routes, integrate agent execution into the conversation streaming endpoint, and seed default agents.

- [ ] **Step 1: Create agent module index.ts**

Standard module pattern: `onRegister` creates tables + seeds agents from `config/agents/`, `onStart` registers routes. Attaches `ctx.agents` (registry + runner).

- [ ] **Step 2: Create routes.ts**

Key endpoints:
- `GET /api/v1/agents` — list agent definitions
- `GET /api/v1/agents/:id` — get agent detail + sessions
- `POST /api/v1/agents` — create agent (source='user')
- `PATCH /api/v1/agents/:id` — update agent
- `DELETE /api/v1/agents/:id` — delete (only source='user')
- `POST /api/v1/agents/:id/toggle` — enable/disable
- `GET /api/v1/agents/:id/sessions` — execution history

- [ ] **Step 3: Integrate agent runner into conversation streaming**

Modify `src/modules/conversations/routes.ts` POST `/conversations/:id/messages` to:

1. Check conversation `mode` — if `managed` or `autonomous`, use agent runner instead of simple gateway stream
2. Look up agent definition from `conversation.agentId`
3. Get tools from tool registry based on agent's `tools[]` list
4. Run `agentRunner.run()` with proper messages, tools, system prompt
5. Stream all `AgentEvent`s to the frontend via SSE
6. Save tool calls and results to `tool_executions` table
7. Save all messages (including tool_use/tool_result) to conversation

```typescript
// In the streaming endpoint, after building messages:
if (conversation.mode !== 'simple' && conversation.agentId && ctx.agents) {
  const agent = ctx.agents.registry.get(conversation.agentId)
  if (agent && ctx.tools) {
    const toolDefs = ctx.tools.registry.toToolDefinitions(agent.tools)
    const toolCtx: ToolContext = { conversationId: id, userId, agentId: agent.id, logger: ctx.logger }

    for await (const event of ctx.agents.runner.run({
      messages: sdkMessages,
      tools: toolDefs,
      system: assembledPrompt,  // From prompt builder
      maxTurns: agent.maxTurns ?? 20,
      provider: conversation.providerId,
      model: conversation.modelId,
      toolContext: toolCtx,
    })) {
      // Stream events to frontend via SSE
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
    }
    return
  }
}
// Fall through to existing simple streaming for mode='simple'
```

- [ ] **Step 4: Create seed agent YAML files**

```yaml
# config/agents/general-assistant.yaml
id: general-assistant
name: "General Assistant"
role: "Versatile AI assistant for everyday tasks"
description: "Handles general questions, simple tasks, research, and document management"
systemPrompt: |
  You are EYAS, a personal AI assistant. You have access to tools for searching memory,
  knowledge base, files, and documents. Use tools when the user's request requires
  looking up information or taking action. Be proactive but careful.
model: sonnet
capabilities: [general, research, documents, memory]
tools: [search_memory, save_memory, search_indexed, search_knowledge, get_page, list_documents, read_document]
constraints:
  - "Ask for clarification if the task is ambiguous"
  - "Save important findings to memory"
maxTurns: 10
enabled: true
source: seed
avatar: "🤖"
tags: [general, default]
monthlyTokenBudget: 0
```

```yaml
# config/agents/code-reviewer.yaml
id: code-reviewer
name: "Code Reviewer"
role: "Senior code reviewer with security focus"
description: "Reviews code for quality, security vulnerabilities, and performance issues"
systemPrompt: |
  You are a senior code reviewer. Focus on OWASP top 10, input validation, auth flows,
  and performance. Use search tools to find relevant code and memory to recall past reviews.
model: opus
capabilities: [code-analysis, security-audit, performance-check]
tools: [search_indexed, search_memory, save_memory, run_command]
constraints:
  - "Never modify files directly without approval"
  - "Always check for security vulnerabilities"
maxTurns: 20
enabled: true
source: seed
avatar: "🔍"
tags: [security, review, quality]
monthlyTokenBudget: 500000
```

```yaml
# config/agents/researcher.yaml
id: researcher
name: "Researcher"
role: "Deep research and analysis agent"
description: "Conducts thorough research using web, knowledge base, and memory"
systemPrompt: |
  You are a research agent. Gather information from all available sources,
  synthesize findings, and save important discoveries to memory and knowledge base.
model: sonnet
capabilities: [research, analysis, writing]
tools: [search_indexed, search_knowledge, search_memory, save_memory, create_page, browser_navigate, browser_screenshot]
constraints:
  - "Always cite sources"
  - "Save key findings to knowledge base"
maxTurns: 30
enabled: true
source: seed
avatar: "📚"
tags: [research, analysis]
monthlyTokenBudget: 300000
```

- [ ] **Step 5: Run tests, commit**

```bash
git add src/modules/agent/ src/modules/conversations/ config/agents/
git commit -m "feat(agent): complete agent module — routes, conversation integration, seed agents"
```

---

### Task 10: Prompt Wizard Module

**Files:**
- Create: `src/modules/prompt-wizard/types.ts`
- Create: `src/modules/prompt-wizard/schema.ts`
- Create: `src/modules/prompt-wizard/wizard-service.ts`
- Create: `src/modules/prompt-wizard/prompt-builder.ts`
- Create: `src/modules/prompt-wizard/index.ts`
- Create: `src/modules/prompt-wizard/routes.ts`
- Test: `src/modules/prompt-wizard/__tests__/prompt-builder.test.ts`

**What:** The Prompt Wizard manages prompt templates at 3 levels (master, project-type, project) and provides an interactive wizard conversation to help formulate task prompts. The `prompt-builder` assembles the inheritance chain: master → project-type → project → conversation prompt.

- [ ] **Step 1: Write tests for prompt builder**

```typescript
// src/modules/prompt-wizard/__tests__/prompt-builder.test.ts
import { describe, it, expect } from 'vitest'
import { buildPromptChain } from '../prompt-builder.js'

describe('PromptBuilder', () => {
  it('builds single-level prompt', () => {
    const result = buildPromptChain({
      master: 'You are EYAS, a personal AI assistant.',
      projectType: null,
      project: null,
      conversation: null,
    })
    expect(result).toContain('You are EYAS')
  })

  it('chains master + project type + project + conversation', () => {
    const result = buildPromptChain({
      master: 'You are EYAS.',
      projectType: 'This is a development project. Follow TDD.',
      project: 'Working on the EYAS platform itself.',
      conversation: 'Review the auth module for security issues.',
    })
    // All levels present, separated by sections
    expect(result).toContain('You are EYAS.')
    expect(result).toContain('Follow TDD')
    expect(result).toContain('EYAS platform')
    expect(result).toContain('auth module')
  })

  it('skips null levels without breaking chain', () => {
    const result = buildPromptChain({
      master: 'You are EYAS.',
      projectType: null,
      project: 'Project context.',
      conversation: 'Task prompt.',
    })
    expect(result).toContain('You are EYAS.')
    expect(result).not.toContain('null')
    expect(result).toContain('Project context.')
  })
})
```

- [ ] **Step 2: Create types.ts**

```typescript
// src/modules/prompt-wizard/types.ts
export type PromptLevel = 'master' | 'project_type' | 'project' | 'conversation'

export interface PromptTemplate {
  id: string
  level: PromptLevel
  targetId?: string      // projectTypeId, projectId, or conversationId
  name: string
  content: string
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
```

- [ ] **Step 3: Create prompt-builder.ts**

```typescript
// src/modules/prompt-wizard/prompt-builder.ts
import type { PromptChainInput } from './types.js'

export function buildPromptChain(input: PromptChainInput): string {
  const sections: string[] = []

  if (input.master) {
    sections.push(`<system-identity>\n${input.master}\n</system-identity>`)
  }

  if (input.projectType) {
    sections.push(`<project-type-context>\n${input.projectType}\n</project-type-context>`)
  }

  if (input.project) {
    sections.push(`<project-context>\n${input.project}\n</project-context>`)
  }

  if (input.conversation) {
    sections.push(`<task-instructions>\n${input.conversation}\n</task-instructions>`)
  }

  return sections.join('\n\n')
}
```

- [ ] **Step 4: Create schema, wizard-service, index, routes**

The wizard-service manages `prompt_templates` table CRUD and provides a `startWizard(level, targetId)` function that creates a new conversation with `mode: 'wizard'` and a system prompt specialized for prompt engineering.

The wizard conversation uses the model module to interactively help the user formulate their prompt through questions, context gathering, and iterative refinement.

- [ ] **Step 5: Run tests, commit**

```bash
git add src/modules/prompt-wizard/
git commit -m "feat(prompt-wizard): add prompt wizard module — templates, inheritance chain, wizard conversation"
```

---

### Task 11: Frontend — Agent Progress & Sub-Conversation Tree

**Files:**
- Create: `src/web/src/pages/conversations/components/agent-progress.tsx`
- Create: `src/web/src/pages/conversations/components/sub-conversation-tree.tsx`
- Create: `src/web/src/pages/conversations/components/tool-call-display.tsx`
- Create: `src/web/src/pages/conversations/components/complexity-indicator.tsx`
- Modify: `src/web/src/pages/conversations/conversation-page.tsx`
- Modify: `src/web/src/pages/conversations/conversation-messages.tsx`
- Modify: `src/web/src/pages/conversations/conversation-top-bar.tsx`

**What:** Update the conversation UI to show agent execution progress, tool calls, sub-conversations, and complexity/mode indicators.

- [ ] **Step 1: Create agent-progress.tsx**

A real-time panel showing:
- Current agent name + avatar
- Turn counter (turn X / maxTurns)
- Tool calls in progress (spinner + tool name)
- Completed tool calls (name + duration + success/fail)
- Token usage for this session
- Cancel button

- [ ] **Step 2: Create sub-conversation-tree.tsx**

A collapsible tree showing child conversations:
- Each child shows: title, status badge, agent avatar, message count
- Click navigates to child conversation
- Color-coded by status (running=blue, completed=green, failed=red)

- [ ] **Step 3: Create tool-call-display.tsx**

Rich rendering of tool_use/tool_result in the message stream:
- Tool name + input parameters (collapsible)
- Execution result (success: green, error: red)
- Duration badge
- Replaces the current `🔧 Using: [name]...` text

- [ ] **Step 4: Create complexity-indicator.tsx**

Shows conversation mode and complexity:
- Mode badge: simple (gray), managed (blue), autonomous (purple), wizard (amber)
- Complexity: trivial-epic scale with visual indicator

- [ ] **Step 5: Update conversation-page.tsx**

- Add agent-progress panel to the right sidebar (new tab alongside Chatter)
- Show sub-conversation-tree below the fields when conversation has children
- Handle new SSE event types: `tool_result`, `turn_complete`, `max_turns_reached`

- [ ] **Step 6: Update conversation-top-bar.tsx**

- Add mode selector (simple/managed/autonomous)
- Add agent selector dropdown (from agent registry API)
- Show complexity badge
- Add "Start Wizard" button that opens prompt wizard

- [ ] **Step 7: Update conversation-messages.tsx**

- Render tool_use blocks with tool-call-display component instead of plain text
- Render tool_result blocks with success/error styling

- [ ] **Step 8: Commit**

```bash
git add src/web/src/pages/conversations/
git commit -m "feat(frontend): agent progress panel, sub-conversation tree, tool call display"
```

---

### Task 12: Frontend — Agent Management Page

**Files:**
- Create: `src/web/src/pages/agents/agents-page.tsx`
- Create: `src/web/src/pages/agents/agent-detail-page.tsx`
- Create: `src/web/src/pages/agents/components/agent-card.tsx`
- Create: `src/web/src/pages/agents/components/agent-session-view.tsx`
- Modify: `src/web/src/routes.tsx` (add agent routes)
- Modify: `src/web/src/components/layout/sidebar.tsx` (add Agents nav item)

**What:** Admin UI for managing agent definitions — create, edit, toggle, view execution history, monitor budgets.

- [ ] **Step 1: Create agents-page.tsx** — grid of agent cards, create button
- [ ] **Step 2: Create agent-detail-page.tsx** — edit form, session history, budget chart
- [ ] **Step 3: Create agent-card.tsx** — avatar, name, status, budget progress bar
- [ ] **Step 4: Create agent-session-view.tsx** — timeline of tool calls for a session
- [ ] **Step 5: Add routes and navigation**
- [ ] **Step 6: Commit**

```bash
git add src/web/src/pages/agents/ src/web/src/routes.tsx src/web/src/components/layout/
git commit -m "feat(frontend): agent management pages — definitions CRUD, sessions, budgets"
```

---

### Task 13: Frontend — Prompt Wizard UI

**Files:**
- Create: `src/web/src/pages/conversations/components/wizard-dialog.tsx`
- Create: `src/web/src/pages/conversations/components/prompt-chain-view.tsx`
- Create: `src/web/src/pages/settings/prompts-settings.tsx`

**What:** UI for the prompt wizard — launch dialog, chain visualization, master/project prompt management in settings.

- [ ] **Step 1: Create wizard-dialog.tsx** — modal that opens a wizard conversation, shows iterative prompt refinement, "Apply" button to save result
- [ ] **Step 2: Create prompt-chain-view.tsx** — visualizes the prompt inheritance chain (master → project-type → project → conversation), shows which levels are set
- [ ] **Step 3: Create prompts-settings.tsx** — settings page for managing master prompt template and project-type prompts
- [ ] **Step 4: Commit**

```bash
git add src/web/src/pages/
git commit -m "feat(frontend): prompt wizard dialog, chain view, prompt settings page"
```

---

### Task 14: Phase I Integration Test

**Files:**
- Create: `src/modules/agent/__tests__/integration.test.ts`

**What:** End-to-end test: create conversation → assign agent → send message → agent runs tool-use loop → tools execute → response saved → verify state.

- [ ] **Step 1: Write integration test**

```typescript
// src/modules/agent/__tests__/integration.test.ts
import { describe, it, expect } from 'vitest'

describe('Agent E2E Flow', () => {
  it('conversation → agent → tool loop → completion', async () => {
    // 1. Boot test modules (conversations, tools, agent, model with mock provider)
    // 2. Register mock tools
    // 3. Create conversation with mode='managed', agentId='test-agent'
    // 4. Add user message
    // 5. Trigger agent run
    // 6. Verify: tool executions logged, messages saved, conversation status='idle'
    // 7. Verify: child conversations created if agent used create_sub_conversation
  })

  it('prompt wizard creates and applies prompt', async () => {
    // 1. Create wizard conversation
    // 2. Simulate wizard interaction
    // 3. Verify prompt saved to target conversation
  })

  it('complexity analyzer suggests correct mode', () => {
    // Test various inputs against expected complexity/mode
  })
})
```

- [ ] **Step 2: Run all tests**

Run: `cd /Users/eyssen/GitHub/eyas && bun test`
Expected: ALL PASS

- [ ] **Step 3: Commit**

```bash
git add src/modules/agent/__tests__/
git commit -m "test(agent): add Phase I integration tests — agent loop, wizard, complexity"
```

---

## Phase II: Orchestration

### Task 15: Agent Orchestrator

**Files:**
- Create: `src/modules/agent/orchestrator.ts`
- Create: `src/modules/agent/model-router.ts`
- Create: `src/modules/agent/re-planner.ts`
- Test: `src/modules/agent/__tests__/orchestrator.test.ts`
- Test: `src/modules/agent/__tests__/model-router.test.ts`

**What:** Team assembly and parallel execution. Analyzes complex tasks and proposes agent teams. Manages parent-child conversation relationships, parallel execution, phased workflows (plan → build → review → merge), and conflict resolution.

**Enhancement: Adaptive re-planning** — After each phase completes, the orchestrator invokes the Product Owner agent to re-evaluate remaining tasks against actual results. If a task produced unexpected output (new dependency discovered, API changed, scope shift), the plan mutates: tasks are added, removed, reordered, or reassigned. Only the affected subtree is replanned — unrelated branches continue uninterrupted.

**Enhancement: Per-task AI model routing** — The orchestrator selects the optimal AI model for each task based on task type, complexity, and cost. The `model-router.ts` component maintains a routing table (configurable, with learned overrides from self-learning):

| Task type | Default model | Reasoning |
|-----------|--------------|-----------|
| Architecture/planning | Opus | Complex reasoning needed |
| Code implementation | Sonnet | Good quality/cost ratio |
| Boilerplate/scaffolding | Haiku | Fast, cheap, sufficient |
| Security review | Opus | Precision critical |
| Test generation | Sonnet | Pattern-heavy, Sonnet excels |
| Documentation | Gemini Flash | Large context, fast |
| Quick lookups | Haiku | Minimal reasoning needed |

The model-router exposes `selectModel(taskType, complexity, budget)` and can be overridden per agent definition (`model` field) or per conversation.

Key functions:
- `analyzeAndPropose(conversation)` — suggests team composition + model assignments
- `executeTeam(teamConfig, parentConversation)` — creates child conversations, assigns agents, runs in parallel
- `waitForPhase(phase)` — blocks until all agents in a phase complete
- `resolveConflicts(childConversations)` — handles when multiple agents produce conflicting results
- `replan(completedPhase, results)` — re-evaluates remaining plan based on phase results
- `selectModelForTask(task)` — picks optimal AI model for the given task

- [ ] **Step 1: Write tests for orchestrator**

Including tests for:
- Team assembly from complex task description
- Phase execution order (sequential phases, parallel agents within phase)
- Re-planning after phase completion (plan mutation)
- Model selection per task type

- [ ] **Step 2: Implement orchestrator**

- [ ] **Step 3: Implement model-router.ts**

```typescript
interface ModelRoutingRule {
  taskType: string        // 'architecture' | 'implementation' | 'review' | 'test' | 'docs' | 'lookup'
  complexity: string      // 'trivial' | 'simple' | 'moderate' | 'complex' | 'epic'
  model: string           // Model ID
  provider: string        // Provider ID
  reasoning: string       // Why this model for this task
}

interface ModelRouter {
  selectModel(taskType: string, complexity: string, budgetRemaining?: number): { provider: string; model: string }
  getRoutingTable(): ModelRoutingRule[]
  updateRule(taskType: string, complexity: string, model: string, provider: string): void
}
```

- [ ] **Step 4: Implement re-planner.ts**

```typescript
interface RePlanResult {
  tasksAdded: string[]
  tasksRemoved: string[]
  tasksModified: { id: string; changes: string }[]
  reasoning: string
}

// Uses Product Owner agent (or a lightweight LLM call) to analyze:
// 1. Original plan goals
// 2. Completed phase results (what actually happened)
// 3. Remaining tasks (what's still planned)
// → Produces modified plan with explanation
```

- [ ] **Step 5: Create team configuration types**

```typescript
interface TeamConfig {
  phases: TeamPhase[]
  maxParallelAgents: number
  conflictStrategy: 'first-wins' | 'merge' | 'human-review'
  replanAfterPhase: boolean    // Enable adaptive re-planning
  modelRouting: 'auto' | 'manual'  // Auto = model-router decides per task
}

interface TeamPhase {
  name: string       // 'plan' | 'build' | 'review' | 'merge'
  agents: string[]   // Agent IDs
  parallel: boolean  // Run agents in this phase in parallel?
  checkpoint: boolean // Require human approval before next phase?
  replanOnComplete: boolean  // Trigger re-planning after this phase?
}
```

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(agent): add orchestrator — team assembly, adaptive re-planning, per-task model routing"
```

---

### Task 16: Token Budget Engine

**Files:**
- Modify: `src/modules/agent/agent-registry.ts`
- Create: `src/modules/agent/budget-engine.ts`
- Test: `src/modules/agent/__tests__/budget-engine.test.ts`

**What:** Per-agent token budget tracking with monthly reset, alerts at 80%/100%/120% thresholds, and automatic throttling.

- [ ] **Step 1: Write tests**
- [ ] **Step 2: Implement budget engine**

Key logic:
- Pre-execution check: `isWithinBudget(agentId)` — returns false if monthly budget exceeded
- Post-execution tracking: `addTokenUsage(agentId, tokens)` — increments counter
- Monthly reset: cron-compatible function to zero counters at month start
- Alert thresholds: emit bus events at 80%, 100%, 120% of budget
- Dashboard data: `getBudgetStats(agentId)` — used/total/percentage/projectedMonthly

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(agent): add token budget engine — tracking, throttling, alerts, monthly reset"
```

---

### Task 17: Security Gate Module

**Files:**
- Create: `src/modules/security-gate/index.ts`
- Create: `src/modules/security-gate/schema.ts`
- Create: `src/modules/security-gate/types.ts`
- Create: `src/modules/security-gate/deterministic-gate.ts`
- Create: `src/modules/security-gate/llm-judge.ts`
- Create: `src/modules/security-gate/runtime-monitor.ts`
- Create: `src/modules/security-gate/routes.ts`
- Test: `src/modules/security-gate/__tests__/deterministic-gate.test.ts`

**What:** 3-checkpoint security validation (from architecture spec §41): deterministic gate (regex/pattern, <5ms), LLM judge (separate AI context), runtime monitor (real-time during execution).

**Enhancement: Incremental validation (Runtime Monitor)** — Checkpoint 3 doesn't just check individual tool calls. It runs as a continuous monitor alongside agent execution:
- **Drift detection**: Tracks the agent's chain-of-thought. If the agent starts working on something unrelated to the goal (goal description vs. actual actions divergence), it pauses the agent and asks for human review.
- **Token waste detection**: If an agent uses >50% of its turn budget without producing meaningful tool results (repeated failed calls, circular reasoning), the monitor halts execution and escalates.
- **Cumulative risk scoring**: Each tool call adds to a session risk score. Even if individual calls are green-tier, a high volume of yellow-tier calls in a session can trigger red-tier review.
- **Real-time dashboard**: Emits WebSocket events for live monitoring in the frontend (agent-progress.tsx consumes these).

- [ ] **Step 1: Write tests for deterministic gate** — regex blocklist, attack patterns, rate limiting
- [ ] **Step 2: Implement Checkpoint 1** — fast, no LLM, pattern matching
- [ ] **Step 3: Implement Checkpoint 2** — LLM judge with sandwich prompt
- [ ] **Step 4: Implement Checkpoint 3 — Runtime Monitor with incremental validation**

```typescript
interface RuntimeMonitorConfig {
  goalDriftThreshold: number     // 0-1, how far agent can drift from goal (default: 0.3)
  tokenWasteThreshold: number    // Percentage of budget used without results (default: 0.5)
  cumulativeRiskCap: number      // Max cumulative risk score before escalation (default: 10)
  emitWebSocket: boolean         // Send live events to frontend (default: true)
}

interface MonitorEvent {
  type: 'drift_warning' | 'token_waste' | 'risk_escalation' | 'action_blocked' | 'session_halted'
  sessionId: string
  details: string
  severity: 'info' | 'warning' | 'critical'
  timestamp: string
}
```

- [ ] **Step 5: Implement tiered risk routing** — green (gate only), yellow (gate + judge), red (all + human approval)
- [ ] **Step 6: Integrate into agent runner** — every tool call passes through security gate before execution; runtime monitor runs as parallel async watcher
- [ ] **Step 7: Create routes** — security events, configuration, rate limit management
- [ ] **Step 8: Commit**

```bash
git commit -m "feat(security-gate): 3-checkpoint validation — deterministic, LLM judge, runtime monitor"
```

---

### Task 18: Context Builder

**Files:**
- Create: `src/modules/memory/context-builder.ts` (extends existing memory module)
- Test: `src/modules/memory/__tests__/context-builder.test.ts`

**What:** Assembles the optimal context for every AI request: selects relevant memories, compresses long content, prioritizes by recency/salience, formats per model expectations. Called by agent runner before every model invocation.

Key features:
- Select from working memory, episodic (by relevance), vault/semantic (by search)
- Compress: summarize long memories, remove redundancy
- Prioritize: fresh + high-salience + frequently-used at top
- Format: Claude XML tags, OpenAI JSON, Gemini format
- Audit: log what was included/excluded and why

**Enhancement: Cross-agent context sharing** — The context builder is aware of the conversation hierarchy. When building context for a child conversation's agent:
1. **Parent goal injection**: The root conversation's `goalDescription` + all ancestor goals are included as `<goal-ancestry>` section
2. **Sibling discoveries**: Working memory entries from sibling conversations (same parent) that are marked `broadcast: true` are included
3. **Shared memory tier**: The parent conversation maintains a `shared_context` working memory namespace that all children read/write
4. **Deduplication**: If the same memory appears in multiple tiers (episodic + vault), only the richest version is included

```typescript
interface ContextAssemblyOptions {
  conversationId: string
  includeAncestry: boolean       // Include parent/grandparent goals (default: true)
  includeSiblingDiscoveries: boolean  // Include broadcast memories from siblings (default: true)
  maxTokenBudget: number         // Max tokens for assembled context (default: 4000)
  strategy: 'balanced' | 'recency' | 'relevance' | 'minimal'
}
```

- [ ] **Step 1: Write tests** — including ancestry injection, sibling discovery sharing, deduplication
- [ ] **Step 2: Implement context assembler** — with cross-agent awareness
- [ ] **Step 3: Integrate into agent runner** — call context builder before every model request (not just first), with updated conversation state
- [ ] **Step 4: Commit**

```bash
git commit -m "feat(memory): add context builder — select, compress, prioritize, cross-agent sharing"
```

---

### Task 19: Scheduler Module

**Files:**
- Create: `src/modules/scheduler/index.ts`
- Create: `src/modules/scheduler/schema.ts`
- Create: `src/modules/scheduler/types.ts`
- Create: `src/modules/scheduler/scheduler-service.ts`
- Create: `src/modules/scheduler/routes.ts`
- Test: `src/modules/scheduler/__tests__/scheduler.test.ts`

**What:** Croner-based job scheduler with extended triggers (from architecture spec §17): time (cron), event (bus), webhook, file (fs.watch), condition. Supports job chains with error strategies.

Uses: [croner](https://github.com/hexagon/croner) (MIT licensed, lightweight, no dependencies).

- [ ] **Step 1: Write tests** — cron scheduling, event triggers, job chains, error strategies
- [ ] **Step 2: Implement scheduler service** — register jobs, trigger types, chain execution
- [ ] **Step 3: Create module index + routes** — CRUD for scheduled jobs, execution history
- [ ] **Step 4: Register built-in jobs** — token budget monthly reset, memory consolidation
- [ ] **Step 5: Commit**

```bash
git commit -m "feat(scheduler): add scheduler module — cron, event, webhook, file triggers, job chains"
```

---

### Task 20: Phase II Frontend Updates

**Files:**
- Create: `src/web/src/pages/agents/components/team-config.tsx`
- Create: `src/web/src/pages/agents/components/budget-dashboard.tsx`
- Create: `src/web/src/pages/security/security-events-page.tsx`
- Create: `src/web/src/pages/scheduler/scheduler-page.tsx`
- Modify: `src/web/src/pages/conversations/conversation-page.tsx` (team execution view)

**What:** Frontend for orchestrator team config, budget dashboards, security event viewer, scheduler management.

- [ ] **Step 1: Team configuration UI** — visual team builder, phase editor, agent assignment
- [ ] **Step 2: Budget dashboard** — per-agent token usage charts, alerts, projections
- [ ] **Step 3: Security events page** — event log, rate limits, risk tier configuration
- [ ] **Step 4: Scheduler page** — job list, execution history, create/edit jobs
- [ ] **Step 5: Update conversation page** — show team execution view when orchestrator is active
- [ ] **Step 6: Commit**

```bash
git commit -m "feat(frontend): Phase II — team config, budgets, security events, scheduler UI"
```

---

### Task 21: Phase II Integration Test

**Files:**
- Create: `src/modules/agent/__tests__/orchestrator-integration.test.ts`
- Create: `src/modules/security-gate/__tests__/integration.test.ts`

**What:** End-to-end tests for team orchestration, security gate enforcement, context builder, and scheduler.

- [ ] **Step 1: Write orchestrator integration test** — team assembly → parallel execution → merge
- [ ] **Step 2: Write security gate integration test** — green/yellow/red tier routing
- [ ] **Step 3: Run full test suite**
- [ ] **Step 4: Commit**

```bash
git commit -m "test: Phase II integration tests — orchestrator, security gate, context builder"
```

---

## Phase III: Autonomy

### Task 22: Self-Learning Module

**Files:**
- Create: `src/modules/self-learning/index.ts`
- Create: `src/modules/self-learning/activity-analyzer.ts`
- Create: `src/modules/self-learning/execution-learner.ts`
- Create: `src/modules/self-learning/skill-generator.ts`
- Create: `src/modules/self-learning/efficiency-reporter.ts`
- Test: `src/modules/self-learning/__tests__/activity-analyzer.test.ts`
- Test: `src/modules/self-learning/__tests__/execution-learner.test.ts`

**What:** From architecture spec §16. Periodically analyzes activity and proposes improvements:
- **Activity analyzer**: patterns from audit logs, recurring tasks, error patterns
- **Skill generator**: proposes new skills from repeated task patterns
- **Efficiency reporter**: token efficiency, cost/benefit analysis

**Enhancement: Execution learning** — The `execution-learner.ts` component analyzes completed agent sessions to continuously improve the system:

1. **Success rate tracking per agent per task type**: Queries `agent_sessions` table, groups by `agentId` + task complexity/type, calculates success rate. Surfaces which agents excel at which tasks → informs orchestrator's `analyzeAndPropose()`.

2. **Prompt effectiveness scoring**: Correlates prompt templates (from prompt-wizard) with session outcomes (success/fail, token efficiency, user feedback). Ranks prompts and suggests modifications for underperforming ones.

3. **Model routing optimization**: Analyzes which AI models produced best results for which task types. Feeds updated routing rules back into `model-router.ts`. Example: if Sonnet consistently outperforms Opus on test generation at 1/10th the cost, the routing table auto-adjusts.

4. **Constraint tuning**: If an agent consistently fails due to a specific constraint (e.g., "max 5 minutes" causing timeouts on complex reviews), proposes loosening it. If an agent succeeds but produces low-quality output without a constraint, proposes adding one.

5. **Agent recommendation**: "You've done this type of task 12 times manually. Consider creating a dedicated agent with these tools and this prompt."

```typescript
interface ExecutionInsight {
  type: 'success_rate' | 'prompt_effectiveness' | 'model_routing' | 'constraint_tuning' | 'agent_recommendation'
  agentId?: string
  metric: number                    // 0-1 score
  currentValue: string              // What's currently configured
  suggestedValue: string            // What the learner recommends
  confidence: number                // 0-1, how confident the suggestion is
  dataPoints: number                // How many sessions this is based on
  reasoning: string
}
```

Scheduled via scheduler module: daily (22:00), weekly (Monday 9:00), monthly (1st 9:00).

- [ ] **Step 1: Implement activity analyzer with tests**
- [ ] **Step 2: Implement execution learner with tests** — success tracking, prompt scoring, model optimization
- [ ] **Step 3: Implement skill generator**
- [ ] **Step 4: Implement efficiency reporter**
- [ ] **Step 5: Register scheduler jobs** — daily analysis, weekly execution learning, monthly full report
- [ ] **Step 6: Wire execution learner output into orchestrator** — model-router reads learned routing rules, analyzeAndPropose reads success rates
- [ ] **Step 7: Commit**

```bash
git commit -m "feat(self-learning): activity analysis, execution learning, skill generation, efficiency reporting"
```

---

### Task 23: Communication Module

**Files:**
- Create: `src/modules/communication/index.ts`
- Create: `src/modules/communication/types.ts`
- Create: `src/modules/communication/channel-router.ts`
- Create: `src/modules/communication/submodules/mcp-server/manifest.ts`
- Create: `src/modules/communication/submodules/mcp-server/server.ts`
- Create: `src/modules/communication/submodules/mcp-client/manifest.ts`
- Create: `src/modules/communication/submodules/mcp-client/client.ts`
- Create: `src/modules/communication/submodules/telegram/manifest.ts`
- Create: `src/modules/communication/submodules/telegram/bot.ts`

**What:** From architecture spec §19. Unified Channel interface with pluggable adapters. MCP server (expose EYAS tools to external agents), MCP client (connect to external MCP servers), Telegram bot (Grammy).

- [ ] **Step 1: Create Channel interface and router**
- [ ] **Step 2: Implement MCP Server submodule** — expose search, task.create, memory.save, agent.run
- [ ] **Step 3: Implement MCP Client submodule** — connect to external servers, register as tools
- [ ] **Step 4: Implement Telegram submodule** — Grammy bot, message routing, DM pairing
- [ ] **Step 5: Commit**

```bash
git commit -m "feat(communication): channel router, MCP server/client, Telegram bot"
```

---

### Task 24: Proactive Assistant

**Files:**
- Create: `src/modules/proactive-assistant/index.ts`
- Create: `src/modules/proactive-assistant/source-adapters.ts`
- Create: `src/modules/proactive-assistant/lesson-learner.ts`
- Create: `src/modules/proactive-assistant/bot-executor.ts`
- Test: `src/modules/proactive-assistant/__tests__/bot-executor.test.ts`

**What:** From architecture spec §47. EYAS doesn't just wait — it proactively monitors and acts:
- **Source adapters**: watch tasks, git, audit logs, email (IMAP), calendar
- **Lesson learner**: weekly analysis of closed conversations → extract reusable knowledge
- **Bot executor**: autonomous task processing on stages with `bot_listen` flag

- [ ] **Step 1: Implement source adapter framework** — pluggable, event-driven
- [ ] **Step 2: Implement lesson learner** — analyze closed conversations, extract patterns, save to memory
- [ ] **Step 3: Implement bot executor** — watch board stages, pick up waiting tasks, process autonomously
- [ ] **Step 4: Schedule proactive checks** — morning brief, weekly summary, real-time alerts
- [ ] **Step 5: Commit**

```bash
git commit -m "feat(proactive-assistant): source adapters, lesson learner, autonomous bot executor"
```

---

### Task 25: Skills Module

**Files:**
- Create: `src/modules/skills/index.ts`
- Create: `src/modules/skills/schema.ts`
- Create: `src/modules/skills/skill-loader.ts`
- Create: `src/modules/skills/skill-matcher.ts`
- Create: `config/skills/devops-k8s.md`
- Create: `config/skills/git-workflow.md`
- Create: `config/skills/api-design.md`
- Test: `src/modules/skills/__tests__/skill-matcher.test.ts`

**What:** From architecture spec §15. Markdown-based skills with YAML frontmatter, automatic relevance matching, loaded from `config/skills/*.md`.

- [ ] **Step 1: Implement skill loader** — parse markdown with frontmatter, register in DB
- [ ] **Step 2: Implement skill matcher** — match skills to task context using patterns + AI
- [ ] **Step 3: Integrate with agent runner** — inject matched skills into agent system prompt
- [ ] **Step 4: Create seed skills** — devops-k8s, git-workflow, api-design
- [ ] **Step 5: Commit**

```bash
git commit -m "feat(skills): skill loader, relevance matching, seed skills"
```

---

### Task 26: Phase III Frontend Updates

**Files:**
- Create: `src/web/src/pages/skills/skills-page.tsx`
- Create: `src/web/src/pages/communication/channels-page.tsx`
- Create: `src/web/src/pages/proactive/proactive-dashboard.tsx`
- Create: `src/web/src/pages/self-learning/insights-page.tsx`

**What:** Frontend for skills management, communication channels, proactive assistant dashboard, self-learning insights.

- [ ] **Steps 1–4: Create each page following existing patterns**
- [ ] **Step 5: Commit**

```bash
git commit -m "feat(frontend): Phase III — skills, channels, proactive dashboard, insights"
```

---

### Task 27: Phase III Integration Test & Full System Test

**Files:**
- Create: `src/__tests__/full-system.test.ts`

**What:** Full system integration test: boot all modules → create project → create conversation → agent analyzes complexity → wizard helps refine prompt → agent team executes → tools used → results saved → proactive assistant monitors → self-learning extracts lessons.

- [ ] **Step 1: Write full system test**
- [ ] **Step 2: Run complete test suite**
- [ ] **Step 3: Fix any failures**
- [ ] **Step 4: Commit**

```bash
git commit -m "test: full system integration test — complete agent lifecycle"
```

---

## Summary

| Phase | Tasks | New Modules | Modified | Key Outcome |
|-------|-------|-------------|----------|-------------|
| **I** | 1–14 | tools, agent, prompt-wizard | conversations, frontend | Single agent works autonomously with tools |
| **II** | 15–21 | security-gate, scheduler | agent (orchestrator, budget, model-router, re-planner), memory (context-builder) | Teams, security, budgets, scheduling, adaptive re-planning |
| **III** | 22–27 | self-learning, communication, proactive-assistant, skills | frontend, orchestrator (learned routing) | Full autonomy, multi-channel, self-improvement, execution learning |

**Total: 27 tasks, 3 phases, ~65 new files, ~15 modified files.**

Each phase produces a working system that can be tested and used independently.

### Key Enhancements (vs. simple pipeline orchestration)

| Enhancement | Phase | Task(s) | Impact |
|------------|-------|---------|--------|
| Adaptive re-planning | II | 15 | Plan mutates based on actual results, not rigid pipeline |
| Cross-agent context sharing | II | 8, 18 | Agents share discoveries, parent goals propagate down |
| Per-task model routing | II | 15 | Optimal cost/quality per task type, auto-optimized over time |
| Execution learning | III | 22 | System improves agent selection, prompts, constraints from history |
| Incremental validation | II | 17 | Real-time drift/waste detection, early intervention |
| Partial result persistence | I | 8 | Crash-safe, resumable sessions, partial results reusable |

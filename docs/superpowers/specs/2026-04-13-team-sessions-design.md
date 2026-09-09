# Team Sessions Design

**Date:** 2026-04-13  
**Status:** Approved  
**Scope:** Team session lifecycle, team memory, subconversation UI, agent gap detection

## Overview

EYAS conversations can delegate complex tasks to a coordinated team of agents running in parallel subconversations. This design introduces `team_sessions` as a first-class entity, a two-layer team memory system, real-time team dashboard UI, and self-improvement via agent gap detection.

The feature is modeled after Claude Code's agent teams UX but is provider-agnostic: any agent in the team can use any configured provider (Anthropic, OpenAI, Ollama, etc.).

---

## 1. Data Layer

### New table: `team_sessions`

```sql
id                   TEXT  PRIMARY KEY
parentConversationId TEXT  NOT NULL  REFERENCES conversations(id)
status               TEXT  NOT NULL  -- proposing | awaiting_approval | running | paused | completed | failed
config               TEXT  NOT NULL  -- JSON (TeamConfig)
reasoning            TEXT            -- AI explanation for the proposal
estimatedTokens      INT   DEFAULT 0
totalTokens          INT   DEFAULT 0
totalCostUsd         REAL  DEFAULT 0
createdAt            TEXT  NOT NULL
completedAt          TEXT            -- nullable
```

### New table: `team_memory`

```sql
id             TEXT  PRIMARY KEY
teamSessionId  TEXT  NOT NULL  REFERENCES team_sessions(id)  -- INDEX
key            TEXT  NOT NULL  -- e.g. "security-finding-001", "architecture-decision"
value          TEXT  NOT NULL  -- JSON
layer          TEXT  NOT NULL  -- system | agent
category       TEXT  NOT NULL  -- finding | decision | blocker | question | fact
authorAgentId  TEXT            -- NULL for system-layer entries
visibility     TEXT  DEFAULT 'all'  -- all | role:engineer | role:reviewer | ...
createdAt      TEXT  NOT NULL
```

### Modified table: `conversations`

Add one nullable column:
```sql
teamSessionId  TEXT  REFERENCES team_sessions(id)
```

Child conversations created by an orchestrator run will have this set to the session ID.

### `agent_messages` — no change

The existing `session_id` column in `agent_messages` references `agent_sessions`, not `team_sessions`. Team session ID is derivable via the conversation's `teamSessionId` field. No migration needed.

---

## 2. Backend

### TeamSessionService (`src/modules/agent/team-session-service.ts`)

```typescript
create(parentConversationId, proposal): TeamSession
approve(teamSessionId): void          // proposing|awaiting_approval → running
reject(teamSessionId): void
pause(teamSessionId): void            // running → paused (checkpoint)
resume(teamSessionId): void           // paused → running
get(teamSessionId): TeamSession
listByConversation(parentConversationId): TeamSession[]
writeMemory(teamSessionId, entry): TeamMemoryEntry
readMemory(teamSessionId, filter?): TeamMemoryEntry[]
  // filter: { category?, authorAgentId?, visibility? }
```

### `propose_team` tool (for main conversation agent)

The main conversation's agent recognizes task complexity and calls this tool:

```typescript
propose_team(goalDescription, complexity, reasoning)
  → calls analyzeAndPropose() — LLM-based, not heuristic
  → creates team_session with status 'proposing'
  → emits WebSocket event team:{sessionId}:proposed
  → returns TeamProposal including agentGaps[]
```

The tool is registered in `conversation-tools.ts` and available in all conversation modes. In `simple` mode it only activates when the user explicitly requests team execution (message contains "team" keyword or uses a `/team` slash command); in `managed` and `autonomous` modes the agent can call it proactively based on complexity assessment.

### `analyzeAndPropose()` — rewrite from heuristic to LLM

Current implementation uses `capabilities.includes('general')` pattern matching. New implementation:

1. Fetch all enabled agents with their capabilities and descriptions
2. LLM call: given the goal and available agents, propose phases + identify gaps
3. Return `TeamProposal` with `agentGaps: AgentGap[]`

```typescript
interface TeamProposal {
  config: TeamConfig
  reasoning: string
  estimatedTokens: number
  estimatedCostUsd: number
  agentGaps: AgentGap[]
}

interface AgentGap {
  suggestedName: string         // e.g. "Database Migration Specialist"
  suggestedRole: string         // one-line description
  capabilities: string[]        // e.g. ['db-migration', 'sql', 'schema-analysis']
  reason: string                // why this gap matters for the task
  canProceedWithout: boolean    // team can still run in degraded mode
  proposedAgentType: string     // engineer | reviewer | researcher | planner | ...
}
```

### Orchestrator changes

Three targeted fixes to `orchestrator.ts`:

**1. Session tracking** — `executeTeam()` receives `teamSessionId`, writes every
`agent_started` / `agent_completed` event to the DB via `TeamSessionService`.

**2. Parallel event streaming** — replace `Promise.allSettled` with a `Promise.race`
loop so `agent_completed` events yield immediately as each agent finishes, not after
all agents finish.

**3. Checkpoint await** — instead of continuing automatically, checkpoint calls
`teamSessionService.pause(teamSessionId)` and waits for a resume signal via a
Promise stored in a `Map<teamSessionId, ResolveFn>`. The `POST .../resume` API
handler looks up and calls the stored resolve function, unblocking the generator.

### API endpoints

```
POST /api/v1/conversations/:id/team/propose
     → returns TeamSession + TeamProposal

POST /api/v1/team-sessions/:id/approve
POST /api/v1/team-sessions/:id/reject
POST /api/v1/team-sessions/:id/resume     (after checkpoint)

GET  /api/v1/team-sessions/:id
GET  /api/v1/team-sessions/:id/memory
POST /api/v1/team-sessions/:id/memory     (manual entry, e.g. user annotation)

GET  /api/v1/conversations/:id/team-sessions
```

### WebSocket events (channel: `team:{sessionId}`)

```
team:proposed          TeamProposal
team:phase_started     { phase, agents[] }
team:agent_started     { agentId, conversationId, phase }
team:agent_progress    { agentId, turn, toolCall }        ← new
team:agent_completed   { agentId, status, summary }
team:memory_written    { teamSessionId, entry }           ← new
team:checkpoint        { phase, message }
team:completed         { totalTokens, totalCostUsd }
team:failed            { error }
```

### New agent tools

```typescript
write_team_memory(key, value, category, visibility?)
  → TeamSessionService.writeMemory()
  → emits team:memory_written

read_team_memory(category?, key?)
  → TeamSessionService.readMemory() with role-based filter
```

### Context injection

`injectTeamMemory(agentId, teamSessionId)` helper filters `team_memory` by
`visibility` matching the agent's role, then injects a `<team-context>` block
into the agent's system prompt. Agents receive only what is relevant to their role
(minimum context principle — prevents ~15× token bloat in multi-agent systems).

---

## 3. Frontend

### A — Team Proposal Card (in chat stream)

When the main agent calls `propose_team`, a `team:proposed` WebSocket event renders
a special interactive card inline in the conversation chat (not a modal or separate page):

```
┌─────────────────────────────────────────────────────┐
│ 🤝 Team javaslat                                    │
│ "Ez a feladat 3 párhuzamos agenttel hatékonyabb."   │
│                                                     │
│ Fázis 1 — Tervezés (sequential)                     │
│   • Researcher Agent                                │
│                                                     │
│ Fázis 2 — Implementáció (parallel)                  │
│   • Developer Agent                                 │
│   • Code Reviewer Agent                             │
│                                                     │
│ ⚠️  Hiányzó specialista:                            │
│   Database Migration Expert — még nem létezik       │
│   [Létrehozom most]  [Kihagyom]                     │
│                                                     │
│ ~45 000 token · ~$0.08 becsült költség              │
│                                                     │
│ [Elfogadom]  [Módosítom]  [Mégse]                   │
└─────────────────────────────────────────────────────┘
```

- **"Létrehozom most"** — navigates to Agent Wizard with `pendingMessage` pre-filled
  from the `AgentGap` data. On wizard completion, returns to the proposal card with
  the gap resolved.
- **"Módosítom"** — renders the card in edit mode: phases become drag-reorderable,
  agents are togglable.
- **"Elfogadom"** — calls `POST /api/v1/team-sessions/:id/approve`, begins execution.

Component: `src/web/src/pages/conversations/components/team-proposal-card.tsx`

### B — Enhanced SubConversationTree (right panel)

The existing `SubConversationTree` component gains real-time progress per node,
driven by `team:agent_progress` WebSocket events:

```
▼ Team Session #abc123  [running]
  ├─ Fázis 1: Tervezés ✓
  │   └─ Researcher Agent ✓  [4 turn · 12k token]
  └─ Fázis 2: Implementáció  [running]
      ├─ Developer Agent 🔄  [turn 3 · read_file...]
      └─ Code Reviewer Agent ⏳ [várakozik]
```

Checkpoint state renders an inline approval button directly in the tree node.

Component: `src/web/src/pages/conversations/components/sub-conversation-tree.tsx` (enhanced)

### C — Team Dashboard (expand view)

An "Expand to Team View" button appears in the right panel when a team session is
active. Clicking it replaces the conversation chat with a full-width team dashboard:

```
┌────────────────┬────────────────┬────────────────┐
│ Developer      │ Code Reviewer  │ Researcher     │
│ [running] 🔄   │ [waiting] ⏳   │ [done] ✓       │
│                │                │                │
│ Turn 3/20      │                │ 4 turns        │
│ read_file()... │                │ 12 450 token   │
│                │                │                │
│ [View chat]    │ [View chat]    │ [View chat]    │
└────────────────┴────────────────┴────────────────┘
  Team Memory — findings (3) · decisions (1) · blockers (0)
  [scrollable recent entries]
```

- Agent cards update in real-time via `team:agent_progress` events.
- "View chat" navigates into the child conversation (collapses back to standard view).
- Team Memory section shows latest entries from `team_memory`, grouped by category.
- A "Collapse" button returns to the standard conversation view with the right panel.

Component: `src/web/src/pages/conversations/components/team-dashboard.tsx`

Store: `src/web/src/stores/team-session-store.ts` — tracks active team session,
agent states, and memory entries; subscribes to `team:{sessionId}` WebSocket channel.

---

## 4. Self-Improvement Loop

Agent gap detection closes a self-improvement feedback loop:

```
Task arrives
  → analyzeAndPropose() identifies AgentGap
  → User creates the missing agent via AI Wizard
  → New agent stored in agent_definitions
  → Future tasks can use the new specialist
```

This is the "Forge Evolution" pattern: the system observes a capability gap,
proposes filling it, and the user adopts the new agent. The agent wizard's
`pendingMessage` is pre-populated with the gap's `suggestedName`, `suggestedRole`,
`capabilities`, and `reason` so the AI can scaffold the new agent automatically.

---

## 5. Key Constraints

- Max parallel agents: configurable in TeamConfig (default: 3), enforced by orchestrator
- Max delegation depth: 5 levels (existing, unchanged)
- Team memory TTL: entries persist for session lifetime; archived (not deleted) on session completion
- Visibility filter: agents only receive `team_memory` entries matching `all` or their role
- Provider agnostic: each agent in a team uses its own configured provider/model; `modelRouting: 'auto'` overrides via ModelRouter
- No Enterprise code: agent wizard uses existing EYAS wizard skill, no Anthropic-specific patterns copied

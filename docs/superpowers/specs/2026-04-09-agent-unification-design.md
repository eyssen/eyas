# Agent Unification Design

**Date:** 2026-04-09
**Status:** Draft
**Scope:** Unified agent taxonomy (tier + agentType), Users↔agent_definitions linking, setup wizard update, frontend agent management

---

## 1. Overview

EYAS currently has two disconnected systems for agents: agent-type users in the `users` table (identity, board presence) and agent definitions in `agent_definitions` (AI configuration). This design unifies them with a clear separation: Users = identity/communication, agent_definitions = AI behavior, linked via FK.

### Design Principles

- **Users = identity** — name, avatar, email, communication channels, board assignee
- **agent_definitions = AI behavior** — role, goal, backstory, systemPrompt, tools, constraints
- **Primary agents live in both** — Users record (identity) + agent_definitions record (AI config), linked
- **Team/specialist agents live only in agent_definitions** — internal executors, no external identity
- **No automatic deletion** — disabled agents remain as reusable knowledge

---

## 2. Agent Taxonomy

### Tier (who creates/starts it)

| Tier | Created by | Started by | Users record? |
|------|-----------|-----------|---------------|
| `primary` | Human user via UI or setup wizard | User directly — conversation leader | **Yes** (mandatory) |
| `team` | Human user or primary agent | Primary agent delegates — project-level reusable | No |
| `specialist` | Any agent, on-the-fly | Any agent delegates — single task focus | No |

### AgentType (what it does)

| agentType | Description | Example |
|-----------|------------|---------|
| `assistant` | General helper, broad scope | Jarvis |
| `engineer` | System/platform engineer | R2D2 |
| `developer` | Domain-specific code writer | Backend Dev, Odoo Dev |
| `reviewer` | Code/content quality check | Code Reviewer, Security Auditor |
| `critic` | Devil's advocate, systematic challenge | Devils Advocate |
| `researcher` | Information gathering, analysis | Researcher, Docs Analyst |
| `planner` | Task decomposition, planning | Product Owner, Architect |
| `coordinator` | Team orchestration, delegation | Team Lead, Orchestrator |
| `observer` | Passive monitoring, alerts | Monitor, Quality Observer |

---

## 3. Data Model

### Schema Changes

#### `agent_definitions` table — new columns

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `tier` | TEXT | `'specialist'` | `'primary'` / `'team'` / `'specialist'` |
| `agent_type` | TEXT | `'assistant'` | One of the agentType values above |

Note: `goal` and `backstory` columns already exist from the prompt-system feature.

#### `users` table — new column

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `agent_definition_id` | TEXT | NULL | FK to `agent_definitions.id`. NULL for human users. |

### Relationships

```
users (isAgent=true)
  └─ agentDefinitionId → agent_definitions (tier='primary')

conversations
  ├─ userId → users (creator, always human)
  ├─ agentId → agent_definitions (AI executor, any tier)
  └─ assignees → JSON array of user IDs (humans + primary agent users)

projects / project_types
  └─ defaultAgentId → agent_definitions
```

### Rules

- Primary agents **must** have a Users record (for board assignee, communication)
- Team/specialist agents **must not** have a Users record
- `conversations.agentId` references `agent_definitions.id` (unchanged)
- `conversations.assignees` contains user IDs (primary agents accessible via their Users record)
- At least one primary agent must exist at all times

---

## 4. Setup Wizard

The existing "First Agent" setup step changes:

### Current behavior
Creates a user record with `isAgent=true`, no agent_definitions link.

### New behavior

**Step: "Create your AI assistant"**

Inputs:
- Agent name (text, default: "Jarvis")
- Agent role (text, default: "Personal AI Assistant")
- System prompt (textarea, pre-filled with suggested default from `docs/prompt-content-reference.md`)

On submit:
1. Create `agent_definitions` record:
   - `tier = 'primary'`
   - `agentType = 'assistant'`
   - `role`, `goal`, `backstory` from defaults
   - `systemPrompt` from user input
   - `source = 'seed'`
   - `enabled = true`
2. Create `users` record:
   - `username` = lowercase agent name
   - `displayName` = agent name
   - `role = 'agent'`
   - `isAgent = true`
   - `agentDefinitionId` = the new agent_definitions.id
   - `passwordHash = NULL`
3. Set `defaultAgentId` on the "General" project type to the new agent

---

## 5. Agent Lifecycle

### Creating agents

**Primary agent (from Users page):**
1. User clicks "+ New Agent" on Users page
2. Enters: name, avatar, (optional: email)
3. System creates both: Users record + agent_definitions record (linked)
4. Redirects to Agents page for AI configuration (role, goal, backstory, systemPrompt, tools)

**Team/specialist agent (from Agents page):**
1. User clicks "+ New Agent" on Agents page
2. Selects tier (team/specialist) and agentType
3. Configures: name, role, goal, backstory, systemPrompt, tools, constraints
4. Only agent_definitions record is created

**On-the-fly specialist (programmatic):**
1. Primary agent identifies need for specialist during task execution
2. Creates agent_definitions record: `tier='specialist'`, `source='generated'`
3. Delegates sub-task to the new specialist
4. Specialist remains available for future reuse (`enabled=true`)

### Deletion rules

| Tier | Deletable? | Rule |
|------|-----------|------|
| primary | Only if not the last primary | At least 1 primary must always exist |
| team | Soft delete only | Set `enabled=false`, keep for future reuse |
| specialist | Soft delete only | Set `enabled=false`, never auto-delete |

---

## 6. Frontend Changes

### Users page (currently read-only — needs full CRUD anyway)

**New functionality:**
- Create/edit/delete users (full CRUD — separate from this feature but needed)
- "+ New Agent" button creates agent-type user + linked agent_definitions
- Agent-type users show "AI Configuration →" link to Agents detail page
- Type badge: 🤖 Agent / 👤 Human

**Not in this feature's scope:** Full Users CRUD (edit human users, password reset, role changes). That's a separate task.

### Agents page

**Filter additions:**
- Tier filter: All / Primary / Team / Specialist
- AgentType filter dropdown

**List view additions:**
- Tier badge on each agent card
- AgentType label
- Primary agents show linked user info (avatar, email if set)

### Agent detail page

**New sections:**

```
┌─ Classification ─────────────────────────────┐
│  Tier: [primary ▾]  AgentType: [assistant ▾] │
└───────────────────────────────────────────────┘
┌─ Persona ────────────────────────────────────┐
│  Role: [___________________________________] │
│  Goal: [___________________________________] │
│  Backstory: [______________________________] │
└───────────────────────────────────────────────┘
```

Existing sections (System Prompt, Model, Tools, Capabilities, Constraints, Budget) remain unchanged.

### Prompt Settings (new section in Settings)

Displays master prompt sections from DB:
- Identity (🔒 locked, readonly)
- Core Rules (🔒 locked, readonly)
- Personality (✏️ editable, save button)

---

## 7. API Changes

### Agent API (`/api/v1/agents`)

**New query parameters:**
- `GET /agents?tier=primary` — filter by tier
- `GET /agents?agentType=developer` — filter by agentType

**Response additions:**
- `tier` and `agentType` fields in agent response
- `linkedUserId` for primary agents (the Users record ID)

### Users API (`/api/v1/users`)

**Response additions:**
- `agentDefinitionId` field (null for human users)

**New endpoint:**
- `POST /users/agents` — create agent-type user + linked agent_definitions in one call

### Prompt API (`/api/v1/prompts`)

**Existing endpoints unchanged.** The `GET /prompts/preview/:conversationId` already works.

**New endpoint:**
- `GET /prompts/master` — returns the 3 master prompt sections with locked status
- `PATCH /prompts/master/personality` — update the personality section content

---

## 8. PromptAssembler Integration

The PromptAssembler (already implemented) needs **no changes**. It already:
- Resolves agents from `agent_definitions` via `getAgent(id)`
- Builds persona from role/goal/backstory/systemPrompt
- Supports the prompt hierarchy (master → type → project → agent → conversation)

The `tier` and `agentType` fields are metadata for the UI and orchestrator — the assembler doesn't need them.

---

## 9. Scope Boundaries

### In scope
- `tier` and `agentType` columns on agent_definitions
- `agentDefinitionId` column on users
- Setup wizard update (creates both records)
- Agent detail page: add goal/backstory/tier/agentType fields
- Agents page: tier and agentType filters
- Users page: "AI Configuration →" link for agent users, "+ New Agent" button
- Prompt Settings section (master prompt display/edit)
- API additions (filters, new fields, new endpoints)

### Out of scope (separate features)
- Full Users CRUD (edit/delete human users, password reset)
- Communication channel configuration (email, telegram per agent)
- Agent-to-agent on-the-fly creation (orchestrator integration)
- Board assignee picker UI enhancement

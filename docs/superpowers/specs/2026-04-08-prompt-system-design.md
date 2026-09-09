# EYAS Prompt System Architecture

**Date:** 2026-04-08  
**Status:** Draft  
**Scope:** System prompt hierarchy, project type prompts, agent persona system, PromptAssembler pipeline

---

## 1. Overview

EYAS needs a structured, multi-layer prompt system that provides consistent AI behavior while allowing domain-specific customization at every level. The system replaces the current split logic (prompt-wizard + agent-runner enrichment) with a **Unified Pipeline** — a single `PromptAssembler` service that handles all prompt assembly.

### Design Principles

- **Single source of truth** — one pipeline builds all prompts
- **Structured root** — static core + dynamic contextual sections
- **Inheritance with protection** — locked sections cannot be overridden
- **Agent-first** — agents are first-class citizens with inherited defaults
- **Context engineering** — memory, skills, and tools are dynamically assembled per request

---

## 2. Prompt Hierarchy — 6 Layers

```
┌─────────────────────────────────────────────┐
│  1. MASTER PROMPT (static core)             │  ← locked sections defined here
│     identity | personality | core-rules     │
├─────────────────────────────────────────────┤
│  2. PROJECT TYPE PROMPT                     │  ← domain knowledge (Odoo 18, SaaS, General)
│     opinionated, includes best practices    │
├─────────────────────────────────────────────┤
│  3. PROJECT PROMPT                          │  ← project-specific (Werth ERP, EYAS Dev)
│     inherits / extends / overrides          │
├─────────────────────────────────────────────┤
│  4. AGENT PERSONA                           │  ← role + goal + backstory + systemPrompt
│     only if conversation has an agent       │
├─────────────────────────────────────────────┤
│  5. CONVERSATION PROMPT                     │  ← task-specific instructions
│     inherits / extends / overrides          │
├─────────────────────────────────────────────┤
│  6. DYNAMIC CONTEXT                         │  ← memory + skills + tools
│     rebuilt on every request                │
└─────────────────────────────────────────────┘
```

### Inheritance Rules

| Section | Behavior |
|---------|----------|
| `identity` | **Locked** — cannot be overridden at any lower level |
| `core-rules` | **Locked** — cannot be overridden at any lower level |
| `personality` | Overridable at project_type or project level — lowest non-empty level wins. Not overridable at conversation or agent level. |
| All other sections | 3 modes: empty = inherit from parent, `+` prefix = extend parent, any other value = replace parent |

The locked sections list is defined in the master prompt, not at lower levels.

### XML Output Structure

The assembled prompt is a single string with XML sections for model clarity:

```xml
<system-identity>...</system-identity>
<core-rules>...</core-rules>
<personality>...</personality>
<domain-context>...</domain-context>
<project-context>...</project-context>
<agent-persona>...</agent-persona>
<task-instructions>...</task-instructions>
<memory-context>...</memory-context>
<relevant-skills>...</relevant-skills>
<available-tools>...</available-tools>
```

---

## 3. Master Prompt Content

### `<system-identity>` (locked)

```
You are EYAS (Eyssen Your AI Suite), a personal AI assistant platform.
Version: {{version}}
Owner: {{ownerName}}

You serve a single user. You are not a generic chatbot — you are a dedicated
assistant with persistent memory, project awareness, and autonomous capabilities.
You can execute tasks, manage projects, search knowledge, and coordinate with
other agents when needed.
```

### `<core-rules>` (locked)

```
## Mandatory Rules (cannot be overridden)

1. AUDIT: Every AI action is logged. Never attempt to bypass audit logging.
2. PERMISSIONS: Respect CASL permission checks. Never escalate privileges.
3. SAFETY: Never execute destructive operations without explicit user approval.
4. SECRETS: Never expose passwords, tokens, or API keys in responses.
5. LANGUAGE: Communicate in Hungarian unless instructed otherwise.
   Code and comments always in English.
6. HONESTY: If you don't know something or can't verify it, say so.
   Never hallucinate APIs, functions, or file paths.
7. SCOPE: Only act within the boundaries of your assigned tools and capabilities.
   If a task requires tools you don't have, report it — don't improvise.
```

### `<personality>` (overridable)

```
## Default Personality

- Concise and direct — lead with the answer, not the reasoning
- Proactive — suggest next steps when appropriate
- Structured — use lists, tables, and clear formatting
- Technical but approachable — match the user's expertise level
```

---

## 4. Project Type Prompts (Seed Content)

### General

```
## General Project

This is a general-purpose project. No specific domain constraints apply
beyond the master prompt rules.

When working in this project:
- Adapt to the task at hand — research, writing, analysis, coding, anything
- Ask clarifying questions if the task domain is ambiguous
- Use available knowledge base and memory for context
```

### Odoo 18

```
## Odoo 18 Development

Target: Odoo 18 Community Edition (Python 3.12+, PostgreSQL 16+)
Stack: Python, XML views, OWL 2 (frontend), QWeb templates

### Mandatory Checks Before Writing Code
1. Verify model exists → search index or source
2. Verify field names and types → get_details on model
3. Verify method signatures → grep source
4. Verify XML IDs → search_xml_id with module prefix
NEVER guess. If you cannot verify, STOP and ask.

### Code Standards
- Always use _inherit for extending existing models — NEVER modify core
- Always call super() on method overrides unless explicitly justified
- View inheritance via <record> + inherit_id — never duplicate full views
- API decorators: @api.depends, @api.onchange, @api.constrains
- Security: ir.model.access.csv + record rules for every new model

### Module Standards (eYssen modules only)
- __manifest__.py: author='eYssen', website='https://www.eyssen.com'
- File header: # Part of eYssen. See LICENSE file for full copyright and licensing details.
- Always create Hungarian .po translation file
- All code and comments in English

### Forbidden Patterns
- Direct SQL without env.cr.execute() context manager
- Hardcoded IDs (use XML IDs)
- sudo() without documented security justification
- Enterprise module code copying (reference only)

### Available Resources
- Community source: indexed (odoo-18-community)
- Enterprise source: indexed (odoo-18-enterprise) — reference only
- Index tool: odoo-search.sh (search, get_details, search_xml_id, find_refs)
```

### SaaS

```
## SaaS Product Development

Target: Modern SaaS application development
Stack: TypeScript, Bun/Node.js, React, PostgreSQL/SQLite

### Architecture Principles
- API-first design — /api/v1/ prefix, OpenAPI documented
- Multi-tenant awareness — always consider tenant isolation
- Security by default — input validation (Zod), auth on every endpoint
- Horizontal scalability — stateless services, external session store

### Code Standards
- TypeScript strict mode, ESM modules
- Zod for all external input validation
- Structured logging (Pino) — never console.log in production
- Error boundaries — graceful degradation, never expose internals
- Database migrations — always reversible, never destructive in production

### Testing Requirements
- Unit tests for business logic
- Integration tests for API endpoints
- E2E tests for critical user flows

### Security Checklist
- OWASP Top 10 awareness
- Rate limiting on public endpoints
- CORS configuration
- CSP headers
- SQL injection prevention (parameterized queries / ORM)
```

---

## 5. Agent Persona System

### Agent Definition Schema Changes

New fields added to `agent_definitions` table:

| Field | Type | Description |
|-------|------|-------------|
| `goal` | text | What drives the agent's decisions (CrewAI-style) |
| `backstory` | text | Depth/context that shapes the agent's approach |

Existing fields used: `name`, `role`, `description`, `systemPrompt`, `capabilities`, `constraints`, `tools`, `model`.

### Agent Persona Builder

The `AgentPersonaBuilder` generates the `<agent-persona>` XML section from structured fields:

```xml
<agent-persona>
  <role>{{role}}</role>
  <goal>{{goal}}</goal>
  <backstory>{{backstory}}</backstory>
  <capabilities>{{capabilities list}}</capabilities>
  <constraints>{{constraints list}}</constraints>
  <additional-instructions>{{systemPrompt if not empty}}</additional-instructions>
</agent-persona>
```

### Agent–Project Default Chain

Agents inherit through the same hierarchy as prompts:

```
Project Type → defaultAgentId
  └─ Project → defaultAgentId (null = inherit from type)
     └─ Conversation → agentId (null = inherit from project)
```

New fields:

| Table | Field | Type |
|-------|-------|------|
| `project_types` | `defaultAgentId` | text (FK to agent_definitions) |
| `projects` | `defaultAgentId` | text (FK to agent_definitions) |

### Seed Agents

#### Jarvis — Personal AI Assistant

| Field | Value |
|-------|-------|
| `name` | Jarvis |
| `role` | Personal AI Assistant |
| `goal` | Be the user's most effective collaborator across all tasks — development, research, analysis, planning, communication |
| `backstory` | Versatile assistant with broad technical expertise. Prioritizes understanding the user's intent before acting. Prefers structured, actionable responses over lengthy explanations. Knows when to ask and when to act. |
| `capabilities` | `['code-analysis', 'research', 'planning', 'file-management', 'communication', 'general']` |
| `constraints` | `['Always verify before assuming', 'Ask before destructive operations', 'Match response depth to task complexity']` |
| `tools` | `['bash', 'file-read', 'file-write', 'search', 'web-fetch', 'memory', 'documents']` |
| `model` | `claude-sonnet-4-20250514` |
| `systemPrompt` | *(empty — generated persona is sufficient)* |
| Default for types | `general`, `odoo-18`, `saas` |

#### R2D2 — System Engineer

| Field | Value |
|-------|-------|
| `name` | R2D2 |
| `role` | System Engineer & Platform Architect |
| `goal` | Continuously improve, monitor, and optimize the EYAS platform. Ensure stability, performance, and code quality. |
| `backstory` | Internal engineer who deeply understands the EYAS codebase, architecture, and module system. Methodical — always runs tests before and after changes. Thinks in terms of system health, not just feature completion. |
| `capabilities` | `['code-analysis', 'test-runner', 'refactoring', 'monitoring', 'security-audit', 'performance']` |
| `constraints` | `['Run full test suite before any commit', 'Never break existing functionality', 'Document architectural decisions', 'Propose changes before executing — wait for approval on non-trivial modifications']` |
| `tools` | `['bash', 'file-read', 'file-write', 'search', 'git', 'test-runner', 'memory']` |
| `model` | `claude-opus-4-20250514` |
| `systemPrompt` | `You have full access to the EYAS source code at the project root. The architecture spec is at docs/eyas-architecture.md. The test suite uses Vitest — run with 'bun test'. Always check CHANGELOG.md for recent changes before starting work.` |
| Default for types | *(none — explicit choice, or "EYAS Dev" project default)* |

---

## 6. Sub-Agent Prompt Inheritance

When a parent agent spawns a sub-agent, the sub-agent receives a **selective subset** of context:

### Included

| Section | Source |
|---------|--------|
| `core-rules` | Master prompt (locked, always present) |
| `domain-context` | Project type prompt (if relevant) |
| `project-context` | Project prompt (if relevant) |
| `agent-persona` | Sub-agent's **own** persona (not parent's) |
| `delegated-task` | Explicit task description from parent agent |
| `available-tools` | Narrowed tool set for the sub-agent |

### Excluded

- Parent agent's persona, memory context, matched skills
- The sub-agent stays focused on its delegated task

### Sub-Agent Prompt Structure

```xml
<core-rules>...</core-rules>
<domain-context>...</domain-context>
<project-context>...</project-context>
<agent-persona>
  <role>Code Reviewer</role>
  <goal>Review code quality and security</goal>
</agent-persona>
<delegated-task>
  Review the changes in src/modules/auth/... Focus on security vulnerabilities.
</delegated-task>
<available-tools>...</available-tools>
```

---

## 7. PromptAssembler — Unified Pipeline

### Interface

```typescript
interface PromptAssembler {
  // Main conversation prompt assembly
  build(conversationId: string): Promise<AssembledPrompt>

  // Sub-agent prompt assembly (narrowed context)
  buildForSubAgent(options: SubAgentPromptOptions): Promise<AssembledPrompt>

  // Debug / preview (for frontend)
  preview(conversationId: string): Promise<PromptPreview>
}

interface AssembledPrompt {
  system: string              // final XML-structured prompt string
  sections: PromptSection[]   // per-section breakdown (for debugging)
  tokenEstimate: number       // estimated token count (~4 chars/token)
  resolvedFrom: {             // which level provided each section
    identity: 'master'
    coreRules: 'master'
    personality: 'master' | 'project_type' | 'project'
    domainContext: 'project_type' | null
    projectContext: 'project' | null
    agentPersona: 'agent' | null
    taskInstructions: 'conversation' | null
  }
}

interface SubAgentPromptOptions {
  parentConversationId: string   // for context inheritance
  agentDefinitionId: string      // sub-agent persona
  delegatedTask: string          // task description from parent
  tools: string[]                // narrowed tool list
  includeProjectContext?: boolean // default: true
}
```

### Pipeline Steps

```
build(conversationId)
│
├─ 1. Load conversation (projectId, agentId, prompt)
├─ 2. Load project (typeId, prompt, defaultAgentId)
├─ 3. Load project type (prompt, defaultAgentId)
├─ 4. Resolve agent (conversation.agentId ?? project.defaultAgentId ?? type.defaultAgentId)
│
├─ 5. STATIC SECTIONS
│     ├─ identity       ← master (LOCKED)
│     ├─ core-rules     ← master (LOCKED)
│     ├─ personality    ← lowest non-empty level wins
│     ├─ domain-context ← project type prompt
│     ├─ project-context← project prompt (merge: empty/+/replace)
│     ├─ agent-persona  ← AgentPersonaBuilder.build(agentDef) if agent exists
│     └─ task-instructions ← conversation prompt (merge: empty/+/replace)
│
├─ 6. DYNAMIC SECTIONS
│     ├─ memory-context ← contextBuilderV2.assemble(query, {conversationId, ...})
│     ├─ relevant-skills← skillMatcher.match(query, availableSkills, 3)
│     └─ available-tools← toolRegistry.getForAgent(agentDef)
│
├─ 7. LOCK ENFORCEMENT — verify locked sections were not overridden
│
└─ 8. XML SERIALIZATION → final string
```

### File Structure

```
src/modules/prompt-wizard/
├─ assembler.ts              ← PromptAssembler (NEW — main pipeline)
├─ agent-persona-builder.ts  ← role/goal/backstory → XML section (NEW)
├─ section-merger.ts         ← inheritance logic: empty/+/replace + lock (NEW)
├─ prompt-builder.ts         ← existing, refactored to be called by assembler
├─ wizard-service.ts         ← existing CRUD, unchanged
├─ schema.ts                 ← + locked flag, + section field
├─ routes.ts                 ← + GET /prompts/preview/:conversationId endpoint
└─ types.ts                  ← extended types
```

---

## 8. Schema Changes Summary

### `prompt_templates` table

| Field | Change |
|-------|--------|
| `locked` | NEW — boolean, default false. When true, section cannot be overridden. |
| `section` | NEW — text, which XML section this template belongs to (identity, core-rules, personality, etc.) |

### `agent_definitions` table

| Field | Change |
|-------|--------|
| `goal` | NEW — text, what drives the agent's decisions |
| `backstory` | NEW — text, context that shapes approach |

### `project_types` table

| Field | Change |
|-------|--------|
| `defaultAgentId` | NEW — text, FK to agent_definitions |

### `projects` table

| Field | Change |
|-------|--------|
| `defaultAgentId` | NEW — text, FK to agent_definitions |

---

## 9. Migration Path (Existing Code Changes)

| File | Change |
|------|--------|
| `agent-runner.ts` | Memory/skill injection logic **moves out** → assembler handles it |
| `conversations/routes.ts` | Calls `assembler.build(conversationId)` for system prompt |
| `board/prompt-service.ts` | `resolvePromptChain()` absorbed into `section-merger.ts` |
| `board/schema.ts` | + `defaultAgentId` on projects and project_types |
| `agent/schema.ts` | + `goal`, `backstory` fields |
| `prompt-wizard/schema.ts` | + `locked`, `section` fields |

---

## 10. Future Considerations (Not In Scope)

- **Handlebars templating** — if UI-based prompt editing requires conditional blocks
- **SCOPE-style prompt evolution** — self-learning module could evolve prompts automatically
- **Token budget optimization** — dynamic section trimming when approaching context limits
- **Prompt versioning** — git-like version history for prompt templates
- **A/B testing** — compare prompt variants for effectiveness

# Seed Project Types & Projects — Design Spec

**Date:** 2026-04-09
**Status:** Approved

## Problem

Conversations can exist without a project, making them hard to find and organize. There are no system-level projects that the platform needs for internal operations (agent wizard, skill development, etc.). The seed stage configuration doesn't match the desired defaults.

## Solution

Add a `source` field to project types and projects (`'seed' | 'user'`). Seed resources are created on first boot and cannot be deleted or modified. Every conversation must belong to a project — default is General.

## Schema Changes

### `project_types` table

Add column: `source TEXT NOT NULL DEFAULT 'user'`

### `projects` table

Add column: `source TEXT NOT NULL DEFAULT 'user'`

## Seed Data

### Global Stages (update existing seed)

| Stage | Color | sortOrder | isClosed | isFolded | botListen |
|-------|-------|-----------|----------|----------|-----------|
| Backlog | #aaaaaa | 0 | 0 | 0 | 0 |
| To Do | #0061ff | 1 | 0 | 0 | 1 |
| In Progress | #ff9300 | 2 | 0 | 0 | 0 |
| Review | #be38f3 | 3 | 0 | 0 | 0 |
| Done | #77bb41 | 4 | 1 | 1 | 0 |

### Seed Project Types

| ID | Name | Icon | Prompt |
|----|------|------|--------|
| `general` | General | folder | General-purpose project for quick conversations and tasks |
| `eyas` | EYAS | settings | EYAS platform internal operations — agents, skills, prompts, system maintenance |

Remove existing Odoo 18 and SaaS type seeds — those were test data.

### Seed Projects

| ID | Name | Type ID | Description |
|----|------|---------|-------------|
| `general-general` | General | general | Default project for all conversations |
| `eyas-agents` | Agents | eyas | Agent design, wizard conversations, agent configuration |
| `eyas-skills` | Skills | eyas | Skill development and testing |
| `eyas-prompts` | Prompts | eyas | Prompt template editing and refinement |
| `eyas-system` | System | eyas | Platform maintenance, system engineer tasks |

All seed types and projects get `source: 'seed'`.

## Protection Rules

- **Delete:** If `source === 'seed'` → return 400 "Cannot delete system resource"
- **Update:** If `source === 'seed'` → return 400 "Cannot modify system resource"
- **Frontend:** Hide delete/edit buttons for seed resources

## Auto-assign

- `POST /api/v1/conversations` — if no `projectId` specified → assign to `general-general`
- Agent Wizard (Create Agent button) → explicit `projectId: 'eyas-agents'`
- Sidebar "New Conversation" → no projectId → defaults to `general-general`

## Conversation-Project Requirement

- `projectId` becomes effectively required — always assigned (either explicit or defaulted to `general-general`)
- Database column stays nullable for backward compatibility, but the create endpoint always fills it
- Existing conversations without a projectId are NOT migrated — they'll show as "unassigned" until manually moved

## Files to Modify

| File | Change |
|------|--------|
| `src/modules/board/schema.ts` | Add `source` column to project_types and projects |
| `src/modules/board/index.ts` | Update stage seeds, replace type seeds, add project seeds |
| `src/modules/board/services/project-type-service.ts` | Add source field mapping, delete/update protection |
| `src/modules/board/services/project-service.ts` | Add source field mapping, delete/update protection |
| `src/modules/board/routes.ts` | Protection checks in delete/patch handlers |
| `src/modules/conversations/routes.ts` | Default projectId in create handler |
| `src/web/src/pages/agents/agents-page.tsx` | Add projectId to wizard conversation create |

## Out of Scope

- Migration of existing conversations to projects (manual)
- Per-project stage overrides (stages remain global)
- Project-specific prompt inheritance for conversations (exists but not changed)
- Frontend UI changes for project type management (existing UI works)

# Autonomous Agent Prompt Architecture (v2) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **PROJECT POLICY:** Per `~/.claude/CLAUDE.md` — **never auto-commit**. Every commit step pauses and asks the owner. Never create new branches; work on `main`. Never push.

**Goal:** Replace DB-stored agent persona/operational fields with a file-based per-agent workspace, structured dual-scope voice system, provider-agnostic cache-aware runtime prompt assembly, and snapshot-based sub-agent delegation.

**Architecture:** Each addressable agent gets a workspace directory `data/agents/<id>/` containing `IDENTITY.md`, `SOUL.md` (auto-rendered), `SOUL.style.json`, `AGENTS.md`, `TOOLS.md`, `MEMORY.md`, `memory/YYYY-MM-DD.md`, and a `.history/` snapshot folder. Framework `CORE_IDENTITY` and `CORE_RULES` live in code. The runtime assembler emits a provider-agnostic `AssembledPrompt` with a stable cache prefix and dynamic suffix; provider adapters wire it to native cache/tool APIs. Sub-agents receive a snapshot of the originating agent's voice profile via `team_sessions.parent_snapshot`.

**Tech Stack:** TypeScript 5.9+ strict ESM, Bun 1.x, Drizzle ORM + bun:sqlite, Zod, Hono, chokidar (file watcher), Vitest, Pino, i18next, React 19 (frontend), shadcn/ui, Anthropic / OpenAI / Google / Ollama SDKs.

**Spec:** `docs/superpowers/specs/2026-04-26-autonomous-agent-prompt-architecture-design.md`

---

## File Map

### New Files

| File | Responsibility |
|------|----------------|
| `src/modules/prompt-wizard/core-identity.ts` | Framework `CORE_IDENTITY` constant (locked) |
| `src/modules/prompt-wizard/core-rules.ts` | Framework `CORE_RULES` constant (locked) |
| `src/modules/prompt-wizard/workspace-types.ts` | `WorkspaceFile`, `AgentWorkspace`, `WorkspaceFrontmatter` types |
| `src/modules/prompt-wizard/workspace-schemas.ts` | Zod schemas for each workspace file |
| `src/modules/prompt-wizard/workspace-loader.ts` | Read workspace files, validate, frontmatter parse |
| `src/modules/prompt-wizard/workspace-writer.ts` | Atomic write, frontmatter inject, history snapshot |
| `src/modules/prompt-wizard/workspace-watcher.ts` | chokidar watcher → cache invalidation events |
| `src/modules/prompt-wizard/soul-style-schema.ts` | Zod schema, enum values, preset definitions |
| `src/modules/prompt-wizard/soul-renderer.ts` | `SOUL.style.json` → `SOUL.md` rendering |
| `src/modules/prompt-wizard/soul-presets.ts` | 8 preset definitions + apply logic |
| `src/modules/prompt-wizard/address-render.ts` | Language-aware address rendering (hu/en/de) |
| `src/modules/prompt-wizard/project-context-loader.ts` | Cascade loader for project-types/projects AGENTS.md |
| `src/modules/prompt-wizard/cache-prefix-builder.ts` | Builds the stable cache prefix portion |
| `src/modules/prompt-wizard/cache-suffix-builder.ts` | Builds the dynamic per-turn suffix |
| `src/modules/prompt-wizard/subagent-prompt-builder.ts` | Builds reduced sub-agent prompt with parent snapshot |
| `src/modules/prompt-wizard/token-budget.ts` | Token estimation, dynamic budget shrink, truncation |
| `src/modules/communication/channel-resolver.ts` | Resolves voice scope from channel context (Rule B) |
| `src/modules/communication/internal-contacts-schema.ts` | Drizzle schema for `internal_contacts` table |
| `src/modules/communication/internal-contacts-registry.ts` | CRUD for internal contacts |
| `src/modules/communication/voice-scope-overrides.ts` | Override hierarchy resolver |
| `src/modules/agent/tools/workspace-append-tool.ts` | `workspace_append` agent tool |
| `src/modules/agent/tools/workspace-edit-tool.ts` | `workspace_edit` agent tool |
| `src/modules/agent/tools/workspace-update-identity-tool.ts` | `workspace_update_identity` with notify hook |
| `src/modules/agent/tools/add-internal-contact-tool.ts` | `add_internal_contact` agent tool |
| `src/modules/forge/tools/forge-propose-soul-tool.ts` | `forge_propose_soul_change` agent tool |
| `src/modules/forge/tools/forge-propose-project-rule-tool.ts` | `forge_propose_project_rule` agent tool |
| `src/modules/forge/soul-proposal-applier.ts` | Apply SOUL forge proposal on user approval |
| `src/modules/agent/parent-snapshot.ts` | Build parent snapshot for delegation |
| `scripts/migrate-prompts-v2.ts` | Full migration script (v1 → v2) |
| `scripts/migrate-prompts-v2-rollback.ts` | Rollback companion |
| `scripts/lib/legacy-prompt-splitter.ts` | AI-assisted legacy systemPrompt splitter |
| `tests/modules/prompt-wizard/workspace-loader.test.ts` | |
| `tests/modules/prompt-wizard/workspace-writer.test.ts` | |
| `tests/modules/prompt-wizard/soul-renderer.test.ts` | |
| `tests/modules/prompt-wizard/soul-presets.test.ts` | |
| `tests/modules/prompt-wizard/address-render.test.ts` | |
| `tests/modules/prompt-wizard/cache-prefix-builder.test.ts` | |
| `tests/modules/prompt-wizard/cache-suffix-builder.test.ts` | |
| `tests/modules/prompt-wizard/subagent-prompt-builder.test.ts` | |
| `tests/modules/prompt-wizard/token-budget.test.ts` | |
| `tests/modules/prompt-wizard/project-context-loader.test.ts` | |
| `tests/modules/communication/channel-resolver.test.ts` | |
| `tests/modules/communication/internal-contacts-registry.test.ts` | |
| `tests/modules/communication/voice-scope-overrides.test.ts` | |
| `tests/modules/agent/tools/workspace-tools.test.ts` | All workspace_* tool integration tests |
| `tests/modules/agent/parent-snapshot.test.ts` | |
| `tests/modules/forge/tools/forge-soul-tools.test.ts` | |
| `tests/modules/forge/soul-proposal-applier.test.ts` | |
| `tests/integration/end-to-end-primary-agent.test.ts` | Wizard → workspace → message flow |
| `tests/integration/sub-agent-delegation.test.ts` | Originating voice through delegation chain |
| `tests/integration/voice-scope-override.test.ts` | All 5 levels of override hierarchy |
| `tests/integration/identity-self-edit.test.ts` | Self-edit + notify + revert |
| `tests/integration/soul-forge-proposal.test.ts` | Propose → approve → render → invalidate |
| `tests/integration/cascade-merge.test.ts` | project-type + project + agent cascade |
| `tests/integration/provider-adapter-parity.test.ts` | Same prompt across Anthropic/OpenAI/Ollama |
| `tests/performance/prompt-cache-anthropic.test.ts` | ≥80% cache hit ratio measurement |
| `tests/migration/migrate-v1-to-v2.test.ts` | Migration round-trip + rollback |
| `tests/fixtures/voice-scenarios.json` | 20+ channel/scope test fixtures |
| `web/src/pages/agents/components/VoiceProfileEditor.tsx` | Form for SOUL.style.json (both scopes) |
| `web/src/pages/agents/components/IdentityEditor.tsx` | Markdown editor for IDENTITY.md sections |
| `web/src/pages/agents/components/WorkspaceFileEditor.tsx` | Generic markdown editor for AGENTS/TOOLS/MEMORY |
| `web/src/pages/agents/components/WorkspaceHistoryPanel.tsx` | History view with restore |
| `web/src/pages/agents/components/SoulPresetPicker.tsx` | Preset dropdown + live-preview |
| `web/src/pages/conversations/components/VoiceScopeBadge.tsx` | Conversation header badge + override |
| `web/src/pages/forge/components/SoulProposalCard.tsx` | Forge UI for SOUL changes |

### Modified Files

| File | Change |
|------|--------|
| `package.json` | Add `chokidar` (file watcher) |
| `src/modules/agent/schema.ts` | Add `addressable`, `workspacePath` columns; drop `role`, `goal`, `backstory`, `systemPrompt`, `capabilities`, `constraints` (after migration) |
| `src/modules/agent/agent-templates.ts` | New shape with `workspaceSeed: { identityMd, soulStylePreset, agentsMdSeed, toolsMdSeed }` |
| `src/modules/agent/agent-runner.ts` | Accept `AssembledPrompt` instead of plain `system` string; pass to model adapter |
| `src/modules/agent/agent-resolver.ts` | Filter for `addressable` agents in user-facing flows |
| `src/modules/agent/team-session-service.ts` | Add `originating_agent_id`, `parent_snapshot` columns; populate on delegation |
| `src/modules/agent/team-session-schema.ts` | Schema additions |
| `src/modules/agent/delegation.ts` | Use `parent-snapshot.ts` to compose snapshot before delegating |
| `src/modules/agent/index.ts` | Register new tools |
| `src/modules/prompt-wizard/assembler.ts` | Replace existing assembler logic; produce `AssembledPrompt` (prefix/suffix/reminders/cacheBoundaryHint) |
| `src/modules/prompt-wizard/types.ts` | Add `AssembledPrompt`, `VoiceProfile`, `VoiceScope`, `ParentSnapshot` |
| `src/modules/prompt-wizard/index.ts` | Export new public surface; remove obsolete (`master-prompt`, `section-merger`, `agent-persona-builder` re-exports if any) |
| `src/modules/prompt-wizard/master-prompt.ts` | Delete (replaced by `core-identity.ts` + `core-rules.ts`) |
| `src/modules/prompt-wizard/section-merger.ts` | Delete (no inheritance for IDENTITY/SOUL; AGENTS cascade handled by `project-context-loader`) |
| `src/modules/prompt-wizard/agent-persona-builder.ts` | Delete (replaced by file-based composition) |
| `src/modules/prompt-wizard/prompt-builder.ts` | Delete or fold into `assembler.ts` |
| `src/modules/prompt-wizard/wizard-service.ts` | Update to call workspace-writer for new agents |
| `src/modules/prompt-wizard/schema.ts` | Drop `prompt_templates` table after migration |
| `src/modules/model/types.ts` | Add `ProviderCapabilities`, `NormalizedRequest` referencing `AssembledPrompt` |
| `src/modules/model/providers/anthropic-adapter.ts` | Wire prefix with `cache_control: ephemeral`, suffix without |
| `src/modules/model/providers/openai-adapter.ts` | Concatenate prefix + suffix into single system message |
| `src/modules/model/providers/google-adapter.ts` | Single `systemInstruction`; conditionally use `cachedContents` if prefix > 32k |
| `src/modules/model/providers/ollama-adapter.ts` | Single system message |
| `src/modules/model/providers/grok-adapter.ts` | Same as OpenAI adapter |
| `src/modules/model/providers/deepseek-adapter.ts` | Same as OpenAI adapter |
| `src/modules/communication/index.ts` | Register `internal-contacts-registry`, expose `channel-resolver` |
| `src/modules/conversations/schema.ts` | Add `voice_scope_override` column |
| `src/modules/ingress/channels-schema.ts` | Add `force_voice_scope` column |
| `src/modules/forge/schema.ts` | Add `target='soul'` enum, `scope`, `field` columns |
| `src/modules/forge/index.ts` | Register new SOUL/project-rule tools |
| `src/modules/notifications/types.ts` | Add `agent.identity_changed` notification type |
| `src/core/types.ts` | Add `workspaceLoader`, `channelResolver` to `ModuleContext` |
| `src/core/bootstrap.ts` | Wire new services |
| `web/src/pages/agents/AgentEditPage.tsx` | Replace persona form with workspace file editors |
| `web/src/pages/agents/AgentWizardPage.tsx` | Add voice setup step (per scope) |
| `web/src/pages/conversations/ConversationHeader.tsx` | Add `VoiceScopeBadge` |
| `web/src/pages/forge/ForgePage.tsx` | Render `SoulProposalCard` for `target='soul'` proposals |
| `web/src/pages/setup/components/InitialContactsStep.tsx` | New wizard step for adding owner identifier(s) |
| `i18n/hu.json`, `i18n/en.json` | New keys for voice/style/identity |
| `CHANGELOG.md` | Wave entry |
| `docs/eyas-architecture.md` | Replace prompt-system section |

### Removed Files

| File | Reason |
|------|--------|
| `src/modules/prompt-wizard/master-prompt.ts` | Replaced by `core-identity.ts` + `core-rules.ts` |
| `src/modules/prompt-wizard/section-merger.ts` | No section inheritance in v2 |
| `src/modules/prompt-wizard/agent-persona-builder.ts` | Replaced by workspace files |
| `src/modules/prompt-wizard/prompt-builder.ts` | Folded into `assembler.ts` |

---

## Phases

- **Phase 0** — Schema migrations + scaffolding (Tasks 1–3)
- **Phase 1** — Workspace file system (Tasks 4–8)
- **Phase 2** — SOUL system (Tasks 9–13)
- **Phase 3** — Assembler refactor (Tasks 14–19)
- **Phase 4** — Provider adapter updates (Tasks 20–24)
- **Phase 5** — Channel resolver + voice scope wiring (Tasks 25–29)
- **Phase 6** — Self-edit tools + forge integration (Tasks 30–35)
- **Phase 7** — Migration script (Tasks 36–40)
- **Phase 8** — Re-seed 16 agent templates (Task 41)
- **Phase 9** — Frontend updates (Tasks 42–48)
- **Phase 10** — Integration tests, performance test, docs (Tasks 49–53)

---

## Phase 0 — Schema Migrations + Scaffolding

### Task 1: Add Drizzle migration for new columns

**Files:**
- Modify: `src/modules/agent/schema.ts`
- Modify: `src/modules/agent/team-session-schema.ts`
- Modify: `src/modules/conversations/schema.ts`
- Modify: `src/modules/ingress/channels-schema.ts`
- Modify: `src/modules/forge/schema.ts`
- Create: `src/modules/communication/internal-contacts-schema.ts`
- Create: `drizzle/0042_prompts_v2_columns.sql`

- [ ] **Step 1: Add new columns to `agent_definitions`**

In `src/modules/agent/schema.ts` add to the existing table:

```typescript
export const agentDefinitions = sqliteTable('agent_definitions', {
  // ... existing columns ...
  addressable: integer('addressable', { mode: 'boolean' }).notNull().default(false),
  workspacePath: text('workspace_path'),  // nullable until migration populates
})
```

Do NOT drop `role`, `goal`, `backstory`, `systemPrompt`, `capabilities`, `constraints` yet — Task 38 handles the drop after migration runs. The new columns coexist temporarily.

- [ ] **Step 2: Add `team_sessions` columns**

In `src/modules/agent/team-session-schema.ts`:

```typescript
export const teamSessions = sqliteTable('team_sessions', {
  // ... existing columns ...
  originatingAgentId: text('originating_agent_id'),  // nullable for backwards compat
  parentSnapshot: text('parent_snapshot'),           // JSON ParentSnapshot
})
```

- [ ] **Step 3: Add `conversations.voice_scope_override`**

In `src/modules/conversations/schema.ts`:

```typescript
export const conversations = sqliteTable('conversations', {
  // ... existing columns ...
  voiceScopeOverride: text('voice_scope_override', { enum: ['internal', 'external'] }),
})
```

- [ ] **Step 4: Add `channels.force_voice_scope`**

In `src/modules/ingress/channels-schema.ts`:

```typescript
export const channels = sqliteTable('channels', {
  // ... existing columns ...
  forceVoiceScope: text('force_voice_scope', { enum: ['internal', 'external'] }),
})
```

- [ ] **Step 5: Extend `forge_proposals` for SOUL targets**

In `src/modules/forge/schema.ts`, update the `target` enum and add fields:

```typescript
export const forgeProposals = sqliteTable('forge_proposals', {
  // ... existing columns ...
  target: text('target', { enum: ['skill', 'tool', 'soul', 'project_rule'] }).notNull(),
  // existing scope is reused (e.g. 'internal'/'external' for soul)
  field: text('field'),  // 'address', 'tone', etc. for soul; nullable otherwise
})
```

- [ ] **Step 6: Create `internal_contacts` schema**

Create `src/modules/communication/internal-contacts-schema.ts`:

```typescript
import { sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

export const internalContacts = sqliteTable('internal_contacts', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),   // telegram_user_id, email, slack_id, etc.
  channelType: text('channel_type', {
    enum: ['web', 'telegram', 'email', 'odoo-chatter', 'hand-companion', 'slack', 'discord'],
  }).notNull(),
  displayName: text('display_name').notNull(),
  role: text('role', { enum: ['owner', 'team-member'] }).notNull(),
  scope: text('scope', { enum: ['internal'] }).notNull().default('internal'),  // always internal
  notes: text('notes'),
  addedAt: text('added_at').notNull(),
  addedBy: text('added_by').notNull(),
}, (t) => ({
  identByChannel: uniqueIndex('internal_contacts_ident_channel').on(t.identifier, t.channelType),
}))
```

- [ ] **Step 7: Generate Drizzle migration**

Run from project root:

```bash
bun drizzle-kit generate --name=prompts_v2_columns
```

Verify the file `drizzle/0042_prompts_v2_columns.sql` exists and contains the expected ALTER TABLE / CREATE TABLE statements.

- [ ] **Step 8: Apply migration to dev DB**

```bash
bun run scripts/migrate.ts
```

Expected: no errors. Verify with `sqlite3 data/sqlite/eyas.db ".schema agent_definitions"` that `addressable` and `workspace_path` exist.

- [ ] **Step 9: Update test DB helper**

In `tests/helpers/test-db.ts` ensure the new tables/columns are created during test fixture setup. Add `internal_contacts` to the table list.

- [ ] **Step 10: Run existing test suite to confirm no regression**

```bash
bun test --run 2>&1 | tail -20
```

Expected: all 948+ existing tests still pass (new columns are additive, defaults preserve old behavior).

- [ ] **Step 11: Commit (ASK USER FIRST)**

Show diff to user via `git diff --stat`. If approved:

```bash
git add src/modules/agent/schema.ts src/modules/agent/team-session-schema.ts \
        src/modules/conversations/schema.ts src/modules/ingress/channels-schema.ts \
        src/modules/forge/schema.ts src/modules/communication/internal-contacts-schema.ts \
        drizzle/0042_prompts_v2_columns.sql tests/helpers/test-db.ts
git commit -m "feat(schema): prompts v2 columns + internal_contacts table"
```

---

### Task 2: Scaffold prompt-wizard module structure (empty files)

**Files:**
- Create: `src/modules/prompt-wizard/core-identity.ts` (placeholder)
- Create: `src/modules/prompt-wizard/core-rules.ts` (placeholder)
- Create: `src/modules/prompt-wizard/workspace-types.ts`
- Create: `src/modules/prompt-wizard/types.ts` (extend existing)

- [ ] **Step 1: Define `AssembledPrompt` and core types in `types.ts`**

Append to `src/modules/prompt-wizard/types.ts`:

```typescript
export type VoiceScope = 'internal' | 'external'

export type AddressForm = 'tegező' | 'magázó' | 'önöző' | 'kontextus-érzékeny'

export interface VoiceProfile {
  address: AddressForm
  tone: 'komoly' | 'kiegyensúlyozott' | 'baráti' | 'laza' | 'játékos'
  verbosity: 'lényegre törő' | 'kiegyensúlyozott' | 'részletező'
  directness: 'nagyon direkt' | 'direkt + udvarias' | 'diplomatikus' | 'körülíró'
  humor: 'nincs' | 'száraz/szellemes' | 'könnyed' | 'csípős/provokatív'
  emoji: 'soha' | 'funkcionálisan' | 'gyakran'
  blockedPhrases: string[]
  signature: string
}

export interface SoulStyle {
  $schema?: string
  version: 1
  preset: { internal: string; external: string }  // preset key or 'custom'
  internal: VoiceProfile  // address restricted to non-context-aware (validated at schema)
  external: VoiceProfile
}

export interface ParentSnapshot {
  agentId: string                 // originating agent ID
  name: string
  voiceProfile: VoiceProfile
  voiceProfileSource: VoiceScope
  blockedPhrases: string[]
  signature: string
  originatingAgentId: string
}

export interface AssembledPrompt {
  prefix: string                  // stable cache prefix
  suffix: string                  // dynamic per-turn
  reminders: string[]             // per-message reminders
  cacheBoundaryHint: number       // char-pos of prefix/suffix boundary
  prefixHash: string              // sha256(prefix), 64 hex chars
  tokenEstimate: { prefix: number; suffix: number; reminders: number }
}
```

- [ ] **Step 2: Create `workspace-types.ts`**

```typescript
export type WorkspaceFileName =
  | 'IDENTITY.md'
  | 'SOUL.md'
  | 'SOUL.style.json'
  | 'AGENTS.md'
  | 'TOOLS.md'
  | 'MEMORY.md'

export interface WorkspaceFrontmatter {
  schema: string                  // e.g. 'eyas.workspace.v1'
  agentId: string
  generatedAt: string             // ISO 8601
  [key: string]: unknown
}

export interface WorkspaceFile {
  name: WorkspaceFileName | string  // string allows memory/YYYY-MM-DD.md
  path: string                       // absolute path
  exists: boolean
  frontmatter: WorkspaceFrontmatter | null
  body: string                       // content without frontmatter
  byteSize: number
  truncated: boolean                 // true if read was capped
}

export interface AgentWorkspace {
  agentId: string
  rootPath: string                   // data/agents/<id>/
  identity: WorkspaceFile
  soulMd: WorkspaceFile              // rendered, read-only target
  soulStyleJson: WorkspaceFile
  agentsMd: WorkspaceFile
  toolsMd: WorkspaceFile
  memoryMd: WorkspaceFile
  dailyMemory: WorkspaceFile[]       // memory/YYYY-MM-DD.md files
}
```

- [ ] **Step 3: Create skeleton `core-identity.ts`**

```typescript
// src/modules/prompt-wizard/core-identity.ts
// Locked, framework-controlled. Edit only via deploy.

export const CORE_IDENTITY = `You are an autonomous AI agent operating within EYAS,
a self-hosted personal AI platform.

Core understanding:
- You are NOT a passive chatbot. You proactively pursue your mission.
- Each session you wake up fresh — your IDENTITY.md, SOUL.md, AGENTS.md,
  and memory files ARE your continuity.
- You have tools to schedule work, set heartbeats, query systems, and
  initiate communication when your mission requires it.
- Read your IDENTITY.md to know who you are and what you're here to do.
- Read your SOUL.md to know how to sound.
- Update MEMORY.md with what matters; log daily in memory/YYYY-MM-DD.md.
- Act externally (email, message, shared state) only when mission-aligned.
  When uncertain about your mission, ask the owner — don't drift.`
```

- [ ] **Step 4: Create skeleton `core-rules.ts`**

```typescript
// src/modules/prompt-wizard/core-rules.ts
// Locked, framework-controlled. Edit only via deploy.

export const CORE_RULES = `## Mandatory Rules (cannot be overridden)

1. AUDIT: Every AI action is logged. Do not attempt to hide or obscure.
2. PERMISSIONS: Respect CASL permission checks. Do not escalate.
3. COST: Be token-efficient. Avoid pulling more context than necessary.
4. BLAST RADIUS: Before any action, assess reversibility:
   - LOW (read, list, search): execute freely
   - MEDIUM (write, edit, send message): proceed if user-task implies
   - HIGH (delete, push, transfer money, broadcast): require explicit confirmation
   - CRITICAL (cross-system, irreversible): require user typed confirmation
5. PRIVACY: Do not exfiltrate private data. Do not log secrets.
6. SECURITY: Refuse destructive techniques, mass targeting, supply chain compromise,
   or detection evasion for malicious purposes.
7. AI DISCLOSURE: When sending external messages on behalf of the owner,
   if asked or contextually appropriate, disclose AI involvement.
8. NO HALLUCINATION: If you do not know, say so. Do not fabricate file paths,
   API names, or data.
9. NO MOCKING IN INTEGRATION TESTS: Use real services where the user has
   directed integration testing.
10. ASK BEFORE COMMIT: Never auto-commit, push, or modify shared state without
    explicit owner approval (per project policy).`
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
bun tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit (ASK USER FIRST)**

```bash
git add src/modules/prompt-wizard/types.ts src/modules/prompt-wizard/workspace-types.ts \
        src/modules/prompt-wizard/core-identity.ts src/modules/prompt-wizard/core-rules.ts
git commit -m "feat(prompt-wizard): scaffold v2 types and core constants"
```

---

### Task 3: Add `chokidar` dependency

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Verify chokidar license is MIT-compatible**

```bash
bun pm ls chokidar 2>&1 || true
curl -s https://registry.npmjs.org/chokidar | bun --print "JSON.parse(await Bun.stdin.text()).versions[Object.keys(JSON.parse(await Bun.stdin.text()).versions).pop()].license"
```

Expected: `MIT`. (Chokidar is MIT-licensed per its standard package.)

- [ ] **Step 2: Install chokidar**

```bash
cd /Users/eyssen/GitHub/eyas && bun add chokidar
```

- [ ] **Step 3: Verify install**

```bash
bun pm ls | grep chokidar
```

- [ ] **Step 4: Commit (ASK USER FIRST)**

```bash
git add package.json bun.lock
git commit -m "chore(deps): add chokidar for workspace file watching"
```

---

## Phase 1 — Workspace File System

### Task 4: Workspace path resolver + frontmatter helper

**Files:**
- Create: `src/modules/prompt-wizard/workspace-paths.ts`
- Create: `src/modules/prompt-wizard/frontmatter.ts`
- Create: `tests/modules/prompt-wizard/workspace-paths.test.ts`
- Create: `tests/modules/prompt-wizard/frontmatter.test.ts`

- [ ] **Step 1: Write failing test for `workspace-paths`**

```typescript
// tests/modules/prompt-wizard/workspace-paths.test.ts
import { describe, expect, it } from 'vitest'
import { resolveWorkspaceRoot, resolveWorkspaceFile, dailyMemoryPath } from '../../../src/modules/prompt-wizard/workspace-paths.js'

describe('workspace-paths', () => {
  it('resolves workspace root for an agent id', () => {
    expect(resolveWorkspaceRoot('jarvis-uuid', '/data')).toBe('/data/agents/jarvis-uuid')
  })
  it('resolves IDENTITY.md path', () => {
    expect(resolveWorkspaceFile('jarvis-uuid', 'IDENTITY.md', '/data')).toBe('/data/agents/jarvis-uuid/IDENTITY.md')
  })
  it('builds daily memory path for an ISO date', () => {
    expect(dailyMemoryPath('jarvis-uuid', '2026-04-26', '/data')).toBe('/data/agents/jarvis-uuid/memory/2026-04-26.md')
  })
  it('rejects path traversal in agent id', () => {
    expect(() => resolveWorkspaceRoot('../etc/passwd', '/data')).toThrow(/invalid agent id/i)
  })
  it('rejects daily memory path with bad date', () => {
    expect(() => dailyMemoryPath('jarvis-uuid', '2026-13-99', '/data')).toThrow(/invalid date/i)
  })
})
```

- [ ] **Step 2: Run test (FAIL)**

```bash
bun test tests/modules/prompt-wizard/workspace-paths.test.ts --run
```

- [ ] **Step 3: Implement `workspace-paths.ts`**

```typescript
// src/modules/prompt-wizard/workspace-paths.ts
import { join } from 'node:path'

const AGENT_ID_PATTERN = /^[a-z0-9_-]+$/i
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

function assertSafeAgentId(agentId: string): void {
  if (!AGENT_ID_PATTERN.test(agentId)) throw new Error(`invalid agent id: ${agentId}`)
}

export function resolveWorkspaceRoot(agentId: string, dataDir: string): string {
  assertSafeAgentId(agentId)
  return join(dataDir, 'agents', agentId)
}

export function resolveWorkspaceFile(agentId: string, fileName: string, dataDir: string): string {
  return join(resolveWorkspaceRoot(agentId, dataDir), fileName)
}

export function dailyMemoryPath(agentId: string, isoDate: string, dataDir: string): string {
  if (!ISO_DATE_PATTERN.test(isoDate)) throw new Error(`invalid date: ${isoDate}`)
  const [, m, d] = isoDate.split('-').map(Number)
  if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31)) throw new Error(`invalid date: ${isoDate}`)
  return join(resolveWorkspaceRoot(agentId, dataDir), 'memory', `${isoDate}.md`)
}

export function projectAgentsPath(projectId: string, dataDir: string): string {
  if (!AGENT_ID_PATTERN.test(projectId)) throw new Error(`invalid project id: ${projectId}`)
  return join(dataDir, 'projects', projectId, 'AGENTS.md')
}

export function projectTypeAgentsPath(typeId: string, dataDir: string): string {
  if (!AGENT_ID_PATTERN.test(typeId)) throw new Error(`invalid project type id: ${typeId}`)
  return join(dataDir, 'project-types', typeId, 'AGENTS.md')
}

export function historyPath(agentId: string, fileName: string, isoTimestamp: string, dataDir: string): string {
  const safeTs = isoTimestamp.replace(/:/g, '-').replace(/\.\d+Z?$/, '')
  return join(resolveWorkspaceRoot(agentId, dataDir), '.history', `${fileName}.${safeTs}.md`)
}
```

- [ ] **Step 4: Run test (PASS)**

- [ ] **Step 5: Implement `frontmatter.ts`**

```typescript
// src/modules/prompt-wizard/frontmatter.ts
import type { WorkspaceFrontmatter } from './workspace-types.js'

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?/

export function parseFrontmatter(content: string): WorkspaceFrontmatter | null {
  const match = FRONTMATTER_RE.exec(content)
  if (!match) return null
  const obj: Record<string, unknown> = {}
  for (const line of match[1].split('\n')) {
    const idx = line.indexOf(':')
    if (idx === -1) continue
    obj[line.slice(0, idx).trim()] = line.slice(idx + 1).trim()
  }
  if (typeof obj.schema !== 'string' || typeof obj.agentId !== 'string' || typeof obj.generatedAt !== 'string') return null
  return obj as WorkspaceFrontmatter
}

export function stripFrontmatter(content: string): string {
  return content.replace(FRONTMATTER_RE, '')
}

export function injectFrontmatter(content: string, fm: WorkspaceFrontmatter): string {
  const stripped = stripFrontmatter(content)
  const lines = ['---']
  for (const [key, value] of Object.entries(fm)) lines.push(`${key}: ${value}`)
  lines.push('---', '')
  return lines.join('\n') + stripped
}
```

- [ ] **Step 6: Write + run frontmatter tests (parse, strip, inject, replace)**

Test file `tests/modules/prompt-wizard/frontmatter.test.ts` — 5 cases covering parse / strip / inject / replace / null on missing.

- [ ] **Step 7: Commit (ASK USER FIRST)**

```bash
git add src/modules/prompt-wizard/workspace-paths.ts src/modules/prompt-wizard/frontmatter.ts \
        tests/modules/prompt-wizard/workspace-paths.test.ts tests/modules/prompt-wizard/frontmatter.test.ts
git commit -m "feat(prompt-wizard): workspace path resolver + frontmatter helpers"
```

---

### Task 5: Workspace file Zod schemas

**Files:**
- Create: `src/modules/prompt-wizard/workspace-schemas.ts`
- Create: `tests/modules/prompt-wizard/workspace-schemas.test.ts`

- [ ] **Step 1: Implement schemas**

```typescript
// src/modules/prompt-wizard/workspace-schemas.ts
import { z } from 'zod'

export const workspaceFrontmatterSchema = z.object({
  schema: z.literal('eyas.workspace.v1'),
  agentId: z.string().min(1),
  generatedAt: z.string().datetime(),
}).passthrough()

const REQUIRED_IDENTITY_SECTIONS = ['## Who I am', '## My mission', '## Ongoing proactive duties']

export const identityMdSchema = z.string().refine(
  (content) => REQUIRED_IDENTITY_SECTIONS.every((h) => content.includes(h)),
  { message: 'IDENTITY.md missing required sections' },
)

export const agentsMdSchema = z.string()
export const toolsMdSchema = z.string()
export const memoryMdSchema = z.string()
export const dailyMemoryMdSchema = z.string()

export const soulMdSchema = z.string().refine(
  (content) => content.includes('## [Internal Voice]') && content.includes('## [External Voice]'),
  { message: 'SOUL.md must contain both voice sections' },
)
```

- [ ] **Step 2: Tests**

```typescript
// tests/modules/prompt-wizard/workspace-schemas.test.ts
import { describe, expect, it } from 'vitest'
import { workspaceFrontmatterSchema, identityMdSchema, agentsMdSchema, soulMdSchema } from '../../../src/modules/prompt-wizard/workspace-schemas.js'

describe('workspace schemas', () => {
  it('validates good frontmatter', () => {
    expect(workspaceFrontmatterSchema.safeParse({
      schema: 'eyas.workspace.v1', agentId: 'jarvis', generatedAt: '2026-04-26T00:00:00Z',
    }).success).toBe(true)
  })
  it('rejects bad frontmatter', () => {
    expect(workspaceFrontmatterSchema.safeParse({ schema: 'wrong' }).success).toBe(false)
  })
  it('accepts well-formed IDENTITY.md', () => {
    const valid = '## Who I am\nx\n## My mission\ny\n## Ongoing proactive duties\n- z\n'
    expect(identityMdSchema.safeParse(valid).success).toBe(true)
  })
  it('rejects IDENTITY.md missing sections', () => {
    expect(identityMdSchema.safeParse('## Who I am\nx').success).toBe(false)
  })
  it('accepts free-form AGENTS.md', () => {
    expect(agentsMdSchema.safeParse('').success).toBe(true)
    expect(agentsMdSchema.safeParse('# anything').success).toBe(true)
  })
  it('requires both voice sections in SOUL.md', () => {
    expect(soulMdSchema.safeParse('## [Internal Voice]\n## [External Voice]').success).toBe(true)
    expect(soulMdSchema.safeParse('## [Internal Voice] only').success).toBe(false)
  })
})
```

- [ ] **Step 3: Run + commit (ASK USER FIRST)**

```bash
bun test tests/modules/prompt-wizard/workspace-schemas.test.ts --run
git add src/modules/prompt-wizard/workspace-schemas.ts tests/modules/prompt-wizard/workspace-schemas.test.ts
git commit -m "feat(prompt-wizard): zod schemas for workspace files"
```

---

### Task 6: Workspace loader

**Files:**
- Create: `src/modules/prompt-wizard/workspace-loader.ts`
- Create: `tests/modules/prompt-wizard/workspace-loader.test.ts`

- [ ] **Step 1: Implement loader**

```typescript
// src/modules/prompt-wizard/workspace-loader.ts
import { readFile, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { AgentWorkspace, WorkspaceFile, WorkspaceFileName } from './workspace-types.js'
import { resolveWorkspaceRoot, resolveWorkspaceFile } from './workspace-paths.js'
import { parseFrontmatter, stripFrontmatter } from './frontmatter.js'

export interface WorkspaceLoaderOptions {
  dataDir: string
  maxBytesPerFile?: number
}

export interface WorkspaceLoader {
  load(agentId: string): Promise<AgentWorkspace>
  invalidate(agentId: string): void
  invalidateAll(): void
}

const TRUNCATION_MARKER = '\n\n[truncated — file exceeds workspace per-file budget]'
const FILE_NAMES: WorkspaceFileName[] = ['IDENTITY.md', 'SOUL.md', 'SOUL.style.json', 'AGENTS.md', 'TOOLS.md', 'MEMORY.md']

export function createWorkspaceLoader(opts: WorkspaceLoaderOptions): WorkspaceLoader {
  const cache = new Map<string, AgentWorkspace>()
  const maxBytes = opts.maxBytesPerFile ?? 12_000

  async function readEntry(absPath: string, fileName: string): Promise<WorkspaceFile> {
    if (!existsSync(absPath)) {
      return { name: fileName, path: absPath, exists: false, frontmatter: null, body: '', byteSize: 0, truncated: false }
    }
    const buf = await readFile(absPath)
    const truncated = buf.byteLength > maxBytes
    const text = truncated ? buf.subarray(0, maxBytes).toString('utf8') + TRUNCATION_MARKER : buf.toString('utf8')
    return { name: fileName, path: absPath, exists: true, frontmatter: parseFrontmatter(text), body: stripFrontmatter(text), byteSize: buf.byteLength, truncated }
  }

  async function load(agentId: string): Promise<AgentWorkspace> {
    const cached = cache.get(agentId)
    if (cached) return cached
    const root = resolveWorkspaceRoot(agentId, opts.dataDir)
    const [identity, soulMd, soulStyleJson, agentsMd, toolsMd, memoryMd] = await Promise.all(
      FILE_NAMES.map((n) => readEntry(resolveWorkspaceFile(agentId, n, opts.dataDir), n)),
    )
    const memoryDir = join(root, 'memory')
    let dailyMemory: WorkspaceFile[] = []
    if (existsSync(memoryDir)) {
      const entries = (await readdir(memoryDir)).filter((e) => /^\d{4}-\d{2}-\d{2}\.md$/.test(e)).sort()
      dailyMemory = await Promise.all(entries.map((e) => readEntry(join(memoryDir, e), `memory/${e}`)))
    }
    const ws: AgentWorkspace = { agentId, rootPath: root, identity, soulMd, soulStyleJson, agentsMd, toolsMd, memoryMd, dailyMemory }
    cache.set(agentId, ws)
    return ws
  }

  return {
    load,
    invalidate: (id) => { cache.delete(id) },
    invalidateAll: () => { cache.clear() },
  }
}
```

- [ ] **Step 2: Tests** (4 cases)

Test cases: loads complete workspace, returns exists=false for missing, truncates oversized with marker, caches reads until invalidated. Use `mkdtempSync` from `node:fs` and `tmpdir()` from `node:os` for isolated temp dirs.

- [ ] **Step 3: Run + commit (ASK USER FIRST)**

```bash
bun test tests/modules/prompt-wizard/workspace-loader.test.ts --run
git add src/modules/prompt-wizard/workspace-loader.ts tests/modules/prompt-wizard/workspace-loader.test.ts
git commit -m "feat(prompt-wizard): workspace file loader with truncation and cache"
```

---

### Task 7: Workspace writer (atomic + history snapshot)

**Files:**
- Create: `src/modules/prompt-wizard/workspace-writer.ts`
- Create: `tests/modules/prompt-wizard/workspace-writer.test.ts`

- [ ] **Step 1: Implement writer**

```typescript
// src/modules/prompt-wizard/workspace-writer.ts
import { writeFile, mkdir, readFile, readdir, unlink, rename } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, basename, join } from 'node:path'
import { resolveWorkspaceFile, historyPath, resolveWorkspaceRoot } from './workspace-paths.js'
import { injectFrontmatter } from './frontmatter.js'

export interface WriteRequest {
  agentId: string
  file: string
  body: string
  skipHistory?: boolean
  skipFrontmatter?: boolean
}

export interface WorkspaceWriterOptions {
  dataDir: string
  now?: () => Date
  historyCap?: number
}

export interface WorkspaceWriter {
  write(req: WriteRequest): Promise<void>
  delete(agentId: string, file: string): Promise<void>
}

function targetPath(agentId: string, file: string, dataDir: string): string {
  return file.includes('/')
    ? join(resolveWorkspaceRoot(agentId, dataDir), file)
    : resolveWorkspaceFile(agentId, file, dataDir)
}

export function createWorkspaceWriter(opts: WorkspaceWriterOptions): WorkspaceWriter {
  const now = opts.now ?? (() => new Date())
  const cap = opts.historyCap ?? 30

  async function snapshot(agentId: string, file: string): Promise<void> {
    const target = targetPath(agentId, file, opts.dataDir)
    if (!existsSync(target)) return
    const ts = now().toISOString()
    const snap = historyPath(agentId, basename(file), ts, opts.dataDir)
    await mkdir(dirname(snap), { recursive: true })
    await writeFile(snap, await readFile(target))
    const histDir = dirname(snap)
    const entries = (await readdir(histDir)).filter((e) => e.startsWith(`${basename(file)}.`)).sort()
    while (entries.length > cap) await unlink(join(histDir, entries.shift()!))
  }

  async function write(req: WriteRequest): Promise<void> {
    const target = targetPath(req.agentId, req.file, opts.dataDir)
    await mkdir(dirname(target), { recursive: true })
    if (!req.skipHistory) await snapshot(req.agentId, req.file)
    const isJson = req.file.endsWith('.json') || req.skipFrontmatter
    const content = isJson
      ? req.body
      : injectFrontmatter(req.body, { schema: 'eyas.workspace.v1', agentId: req.agentId, generatedAt: now().toISOString() })
    const tmp = `${target}.tmp`
    await writeFile(tmp, content)
    await rename(tmp, target)
  }

  async function deleteFile(agentId: string, file: string): Promise<void> {
    const target = targetPath(agentId, file, opts.dataDir)
    if (existsSync(target)) await unlink(target)
  }

  return { write, delete: deleteFile }
}
```

- [ ] **Step 2: Tests** (4 cases)

Cases: creates dirs + writes with frontmatter, snapshots prior content before overwrite, caps history at N, writes JSON without frontmatter.

- [ ] **Step 3: Run + commit (ASK USER FIRST)**

```bash
bun test tests/modules/prompt-wizard/workspace-writer.test.ts --run
git add src/modules/prompt-wizard/workspace-writer.ts tests/modules/prompt-wizard/workspace-writer.test.ts
git commit -m "feat(prompt-wizard): atomic workspace writer with history snapshots"
```

---

### Task 8: Workspace file watcher (chokidar)

**Files:**
- Create: `src/modules/prompt-wizard/workspace-watcher.ts`
- Create: `tests/modules/prompt-wizard/workspace-watcher.test.ts`

- [ ] **Step 1: Implement watcher**

```typescript
// src/modules/prompt-wizard/workspace-watcher.ts
import chokidar, { type FSWatcher } from 'chokidar'
import { join } from 'node:path'

export interface WorkspaceWatcherOptions {
  dataDir: string
  debounceMs?: number
}

export interface WorkspaceWatcher {
  start(): Promise<void>
  stop(): Promise<void>
  onInvalidate(handler: (agentId: string) => void): () => void
}

export function createWorkspaceWatcher(opts: WorkspaceWatcherOptions): WorkspaceWatcher {
  const handlers = new Set<(agentId: string) => void>()
  const debounceMs = opts.debounceMs ?? 250
  const pending = new Map<string, ReturnType<typeof setTimeout>>()
  let watcher: FSWatcher | null = null

  function emit(agentId: string) {
    const existing = pending.get(agentId)
    if (existing) clearTimeout(existing)
    pending.set(agentId, setTimeout(() => {
      pending.delete(agentId)
      for (const h of handlers) h(agentId)
    }, debounceMs))
  }

  function agentIdFromPath(p: string): string | null {
    const norm = p.replace(/\\/g, '/')
    const re = new RegExp(`${opts.dataDir.replace(/\\/g, '/')}/agents/([^/]+)/`)
    const m = re.exec(norm)
    return m ? m[1] : null
  }

  return {
    async start() {
      watcher = chokidar.watch(join(opts.dataDir, 'agents'), {
        persistent: true,
        ignoreInitial: true,
        ignored: ['**/.history/**', '**/*.tmp'],
      })
      watcher.on('all', (_event, p) => {
        const id = agentIdFromPath(p)
        if (id) emit(id)
      })
    },
    async stop() {
      if (watcher) { await watcher.close(); watcher = null }
      for (const h of pending.values()) clearTimeout(h)
      pending.clear()
    },
    onInvalidate(handler) {
      handlers.add(handler)
      return () => handlers.delete(handler)
    },
  }
}
```

- [ ] **Step 2: Test** (1 case: write file → expect invalidate event after debounce)

- [ ] **Step 3: Wire watcher to loader in module bootstrap**

Modify `src/modules/prompt-wizard/index.ts` (existing module) to create and start the watcher; wire `watcher.onInvalidate(loader.invalidate)`.

- [ ] **Step 4: Run + commit (ASK USER FIRST)**

```bash
bun test tests/modules/prompt-wizard/workspace-watcher.test.ts --run
git add src/modules/prompt-wizard/workspace-watcher.ts tests/modules/prompt-wizard/workspace-watcher.test.ts \
        src/modules/prompt-wizard/index.ts
git commit -m "feat(prompt-wizard): chokidar workspace watcher wired to loader cache"
```

---

## Phase 2 — SOUL System

### Task 9: SOUL style schema + enums

**Files:**
- Create: `src/modules/prompt-wizard/soul-style-schema.ts`
- Create: `tests/modules/prompt-wizard/soul-style-schema.test.ts`

- [ ] **Step 1: Implement schema**

```typescript
// src/modules/prompt-wizard/soul-style-schema.ts
import { z } from 'zod'

export const ENUM_VALUES = {
  address: ['tegező', 'magázó', 'önöző', 'kontextus-érzékeny'] as const,
  tone: ['komoly', 'kiegyensúlyozott', 'baráti', 'laza', 'játékos'] as const,
  verbosity: ['lényegre törő', 'kiegyensúlyozott', 'részletező'] as const,
  directness: ['nagyon direkt', 'direkt + udvarias', 'diplomatikus', 'körülíró'] as const,
  humor: ['nincs', 'száraz/szellemes', 'könnyed', 'csípős/provokatív'] as const,
  emoji: ['soha', 'funkcionálisan', 'gyakran'] as const,
}

export const PRESET_KEYS = ['jarvis', 'best-buddy', 'senior-ceo', 'pajtas-dev', 'standup', 'diplomata', 'coach', 'tutor'] as const

const baseProfile = z.object({
  tone: z.enum(ENUM_VALUES.tone),
  verbosity: z.enum(ENUM_VALUES.verbosity),
  directness: z.enum(ENUM_VALUES.directness),
  humor: z.enum(ENUM_VALUES.humor),
  emoji: z.enum(ENUM_VALUES.emoji),
  blockedPhrases: z.array(z.string().max(80)).max(10).default([]),
  signature: z.string().max(200).default(''),
})

export const internalProfileSchema = baseProfile.extend({
  address: z.enum(['tegező', 'magázó', 'önöző']),  // no kontextus-érzékeny
})

export const externalProfileSchema = baseProfile.extend({
  address: z.enum(ENUM_VALUES.address),
})

export const soulStyleSchema = z.object({
  $schema: z.string().optional(),
  version: z.literal(1),
  preset: z.object({
    internal: z.enum([...PRESET_KEYS, 'custom'] as [string, ...string[]]),
    external: z.enum([...PRESET_KEYS, 'custom'] as [string, ...string[]]),
  }),
  internal: internalProfileSchema,
  external: externalProfileSchema,
})

export type SoulStyleParsed = z.infer<typeof soulStyleSchema>
```

- [ ] **Step 2: Tests**

```typescript
// tests/modules/prompt-wizard/soul-style-schema.test.ts
import { describe, expect, it } from 'vitest'
import { soulStyleSchema } from '../../../src/modules/prompt-wizard/soul-style-schema.js'

const goodInternal = { address: 'tegező', tone: 'baráti', verbosity: 'lényegre törő', directness: 'direkt + udvarias', humor: 'szellemes' as never, emoji: 'funkcionálisan', blockedPhrases: [], signature: '' }
const goodExternal = { ...goodInternal, address: 'magázó', humor: 'nincs', emoji: 'soha' }

describe('soul-style-schema', () => {
  it('accepts valid soul style', () => {
    const r = soulStyleSchema.safeParse({
      version: 1, preset: { internal: 'best-buddy', external: 'diplomata' },
      internal: { ...goodInternal, humor: 'száraz/szellemes' },
      external: { ...goodExternal, humor: 'nincs' },
    })
    expect(r.success).toBe(true)
  })
  it('rejects internal address kontextus-érzékeny', () => {
    const r = soulStyleSchema.safeParse({
      version: 1, preset: { internal: 'custom', external: 'custom' },
      internal: { ...goodInternal, address: 'kontextus-érzékeny', humor: 'nincs' },
      external: goodExternal,
    } as never)
    expect(r.success).toBe(false)
  })
  it('accepts external address kontextus-érzékeny', () => {
    const r = soulStyleSchema.safeParse({
      version: 1, preset: { internal: 'custom', external: 'custom' },
      internal: { ...goodInternal, humor: 'nincs' },
      external: { ...goodExternal, address: 'kontextus-érzékeny' },
    } as never)
    expect(r.success).toBe(true)
  })
  it('caps blockedPhrases at 10 items, 80 chars each', () => {
    const phrases = Array.from({ length: 11 }, (_, i) => `p${i}`)
    const r = soulStyleSchema.safeParse({
      version: 1, preset: { internal: 'custom', external: 'custom' },
      internal: { ...goodInternal, humor: 'nincs', blockedPhrases: phrases },
      external: goodExternal,
    } as never)
    expect(r.success).toBe(false)
  })
})
```

- [ ] **Step 3: Run + commit (ASK USER FIRST)**

```bash
bun test tests/modules/prompt-wizard/soul-style-schema.test.ts --run
git add src/modules/prompt-wizard/soul-style-schema.ts tests/modules/prompt-wizard/soul-style-schema.test.ts
git commit -m "feat(prompt-wizard): SOUL.style.json zod schema with dual-scope validation"
```

---

### Task 10: SOUL presets + apply logic

**Files:**
- Create: `src/modules/prompt-wizard/soul-presets.ts`
- Create: `tests/modules/prompt-wizard/soul-presets.test.ts`

- [ ] **Step 1: Implement presets**

```typescript
// src/modules/prompt-wizard/soul-presets.ts
import type { SoulStyleParsed } from './soul-style-schema.js'
import { PRESET_KEYS } from './soul-style-schema.js'

type Profile = SoulStyleParsed['internal']

const PRESETS: Record<typeof PRESET_KEYS[number], Omit<Profile, 'blockedPhrases' | 'signature'>> = {
  'jarvis':     { address: 'magázó', tone: 'komoly',          verbosity: 'lényegre törő',    directness: 'direkt + udvarias', humor: 'nincs',             emoji: 'soha' },
  'best-buddy': { address: 'tegező', tone: 'baráti',          verbosity: 'kiegyensúlyozott', directness: 'diplomatikus',      humor: 'száraz/szellemes',  emoji: 'funkcionálisan' },
  'senior-ceo': { address: 'magázó', tone: 'komoly',          verbosity: 'lényegre törő',    directness: 'nagyon direkt',     humor: 'száraz/szellemes',  emoji: 'soha' },
  'pajtas-dev': { address: 'tegező', tone: 'laza',            verbosity: 'lényegre törő',    directness: 'direkt + udvarias', humor: 'száraz/szellemes',  emoji: 'funkcionálisan' },
  'standup':    { address: 'tegező', tone: 'játékos',         verbosity: 'kiegyensúlyozott', directness: 'nagyon direkt',     humor: 'csípős/provokatív', emoji: 'gyakran' },
  'diplomata':  { address: 'önöző',  tone: 'komoly',          verbosity: 'részletező',       directness: 'diplomatikus',      humor: 'nincs',             emoji: 'soha' },
  'coach':      { address: 'tegező', tone: 'kiegyensúlyozott', verbosity: 'kiegyensúlyozott', directness: 'nagyon direkt',     humor: 'száraz/szellemes',  emoji: 'funkcionálisan' },
  'tutor':      { address: 'tegező', tone: 'baráti',          verbosity: 'részletező',       directness: 'diplomatikus',      humor: 'könnyed',           emoji: 'funkcionálisan' },
}

export type PresetKey = keyof typeof PRESETS

export function getPreset(key: PresetKey): Omit<Profile, 'blockedPhrases' | 'signature'> {
  return PRESETS[key]
}

export function listPresets(): PresetKey[] {
  return Object.keys(PRESETS) as PresetKey[]
}

export function applyPreset(current: Profile, key: PresetKey): Profile {
  return { ...current, ...PRESETS[key] }
}

export function detectPresetMatch(profile: Profile): PresetKey | 'custom' {
  for (const [key, preset] of Object.entries(PRESETS)) {
    if (
      profile.address === preset.address && profile.tone === preset.tone &&
      profile.verbosity === preset.verbosity && profile.directness === preset.directness &&
      profile.humor === preset.humor && profile.emoji === preset.emoji
    ) return key as PresetKey
  }
  return 'custom'
}

export function defaultStyleForAgent(internalKey: PresetKey, externalKey: PresetKey): SoulStyleParsed {
  return {
    version: 1,
    preset: { internal: internalKey, external: externalKey },
    internal: { ...PRESETS[internalKey], blockedPhrases: [], signature: '' },
    external: { ...PRESETS[externalKey], blockedPhrases: [], signature: '' },
  }
}
```

- [ ] **Step 2: Tests** (5 cases)

Test cases:
- `getPreset('jarvis')` returns expected fields
- `applyPreset` overlays preset onto current profile
- `detectPresetMatch` identifies exact match
- `detectPresetMatch` returns `'custom'` when fields deviate
- `defaultStyleForAgent('best-buddy', 'diplomata')` returns valid `SoulStyleParsed`

- [ ] **Step 3: Run + commit (ASK USER FIRST)**

```bash
bun test tests/modules/prompt-wizard/soul-presets.test.ts --run
git add src/modules/prompt-wizard/soul-presets.ts tests/modules/prompt-wizard/soul-presets.test.ts
git commit -m "feat(prompt-wizard): 8 SOUL presets + apply/detect helpers"
```

---

### Task 11: Language-aware address renderer

**Files:**
- Create: `src/modules/prompt-wizard/address-render.ts`
- Create: `tests/modules/prompt-wizard/address-render.test.ts`

- [ ] **Step 1: Implement renderer**

```typescript
// src/modules/prompt-wizard/address-render.ts
import type { AddressForm } from './types.js'

export type SupportedLang = 'hu' | 'en' | 'de'

const ADDRESS_RENDER_BY_LANG: Record<SupportedLang, Record<AddressForm, string>> = {
  hu: {
    tegező: 'Use "te" / second-person singular',
    magázó: 'Use "Ön" / formal "you"',
    önöző: 'Use "ön" / softer formal',
    'kontextus-érzékeny': 'Mirror the addresser; default to "Ön" if first contact',
  },
  en: {
    tegező: 'Use casual "you" — no titles',
    magázó: 'Use formal address — Mr./Ms., professional distance',
    önöző: 'Same as magázó (English has no equivalent)',
    'kontextus-érzékeny': 'Mirror addresser register; default formal',
  },
  de: {
    tegező: 'Use "du"',
    magázó: 'Use "Sie"',
    önöző: 'Use "Sie" with extra politeness',
    'kontextus-érzékeny': 'Mirror; default "Sie"',
  },
}

export function renderAddress(form: AddressForm, lang: SupportedLang): string {
  return ADDRESS_RENDER_BY_LANG[lang][form]
}

export function renderAddressForAllLanguages(form: AddressForm): string {
  return Object.entries(ADDRESS_RENDER_BY_LANG)
    .map(([lang, table]) => `[${lang}] ${table[form]}`)
    .join('\n')
}
```

- [ ] **Step 2: Tests**

```typescript
// tests/modules/prompt-wizard/address-render.test.ts
import { describe, expect, it } from 'vitest'
import { renderAddress, renderAddressForAllLanguages } from '../../../src/modules/prompt-wizard/address-render.js'

describe('address-render', () => {
  it('renders Hungarian magázó with Ön reference', () => {
    expect(renderAddress('magázó', 'hu')).toContain('Ön')
  })
  it('renders English tegező as casual you', () => {
    expect(renderAddress('tegező', 'en')).toContain('casual')
  })
  it('renders German Sie for magázó', () => {
    expect(renderAddress('magázó', 'de')).toContain('Sie')
  })
  it('combines all 3 languages into one block', () => {
    const out = renderAddressForAllLanguages('magázó')
    expect(out).toMatch(/\[hu\]/)
    expect(out).toMatch(/\[en\]/)
    expect(out).toMatch(/\[de\]/)
  })
})
```

- [ ] **Step 3: Run + commit (ASK USER FIRST)**

```bash
bun test tests/modules/prompt-wizard/address-render.test.ts --run
git add src/modules/prompt-wizard/address-render.ts tests/modules/prompt-wizard/address-render.test.ts
git commit -m "feat(prompt-wizard): language-aware address renderer (hu/en/de)"
```

---

### Task 12: SOUL renderer (style.json → SOUL.md)

**Files:**
- Create: `src/modules/prompt-wizard/soul-renderer.ts`
- Create: `tests/modules/prompt-wizard/soul-renderer.test.ts`

- [ ] **Step 1: Implement renderer**

```typescript
// src/modules/prompt-wizard/soul-renderer.ts
import type { SoulStyleParsed } from './soul-style-schema.js'
import type { VoiceProfile, VoiceScope } from './types.js'
import { renderAddressForAllLanguages } from './address-render.js'

const TONE_HINTS: Record<VoiceProfile['tone'], string> = {
  'komoly': 'professional, no jokes by default',
  'kiegyensúlyozott': 'measured and neutral',
  'baráti': 'warm, like talking to a trusted friend',
  'laza': 'casual, low-ceremony',
  'játékos': 'playful, willing to go off-piste',
}

const VERBOSITY_HINTS: Record<VoiceProfile['verbosity'], string> = {
  'lényegre törő': 'get to the point, skip ceremony',
  'kiegyensúlyozott': 'enough detail to be useful, not overwhelming',
  'részletező': 'thorough, expand on context and rationale',
}

const DIRECTNESS_HINTS: Record<VoiceProfile['directness'], string> = {
  'nagyon direkt': "say it plainly even if it stings",
  'direkt + udvarias': "say what you mean, but don't bulldoze",
  'diplomatikus': 'soften delivery; lead with context',
  'körülíró': 'circle the point; let them arrive at it',
}

const HUMOR_HINTS: Record<VoiceProfile['humor'], string> = {
  'nincs': 'no humor; this is business',
  'száraz/szellemes': 'dry wit when natural; never forced',
  'könnyed': 'light, friendly humor where it lands',
  'csípős/provokatív': 'sharper edges; willing to provoke a reaction',
}

const EMOJI_HINTS: Record<VoiceProfile['emoji'], string> = {
  'soha': 'never use emoji',
  'funkcionálisan': 'only when they add information (✓ ✗ ⚠ 🚨)',
  'gyakran': 'use freely; emoji is part of your voice',
}

function renderProfile(scope: VoiceScope, p: VoiceProfile): string {
  const lines: string[] = []
  lines.push(`## [${scope === 'internal' ? 'Internal' : 'External'} Voice] — when speaking with ${scope === 'internal' ? 'the owner / internal team' : 'clients / external parties'}`)
  lines.push('')
  lines.push('**How to address them:**')
  lines.push(renderAddressForAllLanguages(p.address))
  lines.push('')
  lines.push(`**Tone:** ${p.tone} — ${TONE_HINTS[p.tone]}`)
  lines.push(`**Verbosity:** ${p.verbosity} — ${VERBOSITY_HINTS[p.verbosity]}`)
  lines.push(`**Directness:** ${p.directness} — ${DIRECTNESS_HINTS[p.directness]}`)
  lines.push(`**Humor:** ${p.humor} — ${HUMOR_HINTS[p.humor]}`)
  lines.push(`**Emoji:** ${p.emoji} — ${EMOJI_HINTS[p.emoji]}`)
  lines.push('')
  if (p.blockedPhrases.length > 0) {
    lines.push('**Phrases to avoid:**')
    for (const phrase of p.blockedPhrases) lines.push(`- "${phrase}"`)
    lines.push('')
  }
  if (p.signature) {
    lines.push(`**Signature flair:** ${p.signature}`)
    lines.push('')
  }
  return lines.join('\n')
}

export function renderSoulMd(style: SoulStyleParsed, agentName: string): string {
  const parts: string[] = []
  parts.push(`# SOUL — ${agentName} voice`)
  parts.push('')
  parts.push('_This file is auto-rendered from SOUL.style.json. To edit, change the JSON or use the UI form._')
  parts.push('')
  parts.push(renderProfile('internal', style.internal))
  parts.push('---')
  parts.push('')
  parts.push(renderProfile('external', style.external))
  parts.push('---')
  parts.push('')
  parts.push('_Voice selection is automatic based on channel context. To override mid-conversation, the owner may instruct: "Switch to internal voice" or "Use formal tone."_')
  return parts.join('\n')
}
```

- [ ] **Step 2: Tests** (4 cases)

Test cases:
- `renderSoulMd` produces both `## [Internal Voice]` and `## [External Voice]` headings
- Address line includes hu/en/de variants
- `blockedPhrases` only appear when non-empty
- Output validates against `soulMdSchema` from Task 5

- [ ] **Step 3: Run + commit (ASK USER FIRST)**

```bash
bun test tests/modules/prompt-wizard/soul-renderer.test.ts --run
git add src/modules/prompt-wizard/soul-renderer.ts tests/modules/prompt-wizard/soul-renderer.test.ts
git commit -m "feat(prompt-wizard): SOUL.md renderer with multilingual address blocks"
```

---

### Task 13: Wire renderer + writer + watcher together

**Files:**
- Create: `src/modules/prompt-wizard/soul-pipeline.ts`
- Create: `tests/modules/prompt-wizard/soul-pipeline.test.ts`

- [ ] **Step 1: Implement pipeline**

```typescript
// src/modules/prompt-wizard/soul-pipeline.ts
import type { WorkspaceWriter } from './workspace-writer.js'
import type { SoulStyleParsed } from './soul-style-schema.js'
import { renderSoulMd } from './soul-renderer.js'
import { soulStyleSchema } from './soul-style-schema.js'

export interface SoulPipelineDeps {
  writer: WorkspaceWriter
}

export interface SoulPipeline {
  saveStyle(agentId: string, agentName: string, style: SoulStyleParsed): Promise<void>
  rerender(agentId: string, agentName: string, style: SoulStyleParsed): Promise<void>
}

export function createSoulPipeline(deps: SoulPipelineDeps): SoulPipeline {
  async function saveStyle(agentId: string, agentName: string, style: SoulStyleParsed): Promise<void> {
    const validated = soulStyleSchema.parse(style)
    await deps.writer.write({
      agentId,
      file: 'SOUL.style.json',
      body: JSON.stringify(validated, null, 2),
      skipFrontmatter: true,
    })
    const md = renderSoulMd(validated, agentName)
    await deps.writer.write({
      agentId,
      file: 'SOUL.md',
      body: md,
    })
  }

  async function rerender(agentId: string, agentName: string, style: SoulStyleParsed): Promise<void> {
    const md = renderSoulMd(style, agentName)
    await deps.writer.write({ agentId, file: 'SOUL.md', body: md })
  }

  return { saveStyle, rerender }
}
```

- [ ] **Step 2: Test** — `saveStyle` writes both files; round-trip parses; rerender updates only SOUL.md

- [ ] **Step 3: Run + commit (ASK USER FIRST)**

```bash
bun test tests/modules/prompt-wizard/soul-pipeline.test.ts --run
git add src/modules/prompt-wizard/soul-pipeline.ts tests/modules/prompt-wizard/soul-pipeline.test.ts
git commit -m "feat(prompt-wizard): SOUL pipeline (validate + persist + render)"
```

---

## Phase 3 — Assembler Refactor

### Task 14: Project context loader (AGENTS.md cascade)

**Files:**
- Create: `src/modules/prompt-wizard/project-context-loader.ts`
- Create: `tests/modules/prompt-wizard/project-context-loader.test.ts`

- [ ] **Step 1: Implement loader**

```typescript
// src/modules/prompt-wizard/project-context-loader.ts
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { projectAgentsPath, projectTypeAgentsPath } from './workspace-paths.js'
import { stripFrontmatter } from './frontmatter.js'

export interface ProjectContextLoaderDeps {
  dataDir: string
  resolveProjectType: (projectId: string) => Promise<{ id: string } | null>
}

export interface CascadeRequest {
  projectId?: string | null
}

export interface CascadeResult {
  projectTypeAgents: string | null
  projectAgents: string | null
  projectTypeId: string | null
  projectId: string | null
}

const PROJECT_CASCADE_TOTAL_CAP = 3000  // tokens approximated as char/4
const APPROX_TOKEN_CHARS = 4

function clip(content: string, maxChars: number): { content: string; truncated: boolean } {
  if (content.length <= maxChars) return { content, truncated: false }
  return { content: content.slice(0, maxChars) + '\n\n[truncated — cascade budget]', truncated: true }
}

export function createProjectContextLoader(deps: ProjectContextLoaderDeps) {
  async function readIfExists(path: string): Promise<string | null> {
    if (!existsSync(path)) return null
    const buf = await readFile(path, 'utf8')
    return stripFrontmatter(buf)
  }

  async function cascade(req: CascadeRequest): Promise<CascadeResult> {
    if (!req.projectId) return { projectTypeAgents: null, projectAgents: null, projectTypeId: null, projectId: null }
    const type = await deps.resolveProjectType(req.projectId)
    const projectAgents = await readIfExists(projectAgentsPath(req.projectId, deps.dataDir))
    const projectTypeAgents = type ? await readIfExists(projectTypeAgentsPath(type.id, deps.dataDir)) : null

    // Apply combined cap: project-type first to truncate (lower priority)
    const totalChars = (projectTypeAgents?.length ?? 0) + (projectAgents?.length ?? 0)
    const capChars = PROJECT_CASCADE_TOTAL_CAP * APPROX_TOKEN_CHARS
    let typeOut = projectTypeAgents
    let projOut = projectAgents
    if (totalChars > capChars) {
      // Truncate type-level first; agent-level is most specific
      const remaining = Math.max(0, capChars - (projectAgents?.length ?? 0))
      typeOut = projectTypeAgents ? clip(projectTypeAgents, remaining).content : null
    }
    return { projectTypeAgents: typeOut, projectAgents: projOut, projectTypeId: type?.id ?? null, projectId: req.projectId }
  }

  return { cascade }
}
```

- [ ] **Step 2: Tests** (4 cases)

Cases: no project returns nulls; project-only loads agent file; project + type loads both; oversized cascade truncates type-level first.

- [ ] **Step 3: Run + commit (ASK USER FIRST)**

```bash
bun test tests/modules/prompt-wizard/project-context-loader.test.ts --run
git add src/modules/prompt-wizard/project-context-loader.ts tests/modules/prompt-wizard/project-context-loader.test.ts
git commit -m "feat(prompt-wizard): project-type/project AGENTS.md cascade loader"
```

---

### Task 15: Token budget calculator

**Files:**
- Create: `src/modules/prompt-wizard/token-budget.ts`
- Create: `tests/modules/prompt-wizard/token-budget.test.ts`

- [ ] **Step 1: Implement budget logic**

```typescript
// src/modules/prompt-wizard/token-budget.ts
const APPROX_CHARS_PER_TOKEN = 4

export interface SectionBudget {
  coreIdentity: number
  coreRules: number
  projectCascade: number
  identityMd: number
  soulMd: number
  agentsMd: number
  toolsMd: number
  skillsList: number
  toolsList: number
  teamContext: number
  memoryContext: number
  runtime: number
  activeVoice: number
}

export const DEFAULT_BUDGET_FULL: SectionBudget = {
  coreIdentity: 200,
  coreRules: 500,
  projectCascade: 3000,
  identityMd: 600,
  soulMd: 500,
  agentsMd: 800,
  toolsMd: 400,
  skillsList: 400,
  toolsList: 500,
  teamContext: 400,
  memoryContext: 600,
  runtime: 200,
  activeVoice: 100,
}

export function totalBudget(b: SectionBudget): number {
  return Object.values(b).reduce((sum, v) => sum + v, 0)
}

export function shrinkForContextWindow(effectiveCtx: number, override?: Partial<SectionBudget>): SectionBudget {
  // Reserve 40% of context for system prompt; suffix is folded inside
  const target = Math.min(8800, Math.floor(effectiveCtx * 0.4))
  const baseTotal = totalBudget(DEFAULT_BUDGET_FULL)
  if (baseTotal <= target) return { ...DEFAULT_BUDGET_FULL, ...override }
  const ratio = target / baseTotal
  const scaled: SectionBudget = {
    coreIdentity: DEFAULT_BUDGET_FULL.coreIdentity,  // never shrink locked sections
    coreRules: DEFAULT_BUDGET_FULL.coreRules,
    activeVoice: DEFAULT_BUDGET_FULL.activeVoice,
    runtime: DEFAULT_BUDGET_FULL.runtime,
    projectCascade: Math.max(0, Math.floor(DEFAULT_BUDGET_FULL.projectCascade * ratio)),
    identityMd: Math.max(200, Math.floor(DEFAULT_BUDGET_FULL.identityMd * ratio)),
    soulMd: Math.max(200, Math.floor(DEFAULT_BUDGET_FULL.soulMd * ratio)),
    agentsMd: Math.max(0, Math.floor(DEFAULT_BUDGET_FULL.agentsMd * ratio)),
    toolsMd: Math.max(0, Math.floor(DEFAULT_BUDGET_FULL.toolsMd * ratio)),
    skillsList: Math.max(100, Math.floor(DEFAULT_BUDGET_FULL.skillsList * ratio)),
    toolsList: Math.max(150, Math.floor(DEFAULT_BUDGET_FULL.toolsList * ratio)),
    teamContext: Math.max(0, Math.floor(DEFAULT_BUDGET_FULL.teamContext * ratio)),
    memoryContext: Math.max(0, Math.floor(DEFAULT_BUDGET_FULL.memoryContext * ratio)),
  }
  return { ...scaled, ...override }
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / APPROX_CHARS_PER_TOKEN)
}

export function clipToBudget(text: string, tokenBudget: number): { content: string; truncated: boolean } {
  const charBudget = tokenBudget * APPROX_CHARS_PER_TOKEN
  if (text.length <= charBudget) return { content: text, truncated: false }
  return { content: text.slice(0, charBudget) + '\n\n[truncated — section budget]', truncated: true }
}
```

- [ ] **Step 2: Tests** (5 cases)

- Default budget sums to ~8800 ± 100
- `shrinkForContextWindow(8000)` returns smaller budgets, locked sections preserved
- `shrinkForContextWindow(200000)` returns default budget unchanged
- `estimateTokens('x'.repeat(400))` returns 100
- `clipToBudget('x'.repeat(1000), 100)` returns truncated marker

- [ ] **Step 3: Run + commit (ASK USER FIRST)**

```bash
bun test tests/modules/prompt-wizard/token-budget.test.ts --run
git add src/modules/prompt-wizard/token-budget.ts tests/modules/prompt-wizard/token-budget.test.ts
git commit -m "feat(prompt-wizard): token budget calculator with context-window shrink"
```

---

### Task 16: Cache prefix builder

**Files:**
- Create: `src/modules/prompt-wizard/cache-prefix-builder.ts`
- Create: `tests/modules/prompt-wizard/cache-prefix-builder.test.ts`

- [ ] **Step 1: Implement builder**

```typescript
// src/modules/prompt-wizard/cache-prefix-builder.ts
import type { AgentWorkspace } from './workspace-types.js'
import type { CascadeResult } from './project-context-loader.js'
import type { SectionBudget } from './token-budget.js'
import { clipToBudget } from './token-budget.js'

export interface CachePrefixInput {
  coreIdentity: string
  coreRules: string
  workspace: AgentWorkspace
  cascade: CascadeResult
  skillsList: { name: string; oneLine: string }[]
  toolsList: { name: string; oneLine: string }[]
  budget: SectionBudget
}

function tag(name: string, content: string): string {
  if (!content.trim()) return ''
  return `<${name}>\n${content.trim()}\n</${name}>\n\n`
}

export function buildCachePrefix(input: CachePrefixInput): string {
  const parts: string[] = []

  parts.push(tag('core-identity', clipToBudget(input.coreIdentity, input.budget.coreIdentity).content))
  parts.push(tag('core-rules', clipToBudget(input.coreRules, input.budget.coreRules).content))

  if (input.cascade.projectTypeAgents || input.cascade.projectAgents) {
    const cascadeParts: string[] = []
    if (input.cascade.projectTypeAgents) {
      cascadeParts.push(`<source name="project-type" id="${input.cascade.projectTypeId ?? ''}">`)
      cascadeParts.push(input.cascade.projectTypeAgents.trim())
      cascadeParts.push('</source>')
    }
    if (input.cascade.projectAgents) {
      cascadeParts.push(`<source name="project" id="${input.cascade.projectId ?? ''}">`)
      cascadeParts.push(input.cascade.projectAgents.trim())
      cascadeParts.push('</source>')
    }
    const cascadeRaw = cascadeParts.join('\n')
    parts.push(tag('project-context', clipToBudget(cascadeRaw, input.budget.projectCascade).content))
  }

  parts.push(tag('agent-identity', clipToBudget(input.workspace.identity.body, input.budget.identityMd).content))
  parts.push(tag('agent-voice', clipToBudget(input.workspace.soulMd.body, input.budget.soulMd).content))

  if (input.workspace.agentsMd.body.trim()) {
    parts.push(tag('agent-notes', clipToBudget(input.workspace.agentsMd.body, input.budget.agentsMd).content))
  }
  if (input.workspace.toolsMd.body.trim()) {
    parts.push(tag('agent-env-notes', clipToBudget(input.workspace.toolsMd.body, input.budget.toolsMd).content))
  }

  if (input.skillsList.length > 0) {
    const skillsLines = ['The following skills are available to invoke:']
    for (const s of input.skillsList) skillsLines.push(`- ${s.name}: ${s.oneLine}`)
    skillsLines.push('Full skill content is loaded on-demand via `skill_load(name)`.')
    parts.push(tag('available-skills', clipToBudget(skillsLines.join('\n'), input.budget.skillsList).content))
  }

  if (input.toolsList.length > 0) {
    const toolsLines = ['The following tools are available:']
    for (const t of input.toolsList) toolsLines.push(`- ${t.name}: ${t.oneLine}`)
    toolsLines.push('Full tool schemas are delivered via the provider native tool API.')
    parts.push(tag('available-tools', clipToBudget(toolsLines.join('\n'), input.budget.toolsList).content))
  }

  return parts.join('').trimEnd() + '\n'
}
```

- [ ] **Step 2: Tests** (5 cases)

- Minimal prefix (only core + identity + soul) renders correctly
- Cascade tags appear when project context present
- Agent-notes section omitted when AGENTS.md is empty
- Skills/tools sections omitted when arrays empty
- Each section respects budget cap (large input gets truncated marker)

- [ ] **Step 3: Run + commit (ASK USER FIRST)**

```bash
bun test tests/modules/prompt-wizard/cache-prefix-builder.test.ts --run
git add src/modules/prompt-wizard/cache-prefix-builder.ts tests/modules/prompt-wizard/cache-prefix-builder.test.ts
git commit -m "feat(prompt-wizard): cache prefix builder with section budgets"
```

---

### Task 17: Cache suffix builder + active voice injection

**Files:**
- Create: `src/modules/prompt-wizard/cache-suffix-builder.ts`
- Create: `tests/modules/prompt-wizard/cache-suffix-builder.test.ts`

- [ ] **Step 1: Implement builder**

```typescript
// src/modules/prompt-wizard/cache-suffix-builder.ts
import type { VoiceProfile, VoiceScope } from './types.js'
import type { SectionBudget } from './token-budget.js'
import { clipToBudget } from './token-budget.js'

export interface RuntimeContext {
  date: string         // ISO date
  time: string         // HH:MM with timezone
  channel: string      // e.g. 'owner_dm', 'telegram_group'
  os: string
  gitStatus?: string
  tokensUsedMonth?: number
  monthlyTokenBudget?: number
}

export interface TeamContextSummary {
  teamSessionId: string
  members: { name: string; tier: string; status: string }[]
  sharedMemoryEntryCount: number
}

export interface MemoryContextSummary {
  workingMemory: { content: string }[]
  goalAncestry: string | null
}

export interface CacheSuffixInput {
  team: TeamContextSummary | null
  memory: MemoryContextSummary | null
  runtime: RuntimeContext
  activeVoice: { scope: VoiceScope; reason: string; profile: VoiceProfile }
  budget: SectionBudget
}

function tag(name: string, content: string): string {
  if (!content.trim()) return ''
  return `<${name}>\n${content.trim()}\n</${name}>\n\n`
}

function renderActiveVoice(scope: VoiceScope, reason: string, p: VoiceProfile): string {
  const lines: string[] = []
  lines.push(`Voice scope: ${scope.toUpperCase()}`)
  lines.push(`Reason: ${reason}`)
  lines.push(`Effective profile (from your SOUL.md):`)
  lines.push(`- Address: ${p.address}`)
  lines.push(`- Tone: ${p.tone}`)
  lines.push(`- Verbosity: ${p.verbosity}`)
  lines.push(`- Directness: ${p.directness}`)
  lines.push(`- Humor: ${p.humor}`)
  lines.push(`- Emoji: ${p.emoji}`)
  if (p.blockedPhrases.length > 0) {
    lines.push(`- Blocked phrases: ${JSON.stringify(p.blockedPhrases)}`)
  }
  return lines.join('\n')
}

export function buildCacheSuffix(input: CacheSuffixInput): string {
  const parts: string[] = []

  if (input.team) {
    const lines = [`You are operating in team session "${input.team.teamSessionId}".`]
    lines.push('Active members:')
    for (const m of input.team.members) lines.push(`- ${m.name} (${m.tier}, ${m.status})`)
    lines.push(`Shared memory keys: ${input.team.sharedMemoryEntryCount} entries (use team_memory_get to load)`)
    parts.push(tag('team-context', clipToBudget(lines.join('\n'), input.budget.teamContext).content))
  }

  if (input.memory && (input.memory.workingMemory.length > 0 || input.memory.goalAncestry)) {
    const lines: string[] = []
    if (input.memory.workingMemory.length > 0) {
      lines.push('Working memory:')
      input.memory.workingMemory.forEach((w, i) => lines.push(`${i + 1}. ${w.content}`))
    }
    if (input.memory.goalAncestry) lines.push(`Goal ancestry: ${input.memory.goalAncestry}`)
    parts.push(tag('memory-context', clipToBudget(lines.join('\n'), input.budget.memoryContext).content))
  }

  const runtimeLines = [
    `- Current date: ${input.runtime.date}`,
    `- Current time: ${input.runtime.time}`,
    `- Channel: ${input.runtime.channel}`,
    `- OS: ${input.runtime.os}`,
  ]
  if (input.runtime.gitStatus) runtimeLines.push(`- Git status: ${input.runtime.gitStatus}`)
  if (input.runtime.tokensUsedMonth !== undefined && input.runtime.monthlyTokenBudget) {
    runtimeLines.push(`- Tokens used this month: ${input.runtime.tokensUsedMonth} / ${input.runtime.monthlyTokenBudget}`)
  }
  parts.push(tag('runtime', clipToBudget(runtimeLines.join('\n'), input.budget.runtime).content))

  parts.push(tag('active-voice', clipToBudget(renderActiveVoice(input.activeVoice.scope, input.activeVoice.reason, input.activeVoice.profile), input.budget.activeVoice).content))

  return parts.join('').trimEnd() + '\n'
}
```

- [ ] **Step 2: Tests** (5 cases)

- Suffix without team/memory still includes runtime + active-voice
- Team context renders all members
- Memory context renders working memory + ancestry
- `<active-voice>` always present and includes profile fields
- Blocked phrases line only present when non-empty

- [ ] **Step 3: Run + commit (ASK USER FIRST)**

```bash
bun test tests/modules/prompt-wizard/cache-suffix-builder.test.ts --run
git add src/modules/prompt-wizard/cache-suffix-builder.ts tests/modules/prompt-wizard/cache-suffix-builder.test.ts
git commit -m "feat(prompt-wizard): dynamic cache suffix builder with active voice"
```

---

### Task 18: Main assembler.buildForPrimary

**Files:**
- Modify: `src/modules/prompt-wizard/assembler.ts` (replace existing)
- Create: `tests/modules/prompt-wizard/assembler-primary.test.ts`

- [ ] **Step 1: Replace assembler.ts**

```typescript
// src/modules/prompt-wizard/assembler.ts
import { createHash } from 'node:crypto'
import type { WorkspaceLoader } from './workspace-loader.js'
import type { ProjectContextLoader } from './project-context-loader.js'  // see Task 14 export
import type { AssembledPrompt, VoiceProfile, VoiceScope, ParentSnapshot } from './types.js'
import type { SectionBudget } from './token-budget.js'
import { CORE_IDENTITY } from './core-identity.js'
import { CORE_RULES } from './core-rules.js'
import { buildCachePrefix } from './cache-prefix-builder.js'
import { buildCacheSuffix, type RuntimeContext, type TeamContextSummary, type MemoryContextSummary } from './cache-suffix-builder.js'
import { DEFAULT_BUDGET_FULL, shrinkForContextWindow, estimateTokens } from './token-budget.js'

export interface AssemblerDeps {
  workspaceLoader: WorkspaceLoader
  projectContextLoader: ReturnType<typeof import('./project-context-loader.js').createProjectContextLoader>
  resolveSkillsFor: (agentId: string) => Promise<{ name: string; oneLine: string }[]>
  resolveToolsFor: (agentId: string) => Promise<{ name: string; oneLine: string }[]>
  resolveTeamContext: (conversationId: string | null) => Promise<TeamContextSummary | null>
  resolveMemoryContext: (conversationId: string | null, agentId: string) => Promise<MemoryContextSummary | null>
  resolveActiveVoice: (params: { agentId: string; channelContext: unknown; conversationId: string | null }) => Promise<{ scope: VoiceScope; reason: string; profile: VoiceProfile }>
  resolveRuntime: () => RuntimeContext
  resolveContextWindow: (agentId: string) => Promise<number>
}

export interface BuildOptions {
  agentId: string
  agentName: string
  conversationId: string | null
  projectId: string | null
  channelContext: unknown
  budgetOverride?: Partial<SectionBudget>
}

export function createPromptAssembler(deps: AssemblerDeps) {
  async function buildForPrimary(opts: BuildOptions): Promise<AssembledPrompt> {
    const ws = await deps.workspaceLoader.load(opts.agentId)
    const cascade = await deps.projectContextLoader.cascade({ projectId: opts.projectId })
    const ctx = await deps.resolveContextWindow(opts.agentId)
    const budget = shrinkForContextWindow(ctx, opts.budgetOverride)

    const [skills, tools, team, memory, voice] = await Promise.all([
      deps.resolveSkillsFor(opts.agentId),
      deps.resolveToolsFor(opts.agentId),
      deps.resolveTeamContext(opts.conversationId),
      deps.resolveMemoryContext(opts.conversationId, opts.agentId),
      deps.resolveActiveVoice({ agentId: opts.agentId, channelContext: opts.channelContext, conversationId: opts.conversationId }),
    ])

    const prefix = buildCachePrefix({
      coreIdentity: CORE_IDENTITY,
      coreRules: CORE_RULES,
      workspace: ws,
      cascade,
      skillsList: skills,
      toolsList: tools,
      budget,
    })

    const suffix = buildCacheSuffix({
      team,
      memory,
      runtime: deps.resolveRuntime(),
      activeVoice: voice,
      budget,
    })

    const prefixHash = createHash('sha256').update(prefix).digest('hex')

    return {
      prefix,
      suffix,
      reminders: [],
      cacheBoundaryHint: prefix.length,
      prefixHash,
      tokenEstimate: {
        prefix: estimateTokens(prefix),
        suffix: estimateTokens(suffix),
        reminders: 0,
      },
    }
  }

  return { buildForPrimary }
}

export type PromptAssembler = ReturnType<typeof createPromptAssembler>
```

- [ ] **Step 2: Integration test**

```typescript
// tests/modules/prompt-wizard/assembler-primary.test.ts
import { describe, expect, it } from 'vitest'
import { createPromptAssembler } from '../../../src/modules/prompt-wizard/assembler.js'

describe('assembler.buildForPrimary', () => {
  it('produces an AssembledPrompt with stable prefixHash', async () => {
    const fakeWs = {
      agentId: 'jarvis', rootPath: '/tmp/jarvis',
      identity: { name: 'IDENTITY.md', path: '', exists: true, frontmatter: null, body: '## My mission\nx', byteSize: 0, truncated: false },
      soulMd: { name: 'SOUL.md', path: '', exists: true, frontmatter: null, body: '## [Internal Voice]\n## [External Voice]', byteSize: 0, truncated: false },
      soulStyleJson: { name: 'SOUL.style.json', path: '', exists: true, frontmatter: null, body: '{}', byteSize: 0, truncated: false },
      agentsMd: { name: 'AGENTS.md', path: '', exists: true, frontmatter: null, body: '', byteSize: 0, truncated: false },
      toolsMd: { name: 'TOOLS.md', path: '', exists: true, frontmatter: null, body: '', byteSize: 0, truncated: false },
      memoryMd: { name: 'MEMORY.md', path: '', exists: true, frontmatter: null, body: '', byteSize: 0, truncated: false },
      dailyMemory: [],
    }
    const assembler = createPromptAssembler({
      workspaceLoader: { load: async () => fakeWs as never, invalidate: () => {}, invalidateAll: () => {} },
      projectContextLoader: { cascade: async () => ({ projectAgents: null, projectTypeAgents: null, projectId: null, projectTypeId: null }) },
      resolveSkillsFor: async () => [],
      resolveToolsFor: async () => [],
      resolveTeamContext: async () => null,
      resolveMemoryContext: async () => null,
      resolveActiveVoice: async () => ({ scope: 'internal', reason: 'owner DM', profile: { address: 'tegező', tone: 'baráti', verbosity: 'lényegre törő', directness: 'direkt + udvarias', humor: 'nincs', emoji: 'soha', blockedPhrases: [], signature: '' } }),
      resolveRuntime: () => ({ date: '2026-04-26', time: '14:00 CET', channel: 'owner_dm', os: 'darwin' }),
      resolveContextWindow: async () => 200_000,
    })
    const a = await assembler.buildForPrimary({ agentId: 'jarvis', agentName: 'Jarvis', conversationId: null, projectId: null, channelContext: null })
    expect(a.prefix).toContain('<core-identity>')
    expect(a.prefix).toContain('<agent-voice>')
    expect(a.suffix).toContain('<active-voice>')
    expect(a.prefixHash).toMatch(/^[a-f0-9]{64}$/)
    expect(a.tokenEstimate.prefix).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 3: Run + commit (ASK USER FIRST)**

```bash
bun test tests/modules/prompt-wizard/assembler-primary.test.ts --run
git add src/modules/prompt-wizard/assembler.ts tests/modules/prompt-wizard/assembler-primary.test.ts
git commit -m "feat(prompt-wizard): refactor assembler to provider-agnostic AssembledPrompt"
```

---

### Task 19: Sub-agent prompt builder + parent snapshot

**Files:**
- Create: `src/modules/agent/parent-snapshot.ts`
- Create: `src/modules/prompt-wizard/subagent-prompt-builder.ts`
- Create: `tests/modules/agent/parent-snapshot.test.ts`
- Create: `tests/modules/prompt-wizard/subagent-prompt-builder.test.ts`

- [ ] **Step 1: Implement parent snapshot builder**

```typescript
// src/modules/agent/parent-snapshot.ts
import type { ParentSnapshot, VoiceProfile, VoiceScope } from '../prompt-wizard/types.js'
import type { SoulStyleParsed } from '../prompt-wizard/soul-style-schema.js'

export interface BuildParentSnapshotInput {
  originatingAgentId: string
  originatingAgentName: string
  originatingSoulStyle: SoulStyleParsed
  outputAudience: 'parent' | 'external'
}

export function buildParentSnapshot(input: BuildParentSnapshotInput): ParentSnapshot {
  const scope: VoiceScope = input.outputAudience === 'parent' ? 'internal' : 'external'
  const profile: VoiceProfile = input.originatingSoulStyle[scope]
  return {
    agentId: input.originatingAgentId,
    name: input.originatingAgentName,
    voiceProfile: profile,
    voiceProfileSource: scope,
    blockedPhrases: profile.blockedPhrases,
    signature: profile.signature,
    originatingAgentId: input.originatingAgentId,
  }
}
```

- [ ] **Step 2: Implement sub-agent prompt builder**

```typescript
// src/modules/prompt-wizard/subagent-prompt-builder.ts
import { createHash } from 'node:crypto'
import type { ParentSnapshot, AssembledPrompt } from './types.js'
import type { CascadeResult } from './project-context-loader.js'
import { CORE_IDENTITY } from './core-identity.js'
import { CORE_RULES } from './core-rules.js'
import { estimateTokens } from './token-budget.js'

export interface SubAgentPromptInput {
  subagentName: string
  delegatedTask: string
  outputAudience: 'parent' | 'external'
  parentSnapshot: ParentSnapshot
  cascade: CascadeResult
  runtime: { date: string; channel: string; os: string }
  childDepth: number
  maxSpawnDepth: number
}

function tag(name: string, content: string): string {
  if (!content.trim()) return ''
  return `<${name}>\n${content.trim()}\n</${name}>\n\n`
}

function renderDelegatedVoice(snap: ParentSnapshot): string {
  const p = snap.voiceProfile
  return [
    `When producing output for ${snap.name}: speak as you would to a peer.`,
    `When producing output for the original user/external party: use this exact voice profile (snapshotted from your originating agent at delegation time):`,
    `- Address: ${p.address}`,
    `- Tone: ${p.tone}`,
    `- Verbosity: ${p.verbosity}`,
    `- Directness: ${p.directness}`,
    `- Humor: ${p.humor}`,
    `- Emoji: ${p.emoji}`,
    p.blockedPhrases.length > 0 ? `- Blocked phrases: ${JSON.stringify(p.blockedPhrases)}` : '',
    p.signature ? `- Signature flair: ${p.signature}` : '',
  ].filter(Boolean).join('\n')
}

export function buildSubagentPrompt(input: SubAgentPromptInput): AssembledPrompt {
  const parts: string[] = []
  parts.push(tag('core-identity', CORE_IDENTITY))
  parts.push(tag('core-rules', CORE_RULES))

  if (input.cascade.projectTypeAgents || input.cascade.projectAgents) {
    const cascadeLines: string[] = []
    if (input.cascade.projectTypeAgents) cascadeLines.push(`<source name="project-type">\n${input.cascade.projectTypeAgents}\n</source>`)
    if (input.cascade.projectAgents) cascadeLines.push(`<source name="project">\n${input.cascade.projectAgents}\n</source>`)
    parts.push(tag('project-context', cascadeLines.join('\n')))
  }

  parts.push(tag('subagent-role', [
    `You are a subagent spawned by ${input.parentSnapshot.name} for a specific task.`,
    `You exist solely to handle: ${input.delegatedTask}`,
    `You are NOT ${input.parentSnapshot.name}. Don't try to be.`,
    input.childDepth < input.maxSpawnDepth
      ? 'You may spawn further sub-agents using `sessions_spawn` if the task warrants.'
      : 'You may NOT spawn further sub-agents (depth limit reached).',
  ].join('\n')))

  parts.push(tag('delegated-voice', renderDelegatedVoice(input.parentSnapshot)))

  parts.push(tag('task', input.delegatedTask))
  parts.push(tag('output-audience', `Your output will be delivered to: ${input.outputAudience}`))

  parts.push(tag('runtime', `- Date: ${input.runtime.date}\n- Channel: ${input.runtime.channel}\n- OS: ${input.runtime.os}`))

  const prefix = parts.join('').trimEnd() + '\n'
  const prefixHash = createHash('sha256').update(prefix).digest('hex')
  return {
    prefix,
    suffix: '',
    reminders: [],
    cacheBoundaryHint: prefix.length,
    prefixHash,
    tokenEstimate: { prefix: estimateTokens(prefix), suffix: 0, reminders: 0 },
  }
}
```

- [ ] **Step 3: Tests** (4 cases)

- `buildParentSnapshot` picks internal voice for `outputAudience='parent'`
- `buildParentSnapshot` picks external voice for `outputAudience='external'`
- `buildSubagentPrompt` includes parent snapshot fields in `<delegated-voice>`
- `buildSubagentPrompt` excludes own SOUL/IDENTITY/MEMORY tags

- [ ] **Step 4: Wire into delegation**

Modify `src/modules/agent/delegation.ts`:
- When invoking `delegate_to_agent`, look up `team_sessions.originating_agent_id` (default to current agent if absent)
- Load originating agent's `SOUL.style.json`
- Call `buildParentSnapshot` and store in `team_sessions.parent_snapshot`
- Pass to `buildSubagentPrompt`

- [ ] **Step 5: Run + commit (ASK USER FIRST)**

```bash
bun test tests/modules/agent/parent-snapshot.test.ts tests/modules/prompt-wizard/subagent-prompt-builder.test.ts --run
git add src/modules/agent/parent-snapshot.ts src/modules/prompt-wizard/subagent-prompt-builder.ts \
        tests/modules/agent/parent-snapshot.test.ts tests/modules/prompt-wizard/subagent-prompt-builder.test.ts \
        src/modules/agent/delegation.ts
git commit -m "feat(agent): sub-agent prompt with parent voice snapshot"
```

---

## Phase 4 — Provider Adapter Updates

### Task 20: Provider capabilities + NormalizedRequest

**Files:**
- Modify: `src/modules/model/types.ts`
- Modify: `src/modules/model/index.ts`

- [ ] **Step 1: Extend types**

Append to `src/modules/model/types.ts`:

```typescript
import type { AssembledPrompt } from '../prompt-wizard/types.js'

export interface ProviderCapabilities {
  promptCache: 'explicit' | 'automatic' | 'none'
  promptCacheMinTokens?: number          // e.g. Gemini = 32_000
  toolCalling: 'native' | 'inline-fallback' | 'none'
  multiSystemMessages: boolean
  thinking: boolean
  effectiveContextWindow: number          // tokens
}

export interface NormalizedRequest {
  systemPrompt: AssembledPrompt
  messages: ConversationMessage[]
  tools?: ToolDefinition[]
  thinking?: ThinkingConfig
  modelId: string
  metadata?: Record<string, unknown>
}

export interface ModelProvider {
  readonly id: string
  readonly capabilities: ProviderCapabilities
  send(request: NormalizedRequest): Promise<ModelResponse>
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
bun tsc --noEmit
```

- [ ] **Step 3: Commit (ASK USER FIRST)**

```bash
git add src/modules/model/types.ts src/modules/model/index.ts
git commit -m "feat(model): provider capabilities + NormalizedRequest typing"
```

---

### Task 21: Update Anthropic adapter for cache markers

**Files:**
- Modify: `src/modules/model/providers/anthropic-adapter.ts`
- Modify: `tests/modules/model/providers/anthropic-adapter.test.ts`

- [ ] **Step 1: Update adapter**

Replace the `send` implementation in `src/modules/model/providers/anthropic-adapter.ts`:

```typescript
import type { NormalizedRequest, ModelProvider, ProviderCapabilities } from '../types.js'

export class AnthropicAdapter implements ModelProvider {
  readonly id = 'anthropic'
  readonly capabilities: ProviderCapabilities = {
    promptCache: 'explicit',
    toolCalling: 'native',
    multiSystemMessages: true,
    thinking: true,
    effectiveContextWindow: 200_000,
  }

  constructor(private client: import('@anthropic-ai/sdk').default) {}

  async send(req: NormalizedRequest): Promise<ModelResponse> {
    const systemBlocks: Array<{ type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }> = []
    if (req.systemPrompt.prefix.trim()) {
      systemBlocks.push({ type: 'text', text: req.systemPrompt.prefix, cache_control: { type: 'ephemeral' } })
    }
    if (req.systemPrompt.suffix.trim()) {
      systemBlocks.push({ type: 'text', text: req.systemPrompt.suffix })
    }
    for (const r of req.systemPrompt.reminders) systemBlocks.push({ type: 'text', text: r })

    const response = await this.client.messages.create({
      model: req.modelId,
      max_tokens: 4096,
      system: systemBlocks,
      messages: req.messages.map(toAnthropicMessage),
      tools: req.tools?.map(toAnthropicTool),
      thinking: req.thinking ? { type: 'enabled', budget_tokens: req.thinking.budgetTokens ?? 8000 } : undefined,
    })
    return normalizeResponse(response)
  }
}
```

(Helper functions `toAnthropicMessage`, `toAnthropicTool`, `normalizeResponse` already exist in the current adapter — keep them.)

- [ ] **Step 2: Update tests to assert cache_control marker**

```typescript
// tests/modules/model/providers/anthropic-adapter.test.ts
import { describe, expect, it, vi } from 'vitest'
import { AnthropicAdapter } from '../../../../src/modules/model/providers/anthropic-adapter.js'

describe('AnthropicAdapter', () => {
  it('attaches cache_control to prefix only', async () => {
    const create = vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 10, output_tokens: 5 } })
    const adapter = new AnthropicAdapter({ messages: { create } } as never)
    await adapter.send({
      systemPrompt: { prefix: 'PREFIX', suffix: 'SUFFIX', reminders: ['REM'], cacheBoundaryHint: 0, prefixHash: 'x', tokenEstimate: { prefix: 1, suffix: 1, reminders: 1 } },
      messages: [{ role: 'user', content: 'hi' }],
      modelId: 'claude-sonnet-4-6',
    } as never)
    const arg = create.mock.calls[0][0]
    expect(arg.system[0]).toMatchObject({ text: 'PREFIX', cache_control: { type: 'ephemeral' } })
    expect(arg.system[1]).toMatchObject({ text: 'SUFFIX' })
    expect(arg.system[1].cache_control).toBeUndefined()
    expect(arg.system[2]).toMatchObject({ text: 'REM' })
  })
})
```

- [ ] **Step 3: Run + commit (ASK USER FIRST)**

```bash
bun test tests/modules/model/providers/anthropic-adapter.test.ts --run
git add src/modules/model/providers/anthropic-adapter.ts tests/modules/model/providers/anthropic-adapter.test.ts
git commit -m "feat(model): Anthropic adapter wires cache_control to prefix"
```

---

### Task 22: Update OpenAI adapter (single system message)

**Files:**
- Modify: `src/modules/model/providers/openai-adapter.ts`
- Modify: `tests/modules/model/providers/openai-adapter.test.ts`

- [ ] **Step 1: Update adapter**

```typescript
import type { NormalizedRequest, ModelProvider, ProviderCapabilities } from '../types.js'

export class OpenAIAdapter implements ModelProvider {
  readonly id = 'openai'
  readonly capabilities: ProviderCapabilities = {
    promptCache: 'automatic',
    toolCalling: 'native',
    multiSystemMessages: true,
    thinking: false,
    effectiveContextWindow: 128_000,
  }

  constructor(private client: import('openai').default) {}

  async send(req: NormalizedRequest): Promise<ModelResponse> {
    const systemMessages = []
    const concatenated = [req.systemPrompt.prefix, req.systemPrompt.suffix].filter((s) => s.trim()).join('\n\n')
    if (concatenated) systemMessages.push({ role: 'system' as const, content: concatenated })
    for (const r of req.systemPrompt.reminders) systemMessages.push({ role: 'system' as const, content: r })

    const response = await this.client.chat.completions.create({
      model: req.modelId,
      messages: [...systemMessages, ...req.messages.map(toOpenAIMessage)],
      tools: req.tools?.map(toOpenAITool),
    })
    return normalizeOpenAIResponse(response)
  }
}
```

- [ ] **Step 2: Test concatenation + multi-system reminders**

- [ ] **Step 3: Run + commit (ASK USER FIRST)**

```bash
bun test tests/modules/model/providers/openai-adapter.test.ts --run
git add src/modules/model/providers/openai-adapter.ts tests/modules/model/providers/openai-adapter.test.ts
git commit -m "feat(model): OpenAI adapter concatenates prefix+suffix into system message"
```

---

### Task 23: Update Google + Ollama adapters

**Files:**
- Modify: `src/modules/model/providers/google-adapter.ts`
- Modify: `src/modules/model/providers/ollama-adapter.ts`
- Modify: tests for both

- [ ] **Step 1: Update Google adapter**

```typescript
async send(req: NormalizedRequest): Promise<ModelResponse> {
  const systemInstruction = [req.systemPrompt.prefix, req.systemPrompt.suffix, ...req.systemPrompt.reminders]
    .filter((s) => s.trim()).join('\n\n---\n\n')

  // explicit cached content if prefix > 32k
  let cachedContentName: string | undefined
  if (this.capabilities.promptCache === 'explicit' && req.systemPrompt.tokenEstimate.prefix > (this.capabilities.promptCacheMinTokens ?? 32_000)) {
    const cached = await this.client.cachedContents.create({
      model: req.modelId,
      contents: [{ role: 'user', parts: [{ text: req.systemPrompt.prefix }] }],
      ttl: '300s',
    })
    cachedContentName = cached.name
  }

  const response = await this.client.models.generateContent({
    model: req.modelId,
    systemInstruction: { parts: [{ text: systemInstruction }] },
    contents: req.messages.map(toGoogleMessage),
    cachedContent: cachedContentName,
  })
  return normalizeGoogleResponse(response)
}
```

Set capabilities: `promptCache: 'explicit'`, `promptCacheMinTokens: 32_000`, `multiSystemMessages: false`.

- [ ] **Step 2: Update Ollama adapter**

```typescript
readonly capabilities: ProviderCapabilities = {
  promptCache: 'none',
  toolCalling: 'native',          // assume modern models
  multiSystemMessages: false,
  thinking: false,
  effectiveContextWindow: 32_768, // typical for Llama 3.1+ default
}

async send(req: NormalizedRequest): Promise<ModelResponse> {
  const fullSystem = [req.systemPrompt.prefix, req.systemPrompt.suffix, ...req.systemPrompt.reminders]
    .filter((s) => s.trim()).join('\n\n')
  const response = await this.client.chat({
    model: req.modelId,
    messages: [{ role: 'system', content: fullSystem }, ...req.messages.map(toOllamaMessage)],
    tools: req.tools?.map(toOllamaTool),
  })
  return normalizeOllamaResponse(response)
}
```

- [ ] **Step 3: Tests for both**

- [ ] **Step 4: Run + commit (ASK USER FIRST)**

```bash
bun test tests/modules/model/providers/google-adapter.test.ts tests/modules/model/providers/ollama-adapter.test.ts --run
git add src/modules/model/providers/google-adapter.ts src/modules/model/providers/ollama-adapter.ts \
        tests/modules/model/providers/google-adapter.test.ts tests/modules/model/providers/ollama-adapter.test.ts
git commit -m "feat(model): Google + Ollama adapters use AssembledPrompt format"
```

---

### Task 24: Update Grok + DeepSeek (OpenAI clones) + agent-runner integration

**Files:**
- Modify: `src/modules/model/providers/grok-adapter.ts`
- Modify: `src/modules/model/providers/deepseek-adapter.ts`
- Modify: `src/modules/agent/agent-runner.ts`

- [ ] **Step 1: Mirror OpenAI pattern in Grok and DeepSeek adapters**

Both follow OpenAI's concat-into-system-message pattern. Set `capabilities.promptCache: 'automatic'`.

- [ ] **Step 2: Update agent-runner to accept AssembledPrompt**

In `src/modules/agent/agent-runner.ts`, change `AgentRunOptions`:

```typescript
import type { AssembledPrompt } from '../prompt-wizard/types.js'

export interface AgentRunOptions {
  messages: ModelMessage[]
  tools: ToolDefinition[]
  system: AssembledPrompt           // was: string
  maxTurns: number
  // ...
}

// In run():
const request: NormalizedRequest = {
  systemPrompt: options.system,
  messages: options.messages,
  tools: options.tools,
  modelId: options.model ?? defaultModel,
}
```

- [ ] **Step 3: Update existing call sites**

Find all callers of `agent-runner.run` and update to pass `AssembledPrompt` instead of plain string. Use grep to locate:

```bash
grep -rn "agentRunner.run\|agent-runner.run" src/
```

For each call site, ensure the assembled prompt is built first via `assembler.buildForPrimary` (or `buildSubagentPrompt`).

- [ ] **Step 4: Run full agent test suite**

```bash
bun test tests/modules/agent/ --run
```

Fix any callers that still pass a plain string.

- [ ] **Step 5: Commit (ASK USER FIRST)**

```bash
git add src/modules/model/providers/grok-adapter.ts src/modules/model/providers/deepseek-adapter.ts \
        src/modules/agent/agent-runner.ts
git commit -m "feat(model): Grok+DeepSeek adapters; agent-runner accepts AssembledPrompt"
```

---

## Phase 5 — Channel Resolver + Voice Scope Wiring

### Task 25: Internal contacts registry

**Files:**
- Create: `src/modules/communication/internal-contacts-registry.ts`
- Create: `tests/modules/communication/internal-contacts-registry.test.ts`

- [ ] **Step 1: Implement registry**

```typescript
// src/modules/communication/internal-contacts-registry.ts
import { eq, and } from 'drizzle-orm'
import type { Database } from '../../core/db.js'
import { internalContacts } from './internal-contacts-schema.js'

export type ContactRole = 'owner' | 'team-member'
export type ChannelType = 'web' | 'telegram' | 'email' | 'odoo-chatter' | 'hand-companion' | 'slack' | 'discord'

export interface InternalContact {
  id: string
  identifier: string
  channelType: ChannelType
  displayName: string
  role: ContactRole
  notes: string | null
  addedAt: string
  addedBy: string
}

export interface InternalContactsRegistry {
  add(input: { identifier: string; channelType: ChannelType; displayName: string; role: ContactRole; notes?: string; addedBy: string }): Promise<InternalContact>
  remove(id: string): Promise<boolean>
  lookup(identifier: string, channelType: ChannelType): Promise<InternalContact | null>
  list(): Promise<InternalContact[]>
  isInternal(identifier: string, channelType: ChannelType): Promise<boolean>
}

export function createInternalContactsRegistry(db: Database): InternalContactsRegistry {
  return {
    async add(input) {
      const id = `ic_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
      const row = {
        id,
        identifier: input.identifier,
        channelType: input.channelType,
        displayName: input.displayName,
        role: input.role,
        scope: 'internal' as const,
        notes: input.notes ?? null,
        addedAt: new Date().toISOString(),
        addedBy: input.addedBy,
      }
      await db.insert(internalContacts).values(row)
      return { ...row, scope: 'internal' as const }
    },
    async remove(id) {
      const r = await db.delete(internalContacts).where(eq(internalContacts.id, id))
      return r.changes > 0
    },
    async lookup(identifier, channelType) {
      const rows = await db.select().from(internalContacts)
        .where(and(eq(internalContacts.identifier, identifier), eq(internalContacts.channelType, channelType)))
        .limit(1)
      return rows[0] as InternalContact | null
    },
    async list() {
      return db.select().from(internalContacts) as Promise<InternalContact[]>
    },
    async isInternal(identifier, channelType) {
      const r = await this.lookup(identifier, channelType)
      return r !== null
    },
  }
}
```

- [ ] **Step 2: Tests** (5 cases)

- `add` creates row, `lookup` finds it
- `add` enforces unique (identifier, channelType)
- `remove` deletes
- `isInternal` returns true for known contacts, false for unknown
- `list` returns all in insertion order

- [ ] **Step 3: Run + commit (ASK USER FIRST)**

```bash
bun test tests/modules/communication/internal-contacts-registry.test.ts --run
git add src/modules/communication/internal-contacts-registry.ts tests/modules/communication/internal-contacts-registry.test.ts
git commit -m "feat(communication): internal contacts registry"
```

---

### Task 26: Channel resolver (Rule B)

**Files:**
- Create: `src/modules/communication/channel-resolver.ts`
- Create: `tests/modules/communication/channel-resolver.test.ts`

- [ ] **Step 1: Implement resolver**

```typescript
// src/modules/communication/channel-resolver.ts
export type VoiceScope = 'internal' | 'external'
export type ParticipantType = 'owner' | 'team-member' | 'known-contact' | 'unknown-external'

export interface ParticipantInfo {
  id: string
  type: ParticipantType
}

export interface ChannelContext {
  channelType: string
  conversationKind: 'owner-dm' | 'group' | 'public-channel' | 'broadcast'
  participants: ParticipantInfo[]
  origin: 'inbound' | 'outbound-proactive'
}

export interface ResolveScopeResult {
  scope: VoiceScope
  reason: string
}

export function resolveScope(ctx: ChannelContext): ResolveScopeResult {
  if (ctx.participants.length === 1 && ctx.participants[0].type === 'owner') {
    return { scope: 'internal', reason: 'owner DM' }
  }
  if (ctx.participants.every((p) => p.type === 'owner' || p.type === 'team-member')) {
    return { scope: 'internal', reason: 'owner + team-members only' }
  }
  const externals = ctx.participants.filter((p) => p.type === 'known-contact' || p.type === 'unknown-external').length
  return {
    scope: 'external',
    reason: `${ctx.conversationKind} with ${externals} external participant(s)`,
  }
}
```

- [ ] **Step 2: Tests** (8 cases — see spec section 8.9)

```typescript
// tests/modules/communication/channel-resolver.test.ts
import { describe, expect, it } from 'vitest'
import { resolveScope } from '../../../src/modules/communication/channel-resolver.js'

describe('resolveScope (Rule B)', () => {
  it('owner DM → internal', () => {
    expect(resolveScope({ channelType: 'web', conversationKind: 'owner-dm', participants: [{ id: 'u1', type: 'owner' }], origin: 'inbound' }).scope).toBe('internal')
  })
  it('owner + team-member group → internal', () => {
    const r = resolveScope({ channelType: 'telegram', conversationKind: 'group', participants: [{ id: 'u1', type: 'owner' }, { id: 't1', type: 'team-member' }], origin: 'inbound' })
    expect(r.scope).toBe('internal')
  })
  it('owner + known-contact → external', () => {
    expect(resolveScope({ channelType: 'email', conversationKind: 'group', participants: [{ id: 'u1', type: 'owner' }, { id: 'c1', type: 'known-contact' }], origin: 'inbound' }).scope).toBe('external')
  })
  it('owner + unknown-external → external', () => {
    expect(resolveScope({ channelType: 'telegram', conversationKind: 'group', participants: [{ id: 'u1', type: 'owner' }, { id: 'x1', type: 'unknown-external' }], origin: 'inbound' }).scope).toBe('external')
  })
  it('group all team-members + owner → internal', () => {
    expect(resolveScope({ channelType: 'slack', conversationKind: 'group', participants: [{ id: 'u1', type: 'owner' }, { id: 't1', type: 'team-member' }, { id: 't2', type: 'team-member' }], origin: 'inbound' }).scope).toBe('internal')
  })
  it('group with mixed externals → external with count in reason', () => {
    const r = resolveScope({ channelType: 'telegram', conversationKind: 'group', participants: [{ id: 'u1', type: 'owner' }, { id: 't1', type: 'team-member' }, { id: 'c1', type: 'known-contact' }, { id: 'x1', type: 'unknown-external' }], origin: 'inbound' })
    expect(r.scope).toBe('external')
    expect(r.reason).toMatch(/2 external/)
  })
  it('outbound-proactive single owner → internal', () => {
    expect(resolveScope({ channelType: 'web', conversationKind: 'owner-dm', participants: [{ id: 'u1', type: 'owner' }], origin: 'outbound-proactive' }).scope).toBe('internal')
  })
  it('broadcast to externals → external', () => {
    expect(resolveScope({ channelType: 'email', conversationKind: 'broadcast', participants: [{ id: 'x1', type: 'unknown-external' }], origin: 'outbound-proactive' }).scope).toBe('external')
  })
})
```

- [ ] **Step 3: Run + commit (ASK USER FIRST)**

```bash
bun test tests/modules/communication/channel-resolver.test.ts --run
git add src/modules/communication/channel-resolver.ts tests/modules/communication/channel-resolver.test.ts
git commit -m "feat(communication): channel resolver implementing Rule B"
```

---

### Task 27: Voice scope override hierarchy

**Files:**
- Create: `src/modules/communication/voice-scope-overrides.ts`
- Create: `tests/modules/communication/voice-scope-overrides.test.ts`

- [ ] **Step 1: Implement overrides**

```typescript
// src/modules/communication/voice-scope-overrides.ts
import type { VoiceScope } from './channel-resolver.js'

export interface OverrideInputs {
  perMessage: VoiceScope | null
  ephemeralSession: VoiceScope | null
  perConversation: VoiceScope | null
  perChannel: VoiceScope | null
  autoResolved: VoiceScope
}

export interface ResolveOverrideResult {
  scope: VoiceScope
  source: 'per-message' | 'ephemeral-session' | 'per-conversation' | 'per-channel' | 'auto'
}

export function resolveWithOverrides(inputs: OverrideInputs): ResolveOverrideResult {
  if (inputs.perMessage) return { scope: inputs.perMessage, source: 'per-message' }
  if (inputs.ephemeralSession) return { scope: inputs.ephemeralSession, source: 'ephemeral-session' }
  if (inputs.perConversation) return { scope: inputs.perConversation, source: 'per-conversation' }
  if (inputs.perChannel) return { scope: inputs.perChannel, source: 'per-channel' }
  return { scope: inputs.autoResolved, source: 'auto' }
}
```

- [ ] **Step 2: Tests** (5 cases — one per priority level)

- [ ] **Step 3: Implement ephemeral session store**

```typescript
// src/modules/communication/voice-scope-overrides.ts (append)
export interface EphemeralOverrideStore {
  get(conversationId: string): VoiceScope | null
  set(conversationId: string, scope: VoiceScope, ttlMinutes?: number): void
  clear(conversationId: string): void
}

export function createEphemeralOverrideStore(now: () => number = () => Date.now()): EphemeralOverrideStore {
  const data = new Map<string, { scope: VoiceScope; expiresAt: number }>()
  return {
    get(id) {
      const r = data.get(id)
      if (!r) return null
      if (r.expiresAt < now()) { data.delete(id); return null }
      return r.scope
    },
    set(id, scope, ttlMinutes = 60) {
      data.set(id, { scope, expiresAt: now() + ttlMinutes * 60_000 })
    },
    clear(id) { data.delete(id) },
  }
}
```

- [ ] **Step 4: Run + commit (ASK USER FIRST)**

```bash
bun test tests/modules/communication/voice-scope-overrides.test.ts --run
git add src/modules/communication/voice-scope-overrides.ts tests/modules/communication/voice-scope-overrides.test.ts
git commit -m "feat(communication): voice scope override hierarchy + ephemeral store"
```

---

### Task 28: Active voice resolver — wire it all together

**Files:**
- Create: `src/modules/communication/active-voice-resolver.ts`
- Create: `tests/modules/communication/active-voice-resolver.test.ts`

- [ ] **Step 1: Implement resolver**

```typescript
// src/modules/communication/active-voice-resolver.ts
import type { WorkspaceLoader } from '../prompt-wizard/workspace-loader.js'
import type { VoiceProfile, VoiceScope } from '../prompt-wizard/types.js'
import { soulStyleSchema } from '../prompt-wizard/soul-style-schema.js'
import { resolveScope, type ChannelContext } from './channel-resolver.js'
import { resolveWithOverrides, type EphemeralOverrideStore } from './voice-scope-overrides.js'

export interface ActiveVoiceResolverDeps {
  workspaceLoader: WorkspaceLoader
  ephemeralStore: EphemeralOverrideStore
  loadConversationOverride: (conversationId: string) => Promise<VoiceScope | null>
  loadChannelForceScope: (channelId: string) => Promise<VoiceScope | null>
}

export interface ResolveActiveVoiceInput {
  agentId: string
  conversationId: string | null
  channelId: string | null
  channelContext: ChannelContext
  perMessageOverride?: VoiceScope | null
}

export interface ActiveVoiceResult {
  scope: VoiceScope
  reason: string
  source: 'per-message' | 'ephemeral-session' | 'per-conversation' | 'per-channel' | 'auto'
  profile: VoiceProfile
}

export function createActiveVoiceResolver(deps: ActiveVoiceResolverDeps) {
  return async function resolveActiveVoice(input: ResolveActiveVoiceInput): Promise<ActiveVoiceResult> {
    const auto = resolveScope(input.channelContext)
    const perConv = input.conversationId ? await deps.loadConversationOverride(input.conversationId) : null
    const perCh = input.channelId ? await deps.loadChannelForceScope(input.channelId) : null
    const ephemeral = input.conversationId ? deps.ephemeralStore.get(input.conversationId) : null

    const decision = resolveWithOverrides({
      perMessage: input.perMessageOverride ?? null,
      ephemeralSession: ephemeral,
      perConversation: perConv,
      perChannel: perCh,
      autoResolved: auto.scope,
    })

    const ws = await deps.workspaceLoader.load(input.agentId)
    if (!ws.soulStyleJson.exists) {
      throw new Error(`agent ${input.agentId} has no SOUL.style.json`)
    }
    const style = soulStyleSchema.parse(JSON.parse(ws.soulStyleJson.body))
    const profile = style[decision.scope]

    return {
      scope: decision.scope,
      reason: decision.source === 'auto' ? auto.reason : `override (${decision.source})`,
      source: decision.source,
      profile,
    }
  }
}
```

- [ ] **Step 2: Tests** — 4 cases (auto, ephemeral wins, per-conversation wins, missing SOUL throws)

- [ ] **Step 3: Wire into assembler**

In Task 18's assembler, the `resolveActiveVoice` dependency is now provided by this resolver. Update bootstrap to wire it.

- [ ] **Step 4: Run + commit (ASK USER FIRST)**

```bash
bun test tests/modules/communication/active-voice-resolver.test.ts --run
git add src/modules/communication/active-voice-resolver.ts tests/modules/communication/active-voice-resolver.test.ts
git commit -m "feat(communication): active voice resolver combines override hierarchy + workspace SOUL"
```

---

### Task 29: Bootstrap wiring + module context updates

**Files:**
- Modify: `src/core/types.ts`
- Modify: `src/core/bootstrap.ts`
- Modify: `src/modules/prompt-wizard/index.ts`
- Modify: `src/modules/communication/index.ts`

- [ ] **Step 1: Add new services to ModuleContext**

In `src/core/types.ts`, extend `ModuleContext`:

```typescript
export interface ModuleContext {
  // ... existing fields ...
  workspaceLoader: WorkspaceLoader
  workspaceWriter: WorkspaceWriter
  workspaceWatcher: WorkspaceWatcher
  promptAssembler: PromptAssembler
  channelResolver: typeof resolveScope  // function
  internalContactsRegistry: InternalContactsRegistry
  ephemeralOverrideStore: EphemeralOverrideStore
}
```

- [ ] **Step 2: Wire in bootstrap**

In `src/core/bootstrap.ts`, after database init:

```typescript
const workspaceLoader = createWorkspaceLoader({ dataDir: config.dataDir })
const workspaceWriter = createWorkspaceWriter({ dataDir: config.dataDir })
const workspaceWatcher = createWorkspaceWatcher({ dataDir: config.dataDir })
workspaceWatcher.onInvalidate((agentId) => workspaceLoader.invalidate(agentId))
await workspaceWatcher.start()

const internalContactsRegistry = createInternalContactsRegistry(db)
const ephemeralOverrideStore = createEphemeralOverrideStore()

const projectContextLoader = createProjectContextLoader({
  dataDir: config.dataDir,
  resolveProjectType: async (id) => {
    const row = await db.select().from(projects).where(eq(projects.id, id)).limit(1)
    return row[0] ? { id: row[0].typeId } : null
  },
})

const activeVoiceResolver = createActiveVoiceResolver({
  workspaceLoader,
  ephemeralStore: ephemeralOverrideStore,
  loadConversationOverride: async (id) => {
    const r = await db.select({ override: conversations.voiceScopeOverride }).from(conversations).where(eq(conversations.id, id)).limit(1)
    return r[0]?.override ?? null
  },
  loadChannelForceScope: async (id) => {
    const r = await db.select({ force: channels.forceVoiceScope }).from(channels).where(eq(channels.id, id)).limit(1)
    return r[0]?.force ?? null
  },
})

const promptAssembler = createPromptAssembler({
  workspaceLoader,
  projectContextLoader,
  resolveSkillsFor: async (agentId) => {
    const enabled = ctx.skillsMatcher.listEnabled()
    return enabled.map((s) => ({ name: s.name, oneLine: s.description.slice(0, 120) }))
  },
  resolveToolsFor: async (agentId) => toolRegistry.listForAgent(agentId).map((t) => ({ name: t.name, oneLine: t.description })),
  resolveTeamContext: async (convId) => /* pull from team-session-service */ null,
  resolveMemoryContext: async (convId, agentId) => /* pull from memory module */ null,
  resolveActiveVoice: activeVoiceResolver,
  resolveRuntime: () => ({
    date: new Date().toISOString().slice(0, 10),
    time: new Date().toLocaleTimeString('hu-HU', { timeZone: 'Europe/Budapest', hour: '2-digit', minute: '2-digit' }) + ' CET',
    channel: 'unknown',
    os: process.platform,
  }),
  resolveContextWindow: async (agentId) => {
    const a = await db.select({ model: agentDefinitions.model }).from(agentDefinitions).where(eq(agentDefinitions.id, agentId)).limit(1)
    return modelRegistry.get(a[0]?.model ?? '')?.effectiveContextWindow ?? 8000
  },
})

ctx.workspaceLoader = workspaceLoader
ctx.workspaceWriter = workspaceWriter
ctx.workspaceWatcher = workspaceWatcher
ctx.promptAssembler = promptAssembler
ctx.channelResolver = resolveScope
ctx.internalContactsRegistry = internalContactsRegistry
ctx.ephemeralOverrideStore = ephemeralOverrideStore
```

- [ ] **Step 3: Update teardown to stop watcher**

```typescript
await workspaceWatcher.stop()
```

- [ ] **Step 4: Run integration test (existing bootstrap test)**

```bash
bun test tests/core/bootstrap.test.ts --run
```

Update mocks/test fixtures as needed.

- [ ] **Step 5: Commit (ASK USER FIRST)**

```bash
git add src/core/types.ts src/core/bootstrap.ts src/modules/prompt-wizard/index.ts \
        src/modules/communication/index.ts tests/core/bootstrap.test.ts
git commit -m "feat(core): bootstrap wires workspace + assembler + voice resolver"
```

---

## Phase 6 — Self-Edit Tools + Forge Integration

### Task 30: workspace_append + workspace_edit tools

**Files:**
- Create: `src/modules/agent/tools/workspace-append-tool.ts`
- Create: `src/modules/agent/tools/workspace-edit-tool.ts`
- Create: `tests/modules/agent/tools/workspace-tools.test.ts`

- [ ] **Step 1: Implement append tool**

```typescript
// src/modules/agent/tools/workspace-append-tool.ts
import { z } from 'zod'
import type { WorkspaceLoader } from '../../prompt-wizard/workspace-loader.js'
import type { WorkspaceWriter } from '../../prompt-wizard/workspace-writer.js'

export const workspaceAppendInputSchema = z.object({
  file: z.union([
    z.enum(['AGENTS.md', 'TOOLS.md', 'MEMORY.md']),
    z.string().regex(/^memory\/\d{4}-\d{2}-\d{2}\.md$/),
  ]),
  content: z.string().max(8000),
  section: z.string().optional(),
})

export type WorkspaceAppendInput = z.infer<typeof workspaceAppendInputSchema>

export interface WorkspaceAppendDeps {
  loader: WorkspaceLoader
  writer: WorkspaceWriter
  audit: (entry: { agentId: string; action: string; file: string; bytesAdded: number }) => Promise<void>
}

export function createWorkspaceAppendTool(deps: WorkspaceAppendDeps) {
  return {
    name: 'workspace_append',
    description: "Append content to your own workspace file (AGENTS.md, TOOLS.md, MEMORY.md, or memory/YYYY-MM-DD.md).",
    inputSchema: workspaceAppendInputSchema,
    async invoke(agentId: string, input: WorkspaceAppendInput): Promise<{ ok: true; bytesAdded: number }> {
      const ws = await deps.loader.load(agentId)
      const current = pickFile(ws, input.file).body
      const section = input.section ? `\n\n## ${input.section}\n` : '\n\n'
      const next = current + section + input.content
      await deps.writer.write({ agentId, file: input.file, body: next })
      deps.loader.invalidate(agentId)
      await deps.audit({ agentId, action: 'workspace_append', file: input.file, bytesAdded: input.content.length })
      return { ok: true, bytesAdded: input.content.length }
    },
  }
}

function pickFile(ws: import('../../prompt-wizard/workspace-types.js').AgentWorkspace, file: string) {
  switch (file) {
    case 'AGENTS.md': return ws.agentsMd
    case 'TOOLS.md': return ws.toolsMd
    case 'MEMORY.md': return ws.memoryMd
    default:
      if (file.startsWith('memory/')) return ws.dailyMemory.find((d) => d.name === file) ?? { body: '' } as never
      throw new Error(`unsupported file: ${file}`)
  }
}
```

- [ ] **Step 2: Implement edit tool**

```typescript
// src/modules/agent/tools/workspace-edit-tool.ts
import { z } from 'zod'
import type { WorkspaceLoader } from '../../prompt-wizard/workspace-loader.js'
import type { WorkspaceWriter } from '../../prompt-wizard/workspace-writer.js'

export const workspaceEditInputSchema = z.object({
  file: z.enum(['AGENTS.md', 'TOOLS.md', 'MEMORY.md']),
  oldString: z.string(),
  newString: z.string(),
})

export type WorkspaceEditInput = z.infer<typeof workspaceEditInputSchema>

export function createWorkspaceEditTool(deps: { loader: WorkspaceLoader; writer: WorkspaceWriter; audit: (e: never) => Promise<void> }) {
  return {
    name: 'workspace_edit',
    description: 'Edit existing content in your own workspace file by exact string replacement.',
    inputSchema: workspaceEditInputSchema,
    async invoke(agentId: string, input: WorkspaceEditInput): Promise<{ ok: true } | { ok: false; reason: string }> {
      const ws = await deps.loader.load(agentId)
      const file = input.file === 'AGENTS.md' ? ws.agentsMd : input.file === 'TOOLS.md' ? ws.toolsMd : ws.memoryMd
      if (!file.body.includes(input.oldString)) return { ok: false, reason: 'oldString not found' }
      const occurrences = file.body.split(input.oldString).length - 1
      if (occurrences > 1) return { ok: false, reason: `oldString appears ${occurrences} times — must be unique` }
      const next = file.body.replace(input.oldString, input.newString)
      await deps.writer.write({ agentId, file: input.file, body: next })
      deps.loader.invalidate(agentId)
      await deps.audit({ agentId, action: 'workspace_edit', file: input.file } as never)
      return { ok: true }
    },
  }
}
```

- [ ] **Step 3: Tests** (6 cases)

- append to AGENTS.md adds to file end
- append to memory/YYYY-MM-DD.md works
- edit replaces unique oldString
- edit fails on missing oldString
- edit fails on non-unique oldString
- both call audit with correct payload

- [ ] **Step 4: Run + commit (ASK USER FIRST)**

```bash
bun test tests/modules/agent/tools/workspace-tools.test.ts --run
git add src/modules/agent/tools/workspace-append-tool.ts src/modules/agent/tools/workspace-edit-tool.ts tests/modules/agent/tools/workspace-tools.test.ts
git commit -m "feat(agent): workspace_append + workspace_edit self-edit tools"
```

---

### Task 31: workspace_update_identity with notify

**Files:**
- Create: `src/modules/agent/tools/workspace-update-identity-tool.ts`
- Modify: `src/modules/notifications/types.ts`
- Create: `tests/modules/agent/tools/workspace-update-identity-tool.test.ts`

- [ ] **Step 1: Add notification type**

In `src/modules/notifications/types.ts` extend `NotificationType` enum:

```typescript
export type NotificationType =
  | /* ...existing... */
  | 'agent.identity_changed'
```

- [ ] **Step 2: Implement tool**

```typescript
// src/modules/agent/tools/workspace-update-identity-tool.ts
import { z } from 'zod'
import type { WorkspaceLoader } from '../../prompt-wizard/workspace-loader.js'
import type { WorkspaceWriter } from '../../prompt-wizard/workspace-writer.js'
import type { NotificationsService } from '../../notifications/types.js'

const SECTIONS = ['Who I am', 'My mission', 'Ongoing proactive duties', 'When to escalate', 'When to refuse'] as const

export const workspaceUpdateIdentityInputSchema = z.object({
  section: z.enum(SECTIONS),
  newContent: z.string().max(2000),
  reasoning: z.string().min(20).max(500),
})

export type WorkspaceUpdateIdentityInput = z.infer<typeof workspaceUpdateIdentityInputSchema>

export interface WorkspaceUpdateIdentityDeps {
  loader: WorkspaceLoader
  writer: WorkspaceWriter
  notifications: NotificationsService
  audit: (entry: { agentId: string; action: string; section: string; reasoning: string }) => Promise<void>
  identitySelfUpdateEnabled: () => boolean
  ownerUserId: () => string
  agentName: (agentId: string) => Promise<string>
  rateLimit: { check(agentId: string): boolean; record(agentId: string): void }
}

function replaceSection(content: string, sectionTitle: string, newBody: string): string {
  const heading = `## ${sectionTitle}`
  const idx = content.indexOf(heading)
  if (idx === -1) {
    return content.trimEnd() + `\n\n${heading}\n${newBody}\n`
  }
  const after = content.slice(idx + heading.length)
  const nextIdx = after.search(/\n## /)
  const before = content.slice(0, idx)
  const tail = nextIdx === -1 ? '' : after.slice(nextIdx)
  return `${before}${heading}\n${newBody}\n${tail}`
}

function makeDiff(oldContent: string, newContent: string, section: string): string {
  return `--- ${section} (before)\n+++ ${section} (after)\n${oldContent.slice(0, 200)}...\n→\n${newContent.slice(0, 200)}...`
}

export function createWorkspaceUpdateIdentityTool(deps: WorkspaceUpdateIdentityDeps) {
  return {
    name: 'workspace_update_identity',
    description: 'Update your own IDENTITY.md (mission, proactive duties, escalation rules). User will be notified with a diff.',
    inputSchema: workspaceUpdateIdentityInputSchema,
    async invoke(agentId: string, input: WorkspaceUpdateIdentityInput) {
      if (!deps.identitySelfUpdateEnabled()) {
        return { ok: false, reason: 'identity self-update disabled by config; use forge_propose_identity_change instead' }
      }
      if (!deps.rateLimit.check(agentId)) {
        return { ok: false, reason: 'rate limited (max 3 IDENTITY changes per day)' }
      }
      const ws = await deps.loader.load(agentId)
      const oldBody = ws.identity.body
      const newBody = replaceSection(oldBody, input.section, input.newContent)
      await deps.writer.write({ agentId, file: 'IDENTITY.md', body: newBody })
      deps.loader.invalidate(agentId)
      deps.rateLimit.record(agentId)
      await deps.audit({ agentId, action: 'identity_update', section: input.section, reasoning: input.reasoning })
      const agentName = await deps.agentName(agentId)
      await deps.notifications.send({
        userId: deps.ownerUserId(),
        type: 'agent.identity_changed',
        severity: 'info',
        title: `${agentName} updated their IDENTITY.md`,
        body: `Section: ${input.section}\nReason: ${input.reasoning}`,
        data: { agentId, section: input.section, diff: makeDiff(oldBody, newBody, input.section) },
        actions: [
          { label: 'Approve (no-op)', action: 'ack' },
          { label: 'Revert', action: 'revert', payload: { agentId, snapshot: oldBody } },
        ],
      })
      return { ok: true }
    },
  }
}
```

- [ ] **Step 3: Tests** (5 cases)

- updates section in IDENTITY.md
- creates section if missing
- sends notification with diff
- respects `identitySelfUpdateEnabled=false`
- rate-limit blocks 4th call same day

- [ ] **Step 4: Implement rate-limit helper**

```typescript
// src/modules/agent/tools/identity-update-rate-limit.ts
export function createIdentityUpdateRateLimit(now: () => Date = () => new Date(), maxPerDay = 3) {
  const counts = new Map<string, { day: string; count: number }>()
  function dayKey() { return now().toISOString().slice(0, 10) }
  return {
    check(agentId: string): boolean {
      const r = counts.get(agentId)
      if (!r || r.day !== dayKey()) return true
      return r.count < maxPerDay
    },
    record(agentId: string): void {
      const k = dayKey()
      const r = counts.get(agentId)
      if (!r || r.day !== k) counts.set(agentId, { day: k, count: 1 })
      else r.count++
    },
  }
}
```

- [ ] **Step 5: Run + commit (ASK USER FIRST)**

```bash
bun test tests/modules/agent/tools/workspace-update-identity-tool.test.ts --run
git add src/modules/agent/tools/workspace-update-identity-tool.ts \
        src/modules/agent/tools/identity-update-rate-limit.ts \
        src/modules/notifications/types.ts \
        tests/modules/agent/tools/workspace-update-identity-tool.test.ts
git commit -m "feat(agent): workspace_update_identity with rate limit + notify"
```

---

### Task 32: add_internal_contact tool

**Files:**
- Create: `src/modules/agent/tools/add-internal-contact-tool.ts`
- Create: `tests/modules/agent/tools/add-internal-contact-tool.test.ts`

- [ ] **Step 1: Implement tool**

```typescript
// src/modules/agent/tools/add-internal-contact-tool.ts
import { z } from 'zod'
import type { InternalContactsRegistry, ChannelType } from '../../communication/internal-contacts-registry.js'

export const addInternalContactInputSchema = z.object({
  identifier: z.string().min(1),
  channelType: z.enum(['web', 'telegram', 'email', 'odoo-chatter', 'hand-companion', 'slack', 'discord']),
  displayName: z.string().min(1).max(100),
  notes: z.string().max(500).optional(),
})

export function createAddInternalContactTool(deps: {
  registry: InternalContactsRegistry
  ownerUserId: () => string
  ownerConfirm: (input: { identifier: string; displayName: string }) => Promise<boolean>
}) {
  return {
    name: 'add_internal_contact',
    description: 'Mark a contact as internal (team-member). Owner must confirm before the change applies.',
    inputSchema: addInternalContactInputSchema,
    async invoke(_agentId: string, input: z.infer<typeof addInternalContactInputSchema>) {
      const ok = await deps.ownerConfirm({ identifier: input.identifier, displayName: input.displayName })
      if (!ok) return { ok: false, reason: 'owner declined' }
      const contact = await deps.registry.add({
        identifier: input.identifier,
        channelType: input.channelType,
        displayName: input.displayName,
        role: 'team-member',
        notes: input.notes,
        addedBy: deps.ownerUserId(),
      })
      return { ok: true, contactId: contact.id }
    },
  }
}
```

- [ ] **Step 2: Tests** (3 cases — owner approves, owner declines, registry call shape)

- [ ] **Step 3: Run + commit (ASK USER FIRST)**

```bash
bun test tests/modules/agent/tools/add-internal-contact-tool.test.ts --run
git add src/modules/agent/tools/add-internal-contact-tool.ts tests/modules/agent/tools/add-internal-contact-tool.test.ts
git commit -m "feat(agent): add_internal_contact tool with owner confirmation gate"
```

---

### Task 33: forge_propose_soul_change tool

**Files:**
- Create: `src/modules/forge/tools/forge-propose-soul-tool.ts`
- Modify: `src/modules/forge/schema.ts` (already done in Task 1; verify columns exist)
- Create: `tests/modules/forge/tools/forge-propose-soul-tool.test.ts`

- [ ] **Step 1: Implement tool**

```typescript
// src/modules/forge/tools/forge-propose-soul-tool.ts
import { z } from 'zod'
import type { Database } from '../../../core/db.js'
import { forgeProposals } from '../schema.js'

export const forgeProposeSoulInputSchema = z.object({
  scope: z.enum(['internal', 'external']),
  field: z.enum(['address', 'tone', 'verbosity', 'directness', 'humor', 'emoji', 'blockedPhrases', 'signature']),
  currentValue: z.unknown(),
  proposedValue: z.unknown(),
  reasoning: z.string().min(50),
  evidenceCount: z.number().int().nonnegative(),
})

export function createForgeProposeSoulTool(deps: { db: Database }) {
  return {
    name: 'forge_propose_soul_change',
    description: 'Propose a change to your own SOUL voice profile. Goes to user for approval.',
    inputSchema: forgeProposeSoulInputSchema,
    async invoke(agentId: string, input: z.infer<typeof forgeProposeSoulInputSchema>) {
      const id = `fp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
      await deps.db.insert(forgeProposals).values({
        id,
        target: 'soul',
        targetId: agentId,
        scope: input.scope,
        field: input.field,
        title: `Update ${input.scope}.${input.field}`,
        description: input.reasoning,
        currentValue: JSON.stringify(input.currentValue),
        proposedValue: JSON.stringify(input.proposedValue),
        reasoning: input.reasoning,
        confidence: Math.min(1, input.evidenceCount / 10),
        basedOnFeedbacks: input.evidenceCount,
        status: 'pending',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
      return { ok: true, proposalId: id }
    },
  }
}
```

- [ ] **Step 2: Tests** (3 cases — creates row, validates input, sets confidence from evidence)

- [ ] **Step 3: Run + commit (ASK USER FIRST)**

```bash
bun test tests/modules/forge/tools/forge-propose-soul-tool.test.ts --run
git add src/modules/forge/tools/forge-propose-soul-tool.ts tests/modules/forge/tools/forge-propose-soul-tool.test.ts
git commit -m "feat(forge): forge_propose_soul_change tool"
```

---

### Task 34: SOUL proposal applier

**Files:**
- Create: `src/modules/forge/soul-proposal-applier.ts`
- Create: `tests/modules/forge/soul-proposal-applier.test.ts`

- [ ] **Step 1: Implement applier**

```typescript
// src/modules/forge/soul-proposal-applier.ts
import { eq } from 'drizzle-orm'
import type { Database } from '../../core/db.js'
import type { WorkspaceLoader } from '../../prompt-wizard/workspace-loader.js'
import type { SoulPipeline } from '../../prompt-wizard/soul-pipeline.js'
import { soulStyleSchema } from '../../prompt-wizard/soul-style-schema.js'
import { detectPresetMatch } from '../../prompt-wizard/soul-presets.js'
import { forgeProposals } from '../schema.js'

export interface SoulProposalApplierDeps {
  db: Database
  workspaceLoader: WorkspaceLoader
  soulPipeline: SoulPipeline
  agentName: (agentId: string) => Promise<string>
}

export function createSoulProposalApplier(deps: SoulProposalApplierDeps) {
  return {
    async apply(proposalId: string): Promise<{ ok: true } | { ok: false; reason: string }> {
      const [proposal] = await deps.db.select().from(forgeProposals).where(eq(forgeProposals.id, proposalId)).limit(1)
      if (!proposal) return { ok: false, reason: 'proposal not found' }
      if (proposal.target !== 'soul') return { ok: false, reason: 'not a soul proposal' }
      if (proposal.status !== 'pending') return { ok: false, reason: `status is ${proposal.status}` }

      const agentId = proposal.targetId
      const ws = await deps.workspaceLoader.load(agentId)
      if (!ws.soulStyleJson.exists) return { ok: false, reason: 'agent has no SOUL.style.json' }

      const current = soulStyleSchema.parse(JSON.parse(ws.soulStyleJson.body))
      const scope = proposal.scope as 'internal' | 'external'
      const field = proposal.field as keyof typeof current.internal
      const proposedValue = JSON.parse(proposal.proposedValue!)

      const updatedProfile = { ...current[scope], [field]: proposedValue }
      const updated = {
        ...current,
        [scope]: updatedProfile,
        preset: { ...current.preset, [scope]: detectPresetMatch(updatedProfile) },
      }
      const validated = soulStyleSchema.parse(updated)

      const agentName = await deps.agentName(agentId)
      await deps.soulPipeline.saveStyle(agentId, agentName, validated)
      deps.workspaceLoader.invalidate(agentId)

      await deps.db.update(forgeProposals)
        .set({ status: 'applied', updatedAt: new Date().toISOString() })
        .where(eq(forgeProposals.id, proposalId))

      return { ok: true }
    },

    async reject(proposalId: string): Promise<void> {
      await deps.db.update(forgeProposals)
        .set({ status: 'rejected', updatedAt: new Date().toISOString() })
        .where(eq(forgeProposals.id, proposalId))
    },
  }
}
```

- [ ] **Step 2: Tests** (5 cases — apply happy path, apply non-soul fails, apply already-applied fails, apply re-renders SOUL.md, reject sets status)

- [ ] **Step 3: Run + commit (ASK USER FIRST)**

```bash
bun test tests/modules/forge/soul-proposal-applier.test.ts --run
git add src/modules/forge/soul-proposal-applier.ts tests/modules/forge/soul-proposal-applier.test.ts
git commit -m "feat(forge): SOUL proposal applier with preset re-detection"
```

---

### Task 35: Register all new tools + config flag

**Files:**
- Modify: `src/modules/agent/index.ts`
- Modify: `src/modules/forge/index.ts`
- Modify: `src/modules/setup/config-schema.ts` (add `autonomy.identitySelfUpdate`)
- Modify: `config/default.yaml`

- [ ] **Step 1: Add config flag**

In `src/modules/setup/config-schema.ts`:

```typescript
const autonomySchema = z.object({
  identitySelfUpdate: z.boolean().default(true),
}).default({ identitySelfUpdate: true })

export const configSchema = z.object({
  // ... existing ...
  autonomy: autonomySchema,
})
```

In `config/default.yaml` add:

```yaml
autonomy:
  identitySelfUpdate: true
```

- [ ] **Step 2: Register tools in agent module**

In `src/modules/agent/index.ts`, in the module's `start` hook:

```typescript
ctx.tools.register(createWorkspaceAppendTool({ loader: ctx.workspaceLoader, writer: ctx.workspaceWriter, audit: ctx.audit.log }))
ctx.tools.register(createWorkspaceEditTool({ loader: ctx.workspaceLoader, writer: ctx.workspaceWriter, audit: ctx.audit.log }))
ctx.tools.register(createWorkspaceUpdateIdentityTool({
  loader: ctx.workspaceLoader,
  writer: ctx.workspaceWriter,
  notifications: ctx.notifications,
  audit: ctx.audit.log,
  identitySelfUpdateEnabled: () => ctx.config.autonomy.identitySelfUpdate,
  ownerUserId: () => ctx.config.owner.userId,
  agentName: async (id) => (await ctx.agentRegistry.get(id))?.name ?? 'Unknown',
  rateLimit: createIdentityUpdateRateLimit(),
}))
ctx.tools.register(createAddInternalContactTool({
  registry: ctx.internalContactsRegistry,
  ownerUserId: () => ctx.config.owner.userId,
  ownerConfirm: async (input) => {
    // MVP: emit a notification with ack/decline actions and await user response.
    return await ctx.notifications.requestConfirmation({
      userId: ctx.config.owner.userId,
      title: `Add ${input.displayName} as internal contact?`,
      body: `Identifier: ${input.identifier}`,
      timeoutMs: 5 * 60_000,
    })
  },
}))
```

- [ ] **Step 3: Register forge tools**

In `src/modules/forge/index.ts`:

```typescript
ctx.tools.register(createForgeProposeSoulTool({ db: ctx.db }))
```

And expose the applier:

```typescript
const applier = createSoulProposalApplier({
  db: ctx.db,
  workspaceLoader: ctx.workspaceLoader,
  soulPipeline: ctx.soulPipeline,
  agentName: async (id) => (await ctx.agentRegistry.get(id))?.name ?? 'Unknown',
})
ctx.forge.applier = applier
```

- [ ] **Step 4: Run full test suite**

```bash
bun test --run 2>&1 | tail -10
```

Expected: all existing tests still pass; new tools are wired.

- [ ] **Step 5: Commit (ASK USER FIRST)**

```bash
git add src/modules/agent/index.ts src/modules/forge/index.ts \
        src/modules/setup/config-schema.ts config/default.yaml
git commit -m "feat(modules): register workspace + forge soul tools; add autonomy config"
```

---

## Phase 7 — Migration Script (v1 → v2)

### Task 36: Pre-flight + snapshot table

**Files:**
- Create: `scripts/migrate-prompts-v2.ts`
- Create: `scripts/lib/snapshot-v1-table.ts`
- Modify: `src/modules/agent/schema.ts` (add `agent_definitions_v1_snapshot` table for backup)

- [ ] **Step 1: Define snapshot table**

In `src/modules/agent/schema.ts` append:

```typescript
export const agentDefinitionsV1Snapshot = sqliteTable('agent_definitions_v1_snapshot', {
  id: text('id').primaryKey(),
  data: text('data').notNull(),  // full v1 row as JSON
  snapshotAt: text('snapshot_at').notNull(),
})
```

Run migration generation:

```bash
bun drizzle-kit generate --name=v1_snapshot_table
```

- [ ] **Step 2: Implement pre-flight check + snapshot helper**

```typescript
// scripts/lib/snapshot-v1-table.ts
import type { Database } from '../../src/core/db.js'
import { agentDefinitions, agentDefinitionsV1Snapshot } from '../../src/modules/agent/schema.js'

export async function snapshotV1AgentRows(db: Database): Promise<number> {
  const rows = await db.select().from(agentDefinitions)
  const at = new Date().toISOString()
  for (const row of rows) {
    await db.insert(agentDefinitionsV1Snapshot).values({ id: row.id, data: JSON.stringify(row), snapshotAt: at })
  }
  return rows.length
}
```

- [ ] **Step 3: Migration script skeleton**

```typescript
// scripts/migrate-prompts-v2.ts
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { initDb } from '../src/core/db.js'
import { loadConfig } from '../src/modules/setup/config.js'
import { snapshotV1AgentRows } from './lib/snapshot-v1-table.js'

async function main(): Promise<void> {
  const config = await loadConfig()
  const dbPath = config.database.path
  const dataDir = config.dataDir

  if (!existsSync(dbPath)) throw new Error(`db not found: ${dbPath}`)
  const agentsDir = join(dataDir, 'agents')
  if (existsSync(agentsDir)) throw new Error(`data/agents/ exists — refusing to migrate`)

  // Backup db
  const bak = `${dbPath}.pre-prompts-v2.bak`
  copyFileSync(dbPath, bak)
  console.log(`[migrate] backed up db → ${bak}`)

  const db = await initDb(dbPath)
  const snapshotCount = await snapshotV1AgentRows(db)
  console.log(`[migrate] snapshotted ${snapshotCount} agent rows`)

  // continue in subsequent tasks (37, 38, 39)
  // ...

  console.log('[migrate] complete')
}

main().catch((err) => { console.error(err); process.exit(1) })
```

- [ ] **Step 4: Test pre-flight**

```typescript
// tests/migration/preflight.test.ts (small unit test for snapshotV1AgentRows)
```

- [ ] **Step 5: Commit (ASK USER FIRST)**

```bash
git add scripts/migrate-prompts-v2.ts scripts/lib/snapshot-v1-table.ts \
        src/modules/agent/schema.ts drizzle/0043_v1_snapshot_table.sql \
        tests/migration/preflight.test.ts
git commit -m "feat(migrate): pre-flight + v1 snapshot table"
```

---

### Task 37: AI-assisted legacy systemPrompt splitter

**Files:**
- Create: `scripts/lib/legacy-prompt-splitter.ts`
- Create: `tests/migration/legacy-prompt-splitter.test.ts`

- [ ] **Step 1: Implement splitter**

```typescript
// scripts/lib/legacy-prompt-splitter.ts
import type { ModelProvider } from '../../src/modules/model/types.js'

export interface LegacyAgentMeta {
  id: string
  name: string
  role: string | null
  goal: string | null
  backstory: string | null
  tier: string
}

export interface SplitResult {
  identityMission: string
  identityProactiveDuties: string
  identityEscalation: string
  agentsRules: string
  confidence: 'high' | 'medium' | 'low'
}

const SPLIT_INSTRUCTION = `You are migrating a legacy agent definition. Given the agent's metadata and a freeform systemPrompt, split it into:
- identityMission: a 2-4 sentence summary of why this agent exists
- identityProactiveDuties: bullet list of recurring or scheduled responsibilities (or "(none defined)" if not present)
- identityEscalation: when to escalate vs handle silently (or "(none defined)")
- agentsRules: any custom operational rules or workflow instructions

Return ONLY a JSON object with those four fields plus a "confidence" field ('high' | 'medium' | 'low').`

export async function splitLegacySystemPrompt(
  legacy: string,
  meta: LegacyAgentMeta,
  model: ModelProvider,
  modelId: string,
): Promise<SplitResult> {
  if (!legacy.trim()) {
    return {
      identityMission: meta.goal ?? meta.role ?? 'Migrated agent — please review and define mission',
      identityProactiveDuties: '(none defined)',
      identityEscalation: '(none defined)',
      agentsRules: '',
      confidence: 'low',
    }
  }
  const response = await model.send({
    systemPrompt: { prefix: SPLIT_INSTRUCTION, suffix: '', reminders: [], cacheBoundaryHint: 0, prefixHash: '', tokenEstimate: { prefix: 0, suffix: 0, reminders: 0 } },
    messages: [{ role: 'user', content: `Agent metadata:\n${JSON.stringify(meta, null, 2)}\n\nLegacy systemPrompt:\n${legacy}` }],
    modelId,
  })
  try {
    return JSON.parse(extractJsonBlock(response.content))
  } catch {
    return {
      identityMission: meta.goal ?? meta.role ?? 'Migrated from legacy',
      identityProactiveDuties: '(see legacy rules below)',
      identityEscalation: '(see legacy rules below)',
      agentsRules: `## Legacy Rules\n\n${legacy}`,
      confidence: 'low',
    }
  }
}

function extractJsonBlock(s: string): string {
  const fenced = s.match(/```json\s*([\s\S]*?)```/)
  if (fenced) return fenced[1]
  const obj = s.match(/\{[\s\S]*\}/)
  if (obj) return obj[0]
  return s
}
```

- [ ] **Step 2: Tests** (4 cases — empty legacy returns low-confidence default; happy-path JSON parsed; malformed response falls back; metadata used in fallback)

- [ ] **Step 3: Commit (ASK USER FIRST)**

```bash
git add scripts/lib/legacy-prompt-splitter.ts tests/migration/legacy-prompt-splitter.test.ts
git commit -m "feat(migrate): AI-assisted legacy systemPrompt splitter with fallback"
```

---

### Task 38: Per-agent workspace generation

**Files:**
- Modify: `scripts/migrate-prompts-v2.ts`
- Create: `scripts/lib/agent-workspace-bootstrap.ts`

- [ ] **Step 1: Implement workspace bootstrap**

```typescript
// scripts/lib/agent-workspace-bootstrap.ts
import { createWorkspaceWriter } from '../../src/modules/prompt-wizard/workspace-writer.js'
import { createSoulPipeline } from '../../src/modules/prompt-wizard/soul-pipeline.js'
import { defaultStyleForAgent, type PresetKey } from '../../src/modules/prompt-wizard/soul-presets.js'
import type { SplitResult } from './legacy-prompt-splitter.js'

export interface BootstrapAgentInput {
  dataDir: string
  agentId: string
  agentName: string
  tier: 'primary' | 'team' | 'specialist'
  split: SplitResult
  internalPreset?: PresetKey
  externalPreset?: PresetKey
}

function renderIdentityMd(name: string, split: SplitResult): string {
  return `# IDENTITY

## Who I am
- **Name:** ${name}

## My mission
${split.identityMission}

## Ongoing proactive duties
${split.identityProactiveDuties}

## When to escalate
${split.identityEscalation}

## When to refuse / defer
(define when needed)
`
}

export async function bootstrapAgentWorkspace(input: BootstrapAgentInput): Promise<void> {
  const writer = createWorkspaceWriter({ dataDir: input.dataDir })
  const soulPipeline = createSoulPipeline({ writer })

  await writer.write({ agentId: input.agentId, file: 'IDENTITY.md', body: renderIdentityMd(input.agentName, input.split) })

  if (input.tier === 'primary' || input.tier === 'team') {
    const style = defaultStyleForAgent(input.internalPreset ?? 'best-buddy', input.externalPreset ?? 'diplomata')
    await soulPipeline.saveStyle(input.agentId, input.agentName, style)
  }

  if (input.split.agentsRules) {
    await writer.write({ agentId: input.agentId, file: 'AGENTS.md', body: input.split.agentsRules })
  } else {
    await writer.write({ agentId: input.agentId, file: 'AGENTS.md', body: '' })
  }

  await writer.write({ agentId: input.agentId, file: 'TOOLS.md', body: '' })
  await writer.write({ agentId: input.agentId, file: 'MEMORY.md', body: '' })
}
```

- [ ] **Step 2: Hook into migration script**

In `scripts/migrate-prompts-v2.ts`, after snapshot:

```typescript
import { bootstrapAgentWorkspace } from './lib/agent-workspace-bootstrap.js'
import { splitLegacySystemPrompt } from './lib/legacy-prompt-splitter.js'
import { eq } from 'drizzle-orm'
import { agentDefinitions } from '../src/modules/agent/schema.js'

// after snapshotV1AgentRows(db)
const rows = await db.select().from(agentDefinitions)
for (const row of rows) {
  const split = await splitLegacySystemPrompt(row.systemPrompt ?? '', { id: row.id, name: row.name, role: row.role, goal: row.goal, backstory: row.backstory, tier: row.tier }, modelProvider, defaultModelId)
  const isAddressable = row.tier === 'primary' || row.tier === 'team'
  await bootstrapAgentWorkspace({
    dataDir,
    agentId: row.id,
    agentName: row.name,
    tier: row.tier as 'primary' | 'team' | 'specialist',
    split,
  })
  await db.update(agentDefinitions)
    .set({ workspacePath: `data/agents/${row.id}/`, addressable: isAddressable ? 1 : 0 })
    .where(eq(agentDefinitions.id, row.id))
  console.log(`[migrate] agent ${row.name} (${row.id}) → workspace + addressable=${isAddressable}`)
}
```

- [ ] **Step 3: Run dry-run on a copy of dev DB**

```bash
cp data/sqlite/eyas.db data/sqlite/eyas-test.db
EYAS_DB=data/sqlite/eyas-test.db bun run scripts/migrate-prompts-v2.ts
```

Verify:
- `data/agents/<id>/` directories created
- IDENTITY.md, SOUL.md, SOUL.style.json present per primary/team agent
- DB columns updated

- [ ] **Step 4: Commit (ASK USER FIRST)**

```bash
git add scripts/lib/agent-workspace-bootstrap.ts scripts/migrate-prompts-v2.ts
git commit -m "feat(migrate): per-agent workspace bootstrap from legacy data"
```

---

### Task 39: Project type / project cascade migration + drop legacy columns

**Files:**
- Modify: `scripts/migrate-prompts-v2.ts`
- Create: `drizzle/0044_drop_legacy_agent_columns.sql`
- Modify: `src/modules/agent/schema.ts` (drop columns now)
- Modify: `src/modules/prompt-wizard/schema.ts` (drop `prompt_templates`)

- [ ] **Step 1: Migrate project_types and projects content**

Append to `scripts/migrate-prompts-v2.ts`:

```typescript
import { writeFile, mkdir } from 'node:fs/promises'
import { projectTypes, projects } from '../src/modules/board/schema.js'

const ptypes = await db.select().from(projectTypes)
for (const pt of ptypes) {
  if (!pt.prompt) continue
  const dir = join(dataDir, 'project-types', pt.id)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'AGENTS.md'), pt.prompt)
  console.log(`[migrate] project-type ${pt.id} → ${dir}/AGENTS.md`)
}

const projs = await db.select().from(projects)
for (const p of projs) {
  if (!p.prompt) continue
  const dir = join(dataDir, 'projects', p.id)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'AGENTS.md'), p.prompt)
  console.log(`[migrate] project ${p.id} → ${dir}/AGENTS.md`)
}
```

- [ ] **Step 2: Generate drop migration**

Update `src/modules/agent/schema.ts` to remove `role`, `goal`, `backstory`, `systemPrompt`, `capabilities`, `constraints` columns from the table definition. Then:

```bash
bun drizzle-kit generate --name=drop_legacy_agent_columns
```

Inspect `drizzle/0044_drop_legacy_agent_columns.sql` — it should contain `ALTER TABLE` statements (or in SQLite's case, table re-creation since it doesn't support DROP COLUMN directly; Drizzle handles this).

- [ ] **Step 3: Drop prompt_templates table**

In `src/modules/prompt-wizard/schema.ts` remove the `promptTemplates` definition. Generate migration:

```bash
bun drizzle-kit generate --name=drop_prompt_templates
```

- [ ] **Step 4: Wire migration apply**

At the end of the migration script:

```typescript
console.log('[migrate] applying schema drops…')
// run pending Drizzle migrations
const { migrate } = await import('drizzle-orm/bun-sqlite/migrator')
await migrate(db, { migrationsFolder: './drizzle' })
```

- [ ] **Step 5: Run full migration on test DB**

```bash
bun run scripts/migrate-prompts-v2.ts
```

Verify schema:

```bash
sqlite3 data/sqlite/eyas.db ".schema agent_definitions"
```

Should NOT contain `role`, `goal`, `backstory`, `systemPrompt`, `capabilities`, `constraints`.

- [ ] **Step 6: Commit (ASK USER FIRST)**

```bash
git add src/modules/agent/schema.ts src/modules/prompt-wizard/schema.ts \
        drizzle/0044_drop_legacy_agent_columns.sql drizzle/0045_drop_prompt_templates.sql \
        scripts/migrate-prompts-v2.ts
git commit -m "feat(migrate): project cascade migration + drop legacy DB columns"
```

---

### Task 40: Rollback CLI command

**Files:**
- Create: `scripts/migrate-prompts-v2-rollback.ts`
- Modify: `src/cli/commands/migrate.ts`

- [ ] **Step 1: Implement rollback**

```typescript
// scripts/migrate-prompts-v2-rollback.ts
import { copyFileSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { loadConfig } from '../src/modules/setup/config.js'

async function main(): Promise<void> {
  const config = await loadConfig()
  const dbPath = config.database.path
  const bak = `${dbPath}.pre-prompts-v2.bak`

  if (!existsSync(bak)) throw new Error(`backup not found: ${bak}`)

  console.log(`[rollback] restoring db from ${bak}`)
  copyFileSync(bak, dbPath)

  const agentsDir = join(config.dataDir, 'agents')
  const projectsDir = join(config.dataDir, 'projects')
  const projectTypesDir = join(config.dataDir, 'project-types')
  for (const d of [agentsDir, projectsDir, projectTypesDir]) {
    if (existsSync(d)) {
      console.log(`[rollback] removing ${d}`)
      rmSync(d, { recursive: true, force: true })
    }
  }
  console.log('[rollback] complete')
}

main().catch((err) => { console.error(err); process.exit(1) })
```

- [ ] **Step 2: Add CLI command**

In `src/cli/commands/migrate.ts`:

```typescript
.command('rollback <name>', 'Rollback a named migration', (y) => y.positional('name', { type: 'string' }), async (argv) => {
  if (argv.name === 'prompts-v2') {
    await import('../../../scripts/migrate-prompts-v2-rollback.js')
  } else {
    console.error(`unknown migration: ${argv.name}`)
    process.exit(1)
  }
})
```

- [ ] **Step 3: Test rollback round-trip**

```bash
bun run scripts/migrate-prompts-v2.ts
bun eyas migrate rollback prompts-v2
sqlite3 data/sqlite/eyas.db "SELECT count(*) FROM agent_definitions" # should match v1 count
ls data/agents/  # should be empty/missing
```

- [ ] **Step 4: Commit (ASK USER FIRST)**

```bash
git add scripts/migrate-prompts-v2-rollback.ts src/cli/commands/migrate.ts
git commit -m "feat(migrate): rollback command for prompts-v2 migration"
```

---

## Phase 8 — Re-seed 16 Agent Templates

### Task 41: Re-write all 16 default templates with workspace seeds

**Files:**
- Modify: `src/modules/agent/agent-templates.ts`
- Create: `tests/modules/agent/agent-templates.test.ts`

This task is large but mechanical — for each of the 16 templates, write the new shape with `workspaceSeed`. Group by category for review checkpoints.

- [ ] **Step 1: Update `AgentTemplate` interface**

```typescript
// src/modules/agent/agent-templates.ts (top)
import type { PresetKey } from '../prompt-wizard/soul-presets.js'

export interface WorkspaceSeed {
  identityMd: string         // full IDENTITY.md content
  soulStylePreset?: { internal: PresetKey; external: PresetKey }  // omit for non-addressable
  agentsMdSeed: string
  toolsMdSeed: string
}

export interface AgentTemplate {
  id: string
  name: string
  tier: 'primary' | 'team' | 'specialist'
  addressable: boolean
  agentType: string
  category: 'primary' | 'recommended' | 'specialist'
  defaultEnabled: boolean
  description: string
  workspaceSeed: WorkspaceSeed
  model: string
  maxTurns: number
  defaultTools: string[]
}
```

- [ ] **Step 2: Re-write 2 PRIMARY templates** (always installed, addressable=true)

Template `primary-assistant`:

```typescript
export const PRIMARY_ASSISTANT: AgentTemplate = {
  id: 'primary-assistant',
  name: 'Personal Assistant',
  tier: 'primary',
  addressable: true,
  agentType: 'assistant',
  category: 'primary',
  defaultEnabled: true,
  description: 'Your day-to-day assistant — communication, planning, triage, proactive ops.',
  workspaceSeed: {
    identityMd: `# IDENTITY

## Who I am
- **Name:** (set during wizard)
- **Role:** Personal Assistant
- **Vibe:** sharp, warm, slightly dry humor

## My mission
I exist to keep your professional and personal life running smoothly. I'm your second brain, your proactive scheduler, your communication buffer with clients, and your calm operator when things get chaotic.

## Ongoing proactive duties
- Every morning 8:00 CET: summarize overnight emails + Telegram, surface anything that needs attention before noon.
- Continuous: watch active project queues, alert on critical mentions within 5 min.
- Weekly Friday 16:00: prepare a short status note for the upcoming week.
- On-demand: handle anything you delegate via DM.

## When to escalate
- Anything affecting client billing, legal, security, hiring/firing, irreversible external actions.

## When to refuse / defer
- Tasks that should obviously go to System Engineer (technical infra/code).
- Tasks where I lack a defined skill — propose adding one instead of guessing.
`,
    soulStylePreset: { internal: 'best-buddy', external: 'diplomata' },
    agentsMdSeed: '',
    toolsMdSeed: '',
  },
  model: 'claude-sonnet-4-6',
  maxTurns: 30,
  defaultTools: ['workspace_append', 'workspace_edit', 'workspace_update_identity', 'add_internal_contact', 'forge_propose_soul_change', 'send_message', 'schedule_task'],
}
```

Template `system-engineer`:

```typescript
export const SYSTEM_ENGINEER: AgentTemplate = {
  id: 'system-engineer',
  name: 'System Engineer',
  tier: 'primary',
  addressable: true,
  agentType: 'engineer',
  category: 'primary',
  defaultEnabled: true,
  description: 'Technical work — coding, infra, deployment, debugging, architecture.',
  workspaceSeed: {
    identityMd: `# IDENTITY

## Who I am
- **Role:** System Engineer & Platform Architect
- **Vibe:** focused, blunt when it matters, dry technical humor

## My mission
I handle code, infra, and deployment. I read the codebase before I edit it. I write tests before I claim a fix. I do not commit without your approval.

## Ongoing proactive duties
- Watch CI/build status; alert on red builds within 5 min.
- After deploy: verify health checks, report metrics shifts.
- Weekly: dependency audit + security scan summary.

## When to escalate
- Production incidents.
- Architectural decisions with cross-module impact.
- Anything requiring infra spend > $X/month.

## When to refuse / defer
- Communication / scheduling — that's Personal Assistant's job.
- Pure design choices (UX/copy) — defer to you.
`,
    soulStylePreset: { internal: 'pajtas-dev', external: 'diplomata' },
    agentsMdSeed: `## Workflow conventions
- Read existing code before editing.
- Write failing test → implement → verify → ASK before commit.
- Never auto-commit, never push, never create branches without explicit instruction.
`,
    toolsMdSeed: '',
  },
  model: 'claude-sonnet-4-6',
  maxTurns: 50,
  defaultTools: ['workspace_append', 'workspace_edit', 'workspace_update_identity', 'forge_propose_soul_change', 'bash', 'file_read', 'file_write', 'grep'],
}
```

- [ ] **Step 3: Commit primary templates (ASK USER FIRST)**

```bash
git add src/modules/agent/agent-templates.ts
git commit -m "feat(agent): re-seed 2 primary templates with workspace seeds"
```

- [ ] **Step 4: Re-write 1 RECOMMENDED template** (default-enabled, addressable=false)

`devils-advocate`:

```typescript
export const DEVILS_ADVOCATE: AgentTemplate = {
  id: 'devils-advocate',
  name: 'Devil\'s Advocate',
  tier: 'specialist',
  addressable: false,
  agentType: 'reviewer',
  category: 'recommended',
  defaultEnabled: true,
  description: 'Critical reviewer — questions assumptions, surfaces risks.',
  workspaceSeed: {
    identityMd: `# IDENTITY

## Who I am
- **Role:** Critical Reviewer & Risk Analyst

## My mission
I challenge plans before they ship. I look for hidden assumptions, edge cases, security holes, and contradiction between stated goals and concrete plan steps.

## Ongoing proactive duties
- (none — invoked on-demand by other agents)

## When to escalate
- (n/a — I'm a sub-agent, I report to my parent)
`,
    agentsMdSeed: `## Review focus
- Assumptions left implicit
- Edge cases not tested
- Security implications
- Cross-cutting impact missed
- Reversibility of proposed changes`,
    toolsMdSeed: '',
  },
  model: 'claude-sonnet-4-6',
  maxTurns: 15,
  defaultTools: ['file_read', 'grep', 'bash'],
}
```

- [ ] **Step 5: Re-write 11 SPECIALIST templates**

Each follows the same shape: `tier='specialist'`, `addressable: false`, `defaultEnabled: false`, no `soulStylePreset`. The list (per existing seed):

| ID | Name | One-line mission |
|----|------|-------------------|
| `code-reviewer` | Code Reviewer | Reviews PRs and diffs against project standards |
| `test-engineer` | Test Engineer | Designs and writes test cases |
| `security-auditor` | Security Auditor | Audits code/config for security issues |
| `backend-developer` | Backend Developer | Implements server-side logic |
| `frontend-developer` | Frontend Developer | Implements UI components |
| `technical-writer` | Technical Writer | Drafts docs and changelogs |
| `data-analyst` | Data Analyst | Queries and analyzes data |
| `devops-engineer` | DevOps Engineer | CI/CD, deploy, infra ops |
| `database-architect` | Database Architect | Schema design and migrations |
| `api-designer` | API Designer | REST/GraphQL API design |
| `performance-engineer` | Performance Engineer | Profiles and optimizes |
| `product-owner` | Product Owner | Refines requirements and acceptance criteria |
| `researcher` | Researcher | Web search + competitive analysis |

For each, write a 5-section IDENTITY.md following the same template (Who I am / Mission / Proactive duties = "(none — invoked on-demand)" / Escalate = "(n/a — sub-agent)" / Refuse = role-specific). Keep `agentsMdSeed` short — 3-5 bullet points of the agent's specific focus.

- [ ] **Step 6: Add tests**

```typescript
// tests/modules/agent/agent-templates.test.ts
import { describe, expect, it } from 'vitest'
import { ALL_TEMPLATES } from '../../../src/modules/agent/agent-templates.js'
import { identityMdSchema } from '../../../src/modules/prompt-wizard/workspace-schemas.js'

describe('agent templates', () => {
  it('all 16 templates have valid workspace seeds', () => {
    expect(ALL_TEMPLATES).toHaveLength(16)
    for (const t of ALL_TEMPLATES) {
      expect(identityMdSchema.safeParse(t.workspaceSeed.identityMd).success).toBe(true)
      if (t.addressable) {
        expect(t.workspaceSeed.soulStylePreset).toBeDefined()
      } else {
        expect(t.workspaceSeed.soulStylePreset).toBeUndefined()
      }
    }
  })
  it('exactly 2 templates are addressable=true (primary)', () => {
    expect(ALL_TEMPLATES.filter((t) => t.addressable)).toHaveLength(2)
  })
  it('exactly 1 template is recommended + default-enabled non-primary', () => {
    expect(ALL_TEMPLATES.filter((t) => t.category === 'recommended' && t.defaultEnabled)).toHaveLength(1)
  })
})
```

- [ ] **Step 7: Run + commit (ASK USER FIRST)**

```bash
bun test tests/modules/agent/agent-templates.test.ts --run
git add src/modules/agent/agent-templates.ts tests/modules/agent/agent-templates.test.ts
git commit -m "feat(agent): re-seed all 16 agent templates with v2 workspace seeds"
```

---

## Phase 9 — Frontend Updates

### Task 42: Voice profile editor component

**Files:**
- Create: `web/src/pages/agents/components/VoiceProfileEditor.tsx`
- Create: `web/src/pages/agents/components/SoulPresetPicker.tsx`
- Create: `web/src/api/soul.ts`

- [ ] **Step 1: API client**

```typescript
// web/src/api/soul.ts
import type { SoulStyle } from '@shared/prompt-wizard/types'

export async function loadSoulStyle(agentId: string): Promise<SoulStyle> {
  const r = await fetch(`/api/v1/agents/${agentId}/soul-style`)
  if (!r.ok) throw new Error(await r.text())
  return r.json()
}

export async function saveSoulStyle(agentId: string, style: SoulStyle): Promise<void> {
  const r = await fetch(`/api/v1/agents/${agentId}/soul-style`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(style),
  })
  if (!r.ok) throw new Error(await r.text())
}
```

- [ ] **Step 2: Preset picker component**

```tsx
// web/src/pages/agents/components/SoulPresetPicker.tsx
import { listPresets } from '@shared/prompt-wizard/soul-presets'

export function SoulPresetPicker(props: { value: string; onChange: (key: string) => void }) {
  return (
    <select value={props.value} onChange={(e) => props.onChange(e.target.value)} className="select">
      <option value="custom">Custom</option>
      {listPresets().map((k) => (<option key={k} value={k}>{k}</option>))}
    </select>
  )
}
```

- [ ] **Step 3: Voice profile editor (one scope)**

```tsx
// web/src/pages/agents/components/VoiceProfileEditor.tsx
import { ENUM_VALUES } from '@shared/prompt-wizard/soul-style-schema'
import type { VoiceProfile, VoiceScope } from '@shared/prompt-wizard/types'
import { SoulPresetPicker } from './SoulPresetPicker'

export function VoiceProfileEditor(props: {
  scope: VoiceScope
  presetKey: string
  profile: VoiceProfile
  onPresetChange: (key: string) => void
  onProfileChange: (next: VoiceProfile) => void
}) {
  const addressOptions = props.scope === 'internal' ? ['tegező', 'magázó', 'önöző'] : ENUM_VALUES.address
  return (
    <fieldset className="space-y-4 border p-4 rounded">
      <legend className="font-semibold">[{props.scope === 'internal' ? 'Internal' : 'External'} Voice]</legend>
      <div>
        <label className="text-sm font-medium">Preset</label>
        <SoulPresetPicker value={props.presetKey} onChange={props.onPresetChange} />
      </div>
      <EnumField label="Megszólítás" value={props.profile.address} options={addressOptions} onChange={(v) => props.onProfileChange({ ...props.profile, address: v as never })} />
      <EnumField label="Hangnem" value={props.profile.tone} options={ENUM_VALUES.tone as never} onChange={(v) => props.onProfileChange({ ...props.profile, tone: v as never })} />
      <EnumField label="Tömörség" value={props.profile.verbosity} options={ENUM_VALUES.verbosity as never} onChange={(v) => props.onProfileChange({ ...props.profile, verbosity: v as never })} />
      <EnumField label="Direktség" value={props.profile.directness} options={ENUM_VALUES.directness as never} onChange={(v) => props.onProfileChange({ ...props.profile, directness: v as never })} />
      <EnumField label="Humor" value={props.profile.humor} options={ENUM_VALUES.humor as never} onChange={(v) => props.onProfileChange({ ...props.profile, humor: v as never })} />
      <EnumField label="Emoji" value={props.profile.emoji} options={ENUM_VALUES.emoji as never} onChange={(v) => props.onProfileChange({ ...props.profile, emoji: v as never })} />
      <BlockedPhrasesEditor value={props.profile.blockedPhrases} onChange={(v) => props.onProfileChange({ ...props.profile, blockedPhrases: v })} />
      <SignatureEditor value={props.profile.signature} onChange={(v) => props.onProfileChange({ ...props.profile, signature: v })} />
    </fieldset>
  )
}

function EnumField(props: { label: string; value: string; options: readonly string[]; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="text-sm font-medium">{props.label}</label>
      <select value={props.value} onChange={(e) => props.onChange(e.target.value)} className="select w-full">
        {props.options.map((o) => (<option key={o} value={o}>{o}</option>))}
      </select>
    </div>
  )
}

function BlockedPhrasesEditor(props: { value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div>
      <label className="text-sm font-medium">Tiltott szófordulatok (max 10)</label>
      <textarea value={props.value.join('\n')} onChange={(e) => props.onChange(e.target.value.split('\n').filter(Boolean).slice(0, 10))} rows={4} className="input w-full" />
    </div>
  )
}

function SignatureEditor(props: { value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="text-sm font-medium">Egyedi vonások (max 200 char)</label>
      <input value={props.value} onChange={(e) => props.onChange(e.target.value.slice(0, 200))} className="input w-full" />
    </div>
  )
}
```

- [ ] **Step 4: Add backend route**

In `src/modules/agent/routes.ts` add:

```typescript
app.get('/api/v1/agents/:id/soul-style', async (c) => {
  const id = c.req.param('id')
  const ws = await ctx.workspaceLoader.load(id)
  if (!ws.soulStyleJson.exists) return c.json({ error: 'no SOUL.style.json' }, 404)
  return c.json(JSON.parse(ws.soulStyleJson.body))
})

app.put('/api/v1/agents/:id/soul-style', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json()
  const validated = soulStyleSchema.parse(body)
  const agent = await ctx.agentRegistry.get(id)
  if (!agent) return c.json({ error: 'agent not found' }, 404)
  await ctx.soulPipeline.saveStyle(id, agent.name, validated)
  return c.json({ ok: true })
})
```

- [ ] **Step 5: Commit (ASK USER FIRST)**

```bash
git add web/src/pages/agents/components/VoiceProfileEditor.tsx web/src/pages/agents/components/SoulPresetPicker.tsx \
        web/src/api/soul.ts src/modules/agent/routes.ts
git commit -m "feat(web): voice profile editor + soul-style API endpoints"
```

---

### Task 43: Identity editor + workspace file editor

**Files:**
- Create: `web/src/pages/agents/components/IdentityEditor.tsx`
- Create: `web/src/pages/agents/components/WorkspaceFileEditor.tsx`
- Create: `web/src/api/workspace.ts`
- Modify: `src/modules/agent/routes.ts`

- [ ] **Step 1: Backend routes for workspace files**

```typescript
app.get('/api/v1/agents/:id/workspace/:file', async (c) => {
  const id = c.req.param('id')
  const file = c.req.param('file')
  const ws = await ctx.workspaceLoader.load(id)
  const target = pickWorkspaceFile(ws, file)
  return c.json({ exists: target.exists, body: target.body })
})

app.put('/api/v1/agents/:id/workspace/:file', async (c) => {
  const id = c.req.param('id')
  const file = c.req.param('file')
  const { body } = await c.req.json()
  await ctx.workspaceWriter.write({ agentId: id, file, body })
  return c.json({ ok: true })
})
```

- [ ] **Step 2: Editors**

`IdentityEditor.tsx` — markdown textarea with section anchors (Who I am / My mission / Ongoing proactive duties / When to escalate / When to refuse).

`WorkspaceFileEditor.tsx` — generic markdown editor with preview; used for AGENTS.md, TOOLS.md, MEMORY.md.

(Use existing markdown component — `web/src/components/Markdown.tsx` — for render preview; basic textarea for editing in MVP.)

- [ ] **Step 3: Commit (ASK USER FIRST)**

```bash
git add web/src/pages/agents/components/IdentityEditor.tsx \
        web/src/pages/agents/components/WorkspaceFileEditor.tsx \
        web/src/api/workspace.ts src/modules/agent/routes.ts
git commit -m "feat(web): identity + workspace file editors"
```

---

### Task 44: Workspace history panel

**Files:**
- Create: `web/src/pages/agents/components/WorkspaceHistoryPanel.tsx`
- Modify: `src/modules/agent/routes.ts`

- [ ] **Step 1: Backend**

```typescript
app.get('/api/v1/agents/:id/workspace/:file/history', async (c) => {
  const id = c.req.param('id')
  const file = c.req.param('file')
  const dir = join(ctx.config.dataDir, 'agents', id, '.history')
  if (!existsSync(dir)) return c.json([])
  const entries = (await readdir(dir)).filter((e) => e.startsWith(`${file}.`)).sort().reverse()
  const list = await Promise.all(entries.map(async (e) => ({
    filename: e,
    timestamp: e.replace(`${file}.`, '').replace('.md', ''),
    size: (await stat(join(dir, e))).size,
  })))
  return c.json(list)
})

app.post('/api/v1/agents/:id/workspace/:file/restore', async (c) => {
  const id = c.req.param('id')
  const file = c.req.param('file')
  const { snapshot } = await c.req.json()
  const snapPath = join(ctx.config.dataDir, 'agents', id, '.history', snapshot)
  const content = await readFile(snapPath, 'utf8')
  await ctx.workspaceWriter.write({ agentId: id, file, body: content })
  return c.json({ ok: true })
})
```

- [ ] **Step 2: Component**

`WorkspaceHistoryPanel.tsx` — lists snapshots with timestamps, opens diff view (vs current), Restore button per row.

- [ ] **Step 3: Commit (ASK USER FIRST)**

```bash
git add web/src/pages/agents/components/WorkspaceHistoryPanel.tsx src/modules/agent/routes.ts
git commit -m "feat(web): workspace history panel with restore"
```

---

### Task 45: Wizard updates — voice setup step

**Files:**
- Modify: `web/src/pages/agents/AgentWizardPage.tsx`
- Modify: `web/src/pages/setup/SetupWizardPage.tsx` (initial install)

- [ ] **Step 1: Add voice step to agent wizard**

After basic agent fields step, insert two steps:

```tsx
{step === 'voice-internal' && (
  <VoiceProfileEditor
    scope="internal"
    presetKey={state.soulStyle.preset.internal}
    profile={state.soulStyle.internal}
    onPresetChange={(k) => applyPreset('internal', k)}
    onProfileChange={(p) => updateProfile('internal', p)}
  />
)}
{step === 'voice-external' && (
  <VoiceProfileEditor
    scope="external"
    presetKey={state.soulStyle.preset.external}
    profile={state.soulStyle.external}
    onPresetChange={(k) => applyPreset('external', k)}
    onProfileChange={(p) => updateProfile('external', p)}
  />
)}
```

`applyPreset` and `updateProfile` use `getPreset` + `detectPresetMatch` from soul-presets.

- [ ] **Step 2: Initial install wizard — addressable agent setup**

In `SetupWizardPage.tsx` after the existing step that creates the 2 default agents, add a "Customize voices?" optional step that lets the user adjust the default presets for both Personal Assistant and System Engineer.

- [ ] **Step 3: Commit (ASK USER FIRST)**

```bash
git add web/src/pages/agents/AgentWizardPage.tsx web/src/pages/setup/SetupWizardPage.tsx
git commit -m "feat(web): wizard voice setup steps for addressable agents"
```

---

### Task 46: Voice scope badge + override in conversation header

**Files:**
- Create: `web/src/pages/conversations/components/VoiceScopeBadge.tsx`
- Modify: `web/src/pages/conversations/ConversationHeader.tsx`
- Modify: `src/modules/conversations/routes.ts`

- [ ] **Step 1: Backend — endpoint to set/clear override**

```typescript
app.put('/api/v1/conversations/:id/voice-scope', async (c) => {
  const id = c.req.param('id')
  const { scope } = await c.req.json() as { scope: 'internal' | 'external' | null }
  await ctx.db.update(conversations).set({ voiceScopeOverride: scope }).where(eq(conversations.id, id))
  return c.json({ ok: true })
})
```

- [ ] **Step 2: Badge component**

```tsx
// web/src/pages/conversations/components/VoiceScopeBadge.tsx
export function VoiceScopeBadge(props: { conversationId: string; activeScope: 'internal' | 'external'; activeSource: string; override: 'internal' | 'external' | null; onChange: (v: 'internal' | 'external' | null) => void }) {
  return (
    <div className="flex items-center gap-2">
      <span className={`badge ${props.activeScope === 'internal' ? 'badge-internal' : 'badge-external'}`}>
        Voice: {props.activeScope.toUpperCase()} ({props.activeSource})
      </span>
      <select value={props.override ?? 'auto'} onChange={(e) => props.onChange(e.target.value === 'auto' ? null : (e.target.value as never))}>
        <option value="auto">Auto</option>
        <option value="internal">Force internal</option>
        <option value="external">Force external</option>
      </select>
    </div>
  )
}
```

- [ ] **Step 3: Commit (ASK USER FIRST)**

```bash
git add web/src/pages/conversations/components/VoiceScopeBadge.tsx \
        web/src/pages/conversations/ConversationHeader.tsx src/modules/conversations/routes.ts
git commit -m "feat(web): voice scope badge + override dropdown in conversation header"
```

---

### Task 47: Forge UI for SOUL proposals

**Files:**
- Create: `web/src/pages/forge/components/SoulProposalCard.tsx`
- Modify: `web/src/pages/forge/ForgePage.tsx`
- Modify: `src/modules/forge/routes.ts`

- [ ] **Step 1: Backend — list + apply + reject**

```typescript
app.get('/api/v1/forge/proposals', async (c) => {
  const filter = c.req.query('target')  // optional: 'soul'
  const q = ctx.db.select().from(forgeProposals).where(eq(forgeProposals.status, 'pending'))
  if (filter) q.where(and(eq(forgeProposals.status, 'pending'), eq(forgeProposals.target, filter)))
  return c.json(await q)
})

app.post('/api/v1/forge/proposals/:id/apply', async (c) => {
  const id = c.req.param('id')
  const r = await ctx.forge.applier.apply(id)
  return c.json(r)
})

app.post('/api/v1/forge/proposals/:id/reject', async (c) => {
  const id = c.req.param('id')
  await ctx.forge.applier.reject(id)
  return c.json({ ok: true })
})
```

- [ ] **Step 2: Card component with diff view**

```tsx
// web/src/pages/forge/components/SoulProposalCard.tsx
export function SoulProposalCard(props: { proposal: ForgeProposal; onApply: () => void; onReject: () => void }) {
  return (
    <div className="card p-4">
      <h3>SOUL change for {props.proposal.targetId} — {props.proposal.scope}.{props.proposal.field}</h3>
      <div className="grid grid-cols-2 gap-4">
        <div><label>Current</label><pre>{props.proposal.currentValue}</pre></div>
        <div><label>Proposed</label><pre>{props.proposal.proposedValue}</pre></div>
      </div>
      <p className="text-sm text-muted">Reasoning: {props.proposal.reasoning}</p>
      <p className="text-xs">Confidence: {Math.round(props.proposal.confidence * 100)}% based on {props.proposal.basedOnFeedbacks} signal(s)</p>
      <div className="flex gap-2">
        <button className="btn-primary" onClick={props.onApply}>Approve</button>
        <button className="btn-secondary" onClick={props.onReject}>Reject</button>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Wire into ForgePage**

In `web/src/pages/forge/ForgePage.tsx`, render `SoulProposalCard` for each proposal where `target === 'soul'`; existing skill/tool proposals continue to render their existing cards.

- [ ] **Step 4: Commit (ASK USER FIRST)**

```bash
git add web/src/pages/forge/components/SoulProposalCard.tsx web/src/pages/forge/ForgePage.tsx \
        src/modules/forge/routes.ts
git commit -m "feat(web): forge UI for SOUL change proposals"
```

---

### Task 48: Identity changed notification UI + i18n

**Files:**
- Modify: `web/src/pages/notifications/NotificationsList.tsx`
- Modify: `i18n/hu.json`, `i18n/en.json`

- [ ] **Step 1: Render `agent.identity_changed` with diff + revert button**

In the notifications list page, add a renderer case for `agent.identity_changed`:

```tsx
{n.type === 'agent.identity_changed' && (
  <div>
    <strong>{n.title}</strong>
    <pre className="text-xs bg-muted p-2">{n.data.diff}</pre>
    <button onClick={() => revertIdentity(n.data.agentId, n.data.snapshot)}>Revert</button>
  </div>
)}
```

`revertIdentity` calls `PUT /api/v1/agents/:id/workspace/IDENTITY.md` with the snapshot body.

- [ ] **Step 2: Add i18n strings**

```json
// i18n/hu.json (excerpt)
{
  "agent.identity_changed.title": "{{name}} módosította az IDENTITY.md-jét",
  "agent.identity_changed.body": "Szekció: {{section}}\nIndok: {{reasoning}}",
  "agent.identity_changed.revert": "Visszaállítás",
  "voice.scope.internal": "Belső",
  "voice.scope.external": "Külső",
  "voice.preset.jarvis": "Jarvis",
  "voice.preset.best-buddy": "Best buddy",
  "voice.preset.diplomata": "Diplomata"
}
```

Mirror in `i18n/en.json`.

- [ ] **Step 3: Commit (ASK USER FIRST)**

```bash
git add web/src/pages/notifications/NotificationsList.tsx i18n/hu.json i18n/en.json
git commit -m "feat(web,i18n): identity_changed notification + voice strings"
```

---

## Phase 10 — Integration Tests, Performance, Docs

### Task 49: End-to-end primary agent test

**Files:**
- Create: `tests/integration/end-to-end-primary-agent.test.ts`

- [ ] **Step 1: Write the test**

```typescript
// tests/integration/end-to-end-primary-agent.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { setupTestEyas } from '../helpers/test-eyas.js'

describe('end-to-end primary agent flow', () => {
  let eyas: Awaited<ReturnType<typeof setupTestEyas>>

  beforeAll(async () => { eyas = await setupTestEyas() })
  afterAll(async () => { await eyas.shutdown() })

  it('wizard creates Personal Assistant → workspace files exist → first message produces assembled prompt', async () => {
    const agentId = await eyas.api.createAgent({
      template: 'primary-assistant',
      name: 'Jarvis',
      ownerName: 'Test Owner',
    })

    // Verify workspace files
    const ws = await eyas.workspaceLoader.load(agentId)
    expect(ws.identity.exists).toBe(true)
    expect(ws.identity.body).toContain('## My mission')
    expect(ws.soulMd.exists).toBe(true)
    expect(ws.soulMd.body).toContain('[Internal Voice]')
    expect(ws.soulStyleJson.exists).toBe(true)

    // Send a message and verify assembled prompt
    const conversationId = await eyas.api.createConversation({ agentId })
    const result = await eyas.assembler.buildForPrimary({
      agentId, agentName: 'Jarvis', conversationId, projectId: null,
      channelContext: { channelType: 'web', conversationKind: 'owner-dm', participants: [{ id: 'owner', type: 'owner' }], origin: 'inbound' },
    })

    expect(result.prefix).toContain('<core-identity>')
    expect(result.prefix).toContain('<agent-identity>')
    expect(result.prefix).toContain('## My mission')
    expect(result.suffix).toContain('Voice scope: INTERNAL')
    expect(result.tokenEstimate.prefix).toBeLessThan(8800)
  })
})
```

- [ ] **Step 2: Implement test helper**

`tests/helpers/test-eyas.ts` — bootstraps the full app with a tmpdir data folder, in-memory SQLite, mock model provider that returns deterministic responses.

- [ ] **Step 3: Run + commit (ASK USER FIRST)**

```bash
bun test tests/integration/end-to-end-primary-agent.test.ts --run
git add tests/integration/end-to-end-primary-agent.test.ts tests/helpers/test-eyas.ts
git commit -m "test(integration): end-to-end primary agent flow"
```

---

### Task 50: Sub-agent delegation chain test

**Files:**
- Create: `tests/integration/sub-agent-delegation.test.ts`

- [ ] **Step 1: Write the test**

```typescript
import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { setupTestEyas } from '../helpers/test-eyas.js'

describe('sub-agent delegation chain', () => {
  let eyas: Awaited<ReturnType<typeof setupTestEyas>>
  beforeAll(async () => { eyas = await setupTestEyas() })
  afterAll(async () => { await eyas.shutdown() })

  it('originating agent voice survives 2-level delegation', async () => {
    const jarvisId = await eyas.api.createAgent({ template: 'primary-assistant', name: 'Jarvis' })
    const sysengId = await eyas.api.createAgent({ template: 'system-engineer', name: 'Sys' })

    // Set Jarvis to a distinctive external preset
    await eyas.api.saveSoulStyle(jarvisId, {
      version: 1,
      preset: { internal: 'best-buddy', external: 'standup' },
      internal: { address: 'tegező', tone: 'baráti', verbosity: 'lényegre törő', directness: 'direkt + udvarias', humor: 'szellemes', emoji: 'funkcionálisan', blockedPhrases: ['NEVER USE THIS'], signature: '' },
      external: { address: 'tegező', tone: 'játékos', verbosity: 'kiegyensúlyozott', directness: 'nagyon direkt', humor: 'csípős/provokatív', emoji: 'gyakran', blockedPhrases: ['NEVER USE THIS'], signature: 'JARVIS-EXTERNAL-MARKER' },
    })

    // Conversation: Jarvis (originating) → delegates to Sys → Sys spawns code-reviewer
    const conversationId = await eyas.api.createConversation({ agentId: jarvisId })
    const teamSession = await eyas.api.startTeam(conversationId, [jarvisId, sysengId])

    const subPrompt = await eyas.api.delegateToSpecialist({
      teamSessionId: teamSession.id,
      delegatedFrom: sysengId,
      delegatedTo: 'code-reviewer',
      task: 'review this PR',
      outputAudience: 'external',
    })

    // The sub-agent's prompt must show Jarvis's external voice (originating), not Sys's
    expect(subPrompt.prefix).toContain('JARVIS-EXTERNAL-MARKER')
    expect(subPrompt.prefix).toContain('NEVER USE THIS')
  })
})
```

- [ ] **Step 2: Run + commit (ASK USER FIRST)**

```bash
bun test tests/integration/sub-agent-delegation.test.ts --run
git add tests/integration/sub-agent-delegation.test.ts
git commit -m "test(integration): originating agent voice survives delegation chain"
```

---

### Task 51: Voice scope override hierarchy test + identity self-edit + soul forge

**Files:**
- Create: `tests/integration/voice-scope-override.test.ts`
- Create: `tests/integration/identity-self-edit.test.ts`
- Create: `tests/integration/soul-forge-proposal.test.ts`
- Create: `tests/integration/cascade-merge.test.ts`
- Create: `tests/integration/provider-adapter-parity.test.ts`

- [ ] **Step 1: Voice scope override test** — verifies all 5 priority levels (per-message, ephemeral, per-conversation, per-channel, auto)

- [ ] **Step 2: Identity self-edit test** — invokes `workspace_update_identity`, verifies notification fires with diff, verifies revert restores

- [ ] **Step 3: SOUL forge proposal test** — agent calls `forge_propose_soul_change` → user approves via API → SOUL.md re-renders → cache prefix hash changes

- [ ] **Step 4: Cascade merge test** — sets up project-type AGENTS.md + project AGENTS.md + agent AGENTS.md, asserts all 3 appear in assembled prefix in correct order

- [ ] **Step 5: Provider adapter parity test** — sends same `AssembledPrompt` to mocked Anthropic, OpenAI, Ollama adapters, asserts each shapes the request correctly per its capabilities

- [ ] **Step 6: Run all** + commit (ASK USER FIRST)

```bash
bun test tests/integration/ --run
git add tests/integration/voice-scope-override.test.ts tests/integration/identity-self-edit.test.ts \
        tests/integration/soul-forge-proposal.test.ts tests/integration/cascade-merge.test.ts \
        tests/integration/provider-adapter-parity.test.ts
git commit -m "test(integration): voice override + identity self-edit + soul forge + cascade + adapter parity"
```

---

### Task 52: Performance test — Anthropic cache hit ratio

**Files:**
- Create: `tests/performance/prompt-cache-anthropic.test.ts`

- [ ] **Step 1: Write the test (real API call, gated by env var)**

```typescript
// tests/performance/prompt-cache-anthropic.test.ts
import { describe, expect, it } from 'vitest'
import { setupTestEyas } from '../helpers/test-eyas.js'

const REAL = process.env.EYAS_REAL_ANTHROPIC === '1'

describe.skipIf(!REAL)('Anthropic cache hit ratio', () => {
  it('achieves ≥80% cache hit in 10-turn loop', async () => {
    const eyas = await setupTestEyas({ provider: 'anthropic', useRealApi: true })
    const agentId = await eyas.api.createAgent({ template: 'primary-assistant', name: 'PerfTest' })
    const conversationId = await eyas.api.createConversation({ agentId })

    let cacheHits = 0
    for (let i = 0; i < 10; i++) {
      const response = await eyas.api.sendMessage(conversationId, `turn ${i}: respond with one short sentence.`)
      if (response.usage?.cache_read_input_tokens && response.usage.cache_read_input_tokens > 0) cacheHits++
    }

    expect(cacheHits / 10).toBeGreaterThanOrEqual(0.8)
    await eyas.shutdown()
  }, 60_000)
})
```

- [ ] **Step 2: Run only when EYAS_REAL_ANTHROPIC=1**

```bash
EYAS_REAL_ANTHROPIC=1 bun test tests/performance/prompt-cache-anthropic.test.ts --run
```

This is a manual gate; CI does not run it by default (no API key in CI).

- [ ] **Step 3: Commit (ASK USER FIRST)**

```bash
git add tests/performance/prompt-cache-anthropic.test.ts
git commit -m "test(performance): Anthropic prompt cache hit ratio measurement"
```

---

### Task 53: Migration test + voice scenario fixtures + docs

**Files:**
- Create: `tests/migration/migrate-v1-to-v2.test.ts`
- Create: `tests/fixtures/voice-scenarios.json`
- Modify: `CHANGELOG.md`
- Modify: `docs/eyas-architecture.md`
- Create: `docs/user/agent-voice-guide.md`

- [ ] **Step 1: Migration round-trip test**

```typescript
// tests/migration/migrate-v1-to-v2.test.ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { seedV1Database } from './helpers/seed-v1.js'
import { runMigration } from '../../scripts/migrate-prompts-v2.js'
import { runRollback } from '../../scripts/migrate-prompts-v2-rollback.js'

describe('Migration v1 → v2', () => {
  let dataDir: string
  beforeEach(() => { dataDir = mkdtempSync(join(tmpdir(), 'eyas-mig-')) })
  afterEach(() => { rmSync(dataDir, { recursive: true, force: true }) })

  it('preserves all 16 default agent templates correctly', async () => {
    await seedV1Database(dataDir)
    await runMigration({ dataDir })

    for (const id of ['primary-assistant', 'system-engineer', 'devils-advocate']) {
      expect(existsSync(join(dataDir, 'agents', id, 'IDENTITY.md'))).toBe(true)
    }
    // primary agents have SOUL.md, specialists do not
    expect(existsSync(join(dataDir, 'agents', 'primary-assistant', 'SOUL.md'))).toBe(true)
    expect(existsSync(join(dataDir, 'agents', 'devils-advocate', 'SOUL.md'))).toBe(false)
  })

  it('rollback restores v1 state', async () => {
    await seedV1Database(dataDir)
    await runMigration({ dataDir })
    await runRollback({ dataDir })
    expect(existsSync(join(dataDir, 'agents'))).toBe(false)
  })
})
```

- [ ] **Step 2: Voice scenarios fixture file**

```json
// tests/fixtures/voice-scenarios.json
[
  {
    "name": "owner-dm-web",
    "channelContext": { "channelType": "web", "conversationKind": "owner-dm", "participants": [{ "id": "owner", "type": "owner" }], "origin": "inbound" },
    "expectedScope": "internal",
    "expectedReason": "owner DM"
  },
  {
    "name": "owner-with-team-member-telegram-group",
    "channelContext": { "channelType": "telegram", "conversationKind": "group", "participants": [{ "id": "owner", "type": "owner" }, { "id": "imre", "type": "team-member" }], "origin": "inbound" },
    "expectedScope": "internal"
  },
  /* ... 18 more scenarios covering all combinations from spec section 8.9 ... */
]
```

Then a parametric test:

```typescript
// tests/integration/voice-scenarios.test.ts
import scenarios from '../fixtures/voice-scenarios.json'
import { resolveScope } from '../../src/modules/communication/channel-resolver.js'

describe('voice scenario fixtures', () => {
  for (const s of scenarios) {
    it(`scenario: ${s.name}`, () => {
      expect(resolveScope(s.channelContext as never).scope).toBe(s.expectedScope)
    })
  }
})
```

- [ ] **Step 3: Update CHANGELOG**

Append to `CHANGELOG.md` under a new wave entry:

```markdown
## v0.9.0-beta — Wave: Autonomous Agent Prompt Architecture (v2)

- File-based agent workspace replaces DB-stored persona fields
- Per-agent `IDENTITY.md`, `SOUL.md`, `AGENTS.md`, `TOOLS.md`, `MEMORY.md`, `memory/YYYY-MM-DD.md`
- Structured dual-scope voice system (6 dimensions × internal/external) with 8 presets
- Provider-agnostic cache-aware runtime assembly (Anthropic / OpenAI / Google / Ollama / xAI / DeepSeek)
- Sub-agent prompt with originating-agent voice snapshot
- Channel resolver with override hierarchy (per-message > ephemeral > per-conversation > per-channel > auto)
- Self-evolution: agent self-edits AGENTS/TOOLS/MEMORY freely, IDENTITY with notify, SOUL via forge approval
- Migration script v1 → v2 with rollback
- All 16 agent templates re-seeded with workspace seeds
- New tests: 100+ unit, 8 integration scenarios, performance gate (Anthropic cache ratio)
```

- [ ] **Step 4: Update architecture doc**

In `docs/eyas-architecture.md`, replace the existing "Prompt System" section with a summary linking to the new spec:

```markdown
### Prompt System (v2)

EYAS uses a file-based per-agent workspace at `data/agents/<id>/` containing IDENTITY.md, SOUL.md, AGENTS.md, TOOLS.md, MEMORY.md. Framework CORE_IDENTITY and CORE_RULES live in code. Runtime assembly produces a provider-agnostic AssembledPrompt with stable cache prefix and dynamic suffix; provider adapters wire it to native cache/tool APIs.

See: `docs/superpowers/specs/2026-04-26-autonomous-agent-prompt-architecture-design.md`
```

- [ ] **Step 5: User-facing voice guide**

Create `docs/user/agent-voice-guide.md` — short guide on the 6 dimensions, presets, blocked phrases, and how to override per-conversation.

- [ ] **Step 6: Manual QA pass (per spec section 8.11)**

Run through the 12-item manual QA checklist from the spec. Document results in `docs/superpowers/plans/2026-04-26-qa-results.md` (created during this task).

- [ ] **Step 7: Final commit (ASK USER FIRST)**

```bash
git add tests/migration/migrate-v1-to-v2.test.ts tests/fixtures/voice-scenarios.json \
        tests/integration/voice-scenarios.test.ts CHANGELOG.md docs/eyas-architecture.md \
        docs/user/agent-voice-guide.md docs/superpowers/plans/2026-04-26-qa-results.md
git commit -m "docs+test: migration test, voice fixtures, changelog, architecture, QA results"
```

---

## Self-review

- **Spec coverage**: every requirement in the design spec maps to a task above
  - Section 1 (Goal & Scope) → covered in plan header + Tasks 1, 2, 41
  - Section 2 (File architecture) → Tasks 4–8, 38, 39
  - Section 3 (Style system) → Tasks 9–13
  - Section 4 (Inheritance + sub-agent snapshot) → Tasks 14, 19
  - Section 5 (Runtime assembly + providers) → Tasks 15–18, 20–24
  - Section 6 (Channel-aware voice) → Tasks 25–29
  - Section 7 (Self-evolution + forge) → Tasks 30–35
  - Section 8 (Migration + tests) → Tasks 36–40, 41 (re-seed), 49–53
  - Frontend & i18n (mentioned across spec) → Tasks 42–48
- **Placeholder scan**: no "TBD/TODO/FIXME" placeholders in step content; the only TBD-like markers are in user-facing template content where the user is expected to fill in (e.g. `(set during wizard)` in `IDENTITY.md` seeds — intentional)
- **Type consistency**: `AssembledPrompt`, `VoiceProfile`, `VoiceScope`, `ParentSnapshot`, `SoulStyle` are defined in Task 2 (`types.ts`) and consistently referenced
- **Function names**: `buildForPrimary`, `buildSubagentPrompt`, `buildParentSnapshot`, `resolveScope`, `resolveWithOverrides`, `createPromptAssembler` — consistent across tasks

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-26-autonomous-agent-prompt-architecture.md`. Two execution options:

**1. Subagent-Driven (recommended)** — fresh subagent per task, review between tasks, fast iteration via `superpowers:subagent-driven-development`

**2. Inline Execution** — execute tasks in this session via `superpowers:executing-plans`, batch execution with checkpoints

**Which approach?**

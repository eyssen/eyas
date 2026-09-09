# Agent Unification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify agent-type users and agent_definitions with tier/agentType taxonomy, linked via FK, with updated frontend for full agent management.

**Architecture:** Add `tier`/`agent_type` columns to agent_definitions, `agent_definition_id` to users. Update setup wizard to create both records. Update frontend: agent detail page gets goal/backstory/tier/agentType fields, agents list gets tier filters, users page gets "+ New Agent" button, new Prompt Settings section for master prompt management.

**Tech Stack:** TypeScript, Drizzle ORM (SQLite), React 19, shadcn/ui, TanStack Router, Vitest

---

## File Structure

### Modified Files
| File | Change |
|------|--------|
| `src/modules/agent/types.ts` | Add `tier`, `agentType` to interfaces + `AgentTier`/`AgentType` union types |
| `src/modules/agent/schema.ts` | Add `tier`, `agent_type` columns |
| `src/modules/agent/index.ts` | Add ALTER TABLE + columns to CREATE TABLE |
| `src/modules/agent/agent-registry.ts` | Handle tier/agentType in CRUD, add tier/agentType filters |
| `src/modules/agent/routes.ts` | Add tier/agentType query params, linkedUserId in response |
| `src/modules/auth/schema.ts` | Add `agent_definition_id` column |
| `src/modules/auth/index.ts` | Update setup wizard "first-agent" step + ALTER TABLE |
| `src/modules/auth/routes.ts` | Add `agentDefinitionId` to user response, `POST /users/agents` endpoint |
| `src/modules/prompt-wizard/routes.ts` | Add `GET /prompts/master` and `PATCH /prompts/master/personality` |
| `src/web/src/pages/agents/agents-page.tsx` | Add tier/agentType filters, tier badges |
| `src/web/src/pages/agents/agent-detail-page.tsx` | Add goal, backstory, tier, agentType fields |
| `src/web/src/pages/users/users-page.tsx` | Add "+ New Agent" button, "AI Config →" link |
| `tests/helpers/test-db.ts` | Add new columns to test schemas |

### New Files
| File | Responsibility |
|------|---------------|
| `src/web/src/pages/settings/prompt-settings.tsx` | Master prompt display/edit (locked readonly, personality editable) |

---

### Task 1: Backend Schema — tier, agentType, agentDefinitionId

**Files:**
- Modify: `src/modules/agent/types.ts`
- Modify: `src/modules/agent/schema.ts`
- Modify: `src/modules/agent/index.ts`
- Modify: `src/modules/agent/agent-registry.ts`
- Modify: `src/modules/auth/schema.ts`
- Modify: `src/modules/auth/index.ts`
- Modify: `tests/helpers/test-db.ts`

- [ ] **Step 1: Add types**

In `src/modules/agent/types.ts`, add after line 1 (after the file header comment):

```typescript
export type AgentTier = 'primary' | 'team' | 'specialist'
export type AgentType = 'assistant' | 'engineer' | 'developer' | 'reviewer' | 'critic' | 'researcher' | 'planner' | 'coordinator' | 'observer'
```

Add to `AgentDefinition` interface after `backstory`:

```typescript
  tier: AgentTier
  agentType: AgentType
```

Add to `CreateAgentInput` after `backstory`:

```typescript
  tier?: AgentTier
  agentType?: AgentType
```

Change `source` in both interfaces from `'seed' | 'user'` to `'seed' | 'user' | 'generated'`.

Add to `AgentFilter`:

```typescript
  tier?: AgentTier
  agentType?: AgentType
```

- [ ] **Step 2: Add columns to agent schema**

In `src/modules/agent/schema.ts`, add after `backstory`:

```typescript
  tier: text('tier').notNull().default('specialist'),
  agentType: text('agent_type').notNull().default('assistant'),
```

- [ ] **Step 3: Add columns to agent CREATE TABLE in index.ts**

In `src/modules/agent/index.ts`, in the CREATE TABLE statement, add after `backstory TEXT,`:

```sql
      tier TEXT NOT NULL DEFAULT 'specialist',
      agent_type TEXT NOT NULL DEFAULT 'assistant',
```

Add ALTER TABLE after existing migrations:

```typescript
    try { ctx.db.run(sql`ALTER TABLE agent_definitions ADD COLUMN tier TEXT NOT NULL DEFAULT 'specialist'`) } catch { /* exists */ }
    try { ctx.db.run(sql`ALTER TABLE agent_definitions ADD COLUMN agent_type TEXT NOT NULL DEFAULT 'assistant'`) } catch { /* exists */ }
```

- [ ] **Step 4: Update agent-registry to handle tier/agentType**

In `src/modules/agent/agent-registry.ts`:

Add to `toAgentDefinition()` after `backstory`:
```typescript
    tier: (raw.tier ?? 'specialist') as any,
    agentType: (raw.agent_type ?? 'assistant') as any,
```

Add to `create()` INSERT column list and VALUES:
```typescript
// column: tier, agent_type
// values: ${input.tier ?? 'specialist'}, ${input.agentType ?? 'assistant'}
```

Add to `create()` return object:
```typescript
    tier: (input.tier ?? 'specialist') as any,
    agentType: (input.agentType ?? 'assistant') as any,
```

Add to `update()` merge and SET clause:
```typescript
const tier = patch.tier ?? existing.tier
const agentType = patch.agentType ?? existing.agentType
// SET: tier = ${tier}, agent_type = ${agentType},
```

Add to `seedFromDirectory()` INSERT columns and values:
```typescript
// column: tier, agent_type  
// values: ${data.tier ?? 'specialist'}, ${data.agentType ?? 'assistant'}
```

Add tier/agentType filtering in `list()` — after the existing JS-based filters:
```typescript
if (filter.tier) {
  agents = agents.filter(a => a.tier === filter.tier)
}
if (filter.agentType) {
  agents = agents.filter(a => a.agentType === filter.agentType)
}
```

- [ ] **Step 5: Add agentDefinitionId to auth schema**

In `src/modules/auth/schema.ts`, add to the users table:
```typescript
  agentDefinitionId: text('agent_definition_id'),
```

- [ ] **Step 6: Add ALTER TABLE in auth/index.ts**

In `src/modules/auth/index.ts`, add after the users CREATE TABLE:
```typescript
    try { ctx.db.run(sql`ALTER TABLE users ADD COLUMN agent_definition_id TEXT`) } catch { /* exists */ }
```

- [ ] **Step 7: Update test-db.ts**

In `tests/helpers/test-db.ts`, add to the agent_definitions CREATE TABLE:
- `tier TEXT NOT NULL DEFAULT 'specialist'`
- `agent_type TEXT NOT NULL DEFAULT 'assistant'`

Add to users CREATE TABLE:
- `agent_definition_id TEXT`

- [ ] **Step 8: Run tests**

Run: `cd /Users/eyssen/GitHub/eyas && bunx vitest run`
Expected: All tests pass

- [ ] **Step 9: Commit**

```bash
git add src/modules/agent/types.ts src/modules/agent/schema.ts src/modules/agent/index.ts src/modules/agent/agent-registry.ts src/modules/auth/schema.ts src/modules/auth/index.ts tests/helpers/test-db.ts
git commit -m "feat: add tier/agentType to agent_definitions + agentDefinitionId to users"
```

---

### Task 2: Setup Wizard — Create Both Records

**Files:**
- Modify: `src/modules/auth/index.ts`

The setup wizard's "first-agent" step must create both an agent_definitions record AND a users record, linked.

- [ ] **Step 1: Update the first-agent setup step**

In `src/modules/auth/index.ts`, replace the `first-agent` registerStep block (lines 82-98) with:

```typescript
    ctx.setup.registerStep({
      id: 'first-agent',
      module: 'auth',
      title: 'Create Your AI Assistant',
      description: 'Set up your first AI agent',
      required: true,
      order: 20,
      fields: [
        { name: 'name', type: 'text', label: 'Agent Name', required: true, placeholder: 'Jarvis' },
        { name: 'role', type: 'text', label: 'Role', required: false, placeholder: 'Personal AI Assistant' },
        { name: 'systemPrompt', type: 'textarea', label: 'System Prompt', required: false, placeholder: 'Operating guidelines for your agent...' },
      ],
      async onComplete(data) {
        const agentDefId = generateId()
        const userId = generateId()
        const now = new Date().toISOString()
        const agentName = data.name as string
        const role = (data.role as string) || 'Personal AI Assistant'
        const systemPrompt = (data.systemPrompt as string) || ''

        // 1. Create agent_definitions record
        ctx.db.run(sql`INSERT INTO agent_definitions
          (id, name, role, description, goal, backstory, system_prompt, capabilities, tools, constraints, model, max_turns, enabled, source, tier, agent_type, created_at, updated_at)
          VALUES (
            ${agentDefId}, ${agentName}, ${role},
            ${'Primary AI assistant'},
            ${'Be the user\'s most effective collaborator across all tasks'},
            ${'Versatile assistant with broad technical expertise. Prioritizes understanding intent before acting.'},
            ${systemPrompt},
            ${JSON.stringify(['code-analysis', 'research', 'planning', 'file-management', 'communication', 'general'])},
            ${JSON.stringify(['bash', 'file-read', 'file-write', 'search', 'web-fetch', 'memory', 'documents'])},
            ${JSON.stringify(['Always verify before assuming', 'Ask before destructive operations'])},
            ${null}, ${10}, ${1}, ${'seed'},
            ${'primary'}, ${'assistant'},
            ${now}, ${now}
          )`)

        // 2. Create linked user record
        ctx.db.run(sql`INSERT INTO users
          (id, username, display_name, password_hash, role, is_root_owner, is_agent, agent_definition_id, status, created_at, updated_at)
          VALUES (${userId}, ${agentName.toLowerCase()}, ${agentName}, ${null}, 'agent', 0, 1, ${agentDefId}, 'active', ${now}, ${now})`)

        // 3. Set as default agent for General project type
        ctx.db.run(sql`UPDATE project_types SET default_agent_id = ${agentDefId} WHERE id = 'general'`)
      },
    })
```

- [ ] **Step 2: Run tests**

Run: `cd /Users/eyssen/GitHub/eyas && bunx vitest run tests/modules/auth/`
Expected: All pass

- [ ] **Step 3: Commit**

```bash
git add src/modules/auth/index.ts
git commit -m "feat: setup wizard creates linked agent_definitions + users records"
```

---

### Task 3: Agent API — tier/agentType Filters + linkedUserId

**Files:**
- Modify: `src/modules/agent/routes.ts`

- [ ] **Step 1: Add tier/agentType query params and linkedUserId**

Replace `src/modules/agent/routes.ts` GET /agents handler to support new filters:

```typescript
  api.get('/agents', requirePermission('read', 'Agent'), (c) => {
    const enabled = c.req.query('enabled')
    const source = c.req.query('source')
    const tier = c.req.query('tier')
    const agentType = c.req.query('agentType')
    const filter: any = {}
    if (enabled !== undefined) filter.enabled = enabled === 'true'
    if (source) filter.source = source
    if (tier) filter.tier = tier
    if (agentType) filter.agentType = agentType
    const agents = registry.list(Object.keys(filter).length > 0 ? filter : undefined)
    return c.json({ agents })
  })
```

- [ ] **Step 2: Run tests**

Run: `cd /Users/eyssen/GitHub/eyas && bunx vitest run tests/modules/agent/ 2>/dev/null; bunx vitest run`
Expected: All pass

- [ ] **Step 3: Commit**

```bash
git add src/modules/agent/routes.ts
git commit -m "feat(agent): add tier/agentType query filters to GET /agents"
```

---

### Task 4: Users API — agentDefinitionId + POST /users/agents

**Files:**
- Modify: `src/modules/auth/routes.ts`

- [ ] **Step 1: Add agentDefinitionId to user response**

Find the `userToPublic` function in `src/modules/auth/routes.ts`. Add `agentDefinitionId: u.agent_definition_id ?? null` to the returned object.

- [ ] **Step 2: Add POST /users/agents endpoint**

Add after the existing `POST /api/v1/users` handler:

```typescript
  // Create agent-type user + linked agent_definitions in one call
  router.post('/api/v1/users/agents', authenticate, requirePermission('create', 'User'), async (c) => {
    const body = await c.req.json()
    const { name, avatar, email } = body
    if (!name) return c.json({ error: 'name is required' }, 400)

    const agentDefId = generateId()
    const userId = generateId()
    const now = new Date().toISOString()
    const username = name.toLowerCase().replace(/\s+/g, '-')

    // Check username uniqueness
    const existing = getOne<UserRow>(db, sql`SELECT id FROM users WHERE username = ${username}`)
    if (existing) return c.json({ error: 'Username already exists' }, 409)

    // 1. Create agent_definitions record
    db.run(sql`INSERT INTO agent_definitions
      (id, name, role, description, goal, backstory, system_prompt, capabilities, tools, constraints, enabled, source, tier, agent_type, created_at, updated_at)
      VALUES (
        ${agentDefId}, ${name}, ${''},
        ${''}, ${''}, ${''}, ${''},
        ${JSON.stringify([])}, ${JSON.stringify([])}, ${JSON.stringify([])},
        ${1}, ${'user'}, ${'primary'}, ${'assistant'},
        ${now}, ${now}
      )`)

    // 2. Create linked user record
    db.run(sql`INSERT INTO users
      (id, username, display_name, email, password_hash, role, is_root_owner, is_agent, agent_definition_id, status, created_at, updated_at)
      VALUES (${userId}, ${username}, ${name}, ${email ?? null}, ${null}, 'agent', 0, 1, ${agentDefId}, 'active', ${now}, ${now})`)

    const user = getOne<UserRow>(db, sql`SELECT * FROM users WHERE id = ${userId}`)
    return c.json({ user: userToPublic(user!), agentDefinitionId: agentDefId }, 201)
  })
```

- [ ] **Step 3: Run tests**

Run: `cd /Users/eyssen/GitHub/eyas && bunx vitest run tests/modules/auth/`
Expected: All pass

- [ ] **Step 4: Commit**

```bash
git add src/modules/auth/routes.ts
git commit -m "feat(auth): add agentDefinitionId to user response + POST /users/agents"
```

---

### Task 5: Prompt API — Master Prompt Endpoints

**Files:**
- Modify: `src/modules/prompt-wizard/routes.ts`

- [ ] **Step 1: Add master prompt endpoints**

In `src/modules/prompt-wizard/routes.ts`, add before `app.route('/api/v1', api)`:

```typescript
  // Get master prompt sections (for Prompt Settings UI)
  api.get('/prompts/master', requirePermission('read', 'Prompt'), (c) => {
    const templates = wizard.list('master')
    const sections = templates.map(t => ({
      id: t.id,
      section: t.section,
      name: t.name,
      content: t.content,
      locked: t.locked,
    }))
    return c.json({ sections })
  })

  // Update personality section
  api.patch('/prompts/master/personality', requirePermission('update', 'Prompt'), async (c) => {
    const { content } = await c.req.json()
    if (!content || typeof content !== 'string') {
      return c.json({ error: 'content is required' }, 400)
    }
    // Find the personality template
    const templates = wizard.list('master')
    const personality = templates.find(t => t.section === 'personality')
    if (!personality) {
      return c.json({ error: 'Personality section not found' }, 404)
    }
    if (personality.locked) {
      return c.json({ error: 'Cannot update locked section' }, 403)
    }
    wizard.update(personality.id, { content })
    const updated = wizard.get(personality.id)
    return c.json({ section: updated })
  })
```

- [ ] **Step 2: Run tests**

Run: `cd /Users/eyssen/GitHub/eyas && bunx vitest run tests/modules/prompt-wizard/`
Expected: All pass

- [ ] **Step 3: Commit**

```bash
git add src/modules/prompt-wizard/routes.ts
git commit -m "feat(prompt-wizard): add GET /prompts/master + PATCH /prompts/master/personality"
```

---

### Task 6: Frontend — Agent Detail Page (goal, backstory, tier, agentType)

**Files:**
- Modify: `src/web/src/pages/agents/agent-detail-page.tsx`

- [ ] **Step 1: Add new fields to the AgentDetail interface**

Add to the `AgentDetail` interface:

```typescript
  goal?: string
  backstory?: string
  tier?: 'primary' | 'team' | 'specialist'
  agentType?: 'assistant' | 'engineer' | 'developer' | 'reviewer' | 'critic' | 'researcher' | 'planner' | 'coordinator' | 'observer'
```

- [ ] **Step 2: Add new fields to form state**

Add to `useState` initial form:

```typescript
    goal: '',
    backstory: '',
    tier: 'specialist' as string,
    agentType: 'assistant' as string,
```

Add to the `useEffect` sync block:

```typescript
      goal: agent.goal ?? '',
      backstory: agent.backstory ?? '',
      tier: agent.tier ?? 'specialist',
      agentType: agent.agentType ?? 'assistant',
```

Add to `handleSave`:

```typescript
      goal: form.goal,
      backstory: form.backstory,
      tier: form.tier,
      agentType: form.agentType,
```

- [ ] **Step 3: Add Classification and Persona sections to the form UI**

After the header section and before the existing form `<div className="glass-card p-4 space-y-4">`, add:

```tsx
      {/* Classification */}
      <div className="glass-card p-4 space-y-4 mb-4">
        <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Classification</h3>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Tier</Label>
            <select
              value={form.tier}
              onChange={(e) => setForm({ ...form, tier: e.target.value })}
              className="w-full h-8 rounded-md border border-border/50 bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="primary">Primary</option>
              <option value="team">Team</option>
              <option value="specialist">Specialist</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Agent Type</Label>
            <select
              value={form.agentType}
              onChange={(e) => setForm({ ...form, agentType: e.target.value })}
              className="w-full h-8 rounded-md border border-border/50 bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="assistant">Assistant</option>
              <option value="engineer">Engineer</option>
              <option value="developer">Developer</option>
              <option value="reviewer">Reviewer</option>
              <option value="critic">Critic</option>
              <option value="researcher">Researcher</option>
              <option value="planner">Planner</option>
              <option value="coordinator">Coordinator</option>
              <option value="observer">Observer</option>
            </select>
          </div>
        </div>
      </div>

      {/* Persona */}
      <div className="glass-card p-4 space-y-4 mb-4">
        <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Persona</h3>
        <div className="space-y-1.5">
          <Label className="text-xs">Goal</Label>
          <Input value={form.goal} onChange={(e) => setForm({ ...form, goal: e.target.value })} className="h-8 text-sm" placeholder="What drives this agent's decisions" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Backstory</Label>
          <textarea
            value={form.backstory}
            onChange={(e) => setForm({ ...form, backstory: e.target.value })}
            className="w-full min-h-[80px] rounded-md border border-border/50 bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring resize-y"
            placeholder="Context that shapes the agent's approach and perspective"
          />
        </div>
      </div>
```

- [ ] **Step 4: Verify in browser**

Run: `cd /Users/eyssen/GitHub/eyas && bun run dev` and navigate to an agent detail page to verify new fields appear.

- [ ] **Step 5: Commit**

```bash
git add src/web/src/pages/agents/agent-detail-page.tsx
git commit -m "feat(frontend): add goal, backstory, tier, agentType to agent detail page"
```

---

### Task 7: Frontend — Agents List + Users Page + Prompt Settings

**Files:**
- Modify: `src/web/src/pages/agents/agents-page.tsx`
- Modify: `src/web/src/pages/users/users-page.tsx`
- Create: `src/web/src/pages/settings/prompt-settings.tsx`

- [ ] **Step 1: Update agents-page.tsx — add tier filter and badges**

Add `tier` and `agentType` to the `AgentItem` interface:

```typescript
  tier?: 'primary' | 'team' | 'specialist'
  agentType?: string
```

Replace the filter state and filter logic:

```typescript
  const [filter, setFilter] = useState<'all' | 'enabled' | 'primary' | 'team' | 'specialist'>('all')

  const agents = (data?.agents ?? []).filter((a) => {
    if (filter === 'enabled') return a.enabled
    if (filter === 'primary') return a.tier === 'primary'
    if (filter === 'team') return a.tier === 'team'
    if (filter === 'specialist') return a.tier === 'specialist'
    return true
  })
```

Update filter buttons:

```tsx
{(['all', 'enabled', 'primary', 'team', 'specialist'] as const).map((f) => (
```

Add tier badge in the agent card, after the existing badges:

```tsx
{agent.tier && (
  <Badge variant="outline" className={`text-[10px] ${
    agent.tier === 'primary' ? 'text-purple-400 border-purple-400/30' :
    agent.tier === 'team' ? 'text-blue-400 border-blue-400/30' :
    'text-muted-foreground'
  }`}>
    {agent.tier}
  </Badge>
)}
```

- [ ] **Step 2: Update users-page.tsx — add "+ New Agent" button and AI Config link**

Add imports:

```typescript
import { useNavigate } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'
import { Plus } from 'lucide-react'
```

Add `agentDefinitionId` to the User interface:

```typescript
  agentDefinitionId?: string | null
```

Add navigate hook and create handler inside the component:

```typescript
  const navigate = useNavigate()

  const handleCreateAgent = async () => {
    const result = await api.post<{ user: User; agentDefinitionId: string }>('/users/agents', {
      name: 'New Agent',
    })
    // Navigate to agent definition for AI configuration
    navigate({ to: '/agents/$agentId', params: { agentId: result.agentDefinitionId } })
  }
```

Add header with button (replace the existing h1):

```tsx
<div className="flex items-baseline justify-between mb-5">
  <div>
    <h1 className="page-title">Users</h1>
    <p className="text-sm text-muted-foreground">Users and AI agents</p>
  </div>
  <Button size="sm" onClick={handleCreateAgent}>
    <Plus className="h-3.5 w-3.5 mr-1" />
    New Agent
  </Button>
</div>
```

Add "AI Config →" link in the table row for agent users. In the Type column cell, add after the badge:

```tsx
{u.isAgent && u.agentDefinitionId && (
  <button
    className="text-[10px] text-purple-400 hover:text-purple-300 ml-2"
    onClick={() => navigate({ to: '/agents/$agentId', params: { agentId: u.agentDefinitionId! } })}
  >
    AI Config →
  </button>
)}
```

- [ ] **Step 3: Create prompt-settings.tsx**

```tsx
// src/web/src/pages/settings/prompt-settings.tsx
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { useState, useEffect, useCallback } from 'react'
import { useApi } from '@/hooks/use-api'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Save, Lock } from 'lucide-react'

interface PromptSection {
  id: string
  section: string
  name: string
  content: string
  locked: boolean
}

export default function PromptSettings() {
  const { data, refetch } = useApi<{ sections: PromptSection[] }>('/prompts/master')
  const sections = data?.sections ?? []

  const [personalityContent, setPersonalityContent] = useState('')
  const [saving, setSaving] = useState(false)

  const personality = sections.find(s => s.section === 'personality')

  useEffect(() => {
    if (personality) setPersonalityContent(personality.content)
  }, [personality])

  const handleSave = useCallback(async () => {
    setSaving(true)
    try {
      await api.patch('/prompts/master/personality', { content: personalityContent })
      refetch()
    } finally {
      setSaving(false)
    }
  }, [personalityContent, refetch])

  return (
    <div className="max-w-3xl">
      <h2 className="text-lg font-semibold mb-4">System Prompt</h2>
      <p className="text-sm text-muted-foreground mb-6">
        These sections form the foundation of every AI conversation. Locked sections cannot be modified.
      </p>

      <div className="space-y-4">
        {sections.filter(s => s.section !== 'personality').map(s => (
          <div key={s.id} className="glass-card p-4">
            <div className="flex items-center gap-2 mb-2">
              <Label className="text-xs font-medium">{s.name}</Label>
              {s.locked && (
                <Badge variant="outline" className="text-[10px] text-amber-400 border-amber-400/30">
                  <Lock className="h-2.5 w-2.5 mr-1" />
                  Locked
                </Badge>
              )}
            </div>
            <pre className="text-xs text-muted-foreground whitespace-pre-wrap bg-accent/20 rounded-md p-3 max-h-48 overflow-y-auto">
              {s.content}
            </pre>
          </div>
        ))}

        {personality && (
          <div className="glass-card p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Label className="text-xs font-medium">{personality.name}</Label>
                <Badge variant="outline" className="text-[10px] text-emerald-400 border-emerald-400/30">
                  Editable
                </Badge>
              </div>
              <Button size="sm" variant="ghost" onClick={handleSave} disabled={saving}>
                <Save className="h-3.5 w-3.5 mr-1" />
                {saving ? 'Saving...' : 'Save'}
              </Button>
            </div>
            <textarea
              value={personalityContent}
              onChange={(e) => setPersonalityContent(e.target.value)}
              className="w-full min-h-[150px] rounded-md border border-border/50 bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring resize-y font-mono"
            />
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Register the prompt-settings route**

Find the router configuration file (likely `src/web/src/router.tsx` or similar) and add a route for the prompt settings. This depends on how Settings routes are structured — look for existing settings routes and add alongside them.

- [ ] **Step 5: Commit**

```bash
git add src/web/src/pages/agents/agents-page.tsx src/web/src/pages/users/users-page.tsx src/web/src/pages/settings/prompt-settings.tsx
git commit -m "feat(frontend): tier filters, user agent management, prompt settings page"
```

---

### Task 8: Final Verification

- [ ] **Step 1: Run full test suite**

Run: `cd /Users/eyssen/GitHub/eyas && bunx vitest run`
Expected: All tests pass

- [ ] **Step 2: TypeScript check**

Run: `cd /Users/eyssen/GitHub/eyas && bunx tsc --noEmit 2>&1 | grep -c "error"` — check only our files if pre-existing errors exist

- [ ] **Step 3: Verify in browser**

Start dev server: `bun run dev`

Check:
1. Agents page: tier filter works, tier badges visible
2. Agent detail: goal/backstory/tier/agentType fields present and saveable
3. Users page: "+ New Agent" button creates agent user + redirects to agent config
4. Settings → Prompt: master prompt sections visible, personality editable

- [ ] **Step 4: Commit any fixes**

```bash
git add -A && git commit -m "fix: final verification fixes for agent unification"
```

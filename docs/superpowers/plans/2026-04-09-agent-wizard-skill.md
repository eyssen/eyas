# Agent Creation Wizard Skill — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the blank "Create Agent" form with an AI-guided skill that designs agent personas through conversation.

**Architecture:** A bundled skill (`config/skills/create-agent.md`) provides instructions for the AI to guide users through agent design via 3-5 questions. The AI outputs a ` ```agent-config``` ` JSON block that the frontend renders as a preview card with a "Create" button. The "Create Agent" button on the agents page starts a new conversation that triggers this skill.

**Tech Stack:** Skill markdown (YAML frontmatter), React component for preview card, existing conversation + streaming infrastructure.

---

### Task 1: Create the `create-agent` bundled skill

**Files:**
- Create: `config/skills/create-agent.md`

This is the core of the feature — the skill content that instructs the AI how to guide agent creation.

- [ ] **Step 1: Create the skill file with frontmatter and full content**

```markdown
---
name: create-agent
description: AI-guided agent creation wizard — helps design agent personas through conversation
trigger_patterns:
  - "create agent"
  - "new agent"
  - "build an agent"
  - "design an agent"
  - "agent wizard"
  - "I need an agent"
  - "make an agent"
  - "agent kellene"
  - "agentet szeretnék"
  - "új agent"
  - "agent készítés"
  - "create a specialist"
  - "specialist agent"
capabilities:
  - agent-management
version: "1.0.0"
---
# Agent Creation Wizard

You are helping the user design a new AI agent for the EYAS platform. Your goal is to understand what they need, suggest the best configuration, and generate a complete agent definition.

## Process

### Phase 1: Discovery (1-2 messages)

Start by understanding what the user needs. Ask ONE question:

"What kind of agent do you need? Describe what it should do, or pick from these common types:"

Then list these archetypes (adapted from existing templates):
- 🤖 **Assistant** — General-purpose helper for varied tasks
- 🔧 **Engineer** — System maintenance, testing, optimization
- 👨‍💻 **Developer** — Writes code (backend or frontend)
- 🔍 **Reviewer** — Code review, security audit, quality checks
- 😈 **Critic** — Challenges assumptions, finds blind spots
- 🔬 **Researcher** — Gathers information, evaluates sources
- 📋 **Planner** — Requirements, API design, architecture
- 📊 **Analyst** — Data analysis, reporting, insights
- 🚀 **DevOps** — Deployment, CI/CD, infrastructure
- ✍️ **Writer** — Documentation, technical writing

If the user is vague, ask follow-up: "Can you give me an example task this agent would handle?"

### Phase 2: Refinement (2-3 messages)

Ask these questions ONE AT A TIME (skip any already answered):

1. **Communication style**: "Should this agent be formal and structured, or casual and conversational?"
2. **Key constraints**: "What should this agent absolutely NOT do? Any boundaries?"
3. **Tools needed**: Based on the role, suggest tools and ask for confirmation:
   - Code work: `bash`, `file-read`, `file-write`, `search`, `git`
   - Research: `search`, `web-fetch`, `memory`
   - Analysis: `bash`, `file-read`, `search`
   - Communication: `memory`, `documents`
4. **Model preference** (only if relevant): "For complex reasoning tasks, I'd suggest Opus. For speed, Sonnet. Preference?"

Use binary/multiple-choice questions. Don't ask open-ended questions when a choice works.

### Phase 3: Generate

After gathering enough information (typically 3-5 exchanges), generate the agent config.

IMPORTANT: Output the config in a fenced code block with the language tag `agent-config`. This is how the UI recognizes it:

Write a brief summary of what you designed, then output:

```agent-config
{
  "name": "Agent Name",
  "role": "One-line role description",
  "description": "What this agent does — shown in the agent list",
  "goal": "The agent's driving objective — what it optimizes for",
  "backstory": "2-3 sentences of context that shapes the agent's perspective and approach",
  "tier": "specialist",
  "agentType": "assistant|engineer|developer|reviewer|critic|researcher|planner|coordinator|observer",
  "systemPrompt": "## Role\n...\n\n## Rules\n...\n\n## Output Format\n...",
  "capabilities": ["capability1", "capability2"],
  "tools": ["tool1", "tool2"],
  "constraints": ["constraint1", "constraint2"],
  "model": "claude-sonnet-4",
  "maxTurns": 10,
  "avatar": "",
  "monthlyTokenBudget": 0
}
```

### System Prompt Structure

When generating the `systemPrompt` field, structure it with these sections:

1. **Role statement**: "You are [role] who [core behavior]." — first line
2. **Rules/Protocol**: Numbered list of operating rules (max 7)
3. **Output Format**: Expected response structure
4. **Boundaries**: What the agent should not do

Keep system prompts between 200-600 words. Be specific, not generic.

### Phase 4: Iterate

After generating, ask: "Here's your agent! Want to change anything, or should I create it?"

If the user wants changes:
- Modify the config and output a new `agent-config` block
- Only show the changed fields in your explanation, but always output the FULL config block

If the user confirms, say: "Click the **Create Agent** button on the preview card to finalize it."

## Guidelines

- Never ask more than 2 questions per message
- Always suggest defaults — don't make the user fill in blanks
- The `id` field will be auto-generated, don't include it
- For `tier`: use `specialist` for most custom agents, `team` if it's a core team member
- For `maxTurns`: 5 for reviewers/critics, 8-10 for developers/researchers, 10-15 for engineers
- For `monthlyTokenBudget`: suggest 0 (unlimited) unless user mentions cost concerns
- Match the user's language (Hungarian or English) in conversation, but ALL agent config fields must be in English
- Reference existing agent patterns — the platform has 16 built-in templates
```

- [ ] **Step 2: Verify the skill loads correctly**

Run: `ls -la config/skills/create-agent.md`
Expected: File exists with content.

- [ ] **Step 3: Commit**

```bash
git add config/skills/create-agent.md
git commit -m "feat(skills): add create-agent wizard skill"
```

---

### Task 2: Create the AgentConfigPreview component

**Files:**
- Create: `src/web/src/components/agent-config-preview.tsx`

This component renders the agent config JSON block as a visual preview card with Create/Modify actions.

- [ ] **Step 1: Create the preview component**

```tsx
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { useState, useCallback } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { api } from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Bot, Check, Pencil, Loader2 } from 'lucide-react'

interface AgentConfig {
  name: string
  role: string
  description: string
  goal: string
  backstory: string
  tier: string
  agentType: string
  systemPrompt: string
  capabilities: string[]
  tools: string[]
  constraints: string[]
  model: string
  maxTurns: number
  avatar?: string
  monthlyTokenBudget?: number
}

interface AgentConfigPreviewProps {
  config: AgentConfig
  onModify?: () => void
}

export function AgentConfigPreview({ config, onModify }: AgentConfigPreviewProps) {
  const navigate = useNavigate()
  const [creating, setCreating] = useState(false)
  const [created, setCreated] = useState(false)

  const handleCreate = useCallback(async () => {
    setCreating(true)
    try {
      const result = await api.post<{ agent: { id: string } }>('/agents', {
        id: `agent-${Date.now()}`,
        name: config.name,
        role: config.role,
        description: config.description,
        goal: config.goal,
        backstory: config.backstory,
        tier: config.tier || 'specialist',
        agentType: config.agentType || 'assistant',
        systemPrompt: config.systemPrompt,
        capabilities: config.capabilities || [],
        tools: config.tools || [],
        constraints: config.constraints || [],
        model: config.model,
        maxTurns: config.maxTurns || 10,
        avatar: config.avatar || '',
        monthlyTokenBudget: config.monthlyTokenBudget || 0,
        source: 'user',
      })
      setCreated(true)
      // Navigate to the new agent after a brief delay so user sees the success state
      setTimeout(() => {
        navigate({ to: '/agents/$agentId', params: { agentId: result.agent.id } })
      }, 800)
    } catch (err) {
      console.error('Failed to create agent:', err)
      setCreating(false)
    }
  }, [config, navigate])

  const handleModify = useCallback(() => {
    onModify?.()
  }, [onModify])

  const tierColor = config.tier === 'primary'
    ? 'text-purple-400 border-purple-400/30'
    : config.tier === 'team'
      ? 'text-blue-400 border-blue-400/30'
      : 'text-muted-foreground'

  return (
    <div className="glass-card p-4 space-y-3 border border-purple-500/20 bg-purple-500/5">
      {/* Header */}
      <div className="flex items-start gap-3">
        <div className="h-10 w-10 rounded-xl bg-purple-500/20 flex items-center justify-center flex-shrink-0">
          {config.avatar ? (
            <span className="text-lg">{config.avatar}</span>
          ) : (
            <Bot className="h-5 w-5 text-purple-400" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm">{config.name}</span>
            <Badge variant="outline" className={`text-[10px] ${tierColor}`}>
              {config.tier}
            </Badge>
            <Badge variant="outline" className="text-[10px]">
              {config.agentType}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">{config.role}</p>
        </div>
      </div>

      {/* Goal */}
      {config.goal && (
        <div>
          <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Goal</span>
          <p className="text-xs text-muted-foreground/80 mt-0.5">{config.goal}</p>
        </div>
      )}

      {/* Description */}
      {config.description && (
        <p className="text-xs text-muted-foreground/70">{config.description}</p>
      )}

      {/* Tools & Constraints */}
      <div className="flex flex-wrap gap-1.5">
        {config.tools.map((tool) => (
          <Badge key={tool} variant="secondary" className="text-[10px]">{tool}</Badge>
        ))}
      </div>

      {config.constraints.length > 0 && (
        <div className="text-[10px] text-muted-foreground/60 space-y-0.5">
          {config.constraints.map((c, i) => (
            <div key={i}>· {c}</div>
          ))}
        </div>
      )}

      {/* Model info */}
      <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
        <span>Model: {config.model}</span>
        <span>·</span>
        <span>Max turns: {config.maxTurns}</span>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 pt-1">
        <Button
          size="sm"
          onClick={handleCreate}
          disabled={creating || created}
          className={created ? 'bg-emerald-600 hover:bg-emerald-600' : ''}
        >
          {created ? (
            <>
              <Check className="h-3.5 w-3.5 mr-1" />
              Created!
            </>
          ) : creating ? (
            <>
              <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
              Creating...
            </>
          ) : (
            <>
              <Check className="h-3.5 w-3.5 mr-1" />
              Create Agent
            </>
          )}
        </Button>
        {!created && onModify && (
          <Button variant="outline" size="sm" onClick={handleModify}>
            <Pencil className="h-3.5 w-3.5 mr-1" />
            Modify
          </Button>
        )}
      </div>
    </div>
  )
}

/**
 * Try to extract an agent-config JSON block from message content.
 * Returns the parsed config if found, null otherwise.
 */
export function tryParseAgentConfig(content: string): AgentConfig | null {
  const match = content.match(/```agent-config\s*\n([\s\S]*?)\n```/)
  if (!match) return null
  try {
    const parsed = JSON.parse(match[1])
    // Validate required fields
    if (!parsed.name || !parsed.role) return null
    return parsed as AgentConfig
  } catch {
    return null
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/web/src/components/agent-config-preview.tsx
git commit -m "feat(frontend): add AgentConfigPreview component for wizard skill"
```

---

### Task 3: Integrate AgentConfigPreview into conversation messages

**Files:**
- Modify: `src/web/src/pages/conversations/conversation-messages.tsx`

Add detection and rendering of `agent-config` blocks in assistant messages.

- [ ] **Step 1: Add imports at the top of conversation-messages.tsx**

Add after the existing imports (line 5):

```tsx
import { AgentConfigPreview, tryParseAgentConfig } from '@/components/agent-config-preview'
```

- [ ] **Step 2: Add agent config detection in the message rendering**

Inside the render function for each message, after the A2UI check (around line 74-89), add agent-config detection. Replace the content rendering block:

Find this block (lines 74-89):
```tsx
            {(() => {
              const a2ui = msg.role !== 'user' ? tryParseA2UI(msg.content) : null
              if (a2ui) {
                return (
                  <A2UIRenderer
                    message={a2ui}
                    onAction={(action, params) => {
                      // Send the action back as a new user message
                      const actionText = `[Action: ${action}] ${JSON.stringify(params)}`
                      onSend?.(actionText)
                    }}
                  />
                )
              }
              return msg.content
            })()}
```

Replace with:
```tsx
            {(() => {
              const a2ui = msg.role !== 'user' ? tryParseA2UI(msg.content) : null
              if (a2ui) {
                return (
                  <A2UIRenderer
                    message={a2ui}
                    onAction={(action, params) => {
                      const actionText = `[Action: ${action}] ${JSON.stringify(params)}`
                      onSend?.(actionText)
                    }}
                  />
                )
              }

              // Check for agent-config blocks
              if (msg.role !== 'user') {
                const agentConfig = tryParseAgentConfig(msg.content)
                if (agentConfig) {
                  // Render text before the code block + the preview card
                  const textBefore = msg.content.replace(/```agent-config[\s\S]*?```/, '').trim()
                  return (
                    <>
                      {textBefore && <div className="mb-3">{textBefore}</div>}
                      <AgentConfigPreview
                        config={agentConfig}
                        onModify={() => onSend?.('I want to modify this agent config')}
                      />
                    </>
                  )
                }
              }

              return msg.content
            })()}
```

- [ ] **Step 3: Verify the app compiles**

Run: `cd src/web && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/web/src/pages/conversations/conversation-messages.tsx
git commit -m "feat(frontend): render agent-config blocks as preview cards in chat"
```

---

### Task 4: Update "Create Agent" button to start a wizard conversation

**Files:**
- Modify: `src/web/src/pages/agents/agents-page.tsx`

Change the "Create Agent" button from creating a blank agent to starting a new conversation that triggers the create-agent skill.

- [ ] **Step 1: Replace the handleCreate function**

Find the existing handleCreate (lines 52-68):
```tsx
  const handleCreate = useCallback(async () => {
    const result = await api.post<{ agent: { id: string } }>('/agents', {
      id: `agent-${Date.now()}`,
      name: 'New Agent',
      role: '',
      description: '',
      goal: '',
      backstory: '',
      systemPrompt: '',
      capabilities: [],
      tools: [],
      constraints: [],
      tier: 'specialist',
      agentType: 'assistant',
    })
    navigate({ to: '/agents/$agentId', params: { agentId: result.agent.id } })
  }, [navigate])
```

Replace with:
```tsx
  const handleCreate = useCallback(async () => {
    // Create a new conversation and navigate to it — the first message triggers the create-agent skill
    const conv = await api.post<{ id: string }>('/conversations', {
      title: 'Agent Wizard',
    })
    navigate({ to: '/conversations/$conversationId', params: { conversationId: conv.id } })
  }, [navigate])
```

- [ ] **Step 2: Update the button icon import**

The `Plus` icon import at line 10 can stay — it's still used. No changes needed to imports.

- [ ] **Step 3: Verify the app compiles**

Run: `cd src/web && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/web/src/pages/agents/agents-page.tsx
git commit -m "feat(frontend): Create Agent button starts wizard conversation"
```

---

### Task 5: Write tests for AgentConfigPreview and tryParseAgentConfig

**Files:**
- Create: `src/web/src/components/__tests__/agent-config-preview.test.ts`

- [ ] **Step 1: Write tests for the tryParseAgentConfig parser**

```ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { tryParseAgentConfig } from '../agent-config-preview'

describe('tryParseAgentConfig', () => {
  it('should parse a valid agent-config block', () => {
    const content = `Here's your agent!

\`\`\`agent-config
{
  "name": "Data Analyst",
  "role": "Business Data Analyst",
  "description": "Analyzes data and presents findings.",
  "goal": "Extract actionable insights from data.",
  "backstory": "Experienced analyst.",
  "tier": "specialist",
  "agentType": "researcher",
  "systemPrompt": "You are a data analyst.",
  "capabilities": ["research"],
  "tools": ["bash", "file-read"],
  "constraints": ["Show data behind conclusions"],
  "model": "claude-sonnet-4",
  "maxTurns": 8
}
\`\`\``

    const result = tryParseAgentConfig(content)
    expect(result).not.toBeNull()
    expect(result!.name).toBe('Data Analyst')
    expect(result!.role).toBe('Business Data Analyst')
    expect(result!.tier).toBe('specialist')
    expect(result!.tools).toEqual(['bash', 'file-read'])
  })

  it('should return null for regular content without agent-config block', () => {
    const content = 'Just a regular message with no config.'
    expect(tryParseAgentConfig(content)).toBeNull()
  })

  it('should return null for malformed JSON in agent-config block', () => {
    const content = '```agent-config\n{ invalid json }\n```'
    expect(tryParseAgentConfig(content)).toBeNull()
  })

  it('should return null for agent-config missing required fields', () => {
    const content = '```agent-config\n{ "description": "no name or role" }\n```'
    expect(tryParseAgentConfig(content)).toBeNull()
  })

  it('should return null for regular code blocks', () => {
    const content = '```json\n{ "name": "test" }\n```'
    expect(tryParseAgentConfig(content)).toBeNull()
  })

  it('should extract config when surrounded by text', () => {
    const content = `I designed this agent for you:

\`\`\`agent-config
{
  "name": "Code Helper",
  "role": "Coding Assistant",
  "description": "Helps write code.",
  "goal": "Write clean code.",
  "backstory": "Senior dev.",
  "tier": "specialist",
  "agentType": "developer",
  "systemPrompt": "You write code.",
  "capabilities": ["code-analysis"],
  "tools": ["file-read", "file-write"],
  "constraints": ["Follow existing patterns"],
  "model": "claude-sonnet-4",
  "maxTurns": 10
}
\`\`\`

Want to change anything?`

    const result = tryParseAgentConfig(content)
    expect(result).not.toBeNull()
    expect(result!.name).toBe('Code Helper')
    expect(result!.agentType).toBe('developer')
  })
})
```

- [ ] **Step 2: Run tests**

Run: `cd /Users/eyssen/GitHub/eyas && bun test src/web/src/components/__tests__/agent-config-preview.test.ts`
Expected: All 6 tests pass

- [ ] **Step 3: Commit**

```bash
git add src/web/src/components/__tests__/agent-config-preview.test.ts
git commit -m "test: add tests for tryParseAgentConfig parser"
```

---

### Task 6: Verify full integration

**Files:** None (verification only)

- [ ] **Step 1: Run full test suite**

Run: `cd /Users/eyssen/GitHub/eyas && bun test`
Expected: All tests pass, no regressions

- [ ] **Step 2: TypeScript check**

Run: `cd /Users/eyssen/GitHub/eyas && bunx tsc --noEmit`
Expected: No type errors

- [ ] **Step 3: Manual verification checklist**

1. Start EYAS: `bun run src/main.ts serve`
2. Navigate to Agents page
3. Click "Create Agent" — should open a new conversation
4. Type "I want to create a code review agent" — AI should guide through the wizard
5. After 3-5 exchanges, AI generates an `agent-config` block
6. Preview card renders with agent details
7. Click "Create Agent" on the preview card — agent is created
8. Redirects to agent detail page with all fields populated

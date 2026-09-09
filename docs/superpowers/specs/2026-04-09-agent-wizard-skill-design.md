# Agent Creation Wizard Skill — Design Spec

**Date:** 2026-04-09
**Status:** Approved

## Problem

Clicking "Create Agent" creates a blank agent with empty fields. Users don't know what to write for goal, backstory, system prompt, tools, or constraints. The result is useless agents that get lost in the list.

## Solution

A **bundled skill** (`create-agent`) that turns any conversation into an AI-guided agent design session. The AI asks focused questions, proposes defaults from existing templates, and generates a complete agent configuration that the user previews and confirms.

### Why a Skill (not a wizard mode)

- Any conversation can trigger agent creation — not locked to a special route
- Sub-conversations can suggest "you need a specialist agent for this" and invoke the skill
- The "Create Agent" button is just a shortcut: new conversation + skill trigger
- Follows existing skill infrastructure (markdown + YAML frontmatter, trigger patterns, skill matcher)

## Architecture

### Components

1. **Skill file** (`config/skills/create-agent.md`)
   - YAML frontmatter: name, description, trigger_patterns, capabilities
   - Markdown body: detailed instructions for the AI on how to guide agent creation
   - References the 16 existing agent templates as archetypes

2. **Frontend: Agent config preview** (in `conversation-messages.tsx`)
   - Detects ` ```agent-config {...}``` ` JSON blocks in assistant messages
   - Renders a preview card with agent details (name, role, goal, tier, tools, etc.)
   - "Create Agent" / "Modify" buttons
   - On confirm: POST to `/api/v1/agents` and navigate to agent detail page

3. **Frontend: "Create Agent" button** (in `agents-page.tsx`)
   - Creates a new conversation via POST `/api/v1/conversations`
   - Sends an initial message like "I want to create a new agent" (triggers the skill)
   - Navigates to the conversation page

### Skill Content Design

The skill instructs the AI to follow this flow:

#### Phase 1: Discovery (1-2 messages)
- "What kind of agent do you need? What should it do?"
- If user is vague: offer archetypes from existing templates
  - Assistant, Engineer, Reviewer, Critic, Researcher, Planner, etc.
- Use binary/multiple-choice questions when possible

#### Phase 2: Refinement (2-3 messages)
- Clarify tone/style: "formal or casual?", "concise or detailed?"
- Ask about constraints: "what should it NOT do?"
- Ask about tools: suggest relevant tools based on the role
- Ask about model preference if relevant (opus for complex tasks, sonnet for fast)

#### Phase 3: Generation
- Generate a complete agent config as a ` ```agent-config``` ` JSON block
- Include ALL required fields: id, name, role, description, goal, backstory, tier, agentType, systemPrompt, capabilities, tools, constraints, model, maxTurns
- The system prompt should be structured with sections (role, rules, format, edge cases)
- Show a brief "here's what I designed" summary before the JSON block

#### Phase 4: Iteration
- User can say "change the tone" or "add web-fetch tool" etc.
- AI regenerates the config block with modifications
- Cycle continues until user confirms

### Agent Config JSON Format

```json
{
  "id": "custom-analyst",
  "name": "Data Analyst",
  "role": "Business Data Analyst",
  "description": "Analyzes data and presents findings with evidence.",
  "goal": "Extract actionable insights from data through rigorous analysis.",
  "backstory": "Experienced analyst who transforms raw data into decisions...",
  "tier": "specialist",
  "agentType": "researcher",
  "systemPrompt": "## Role\nYou are a data analyst...\n\n## Rules\n...",
  "capabilities": ["research", "code-analysis"],
  "tools": ["bash", "file-read", "search"],
  "constraints": ["Show data behind every conclusion", "Flag insufficient data"],
  "model": "claude-sonnet-4",
  "maxTurns": 8,
  "avatar": "",
  "monthlyTokenBudget": 0
}
```

### Trigger Patterns

```yaml
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
```

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `config/skills/create-agent.md` | **Create** | Skill with full agent-design instructions |
| `src/web/src/pages/conversations/conversation-messages.tsx` | **Modify** | Parse `agent-config` blocks, render preview card |
| `src/web/src/pages/agents/agents-page.tsx` | **Modify** | "Create Agent" button creates conversation + navigates |
| `src/web/src/components/agent-config-preview.tsx` | **Create** | Preview card component for agent configs |

## Out of Scope

- Agent template browsing UI (future: separate template gallery)
- Wizard-specific conversation mode (`mode: 'wizard'` exists but not needed)
- Auto-triggering from sub-conversations (future: needs conversation-level skill awareness)
- Editing existing agents via skill (future: "modify agent X")

## Success Criteria

1. "Create Agent" button opens a conversation where AI guides through agent design
2. AI asks 3-5 focused questions, offers archetypes when user is unsure
3. AI generates a complete, valid agent config JSON block
4. Frontend shows a preview card with "Create" / "Modify" actions
5. Confirming creates the agent and navigates to its detail page
6. Skill is triggerable from any conversation via natural language

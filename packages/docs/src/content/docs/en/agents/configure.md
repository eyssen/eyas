---
title: Create & configure
description: Agent detail Configuration tab — every field explained.
---

**Route:** `/agents/:id` → tab **Configuration**.

Also shows **Token Budget** summary and **Executing…** when a run is active.

## Classification

| Field | Meaning |
|-------|---------|
| **Tier** | Primary / Team / Specialist (see [overview](/docs/en/agents/overview/)) |
| **Agent Type** | Assistant, Engineer, Developer, … |

## Persona block

| Field | Meaning |
|-------|---------|
| **Name** | Display name |
| **Role** | Short role line |
| **Description** | Longer description |
| **Persona** | Persona summary |
| **Goal** | What drives decisions (*What drives this agent's decisions*) |
| **Backstory** | Context that shapes approach (*…perspective*) |
| **Avatar** | Emoji (or image) shown in UI |
| **System Prompt** | Agent-level instructions (combined with layered prompts) |
| **Prompt coach** | AI coach for the system prompt (operating protocol only — not voice, not project domain) — [Prompts](/docs/en/ai/prompts/#prompt-coach) |

## Model & effort

| Field | Meaning |
|-------|---------|
| **Model** | Concrete model id, or **Auto (routing decides)** |
| **Reset to auto** | Clear override → routing |
| **Effort** | Auto / Low / Medium / High / Max |
| Effort hint | Higher = deeper reasoning, slower, more expensive |
| **Max Turns** | Hard cap on agent loop turns per run |

## Tools & constraints

| Field | Meaning |
|-------|---------|
| **Tools (comma-separated)** | Tool names this agent may call |
| **Capabilities (comma-separated)** | Capability tags (e.g. `research, coding`) |
| **Constraints (one per line)** | Hard rules (e.g. no destructive ops) |

### Coding agents (model-agnostic surface)

For implement/fix/review work, grant the first-class file tools so **any** model
(not only Claude Code) can edit without shell:

```
read_file, write_file, edit_file, grep, glob, git_status, git_diff, run_command, search_indexed, list_search_sources
```

| Tool | Use |
|------|-----|
| `read_file` / `edit_file` / `write_file` | Read and targeted edit under workspace/worktree |
| `grep` / `glob` | Find symbols and files |
| `git_status` / `git_diff` | Review helpers (read-only) |
| `run_command` | Tests/lint (red tier — approval / autonomy) |

**Existing agents** created before 0.8.6 do **not** auto-pick up new tools — add
them here (or re-seed from an updated template). Full catalogue:
[Tools](/docs/en/automation/tools/).

## Budget

| Field | Meaning |
|-------|---------|
| **Monthly Token Budget** | Cap for the month; **`0` = unlimited** |
| Token usage display | Used vs budget on list/detail |

## Actions

| Control | Meaning |
|---------|---------|
| **Save Changes** | Persist configuration |

## Memories tab (read-only list)

| Element | Meaning |
|---------|---------|
| **Episodic / Working** | Memory tier labels |
| **N memories** | Count |
| **salience** | Importance score |
| **accessed N×** | Access count |
| Empty hint | Fills as the agent works |

## Channels tab (summary)

Bind channel instances so inbound messages reach this agent. Full field list: [Channels overview](/docs/en/communication/channels/) and agent channels UI:

| Control | Meaning |
|---------|---------|
| **Bind a channel instance** | Pick existing Telegram/… instance |
| **Bind to this agent** | Attach |
| **Unbind** | Detach |
| Status **Connected / Error / Credentials set / Not configured** | Instance health |
| Mode **Autonomous** | Channel may drive autonomous handling |

## Related

- [Identity & workspace](/docs/en/agents/identity-workspace/)
- [Voice profiles](/docs/en/agents/voice/)
- [Providers](/docs/en/ai/providers/)

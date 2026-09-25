---
title: Create & configure
description: Set an agent's name, model, tools, budget, and channel bindings.
---

**What this is for.** The **Configuration** tab is the stored identity of an agent: name, role, model, effort, tools, constraints, and monthly token budget. Workspace files and voice profiles are separate tabs. This is what you fill in when you create someone, and what you change when their job shifts.

## When to use it

- You are creating an agent and need a name, type, model, and tool list.
- You want a coding agent on an API model to get `read_file` / `edit_file` / `grep` without depending on a CLI.
- A monthly token cap should stop spend, or you need to clear it (`0` = unlimited).
- Inbound Telegram (or another channel) should reach this agent.
- You want the prompt coach to tighten the system prompt — not voice, not project domain.

## Typical workflow

1. Open **Agents** → click the agent (or **Create Agent**) — route `/agents/:id`, tab **Configuration**. The **Create Agent** wizard conversation names no model: it runs on the install default, fixed on its first message.
2. Fill **Name**, **Role**, **Tier**, **Agent Type**, **Model** (a provider + model, or **Conversation's own model**), **Effort**, **Tools (comma-separated)**, **Constraints (one per line)**.
3. Set **Monthly Token Budget** if you want a cap. Bind a channel on the **Channels** tab if inbound should land here.
4. **Save Changes**. A new conversation with this agent uses this model, tool list, and prompt.

## Features

The page header shows the **Token Budget** summary and **Executing…** while a run is active. Tabs: **Configuration**, **Memories**, **Voice**, **Workspace**, **Channels**.

## Classification

| Field | Meaning |
|-------|---------|
| **Tier** | **Primary** / **Team** = colleagues you talk to; **Specialist** = shared spawn pool (see [overview](/docs/en/agents/overview/)) |
| **Agent Type** | **Assistant**, **Engineer**, **Developer**, **Reviewer**, **Critic**, **Researcher**, **Planner**, **Coordinator**, **Observer** |

## Persona block

| Field | Meaning |
|-------|---------|
| **Name** | Display name |
| **Role** | Short role line |
| **Description** | Longer description |
| **Goal** | What drives decisions (*What drives this agent's decisions*) |
| **Backstory** | Context that shapes the approach (*Context that shapes the agent's approach and perspective*) |
| **Avatar** | Emoji shown in the UI |
| **System Prompt** | Agent-level instructions (combined with the layered prompts) |
| **Prompt coach** | AI coach for the system prompt (operating protocol only — not voice, not project domain) — [Prompts](/docs/en/ai/prompts/#prompt-coach) |

<h2 id="model--effort">Model & effort</h2>

| Field | Meaning |
|-------|---------|
| **Model** | A provider plus a model, chosen from a list grouped by provider — or **Conversation's own model** (empty): the colleague then runs on the conversation's model — the delegating turn's model, or the install default fixed on first use (see [Teams & delegation](/docs/en/agents/teams/#which-model-and-effort-a-specialist-or-member-uses)) |
| Reset button | *Use the conversation's own model* — clears the model; saving really clears it |
| Red note | *&lt;provider&gt; / &lt;model&gt; is not an enabled model of an active provider. Until it is back, this colleague runs on the conversation's own model.* |
| **Effort** | The same Effort select as in conversations: only the levels the agent's model offers (from **None**, **Minimal**, **Low**, **Medium**, **High**, **Extra high**, **Max**; **On** / **Off** for an on/off model), with **Auto** first, showing the model's default (*Auto · model default (Medium)*). Picking a model that does not offer the saved level changes it before saving and says so (*Effort adjusted from Extra high to High: the selected model does not offer Extra high.*); a model without effort control changes it to Auto. A level the model does not support is not saved, and a message names the levels it does support — your other edits stay in the form. Without a fixed model, the select offers every level an Auto-routing tier model accepts. The colleague's effort applies wherever it runs — its chat, its home thread, channel replies, and as the inherited level of specialists it delegates to. See [Providers — Reasoning effort](/docs/en/ai/providers/#reasoning-effort). |
| Effort hint | *Reasoning effort for this colleague — only the levels its model offers are listed, and changing the model adjusts a level the new model does not offer. Auto = the model's own default.* |
| **Max Turns** | Hard cap on model round trips per run — for this colleague's chat turns and for its background, specialist, team and channel runs. On Claude Code, Grok and Kimi it is also the CLI's own turn cap. For an agent with no stored value the field shows 10, and saving stores the number shown. Without a stored value a chat turn allows 25 round trips, a background, team or channel run 20, and a specialist run 10. |

Saving other fields (name, prompt…) does not re-send the model, so an edit never fails because the model was switched off meanwhile.

**Upgrade.** On the first start after upgrading, each existing agent whose model id appears under exactly one provider in the model catalog gets that provider automatically. Model ids listed under several providers, unknown ids and tier names such as `sonnet` stay without a provider; they are matched to their owner at run time, and if that is not possible the conversation's own model is used.

<h2 id="tools--constraints">Tools & constraints</h2>

| Field | Meaning |
|-------|---------|
| **Tools (comma-separated)** | Tool names this agent may call. Placeholder: *Empty = all tools · e.g. read_file, grep, research*. Hint: *Empty = all tools. Applies in chat and on every provider — to a CLI model's own write, shell and web tools too. Memory search is always available; on a CLI model, reading files in the conversation's folders is too.* |
| **Capabilities (comma-separated)** | Capability tags (e.g. `research, coding`) |
| **Constraints (one per line)** | Hard rules (e.g. no destructive operations) |

### What the Tools list means

The list is applied the same way on every path an agent runs: interactive chat, scheduled and board runs of a conversation, specialists started with `run_specialist` / `delegate_to_agent`, team members, and channel replies (Telegram, Slack, e-mail and the other channels) — and on every provider: API models and the CLI models Claude Code, Grok and Kimi.

- **An empty list means every tool.**
- Otherwise the agent is offered **exactly the listed tools, plus `memory_search` and `memory_expand`**. Every agent always gets these two EYAS memory tools, even when its list omits them.
- In a **Solo** conversation, `run_specialist`, `delegate_to_agent`, `handoff_to_colleague` and `propose_team` are also removed; `memory_search`, `memory_expand` and `assign_task` (board work) stay.
- The tool inventory in the agent's system prompt names only the tools the run is actually offered.
- **A model can only use a tool it was offered.** If a model names a tool outside the list, or one that does not exist, EYAS refuses the call with *'&lt;tool&gt;' is not in this agent's toolset* and does not run it. There is no approval prompt; it is refused outright, on every provider.
- **Unknown names are dropped.** A name that is not an installed tool (a typo, a disabled module, an MCP server that is not connected) is not offered, and the server log shows one warning per agent and tool name.
- **On the CLI models (Claude Code, Grok, Kimi) the list also limits the CLI's own built-in tools**, the same way for every CLI:
  - **Writing files** (Claude Code's Write, Edit, NotebookEdit; Grok's and Kimi's edit and move tools, and file writes EYAS serves to the CLI): only when the list contains `write_file` or `edit_file`.
  - **Shell commands** (Claude Code's Bash; Grok's and Kimi's execute tools; a delete counts as a shell command, as the security gate classifies it): only when the list contains `run_command`. `git_status` and `git_diff` do not grant the shell; on a list without `run_command` they are offered to the CLI as EYAS tools over the bridge instead.
  - **Web fetch and web search** (Claude Code's WebFetch, WebSearch; Grok's and Kimi's fetch tools, Grok's web_fetch and web_search): only when the list contains a web tool — `research`, `browser_navigate`, `agent_browser_run` or `browser_use_exec`.
  - **Reading files** (Claude Code's Read, Glob, Grep; Grok's and Kimi's read, search and list tools) is always allowed, whatever the list says. It stays inside the conversation's folders under the memory policy and the kernel file sandbox. Memory search stays available too.
  - An empty list still means every tool, the CLI's own tools included.

  On Claude Code the withheld tools are not offered to the model at all. On Grok and Kimi, a withheld tool the CLI tries to use is refused by EYAS before the security gate is asked: no approval prompt, and the tool row shows **Denied**. Kimi's permission requests do not say what kind of tool is asking (from the Kimi 1.52.0 source; not yet verified on a host), so an agent whose list lacks either the file-write tools or `run_command` cannot use any of Kimi's asking tools (file write or replace, shell, background tasks). Kimi's web search and fetch never ask EYAS, so they cannot be allowed per agent; EYAS's isolation check still stops a turn that uses them. See [Providers — Claude Code isolation](/docs/en/ai/providers/#claude-code-isolation).
- Over the EYAS bridge — Claude Code's in-process server and the Grok/Kimi MCP bridge alike — the list governs the EYAS tools the CLI reaches. EYAS tools for which the CLI has a granted equivalent of its own (`read_file`, `grep`, `glob` always; `write_file`, `edit_file` while it may write; `run_command`, `git_status`, `git_diff` while it may use its shell) are not bridged: the CLI uses its own tools under the security gate, the memory policy and the kernel file sandbox. The EYAS browser, agent-browser, browser-use and OpenCode tools reach CLI models too. See [MCP — CLI tool parity](/docs/en/ai/mcp/#cli-mcp-tool-parity-grok--kimi).

**Behaviour change for existing agents:** a narrow list is honoured everywhere. For example, the **Personal Assistant** gets no `run_command` / `write_file` in chat, background, specialist or team runs, as its template says — and on Claude Code, Grok and Kimi it can no longer write files or run commands through the CLI's own Write, Edit or Bash either. To grant a tool, add it to the list (`write_file` / `edit_file` for writing, `run_command` for the shell), or clear the list to allow all tools. Agents whose list names tools that do not exist lose those names (with a warning in the log), and a model that calls a tool outside its offered list gets a denial.

### Coding agents (model-agnostic surface)

For implement/fix/review work on an API model, grant the first-class file tools so the model can edit without a shell:

```
read_file, write_file, edit_file, grep, glob, git_status, git_diff, run_command, search_indexed, list_search_sources
```

| Tool | Use |
|------|-----|
| `read_file` / `edit_file` / `write_file` | Read and targeted edit under the working folders or worktree |
| `grep` / `glob` | Find symbols and files |
| `git_status` / `git_diff` | Review helpers (read-only) |
| `run_command` | Tests/lint (red tier — approval / autonomy) |

The CLI models (Claude Code, Grok, Kimi) use their own file and shell tools instead, and these names in the list are what allows them: `write_file` / `edit_file` unlock the CLI's own file writes and `run_command` its shell. Without `run_command`, `git_status` and `git_diff` reach a CLI over the bridge as EYAS tools.

The **Personal Assistant** (primary, type assistant) is a coordinator — do not give it `write_file` / `edit_file` / `run_command`. The **System Engineer** and the coding specialists own those tools. See [Teams & delegation](/docs/en/agents/teams/).

**Existing agents** created before 0.8.6 do **not** pick up new tools automatically — add them here (or re-seed from an updated template). Full catalogue: [Tools](/docs/en/automation/tools/).

<h2 id="imported-personas">Imported personas</h2>

Agents can come from persona files in the folders listed under `agent.importRoots` in `local.yaml` (see [Configuration — Extra skill and persona roots](/docs/en/deploy/configuration/#extra-skill-and-persona-roots)). An agent you edit in EYAS is **never overwritten** by its file:

- On first start, a file creates its agent.
- Later changes to the file update that agent only while its **name, role, description, system prompt and tools** are exactly as the last import left them. After you edit any of those five here, the file no longer changes the agent.
- Changing only its model, effort, on/off switch, avatar, tags or budget does not stop updates, because the import never writes those.
- An imported agent you delete is not created again. To get it back, import the file with [Data import](/docs/en/admin/data-port/).
- An existing agent with the same id that the import did not create — a built-in template, one made in the UI, or one from the data import — is never overwritten. If it already matches the file exactly, it is taken over and follows later file changes.
- If two import folders contain a persona with the same id, the folder listed first wins; if that file is removed, the next folder's file takes over.

**Upgrade.** Agents imported by earlier versions and not edited since are taken over automatically. Ones you edited stay exactly as they are.

## API (integrators)

- `PATCH /api/v1/agents/:id` validates its body like create: unknown fields such as `source` or `id` are ignored, invalid values return `400` with details (an unsupported effort returns code `EFFORT_UNSUPPORTED` with the model's supported `levels`), and an unknown agent returns `404`.
- `POST` / `PATCH /api/v1/agents` accept `provider` together with `model`. The pair must be an enabled model of an active provider; otherwise the answer is `400` with `code: model_binding_unavailable`, `providerId` and `modelId`, and nothing is saved. `provider` without `model` → `400`.
- `model` alone (the older shape) is still accepted; its provider is filled in when exactly one provider lists the model id.
- `provider: null, model: null` (or an empty model) clears both. `GET` responses include `provider`.

## Budget

| Field | Meaning |
|-------|---------|
| **Monthly Token Budget** | Cap for the month; **`0` = unlimited** |
| Token usage display | Used vs budget on the list and in the header |

## Actions

| Control | Meaning |
|---------|---------|
| **Save Changes** | Persist the configuration |

## Memories tab (read-only list)

| Element | Meaning |
|---------|---------|
| **Episodic / Working** | Memory tier filter |
| *N memories* | Count |
| *salience: N* | Importance score |
| *accessed N×* | Access count |
| *First N of M characters — the whole memory is stored* | A long memory is shortened in the list only |
| Empty hint | *Memories will appear here as the agent interacts and learns.* |

## Channels tab (summary)

Bind channel instances so inbound messages reach this agent. Full field list: [Channels overview](/docs/en/communication/channels/).

| Control | Meaning |
|---------|---------|
| **Bind a channel instance** | Pick an existing Telegram/… instance |
| **Bind to this agent** | Attach |
| **Unbind** | Detach |
| Status **Connected / Error / Credentials set / Not configured** | Instance health |
| Mode **Autonomous** | The channel may drive autonomous handling |

## Related

- [Identity & workspace](/docs/en/agents/identity-workspace/)
- [Teams & delegation](/docs/en/agents/teams/)
- [Voice profiles](/docs/en/agents/voice/)
- [Providers](/docs/en/ai/providers/)

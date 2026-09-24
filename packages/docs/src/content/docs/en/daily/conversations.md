---
title: Conversations
description: Chat with agents — send work, attach designs, and steer orchestration from one thread.
---

**What this is for.** A conversation is the place you talk to an agent. Messages go in the main pane; project, stage, sources, files and runtime live in the right-hand column. The same thread is a Board card, so chat and pipeline stay one record.

## When to use it

- You want an agent to do a job and see the reply, tool calls and progress in one place.
- You need to pin which indexed code tree (Odoo version, addons) this thread may search, and which **working folders** file tools may touch.
- You want to choose which model the conversation answers with — a fixed model, Auto-routing, or the colleague's default (the model picker in the top bar).
- A matched skill is waiting — you accept it, skip it for this thread, or turn it off globally.
- You want the model to write a plan and wait before any tool runs (**Plan first**).
- You want several models to race the same task (**God Mode**), or colleagues to bring in specialists (`run_specialist`) without a team card.
- You want a design canvas to travel with every turn, or the Prompt Enhancer to shape the draft before you send it.

## Typical workflow

1. Open a **colleague** from the sidebar **Colleagues** list (their home thread), click **New Conversation** (**Main** section), or open a card from **Board** / Home **Recent conversations**. Route `/conversations/:id`.
2. Set **Project**, **Stage** and the agent before the first message (the agent locks after that). The agent select lists your **Primary** and **Team** colleagues. Pin **Sources** if several code trees are indexed. Check **Working folders** — a new thread inherits the project's list (or the project type's list when the project has none).
3. Type in the composer. Use the **Prompt Enhancer** if the draft needs shaping; the map icon is **Plan first** (write a plan and wait before tools). Attach files, or attach **Designs** from the top bar.
4. If a skill-proposal card appears, choose **Use it**, **Not this time** or **Turn it off**. Send. The reply streams with live tool rows, the *Provider · model* caption under it, and the thin context bar showing how full the model's window is. **Stop** cancels the run.

## Features

Layout: the **top bar** and the **fields bar** above the **messages + composer** (main pane); on the right, the **Runtime** strip (run tree, agent progress, sub-conversations) above the **context rail** (chatter: history, sources, folders, next steps, files).

## Conversation status

| Status | Meaning |
|--------|---------|
| **Idle** | No active agent run |
| **Working…** | The agent is running |
| **Waiting** | Waiting for user or external input |
| **Waiting approval** | Blocked on a human approval (security / autonomy) |
| **Waiting on plan** | Plan-first turn: the plan card waits for **Approve** / **Skip plan** / **Reject** |
| **Archived** | Closed / archived thread |

---

## Top bar

From left to right: the back arrow, the title (click it to rename — see [Automatic title](#automatic-title)), the status badge, the colleague's name, a help icon, the priority, the OpenCode terminal icon, the **Designs** icon, the voice scope and the model picker. The thin bar along the top edge is the context bar ([Context composition](#context-composition)).

| Control | Meaning |
|---------|---------|
| **Low / Normal / High / Urgent** | Business priority of the conversation (also shown on Board) |
| Terminal icon (*OpenCode terminal*) | Opens an OpenCode terminal for this conversation above the right-hand rail — see [OpenCode](/docs/en/automation/opencode/) |
| **Designs** (shapes icon) | Canvases that travel with every turn — see [Attached designs](#attached-designs) |
| **Voice: …** | The active voice scope and its override — see [Voice scope](#voice-scope) |
| **Model** (right side) | Click to choose how this conversation picks its model. It has a search box (*Search models…*) and three kinds of choice: **Fixed model** — every enabled model of an enabled provider, grouped as *Fixed model · &lt;provider&gt;* (for example *Fixed model · Claude Code CLI*); **Auto-routing** — EYAS picks a model for each message; **Colleague default (&lt;model&gt;)** — only on a conversation with a colleague and on sub-conversations. |
| *Default model — fixed on the first message* | A new conversation without a colleague: the current default model is fixed on it with the first message and stays when the defaults change later |
| Tooltip | Which model answers the next message and why, for example *Answers with Claude Code CLI / sonnet — the model fixed on this conversation*. Other reasons: the colleague's own model; the model of the conversation that delegated this one; Auto-routing picks the model for each message (shown: the Standard tier); the default model |
| Warning icon | A fallback applies (the colleague's model or the conversation's own model is not available, or Auto-routing is off or has no tier), or no model can answer. Hover it for the reason |
| Greyed **Auto-routing** | Auto-routing is not allowed: *switch on “Allow Auto-routing” under Providers.* |
| Dimmed picker | God Mode is on: *God Mode uses the Settings roster* |

Provider names are the same everywhere in the app — in the picker, the reply caption, error messages and the Providers page.

### Which model answers {#which-model-answers}
A conversation keeps the model it runs on; messages are not re-routed one by one. You choose how in the model picker (above).

- **Fixed model.** A conversation fixed to a model always answers with it. A new conversation without a colleague that names no model gets the install default — the Standard routing tier, else the default provider, else the first active provider with a model, CLIs included — on its **first message**, and keeps it from then on. Changing the default provider or the routing tiers later does not move existing conversations. Conversations created earlier keep the provider and model already stored on them; an old conversation without a stored model gets the current default on its next message.
- **Colleague default.** A conversation with a colleague, and a sub-conversation, follows the colleague's own model; else the model of the conversation that delegated it; else the default model, fixed on its first message. A specialist started with `run_specialist` / `delegate_to_agent`, a card handed out with `assign_task` and a sub-conversation made with `create_sub_conversation` run on the model **the delegating turn actually ran on** — not a copy of the parent's saved settings. A colleague's home thread opened by a hand-off follows the colleague's model, not the model of the conversation that handed off. If the colleague's model is not available (its provider is switched off or the model is disabled), the conversation falls back to its stored or default model and the reply records the note `agent-binding-unavailable`; EYAS never picks some other provider by name.
- **Auto-routing** is a per-conversation choice. Only a conversation set to Auto is triaged: its message is classified and routed to the Quick, Standard, Complex or Code tier. The **Allow Auto-routing** switch on the Providers page only *allows* it; while it is off the picker entry is greyed out, and an existing Auto conversation uses its stored model and says so. Existing conversations are not switched to Auto automatically. See [Routing & budget](/docs/en/ai/routing-budget/#auto-routing).
- **A model you pick is never swapped silently.** If a model you chose in the picker later becomes unavailable (it or its provider is switched off, or a CLI stops offering it), EYAS does not answer with another model: the message is refused and not stored, with *The model &lt;provider&gt; / &lt;model&gt; is not available: it, or its provider, is switched off. Choose another model in the model picker at the top of the conversation, or enable it under Providers.* The picker shows the model in red with the same reason, and choosing another model fixes it. Background card runs on such a conversation fail the same way.
- **Models EYAS fixed by itself fall back with a note.** The default fixed on the first message, conversations from before the picker existed, and a sub-conversation's delegating model: when one of these is unavailable, the conversation answers with the default model and says so (warning icon and tooltip). It switches back automatically once its own model returns. Only when there is no default either is the message refused (code `model_binding_unavailable`). With no model configured at all, the run fails with *No model is configured…* (code `no_model_configured`) and is not retried.

**Who answered.** Every assistant reply shows a small caption *Provider · model* (for example *Grok CLI · grok-4*). Its tooltip reads *Answered by …* and adds why that model was used and any fallback. If a failover answered with another model, the caption names the model that actually answered. A reply that is still streaming shows the model as soon as the turn starts; God Mode replies show the winning model.

**Context is kept across a switch.** Switching provider or model keeps the conversation's context. EYAS sends the whole conversation from its own store on every turn; no provider — Claude Code, Grok CLI and Kimi Code CLI included — keeps or resumes a session of its own. See [Providers — Conversation continuity](/docs/en/ai/providers/#conversation-continuity).

**API (integrators).** `POST /api/v1/conversations` stores `providerId` + `modelId` only if both name an enabled model of an active provider (otherwise nothing is stored and the default is fixed on the first message), and accepts an optional `modelBinding` (`pinned` | `auto` | `inherit`; `inherit` needs a colleague, else `400 binding_inherit_needs_agent`) and an optional starting `effort`. `POST /api/v1/projects/:id/conversations` (a card on a project board) applies the same rule. `PATCH /api/v1/conversations/:id` accepts `modelBinding` and `providerId` + `modelId`, always sent together and validated (`400 model_binding_unavailable` for an unknown or disabled model); a PATCH that sends a pair marks it as your choice (a flag the client cannot set directly). `GET` returns `effectiveBinding` (provider, model, why, and image support) and `autoRoutingEnabled`, and the live stream announces the binding when a turn starts. A one-turn provider + model override on `POST …/messages` must send both. Conversation objects no longer include `sdkSessionId`, and a `PATCH` that sends one is ignored.

### Context composition {#context-composition}
The thin bar along the top of the conversation is clickable — it opens the **Context composition** panel for the current turn: every section that went into that turn's prompt, in the order it was assembled, with its size, whether it was truncated, and its raw content. This is per turn, not a running total for the whole conversation.

The **turn** zone holds what is attached to your message rather than to the system prompt: **turn-time** (the current date and time) and **memory-recall** (the recalled-memory block, its ids and its budget). The runtime section no longer carries the date and time, and the old *memory-index* and *related-work* sections are gone. See [Memory — How recall reaches the model](/docs/en/knowledge/memory/#how-recall-reaches-the-model).

Section sizes follow the model that answers the turn — fixed or auto-routed — so whether a section was truncated depends on that model's context window. A large-window model gets more room for project context and agent files; a small local model gets a prompt that still leaves room for the conversation. See [Prompts — sized for the model](/docs/en/ai/prompts/#prompt-size). In an agent loop, the panel reflects the last model call of the turn.

**How full the window is.** The bar shows how full the model's context window really is:

- **Measured.** When the provider reports the prompt size of the last model call, the bar uses that number and its tooltip says *measured* (Anthropic and Anthropic-compatible, the OpenAI family including OpenRouter, Kimi API and LM Studio, Gemini, and Claude Code).
- **Estimated.** Otherwise it shows an estimate, marked with `~` and *estimated*: the system prompt plus the conversation history sent with the turn. Ollama, Grok CLI and Kimi Code CLI always show the estimate (Ollama leaves out the part it reuses from its cache; the Grok and Kimi CLIs report a total over their internal steps).
- **The window** is the selected model's own, on every provider: the window listed for the model under Providers wins, so a CLI model listed with a 1M window uses 1M. When the runtime reports the window of the model that answered (Claude Code does), that wins. The CLIs' fixed windows (Claude Code 200k, Grok 500k, Kimi 256k) are only the fallback for a model the list has no window for. Claude Code's Fable, Opus, Sonnet and Haiku entries list 200k — the window the runtime gives these names — also before the runtime has reported its models; only an entry the runtime offers as its 1M variant (for example *Opus (1M context)*) is listed at 1M. After you switch the conversation to another model, the bar uses the new model's window at once.
- The colours (under 50% / under 75% / 75% and above) follow the theme's success, warning and destructive colours. The same number drives the board card's *% context* stripe. Older turns show their estimate until the next turn.

**Privacy per section.** Each recorded prompt section has a privacy badge:

| Badge | Meaning |
|-------|---------|
| *masked N · &lt;types&gt;* | Values were replaced with placeholders such as `[EMAIL]` before the model saw them (for example *masked 2 · Email address, IBAN*) |
| *not scanned (EYAS-generated)* | Identity, rules, the runtime clock, working folders, tool/skill/agent lists and the orchestration directive are sent as they are |
| *nothing masked* | The section was scanned and nothing needed masking |
| *local destination — not masked* | The model runs on this machine (loopback or a host listed under Privacy → local hosts), so nothing is masked on purpose |
| No badge | Nothing was recorded for the section: sections sent inside your message (the per-turn memory block), sections that could not be located in the prompt (they are still scanned, with the rest of the system text), and turns from before masking was recorded |

When something was masked, an **As assembled / As sent to the model** toggle appears; *As sent to the model* shows the section with the placeholders exactly as the model received it. A line names the privacy policy version used (*Privacy policy regex@2/policy@N*), and a line *Masked memory tool results: memory_search (2), …* lists memory tool results that had values masked — including results Claude Code, Grok and Kimi fetched over the EYAS tool bridge. See [Security & privacy — Where masking applies](/docs/en/admin/security-privacy/#where-masking-applies).

**Memory delivered.** A box shows what memory reached the model, the same way whatever answered the turn (API providers, Claude Code, Grok, Kimi or a local model), one line per fact:

- *Sized for &lt;model&gt; · &lt;N&gt;-token window* — the model the prompt and memory budget were sized for; *window unknown, 100k-token baseline used* when EYAS does not know that model's window.
- *&lt;hits&gt; items recalled (&lt;expanded&gt; in full) · &lt;tokens&gt; / &lt;budget&gt; tokens* — the recalled-memory block attached to this message (standing notes plus items retrieved for it), how many had their full text attached, and the block's estimated size against its cap for this window. Otherwise *No memory was recalled for this message*, or *Recall withheld: &lt;reason&gt;* — the answer goes to someone other than you (an A2A peer or an external-voice channel reply); the model's context window leaves no room; there is no memory to recall from here; recall failed and the turn carried only the time.
- *Drill-down: &lt;calls&gt; of &lt;limit&gt; calls this turn · &lt;items&gt; items read* — the model's own `memory_search` / `memory_expand` / `search_memory` calls in this turn against the per-turn cap of 3 (the same on every provider), counted up to the last call that found something. Turns recorded before calls were counted show *items read* only. *Drill-down unavailable: the memory tools do not reach this model* when the model cannot call tools or the CLI tool bridge failed its self-test.
- *System prompt: …* (Grok and Kimi only) — *delivered as the system prompt (verified)*, *sent as the system prompt (not verified)*, or *carried inside the message*.

The box does not appear for turns recorded before it existed, or when no prompt was assembled. Like the rest of the per-turn detail, it is kept for 7 days by default, then purged. The **Memory delivery by provider** card on [Observability → Context](/docs/en/admin/observability/) compares this delivery across providers.

### Automatic title {#automatic-title}
A new conversation starts with the first words of your message as its title; a short model call may then replace it with a better one. That call runs only on the **Heartbeat** routing tier, as an isolated call, and is never billed to the conversation's own model or any other provider. When the Heartbeat tier has no eligible model (for example on a Grok-only or Kimi-only install before their isolation is verified), the first-message snippet stays the title. Click the title to rename it yourself.

### Voice scope {#voice-scope}
| Control | Meaning |
|---------|---------|
| **Voice: INTERNAL / EXTERNAL / AUTO** | Which voice profile is active ([Voice profiles](/docs/en/agents/voice/)); *(default)* after AUTO means the agent's default applies, with no override |
| Select (*Override voice scope*) | **Auto**, **Force: Internal** or **Force: External** |

---

## Conversation fields (context)

The fields bar under the top bar holds, from left: project, working folders, agent, stage, effort, orchestration and due date. Assignees and tags appear when the conversation has them.

| Field | Meaning |
|-------|---------|
| **Project:** | Owning project, grouped by project type (*None* if unset). Changing the project **re-applies that project's default code sources** on the Sources tab (unless you set sources explicitly in the same update) and replaces the working-folder list. Before the first message, it also selects the project's default agent. |
| **Working folders** | Which named roots this thread may read and write; the select pins which one is **primary** (cwd). A thread with no folders of its own works in its own **EYAS workspace** (see [Folders](#working-folders)); **No folder** appears only when the workspaces location cannot be written. Edit the list on the rail's **Folders** tab. |
| Agent | Assigned colleague — **locked after the first message** (*Agent cannot be changed after first message*). The chat offers only this colleague's **Tools** list plus `memory_search` and `memory_expand` (without a colleague, the project's default agent's list); an empty list, or no agent at all, means every tool. The list applies on every provider, and a model cannot run a tool it was not offered. See [Agents — Tools](/docs/en/agents/configure/#tools--constraints). |
| **Stage:** | Stage within the project pipeline |
| Effort | Reasoning depth. The select lists only the levels the conversation's model offers (from None, Minimal, Low, Medium, High, Extra high, Max; an on/off model shows Off / On). **Auto** stores nothing and names what it inherits — *Auto · Max (Deep)*, *Auto · High (colleague)*, *Auto · Extra high (delegating conversation)*, or *Auto · model default (Medium)*. Higher = deeper, slower, more expensive. A level the model does not support is not saved, and a message lists the levels it does support. When the model changes, the stored level stays; one the new model lacks shows as *Extra high → High (… does not offer Extra high)* and each turn is adjusted. See [Providers — Reasoning effort](/docs/en/ai/providers/#reasoning-effort). |
| **Orchestration: …** | **Solo** = no specialists, hand-offs or team proposals, on every provider (on CLI models the EYAS bridge included): `run_specialist`, `delegate_to_agent`, `handoff_to_colleague` and `propose_team` are not offered; memory tools and `assign_task` stay. **Auto** = the model brings in specialists when needed. **Deep** = aggressive `run_specialist` fan-out; Deep sets the default effort to Max, and specialists without their own effort inherit it. Every model gets the same Deep instruction: split non-trivial work, run one specialist per independent slice in parallel with a precise, self-contained brief, hand off to the colleague who owns a job, propose a team only when a needed specialist does not exist yet, verify important results and keep the final synthesis. The last item, **God Mode**, races the same task on the Settings roster (see [God Mode](#god-mode)). |
| Due date | Deadline of the conversation (also a tracked business field) |

### Complexity indicators

When the conversation does not run in the simple mode, a badge under the fields bar shows its mode, with the complexity class next to it when known.

| Badge | Meaning |
|-------|---------|
| **Managed** | Structured / supervised path |
| **Autonomous** | Higher-autonomy path |
| **Wizard** | Wizard-assisted flow |

---

## Message stream

| Control / label | Meaning |
|-----------------|---------|
| *Start a conversation…* | Empty state |
| **Thinking / Thinking…** | The model is reasoning (may show a character count) |
| *Composing response…* | The reply is streaming |
| *Running tools…* | One or more tools are in flight |
| **Stop** | Cancel the current run |
| *Agent is working in the background…* | You left the page and came back while the agent was still working — messages appear when ready |
| Attachment | Inline image or file from the thread (*Open this file*) |

### Tool trace {#tool-trace}
Each tool call is a live row in the stream: tool name, a short argument preview, a short result, duration, and an icon with its status. Click the row to expand it.

Rows look the same on every provider — API providers, Claude Code, Grok CLI and Kimi Code CLI. They use EYAS's common tool names (`read_file`, `run_command`, `edit_file`, …, or an EYAS tool's own name such as `memory_search`), show the call's input and its output (very long output is cut at 64 KiB and marked), its duration, and a diff for file edits. When the provider's own name for a tool differs from EYAS's (for example Claude Code's *Edit* for `edit_file`), hovering the tool name shows it (*Provider's tool name: …*). A failed call's error text is shown once.

| Status | Meaning |
|--------|---------|
| **Running** | The call is in flight |
| **Succeeded** | The tool ran and reported back |
| **Failed** | The tool ran and returned an error |
| **Denied** | Refused — by the security gate, the memory policy (a search too broad included), or because the model named a tool it was not offered, or a CLI's own tool the agent's **Tools** list withholds |
| **Needs approval** | Waiting for a human decision (see [Approvals in the chat](#approvals-in-the-chat)) |
| **Skipped** | Never ran — the tool-call budget, the per-turn limit, or a repeat on a resumed run |
| **Outcome unknown** | The row was still open when the turn ended |

A row is marked done only when the tool actually reported back; a denied, waiting or skipped call is never shown green. See [Providers — Same chat on every provider](/docs/en/ai/providers/#same-chat-on-every-provider).

**A refused call ends a Grok answer.** When EYAS refuses one of Grok's tool calls — for example a read of memory outside EYAS — Grok ends that answer: the chat shows the **Denied** row and nothing after it. Grok's model does not see EYAS's reason, so ask again without that step. Claude Code instead continues and receives the reason (*Memory outside EYAS … use memory_search / memory_expand from EYAS*). Observed with Grok CLI 1.0.41; see [Providers — Grok CLI and Kimi Code CLI](/docs/en/ai/providers/#grok-cli-and-kimi-code-cli).

**A search refused as too broad.** When a CLI's own search (Grep, Glob, a recursive shell command) starts in a folder that also holds a protected place, it is refused, and the **Denied** row says so in your language: *Search too broad: the folder also holds another tool's memory, which only EYAS may read. The model was asked to search a narrower folder.* — or EYAS's own data, the CLI sign-ins EYAS keeps, or another conversation's workspace. Claude Code gets the reason and can retry on a narrower folder; Grok ends its answer, so ask again naming a narrower folder. See [Security & privacy — Memory outside EYAS](/docs/en/admin/security-privacy/#memory-outside-eyas).

**EYAS tools on Grok.** The row of an EYAS tool Grok called shows the arguments the tool actually received, not Grok's internal `use_tool` wrapper (`tool_name`, `tool_input`, `variant`).

| Label | Meaning |
|-------|---------|
| **Diff** | File edits (`edit_file` / `write_file`) show a unified diff in the thread — not only the model's prose |
| **Input / Output / Error** | The raw payload, when there is no file diff or you need it |

Nothing on this row is a permission grant. Yellow and red tools still wait on [approval](/docs/en/agents/autonomy/). Read-only `git status` / `git diff` (also when the model sent them as `run_command`) do not ask for a click — see [Tools](/docs/en/automation/tools/).

### Turn outcome {#turn-outcome}
Under each assistant reply, next to who answered and the effort chip, a badge appears when the turn did not simply complete:

| Badge | Meaning |
|-------|---------|
| **Turn limit reached** | The turn used up its turn budget (see [Agent progress](#agent-progress)) |
| **Output limit reached** | The answer hit the model's output-token limit |
| **Declined by the model** | The model refused |
| **Tool budget used up** | The turn's tool-call budget ran out |
| **Stopped** | You pressed Stop |
| **Failed** | The turn failed; the tooltip names what went wrong (for example the rate limit) |
| **Waiting for approval** | A tool call waits for a human decision |

The answer written so far is always kept; the badge tooltip says so (*The turn ended early; the answer so far is kept.*). The reply also shows tokens as *N in · N out*, where *in* is the whole prompt, cached parts included, and the cost: *$x* when the provider reported it, *~$x* when EYAS estimated it from the token counts (the tooltip says which), or *Usage not reported* when the provider reported nothing — never $0. A cost that was not reported is not added to the conversation total. *Approvals requested: N* links to the approval queue.

Every assistant message stores how its turn went: the outcome and stop reason; tokens (uncached input, output, cache reads and writes, reasoning); the cost and its source (reported by the provider, estimated by EYAS, or not reported); the number of steps, tool calls and approvals; the provider and model; any notices; and for a failed turn the error kind and code. Delegated, specialist, pipeline and channel replies store the same. It is returned as `turnMeta` on each message of `GET /api/v1/conversations/:id` and on the stream's `done` frame; older messages have none.

### Errors and notices {#errors-and-notices}
A failed turn shows one message in your language per kind of failure: the provider refused the sign-in or API key, rate limit reached, provider overloaded, no answer in time, network error, request cancelled, request rejected, the model's run ended without finishing, the CLI stopped because its isolation could not be confirmed, or other. More specific messages cover these cases:

- CLI isolation refused, listing each failed check ([Providers — Isolation check](/docs/en/ai/providers/#isolation-check-before-every-turn));
- the CLI is not signed in for EYAS;
- a kernel file sandbox is required (`security.cliSandbox: required`) but not available ([Providers — Kernel file sandbox](/docs/en/ai/providers/#kernel-file-sandbox));
- the conversation's model or provider is switched off or unavailable;
- no model is configured;
- the effort level is not supported by the model.

The raw provider text is never the message; it sits under a collapsible **Show details**. Failures with a remedy in the provider settings (sign-in, isolation, sandbox, model binding, no model configured, authentication) show an **Open provider settings** button. If the turn had written part of an answer before failing, that part stays in the conversation, also after a reload, and the error says *The part of the answer written before the failure was saved.* The error itself is never saved as message text, because it would otherwise be replayed to the model as history. A stopped turn also keeps what it wrote, and the tokens and cost of failed and stopped turns are recorded. If the server refuses a message, the chat shows *The server did not accept the message (HTTP n).*; a dropped connection shows *The connection to the server broke off before the answer arrived. Reload the conversation to see what was saved.*

Notices appear as quiet lines under the turn and stay there after a reload:

- *The model's runtime compacted its working context during this turn to make room.* — EYAS still keeps the whole conversation;
- *Images not shown to the model (N): …* — the model cannot see images (see [Providers — Images](/docs/en/ai/providers/#images-and-models-that-cannot-see-them));
- *&lt;provider&gt; runs its own tools without a kernel file sandbox on this server.* — shown when a CLI runs its own tools without the sandbox (`security.cliSandbox: auto`); EYAS still checks every tool call it sees;
- *The folder &lt;path&gt; was left out of this turn: EYAS no longer lets a model work there…* — a Folder saved earlier is now refused, so this turn ran without it (see [Folders](#working-folders)).

### Approvals in the chat {#approvals-in-the-chat}
When a tool call needs a human decision, a card appears under the conversation: *Approval needed: &lt;tool&gt;*, a collapsible **Reason**, **Approve** and **Reject** (when the call was placed in the approval queue), and **Open approvals**, which leads to the [Autonomy](/docs/en/agents/autonomy/) page. The buttons use the same permission as the approval queue; a user without it sees *You are not allowed to decide approvals. An owner or an admin can decide it in the approval queue.* A request already decided elsewhere says so. After approval, ask the assistant to try again: that exact call (same tool, same arguments) is now allowed once. The cards clear when the next message is sent.

In a chat you are attending, a call the security gate allows runs; the card appears only when the gate escalates, and the chat is not paused. This is the same on every provider — also for EYAS tools that Grok and Kimi reach through the tool bridge, which no longer wait for approval just because a tool is marked as needing one. The autonomy levels apply to background runs, not to attended chats (see [Autonomy](/docs/en/agents/autonomy/)).

### Agent progress {#agent-progress}
The progress panel sits in the **Runtime** strip on the right, which opens by itself while an agent runs. It shows the colleague's name, or *Assistant* for the plain assistant.

| Label | Meaning |
|-------|---------|
| **Step N / Max** | Shown when the provider reports its steps (Claude Code); the step bar appears only then |
| **Tool calls: N** | Shown otherwise (Grok CLI, Kimi Code CLI and API providers that report no steps) |
| **Running** | Run in progress |
| **N tokens billed** | Input plus output of the whole run, summed over every model call as the provider reported it — not the size of the conversation. A CLI agent re-sends everything it has read on each of its internal turns, so this can be far larger than what you wrote |
| **Cancel** | Abort the run |

**Turn budget.** A chat turn may take up to **25** model round trips by default. When the conversation's colleague (or its project's default agent) has its own **Max Turns**, that number is used instead. The budget is the same on every provider; for Claude Code, Grok and Kimi it is also the CLI's own internal turn cap for that chat turn. Delegated, specialist and pipeline runs (default 10) and channel replies (default 20) keep their own budgets.

---

## Composer (input)

| Control | Meaning |
|---------|---------|
| *Type a message… (Shift+Enter for newline)* | Main input — Enter sends |
| **Attach file** | Add an attachment to the next message |
| **Prompt Enhancer** | *Prompt Enhancer — helps refine your prompt*: opens the iterative prompt-refining dialog before you send |
| **Plan first** (map icon) | *Plan first — write a plan and wait for approval before tools run*: this send writes a plan and waits — no tools run until you answer the plan card |
| Error | A failed turn shows one localized message, with **Show details** and, where it helps, **Open provider settings** — see [Errors and notices](#errors-and-notices). For example *Grok CLI was stopped: EYAS could not confirm that it runs isolated (…). The turn was not handed to another model.* |
| Image chip | With an image attached and a model that cannot see images: *&lt;model&gt; cannot see images: it will only learn that an image was attached.* Not shown in God Mode |
| **Message not sent — privacy** | The message carried a value the privacy policy blocks and would go to a remote model — see [Refused messages](#refused-messages-privacy) |

### Refused messages (privacy) {#refused-messages-privacy}
A **new** message you send in chat or God Mode is refused when it contains a value whose privacy action is **block** — by default an IBAN, bank account number, tax number, personal ID card number, card number or US SSN, plus any custom pattern set to block — **and** it would go to a remote model. Only your new message can be refused: history, memory, tool results and attachments' extracted text are never refused; they are masked on the way out. E-mail addresses and phone numbers (mask class) and warn-class types are never refused.

- **Where it goes.** The destination is the model the message will run on (a one-turn override, the conversation's fixed model, or its colleague's model). Local means the model's endpoint is loopback (`localhost`, `127.x`, `::1`) or listed in the privacy policy's local hosts; CLI providers (Claude Code, Grok CLI, Kimi Code CLI) and unknown endpoints count as remote. A conversation set to Auto always counts as remote, because its model is chosen after the check — unless Auto-routing is switched off globally, when its stored model is judged. In God Mode every roster participant is judged: if any is remote, or the roster is empty, the message is refused.
- **Nothing is stored.** The message disappears from the transcript, the conversation is not renamed, no memory is recorded, no model is called and no God Mode race starts. A card above the composer, **Message not sent — privacy**, lists the refused types by name (never the values) and offers **Send with these values masked** (sends it again with only the blocked values replaced by placeholders such as `[IBAN]`; the masked text is what is stored, shown and sent), **Edit message** (puts the text and its attachments back into the composer) and **Discard**.
- Re-running a stopped turn (after a skill proposal or plan approval) is not checked again. With the privacy policy off, or the privacy module off, nothing is refused.

Every refusal is audited as `privacy.inbound_refused` and every masked re-send as `privacy.inbound_masked`, with the types, the conversation and the user — never a value. **API:** `POST /api/v1/conversations/:id/messages` accepts an optional `privacy: "mask"` (any other value → `400`). A refusal is HTTP `422 {error: 'privacy_blocked', code: 'privacy_blocked', message, types, maskedContent}`, sent before any stream starts. See [Security & privacy](/docs/en/admin/security-privacy/#refused-messages).

### Prompt Enhancer dialog {#prompt-enhancer-dialog}
An iterative coach that **shapes the prompt for the conversation's model family** (Claude, OpenAI, Gemini, Grok, Kimi, …) before you send. Description: *An iterative prompt coach — optimized for the conversation's model family. Pick a task type, refine, then Apply.*

| Control | Meaning |
|---------|---------|
| Goal / draft area | Describe what you want refined (*Type a prompt draft or a goal — I'll help refine it.*) |
| **Optimized for …** | Target model family — by default the model the conversation actually runs on |
| Task type chips | **General · Coding · Research · Analysis · Writing · Agentic · Files / vision** — steers structure and checklist |
| **Attach file** | Context files for the enhancer only (or carry them over) |
| **Send** | Continue refining with the enhancer |
| **Quality N/10** | Heuristic quality score; **Gaps: …** lists missing checklist items; **Checklist covered** when complete |
| **Propose two alternatives (concise + thorough)** | Ask for **Concise** / **Thorough** / **Recommended** variants |
| **Suggested final prompt** | Candidate text to insert |
| **carry N files** | Whether the attachments go into the main chat too |
| **Apply** | Insert the final prompt (or the last response) into the main composer |

For **durable** project / agent system prompts (not one-off chat drafts), use [Prompt Coach](/docs/en/ai/prompts/#prompt-coach) on Projects and Agent Configuration.

---

## Context rail (chatter) {#context-rail-chatter}
The right-hand column holds the **Runtime** strip on top, the OpenCode terminal while it is open, then the tabs:

**History · Sources · Folders · Next · Files** (plus **God** while God Mode is on or after a race)

### History (messages / filters)

| Control | Meaning |
|---------|---------|
| **History** | Chronological notes and board updates |
| **All / Notes / Changes** | Filter notes vs field changes |
| *Add a note…* + **Add note** | Human note on the record (not a chat turn to the model) |
| Badges **Note** / **Update** | Entry type |
| **Today / Yesterday** | Time grouping |

### Sources (code / Odoo pin)

Multi-select which **indexed search sources** this conversation may use (for example Odoo 18c + custom addons). This prevents mixing several Odoo versions in one thread.

| Control | Meaning |
|---------|---------|
| Checkbox list | All registered search sources (label, version, status, path) |
| **Select all** / **Clear (auto)** | Pin every source / clear the pin |
| **Auto** | No conversation pin — the project default or the multi-version `needsPin` rules apply |
| **N pinned** | Number of selected sources |
| **Manage search sources →** | Open `/search-sources` |

**Inheritance:** new conversations in a project, and assigning a project to an existing conversation, copy the project's **Default code sources**. You can always override them here.

Full setup: [Search — multi-version pin](/docs/en/daily/search/#multi-version-pin-which-tree-may-the-agent-use) · [Projects](/docs/en/daily/projects/).

### Folders (working directories) {#working-folders}
Named roots this conversation may read and write. The first path is the **primary** working directory (cwd). File tools (`read_file`, `edit_file`, `grep`, …) are jailed to these paths — there is no fallback to the EYAS process directory. Claude Code, Grok CLI, Kimi Code CLI and OpenCode start in the first folder that still passes validation, else in the conversation's own EYAS workspace — never in the EYAS server's own directory.

| Control | Meaning |
|---------|---------|
| **Working folders** (fields bar) | Pin which named root is primary |
| **Folders** tab | **Add folder** (name + absolute path), **Move up** / **Move down**, **Remove**; the first entry is **Primary** |
| *This project has no default folders yet.* | Set defaults on the [project](/docs/en/daily/projects/#working-directories) (or its type) |

New conversations copy the project's list; an empty project list copies the **type** list. Changing the project replaces this list. Paths live on the instance, not in product defaults.

**Folders that cannot be saved.** Saving refuses a folder and tells you why, naming the folder, in your language:

- the filesystem root, your home folder, or any folder above it (for example `/Users` or `/home`) — from there a model could reach every tool's memory and your credentials; pick a project folder inside your home instead;
- a folder inside another AI tool's own storage (`~/.claude`, `~/.claude.json`, `~/.grok`, `~/.codex`, `~/.gemini`, `~/.cursor`, `~/.codeium`, `~/.kimi`, `~/.agents`, `~/.config/agents`, `~/.copilot`, OpenCode's config/data/state folders, or a `.claude`/`.grok`/… `memory` folder inside a repository), or the CLI sign-in homes EYAS keeps for Grok and Kimi (`data/cli-homes`);
- a folder inside a notes vault or memory store: any Obsidian vault, Obsidian's app settings, a folder named `ai-memory`, or a path listed under `security.foreignMemoryPaths`;
- a folder inside EYAS's own data folder (memory vault, database, keys) — except a single conversation workspace, Studio projects and browser downloads; the workspaces folder itself is refused, because it holds every conversation's workspace;
- the workspace of another user's conversation — a conversation's workspace, a folder inside it or a link into it is a folder only of that conversation and of your own other conversations (your team and specialist conversations included); a run's temporary folder under `_runs` is refused too;
- sensitive locations: `.ssh`, `.env` files, `master.key`, the database folder;
- a path that is not absolute, a folder that does not exist or cannot be read, and a file instead of a folder;
- a folder that **contains** a protected place — the message names what was found inside: EYAS's own home, data folder, database or conversation-workspaces folder (for example the EYAS source checkout that holds `data/`, or the EYAS home itself even when `EYAS_DATA_DIR` moved the data elsewhere); another AI tool's storage or an EYAS CLI sign-in folder (for example `~/.config` holding OpenCode's folder, or a repository with `.claude/memory`); a notes vault (a folder with `.obsidian` inside, or a vault in Obsidian's vault list — for example `~/Documents` holding *Obsidian Vault*), an `ai-memory` folder or a `security.foreignMemoryPaths` entry.

**Why a folder that only contains one of these is refused.** A CLI such as Claude Code reads and searches inside its working folder without asking, and the release check confirmed on the real binary that such reads never reach the approval step. So a folder that holds a protected place is not safe to hand to a model. Choose a narrower folder instead, such as the project folder inside `~/Documents` or a separate clone of the repository. Vaults and memory folders known only by their shape are found by a bounded scan — 8 levels deep, at most 2,000 folders, skipping `.git` and similar folders and `node_modules`; a read into a deeper one is still refused path by path, and EYAS's own `grep` and `glob` never look inside a protected sub-folder. If a new conversation's folders are refused, the conversation is not created.

**Folders saved earlier that are now refused** are not rewritten, but every run leaves them out: EYAS's own file tools, the security gate, and the working folder of Claude Code, Grok, Kimi and OpenCode. The system prompt no longer names them. In the chat, the turn shows the notice *The folder &lt;path&gt; was left out of this turn: EYAS no longer lets a model work there, because it is, sits inside or contains a protected place (EYAS's own data, another AI tool's storage, a notes vault or your home folder). Change the Folders of this conversation or its project.* A folder that is merely missing is not affected. For background card, team and specialist runs the drop appears only in the server log. If every stored folder is refused, EYAS's own file tools have no folder, and a CLI works in the conversation's own EYAS workspace. Kimi Code CLI follows the same folder rules; its behaviour here has not been verified on a host yet. Every save checks the whole list, so remove a now-refused folder before saving other changes to the list. The API answers a refused folder with `400 {error, code, path, found}`, where `code` is one of `home`, `providerHome`, `vault`, `eyasData`, `sensitive`, `otherWorkspace`, `containsEyasData`, `containsProviderHome`, `containsVault`, `notAbsolute`, `notFound`, `notDirectory`, and `found` — sent with the three `contains…` codes — is the protected place found inside the folder.

**Every conversation has a working folder.** A conversation that gets no folders from you, the project or its type gets its own **EYAS workspace** when it is created — in any project, including when the request sends an empty folder list. Older conversations without folders, and conversations whose folders were all removed, get their workspace on the next message. It shows on the **Folders** tab like any folder. Files the model writes there are copied into the conversation's attachments ([Documents](/docs/en/knowledge/documents/)), together with media jobs and Studio renders — also on a turn that ran without EYAS's tool pipeline. **No folder** appears only if the workspaces location cannot be written. Folders you set yourself are never replaced.

Workspaces never sit inside a git checkout: a CLI model (Claude Code, Grok, Kimi) started inside a git repository treats that repository as its project and loads its instruction files, git status, permission rules and per-project memory. Where they live, and how to move them with `EYAS_WORKSPACES_DIR`, is under [Configuration — Conversation workspaces](/docs/en/deploy/configuration/#conversation-workspaces).

### Business fields (tracked)

| Field | Meaning |
|-------|---------|
| **Stage** | Pipeline stage |
| **Project** | Project link |
| **Priority** | Priority |
| **Status** | Status |
| **Due date** | Deadline |

Changes appear as **Update** entries on the **History** tab.

### Activities

The **Next** tab (*Next steps for this record*) lists the conversation's activities.

| Control | Meaning |
|---------|---------|
| **Schedule** | Open the schedule form |
| **Type** | Activity type (to-do, follow-up, review, …) |
| **Summary** | Optional summary text |
| **Deadline** | When it is due |
| **Schedule activity** | Confirm |
| **Mark as done** | Complete an activity |
| **Overdue / Today / Planned** | Grouping |
| **N completed** | Done count |

### Next / Files / Runtime

| Area | Meaning |
|------|---------|
| **Next** | Activities and next steps for this record (above) |
| **Files** | Attachments of the conversation, including files the model wrote in its workspace |
| **Runtime** | The collapsible strip above the tabs: the run tree, agent progress and the sub-conversation tree. It opens by itself while an agent runs and is kept apart from History, so agent activity never mixes with business notes |

---

## Team features

### Sub-conversation tree

| Control | Meaning |
|---------|---------|
| **Team / Sub-conversations** | Child threads spawned for multi-agent work (in the Runtime strip) |
| **Expand** (*Open Team Dashboard*) | Open the dashboard overlay |
| **turn N** | Progress of a sub-thread |

### Team Dashboard

| Control | Meaning |
|---------|---------|
| **Team Dashboard** / **Collapse** | Overlay title / close |
| **Phase:** | Current orchestration phase |
| **N turn / N tokens** | Usage |
| Categories **Finding / Decision / Blocker / Question / Fact** | Shared team memory entry types |
| **View chat** | Jump into a member's sub-chat |
| **Team Memory** | Aggregated findings, decisions and blockers |

### Team proposal card

Ordinary specialist fan-out (`run_specialist`) does **not** show this card. It appears for `/team`, an explicit team request, missing specialists, or epic work. The proposal is written by the background model in one isolated call; without an eligible background model the card proposes a single agent (see [Teams & delegation](/docs/en/agents/teams/)).

| Control | Meaning |
|---------|---------|
| **Team proposal** | Plan for multi-agent execution |
| **~N tokens · cost** | Estimate |
| **Phases** | Parallel vs sequential phases |
| **Missing specialists** | Templates not created yet |
| **Create now** | Create the missing agents |
| **Approve / Edit / Skip / Skip (risky)** | Accept the plan, edit it (when available), or skip it |

### Handoff {#handoff}
When a colleague takes over (`handoff_to_colleague`), the tool row has **Open &lt;name&gt;** to their home thread, and the colleague **starts straight away** there: the hand-off brief becomes the run's goal and its memory-recall query, and the run is supervised, autonomous and gated by the [autonomy](/docs/en/agents/autonomy/) ladder, like a board card run. A hand-off to a colleague who is busy in their home thread (a chat turn or an earlier run still working, or a run waiting for approval) is refused with a *busy* message — try again later or use `assign_task`. Hand-offs to yourself or to a specialist are refused, and a repeated hand-off never starts a second run.

### Run tree / workflow
Shows the run structure of the current turn (**Workflow** label) in the Runtime strip, for every provider — API providers (Anthropic, OpenAI, Gemini, OpenRouter, Kimi API, local models, …) as well as Claude Code, Grok CLI and Kimi Code CLI.

- The conversation's node shows the live current tool, the turn counter (for a CLI, its own internal steps), the tokens used so far, and a status: **Pending**, **Running**, **Completed**, **Failed**, **Cancelled** or **Paused**. A run waiting for a human approval shows as **Paused**.
- Every new message starts a fresh tree: the previous turn's tree is replaced, not appended.
- When a run ends, the header shows its cost in US dollars: the provider's own cost where reported (Claude Code, also for a failed run), otherwise computed from the token usage with the configured prices (`model.pricing` overrides apply). When a provider did not report its usage, the cost shows *—* and the tooltip says *Cost unknown — the provider did not report its usage* — never a made-up $0.
- **Grok and Kimi plans.** When the model keeps a to-do list, each entry appears under the conversation as a **Plan step** with a checklist icon and its status (pending, running, completed).
- Specialists appear the same way on every provider; Claude Code runs show no nodes of their own. In team runs every member shows its live current tool, whatever its provider.
- Older stored trees still replay.

---

## God Mode

God Mode races the **same task** in parallel on several models, then compares the results. It is not a fourth orchestration style: Solo / Auto / Deep still describe how each worker decomposes the work. God Mode only decides that several models compete (not a team of specialists). You can combine them: God Mode + Deep means every competing model may fan out on its own.

There is **no automatic merge**. One workspace wins; unique ideas from the others are listed for you to apply.

| Topic | Meaning |
|-------|---------|
| **Roster** | **Settings → God Mode** (card under Model Assignments). Pick 2–5 live provider/model pairs. An even count requires a tie-break chair. |
| **Menu** | Last item of the conversation's orchestration control (after a separator): Solo, Auto, Deep, then **God Mode**. Choosing God Mode turns it on and **leaves** Solo/Auto/Deep as they are (the workers inherit that style). Choosing Solo/Auto/Deep turns God Mode off. Without a valid roster the item says *Add at least 2 models in Settings → God Mode*. |
| **Cost** | The first send after turning God Mode on asks for confirmation (*Start God Mode run?* — roster, estimate, ceiling). Later sends in the same conversation show the banner only. If the estimate exceeds the ceiling, sending is blocked until you raise the ceiling or turn God Mode off. |
| **Folders** | Workers run in isolated copies of the conversation's working folders (a git worktree when possible). With no folders the run still starts, without file isolation. |
| **Winner + insights** | Only the winner's changed files land on the conversation's folders. Unique insights from the others are listed on the **God** tab — you apply them; nothing is merged automatically. |

### Settings roster

On [Settings](/docs/en/admin/settings/), under Model Assignments, the **God Mode** card is the global roster every God Mode conversation uses.

| Field | Meaning |
|-------|---------|
| **Add model** | 2–5 live provider/model pairs. Duplicates are not allowed. |
| **Tie-break chair** | One of those models. **Required when the count is even**; recommended always (a failed worker can leave an even remainder). The chair is a competitor, not a separate judge. |
| **Cost ceiling (USD)** | Optional. If the pre-flight estimate is above it, the run does not start. If spending crosses the ceiling mid-run, unfinished workers are cancelled and the winner is decided among those that finished. |
| **Keep worker folders (hours)** | Isolated trees are deleted after this many hours (default 72). |

Saving the roster does not change runs that already started: each send takes a snapshot of the roster.

The conversation's model picker is dimmed and ignored for a God Mode send — the Settings roster runs instead, and each worker always runs on its roster model. An effort set on the conversation is copied to every racer and Deep is passed on as the racers' mode; each racer's level is then fitted to its own model. The cross-review votes use the conversation's effort too.

### Turning God Mode on

1. Open the conversation's orchestration menu and choose **God Mode**.
2. Send a message. The first send shows a cost confirmation (how many models race, estimated USD, ceiling). Click **Send** to start.
3. A **God Mode · N · ~$x** banner stays on the conversation while it is on. The right-hand rail grows a **God** tab.
4. **Stop** cancels the whole race, not only one worker.

### Isolation and the winner

Each worker gets its own folder (a git worktree when the working directory is a repository; otherwise a copy). Workers cannot see each other's files while they work.

When a winner is chosen, **only that winner's changed files** are copied onto the conversation's folders. The other workers' files stay in their isolated trees until retention cleanup. If the conversation has no working folders, there is nothing to promote; the winner is still chosen from the written answers.

### The God tab

The **God** tab on the rail appears while God Mode is on, **or** after the conversation has had at least one God Mode run (it stays if you later turn God Mode off).

#### Header

The current phase, plus total tokens, USD and duration.

| Phase | Meaning |
|-------|---------|
| **Preparing** | Roster snapshot, isolated folders |
| **Racing** | Workers run the same user message in parallel |
| **Reviewing** | Survivors score each other's work and vote |
| **Deciding** | Winner recorded |
| **Promoting** | Winner's files copied onto the conversation's folders |
| **Completed / Failed / Cancelled** | Final state |

A failed worker also shows the provider error (for example an overloaded API).

#### Steps

A time-stamped log of what actually happened:

| Step | Meaning |
|------|---------|
| Run started | Race created from the current roster |
| Workers started in parallel | Every live model begins the same task |
| *Model* finished / failed | That worker's own attempt ended |
| Cross-review started | Survivors read each other's summaries and vote |
| Winner: *model* | Decision recorded |
| Promoting the winner's workspace | Winner's files copied onto the conversation's folders |
| Run completed / failed / cancelled | Final state |

Older runs from before this log show a timeline rebuilt from the finish times.

#### How the winner was chosen

This block states the rule that applied, the vote counts, and **who voted for whom**.

| Rule | When |
|------|------|
| **Majority vote** | One model received more valid votes than any other. A model **cannot vote for itself**; self-votes are discarded. |
| **Tie — the chair picked** | Two or more models tied, and the chair is among them. |
| **Tie — earliest finish** | Two or more models tied, and the chair is missing or not among them. The tied model that finished first wins. |
| **Only one finished** | Every other worker failed or was cancelled; the sole survivor wins and there is no cross-review vote. |

If a review call fails, that worker simply has no vote. The decision goes ahead with the votes that were cast.

#### What each model said about the others

After the race, survivors do **one** structured cross-review (not a live debate). Each reviewer votes in one isolated call on its own roster model, with no tools. The others' answers and file changes are passed to it as clearly marked data, never as instructions, so text in a peer's output cannot tell a reviewer how to vote. For each reviewer the tab shows, without extra clicks:

- who they voted for
- scores 1–5: **quality**, **completeness**, **risk**
- their written commentary on the others' work
- unique insights they say the others missed
- risks they flagged

Expand a model card for that model's **own** output (the work it produced before reviewing) and any worker error.

#### Unique insights

A de-duplicated list of insights from the **non-winners** that do not already appear in the winner's own list. Apply them yourself if you want them in the promoted workspace — nothing is merged automatically.

### Child conversations

Each worker is a child conversation titled like `God <model>`. They may appear in the conversation list as sub-conversations. They run with God Mode **off**, so they cannot start another race.

The global comparison (win rate by model, average cost multiple against a single model) is under [Observability](/docs/en/admin/observability/). Click a run there to open that conversation's God tab.

---

## Skill proposals

A matched skill is a **proposal the turn waits on** — nothing of that skill runs until you answer. The card shows the skill name, the pattern that matched, and a score.

| Control | Meaning |
|---------|---------|
| **A skill matched — use it?** | Heading |
| **Use it** | Accept for this conversation; the turn resumes with the skill |
| **Not this time** | Decline for this conversation only |
| **Turn it off** | Decline here **and** disable the skill globally (owner/admin only). It will not match again until someone turns it back on under [Skills](/docs/en/automation/skills/) |

Your answer is remembered for this conversation. A user who can chat but cannot manage skills still sees **Use it** and **Not this time**.

---

## Plan first {#plan-mode}
The map icon on the composer is **Plan first** (*Plan first — write a plan and wait for approval before tools run*). That send does **not** run tools, and the thread status becomes **Waiting on plan**. The plan is written by the conversation's own model in one isolated call — no tools, a single turn, never another provider. If that call fails, the turn runs without a plan.

The card **Plan for this turn** shows the goal, the numbered steps (with their success criteria) and, when the plan gives one, a *Rollback: …* line saying how it would be undone.

| Control | Meaning |
|---------|---------|
| **Approve** | Run this plan |
| **Skip plan** | Run the turn without the plan |
| **Reject** | Stop — nothing ran |

Nothing has run while the card is waiting. Yellow and red tools in the later run still go through [Autonomy](/docs/en/agents/autonomy/) as usual.

---

## Attached designs {#attached-designs}
The shapes icon in the conversation's top bar is **Designs**. Attached canvases travel with every turn of this thread (the agent can fetch parts with `design_read`). A project's designs are copied onto a new conversation when you create it in that project; after that the conversation owns the links.

| Control | Meaning |
|---------|---------|
| **Attached designs** | Dropdown of every canvas, with a check on those linked here |
| Count badge | How many are attached |
| **Open Design** | Jump to `/design` |
| *No designs yet.* | Empty list — create a canvas first |

---

## Related

- [Search sources & multi-version pin](/docs/en/daily/search/)
- [Projects — working directories and wiki](/docs/en/daily/projects/)
- [Agents overview](/docs/en/agents/overview/)
- [Teams & delegation](/docs/en/agents/teams/)
- [Providers](/docs/en/ai/providers/)
- [Board](/docs/en/daily/board/)
- [Voice profiles](/docs/en/agents/voice/)
- [Memory](/docs/en/knowledge/memory/)
- [Design canvases](/docs/en/knowledge/design/)
- [Skills](/docs/en/automation/skills/)
- [OpenCode](/docs/en/automation/opencode/)
- [Observability — God Mode tab](/docs/en/admin/observability/)

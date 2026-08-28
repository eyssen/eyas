---
title: Conversations
description: Chat workspace — every field, rail, and control for talking with agents.
---

**Entry:** sidebar **New Conversation** (creates via `POST /conversations`) or open an existing thread from Board / Recent.

Layout: **messages + composer** (main) and **context rail** (chatter: notes, fields, activities, files, runtime).

---

## Conversation status

| Status | Meaning |
|--------|---------|
| **Idle** | No active agent run |
| **Working…** | Agent is executing |
| **Waiting** | Waiting for user or external input |
| **Waiting approval** | Blocked on human approval (security / autonomy) |
| **Archived** | Closed / archived thread |

---

## Header / model strip

| Control | Meaning |
|---------|---------|
| **Provider…** | Optional override of AI provider for this thread |
| **Model…** | Optional model override (else agent default / auto-routing) |
| **Auto-routing** | Let the model router pick provider/model |

### Context composition

The thin bar above the header is clickable — it opens the **Context composition** panel for the current turn: every section that went into that turn's prompt, in the order it was assembled, with its size, whether it was truncated, and its raw content. This is per-turn, not a running total for the whole conversation.

The percentage on that bar changed meaning: it now reports the size of the context actually composed for that turn, against the model's context window. It used to sum input and output tokens cumulatively across the whole conversation, so it overstated how full the window was and would sit pinned at 100% on a long one. If you remember that, the smaller number today is the fix, not a bug.

---

## Top bar — priority

| Value | Meaning |
|-------|---------|
| **Low / Normal / High / Urgent** | Business priority of the conversation (also shown on Board) |

---

## Conversation fields (context)

| Field | Meaning |
|-------|---------|
| **Project** | Owning project (`None` if unset). Changing project **re-applies that project’s default code sources** on the Sources tab (unless you set sources explicitly in the same update). |
| **Stage** | Stage within the project pipeline |
| **Agent** | Assigned agent — **locked after the first message** |
| **Effort** | Reasoning depth: Off / Low / Medium / High / Max. Higher = deeper, slower, more expensive. |
| **Orchestration** | **Solo** = no sub-agents; **Auto** = model decides fan-out; **Deep** = aggressive multi-agent fan-out with max effort. Last item **God Mode** — same task raced by the Settings roster (see [God Mode](#god-mode)). |

---

## Message stream

| Control / label | Meaning |
|-----------------|---------|
| **Start a conversation…** | Empty state |
| **Thinking / Thinking…** | Model is reasoning (may show char counts) |
| **Composing response…** | Streaming reply in progress |
| **Stop** | Cancel the current run |
| **Background working…** | You left and returned; agent still working — messages appear when ready |
| **Attachment** | Inline image/file from the thread |
| Tool call **Input / Output / Error** | Expandable tool invocation details |

### Agent progress

| Label | Meaning |
|-------|---------|
| **Turn N / Max** | Current agent loop turn vs max turns |
| **Running** | Run in progress |
| **N tokens** | Tokens used so far |
| **Cancel** | Abort the run |

### Complexity indicators

| Badge | Meaning |
|-------|---------|
| **Simple** | Lightweight path |
| **Managed** | Structured / supervised path |
| **Autonomous** | Higher autonomy path |
| **Wizard** | Wizard-assisted flow |

### Voice scope

| Control | Meaning |
|---------|---------|
| **Voice · INTERNAL / EXTERNAL / AUTO** | Which voice profile is active ([Voice profiles](/docs/en/agents/voice/)) |
| **Override voice scope** | Force Internal, Force External, or Auto |
| **(default)** | Using agent default without override |

---

## Composer (input)

| Control | Meaning |
|---------|---------|
| **Type a message…** | Main input (`Shift+Enter` = newline, Enter = send) |
| **Attach file** | Add attachment to the next message |
| **Prompt Enhancer** | Opens iterative prompt-refining dialog before send |
| Error banner | Last send/stream error |

### Prompt Enhancer dialog

Iterative coach that **shapes the prompt for the conversation’s model family** (Claude, OpenAI, Gemini, Grok, Kimi, …) before you send. Description: *An iterative prompt coach — optimized for the conversation's model family. Pick a task type, refine, then Apply.*

| Control | Meaning |
|---------|---------|
| Goal / draft area | Describe what you want refined (*Type a prompt draft or a goal…*) |
| **Optimized for …** | Target model family badge (from thread Provider/Model) |
| Task type chips | **General · Coding · Research · Analysis · Writing · Agentic · Files / vision** — steers structure and checklist |
| **Attach file** | Context files for the enhancer only (or carry over) |
| **Send** | Continue refining with the enhancer agent |
| **Quality N/10** | Heuristic quality score; **Gaps: …** lists missing checklist items; **Checklist covered** when complete |
| **Propose two alternatives (concise + thorough)** | Ask for **Concise** / **Thorough** / **Recommended** variants |
| **Suggested final prompt** | Candidate text to insert |
| **carry N files** | Whether attachments should enter the main chat |
| **Apply** | Insert final (or last) prompt into the main composer |

For **durable** project / agent system prompts (not one-off chat drafts), use [Prompt Coach](/docs/en/ai/prompts/#prompt-coach) on Projects and Agent Configuration.

---

## Context rail (chatter)

Tabs (right panel):

**History · Sources · Next · Files**

### History (messages / filters)

| Control | Meaning |
|---------|---------|
| **History** | Chronological notes and board updates |
| **All / Notes / Changes** | Filter notes vs field changes |
| **Add a note…** + **Add note** | Human note on the record (not the same as a chat turn to the model) |
| Badges **Note** / **Update** | Entry type |
| **Today / Yesterday** | Time grouping |

### Sources (code / Odoo pin)

Multi-select which **indexed search sources** this conversation may use (e.g. Odoo 18c + custom addons). Prevents mixing multiple Odoo versions in one thread.

| Control | Meaning |
|---------|---------|
| Checkbox list | All registered Search Sources (label, version, status, path) |
| **Select all** / **Clear (auto)** | Pin every source / clear pin |
| **Auto** | No conversation pin — project default or multi-version `needsPin` rules apply |
| **N pinned** | Number of selected sources |
| **Manage search sources →** | Open `/search-sources` |

**Inheritance:** new conversations in a project, and assigning a project on an existing conversation, copy the project’s **Default code sources**. You can always override here.

Full setup: [Search — multi-version pin](/docs/en/daily/search/#multi-version-pin-which-tree-may-the-agent-use) · [Projects](/docs/en/daily/projects/).

### Business fields (tracked)

| Field | Meaning |
|-------|---------|
| **Stage** | Pipeline stage |
| **Project** | Project link |
| **Priority** | Priority |
| **Status** | Status |
| **Due date** | Deadline |

Changes appear as **Update** entries in the rail.

### Activities

| Control | Meaning |
|---------|---------|
| **Activities** | Activity list (to-do, follow-up, …) |
| **Schedule** | Open schedule form |
| **Type** | Activity type |
| **Summary** | Optional summary text |
| **Deadline** | When it is due |
| **Schedule activity** | Confirm create |
| **Mark as done** | Complete an activity |
| **Overdue / Today / Planned** | Grouping |
| **N completed** | Done count |

### Next / Files / Runtime

| Area | Meaning |
|------|---------|
| **Next** | Activities / next steps for this record |
| **Files** | Attachments on the conversation |
| **Runtime** | Runtime / execution metadata strip (collapsible; separate from History) |

---

## Team features

### Sub-conversation tree

| Control | Meaning |
|---------|---------|
| **Team / Sub-conversations** | Child threads spawned for multi-agent work |
| **Expand / Open Team Dashboard** | Open dashboard overlay |
| **turn N** | Progress on a sub-thread |

### Team Dashboard

| Control | Meaning |
|---------|---------|
| **Title / Collapse** | Overlay chrome |
| **Phase** | Current orchestration phase |
| **N turn / N tokens** | Usage |
| Categories **Finding / Decision / Blocker / Question / Fact** | Shared team memory entry types |
| **View chat** | Jump into a member’s sub-chat |
| **Team Memory** | Aggregated findings/decisions/blockers |

### Team proposal card

| Control | Meaning |
|---------|---------|
| **Team proposal** | Plan for multi-agent execution |
| **~N tokens · cost** | Estimate |
| **Phases** | Parallel vs sequential phases |
| **Missing specialists** | Templates not yet created |
| **Create now** | Bootstrap missing agents |
| **Approve / Edit / Skip / Skip (risky)** | Accept plan, edit (if available), or skip |

### Run tree / workflow

Shows hierarchical agent run structure for complex orchestration (**Workflow** label).

---

## God Mode

God Mode races the **same task** in parallel on several models, then compares the results. It is not a fourth orchestration style: Solo / Auto / Deep still describe how each worker decomposes the work. God Mode only decides that multiple models compete (not a team of specialists). You can combine them: God Mode + Deep means every competing model may fan out on its own.

There is **no automatic merge**. One workspace wins; unique ideas from the others are listed for you to apply.

| Topic | Meaning |
|-------|---------|
| **Roster** | **Settings → God Mode** (card under Model assignments). Pick 2–5 live provider/model pairs. An even count requires a tie-break chair. |
| **Menu** | Last item in the conversation **Orchestration** control (after a separator): Solo, Auto, Deep, then **God Mode**. Choosing God Mode turns it on and **leaves** Solo/Auto/Deep as-is (workers inherit that style). Choosing Solo/Auto/Deep turns God Mode off. |
| **Cost** | The first send after turning God Mode on asks for confirmation (roster, estimate, ceiling). Later sends in the same conversation show a banner only. If the estimate exceeds the ceiling, send is blocked until you raise the ceiling or turn God Mode off. |
| **Folders** | Workers run in isolated copies of the conversation working folders (git worktree when possible). No folders → the run still starts, without file isolation. |
| **Winner + insights** | Only the winner’s changed files land on the conversation folders. Unique insights from the others are listed on the **God** tab — you apply them; nothing is merged automatically. |

### Settings roster

On [Settings](/docs/en/admin/settings/), under Model assignments, the **God Mode** card is the global roster every God Mode conversation uses.

| Field | Meaning |
|-------|---------|
| **Models** | 2–5 live provider/model pairs. Duplicates are not allowed. |
| **Tie-break chair** | One of those models. **Required when the count is even**; recommended always (a failed worker can leave an even remainder). The chair is a competitor, not a separate judge. |
| **Cost ceiling (USD)** | Optional. If the pre-flight estimate is above this, the run does not start. If spend crosses the ceiling mid-run, unfinished workers are cancelled and the system decides among whoever finished. |
| **Keep worker folders (hours)** | Isolated trees are deleted after this many hours (default 72). |

Saving the roster does not rewrite runs that already started: each send snapshots the roster.

The conversation’s provider/model strip is ignored for a God Mode send — the Settings roster runs instead.

### Turning God Mode on

1. Open the conversation **Orchestration** menu and choose **God Mode**.
2. Send a message. The first send shows a cost confirmation (who is racing, estimated USD, ceiling). Confirm to start.
3. A **God Mode** banner stays on the conversation while it is on. The right-hand rail grows a **God** tab.
4. **Stop** cancels the whole race, not only one worker.

### Isolation and the winner

Each worker gets its own folder (a git worktree when the working directory is a repo; otherwise a copy). Workers cannot see each other’s files while they work.

When a winner is chosen, **only that winner’s changed files** are copied onto the conversation folders. Other workers’ files stay in their isolated trees until retention cleanup. If the conversation has no working folders, there is nothing to promote; the winner is still chosen from the written answers.

### The God tab

The **God** tab on the chatter rail appears while God Mode is on, **or** after the conversation has had at least one God Mode run (it stays if you later turn God Mode off).

#### Header

Current phase, plus total tokens, USD, and duration.

| Phase | Meaning |
|-------|---------|
| **Preparing** | Roster snapshot, isolated folders |
| **Racing** | Workers running the same user message in parallel |
| **Reviewing** | Survivors scoring each other’s work and voting |
| **Deciding** | Winner recorded |
| **Promoting** | Winner files copied onto the conversation folders |
| **Completed / Failed / Cancelled** | Terminal state |

A failed worker also shows the provider error (for example an overloaded API).

#### Steps

A time-stamped log of what actually happened:

| Step | Meaning |
|------|---------|
| Run started | Race created from the current roster |
| Workers started in parallel | Every live model begins the same task |
| *Model* finished / failed | That worker’s own attempt ended |
| Cross-review started | Survivors read each other’s summaries and vote |
| Winner: *model* | Decision recorded |
| Promoting the winner's workspace | Winner files copied onto the conversation folders |
| Run completed / failed / cancelled | Terminal state |

Older runs that predate this log still show a reconstructed timeline from finish times.

#### How the winner was chosen

This block states the rule that applied, the vote counts, and **who voted for whom**.

| Rule | When |
|------|------|
| **Majority vote** | One model received more valid votes than any other. A model **cannot vote for itself**; self-votes are discarded. |
| **Tie — the chair picked** | Two or more models tied, and the chair is among the tied. |
| **Tie — earliest finish** | Two or more models tied and the chair is missing or not among the tied. The tied model that finished first wins. |
| **Only one finished** | Every other worker failed or was cancelled; the sole survivor wins and there is no cross-review vote. |

If a review call fails, that worker simply has no vote. The decision still proceeds with whoever did vote.

#### What each model said about the others

After the race, survivors do **one** structured cross-review (not a live debate). For each reviewer the tab shows, without extra clicks:

- who they voted for
- scores 1–5: **quality**, **completeness**, **risk**
- their written commentary on the others’ work
- unique insights they claimed the others missed
- risks they flagged

Expand a model card for that model’s **own** output (the work they produced before reviewing) and any worker error.

#### Unique insights

A de-duplicated list of insights from **non-winners** that do not already appear in the winner’s own list. Apply them yourself if you want them in the promoted workspace — nothing is merged automatically.

### Child conversations

Each worker is a child conversation titled like `God <model>`. They may appear in the conversation list as sub-conversations. They run with God Mode **off** so they cannot start another race.

Global comparison (win-rate by model, average cost multiple versus a single model) lives under [Observability](/docs/en/admin/observability/). Click a run there to open that conversation’s God tab.

---

## Related

- [Search sources & multi-version pin](/docs/en/daily/search/)
- [Projects — default code sources](/docs/en/daily/projects/)
- [Agents overview](/docs/en/agents/overview/)
- [Board](/docs/en/daily/board/)
- [Voice profiles](/docs/en/agents/voice/)
- [Memory](/docs/en/knowledge/memory/)
- [Observability — God Mode tab](/docs/en/admin/observability/)

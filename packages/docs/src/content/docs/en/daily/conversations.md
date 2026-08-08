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

---

## Top bar — priority

| Value | Meaning |
|-------|---------|
| **Low / Normal / High / Urgent** | Business priority of the conversation (also shown on Board) |

---

## Conversation fields (context)

| Field | Meaning |
|-------|---------|
| **Project** | Owning project (`None` if unset) |
| **Stage** | Stage within the project pipeline |
| **Agent** | Assigned agent — **locked after the first message** |
| **Effort** | Reasoning depth: Off / Low / Medium / High / Max. Higher = deeper, slower, more expensive. |
| **Orchestration** | **Solo** = no sub-agents; **Auto** = model decides fan-out; **Deep** = aggressive multi-agent fan-out with max effort |

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

Tabs / areas:

### Messages / filters

| Control | Meaning |
|---------|---------|
| **Messages** | Focus message-related rail content |
| **All / Notes / Changes** | Filter notes vs board field changes |
| **Add a note…** + **Add note** | Human note on the record (not sent to the model as a user chat turn the same way) |
| **History** | Chronological notes and updates |
| Badges **Note** / **Update** | Entry type |
| **Today / Yesterday** | Time grouping |

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

### Attachments / Files / Runtime / Next

| Area | Meaning |
|------|---------|
| **Attachments / Files** | Files on the conversation |
| **Runtime** | Runtime / execution metadata strip |
| **Next** | Suggested next steps for this record (`Next steps for this record`) |

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

## Related

- [Agents overview](/docs/en/agents/overview/)
- [Board](/docs/en/daily/board/)
- [Voice profiles](/docs/en/agents/voice/)
- [Memory](/docs/en/knowledge/memory/)

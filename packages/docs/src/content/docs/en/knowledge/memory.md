---
title: Memory
description: What EYAS remembers — automatic vault notes, five tiers, the raw record of every message, and when to use which store.
---

**What this is for.** Memory is EYAS's own long-term store. A durable fact you state in a conversation becomes a vault note without anyone asking, and the same note is what every later conversation reads back. This page is where you inspect working blocks, episodic facts, vault files, and the review queue — not where you curate a wiki. How remembered text reaches a model is under [How recall works](#how-recall-works). Since 0.8.23 EYAS also keeps a raw record of every message it persists; [The raw record](#the-raw-record) below is all there is to know about it.

## When to use it

- You want the assistant to remember who you are, how you work, or a project's constraints.
- A fact was stated in chat and you want to confirm it landed in the vault (or why a capture was skipped).
- You need to review, tag, graph, or consolidate memories — or jump to **Today's note**.
- You are choosing between Memory, the Knowledge wiki, Documents, and hand-written vault files (see below).
- You want capture off for this instance (`memory.capture.enabled: false`) — or the raw record off as well (`memory.l0.enabled: false`).
- A model ran without EYAS's isolation and what it wrote should be hidden from every model (**Quarantine a provider's memory**, owner only).
- You want to see what recall runs on here — the local embedder, how much memory already has vectors, and which capture switches are really on (the **Recall engine** card).

## Typical workflow

1. Open **Memory** in the sidebar (**Content** section) — route `/memory`. (Also listed under **Settings → AI & Model**.)
2. Check **Overview** (counts, salience, recent episodic memories and the **Recall engine** card), then **Vault Files** for durable notes.
3. Have a conversation longer than ~40 characters that states a lasting fact. Return here after the reply — you should see a new vault note (kind `user`, `feedback`, `domain`, `project`, or `reference`).
4. If nothing appeared, it was too short, capture is off, no background model could run the capture (see [Capture runs on the background model](#capture-runs-on-the-background-model)), or the turn was God Mode (the race's own turn writes no vault note; each worker's run is captured on its own). Hand-write a note in the vault if you need it anyway. A God Mode turn still leaves the reply that won in the raw record — see [The raw record](#the-raw-record).

## Which store to use

| Store | Job |
|-------|-----|
| **Memory** (this page) | Facts EYAS records automatically — agents never write memory themselves. EYAS attaches a one-line index, and what it recalled for the message, to every later turn. Source of truth for "what the assistant knows about you." |
| **Knowledge** wiki | Curated pages **you** edit (spaces, tree, versions). Not filled by capture. |
| **Documents** | Files you upload (PDF, images, …) for retrieval — not durable identity notes. |
| **Vault files** (hand-written markdown) | Same vault as capture (`<data dir>/vault/…`, by default `data/vault/…`). Write one yourself; EYAS picks it up. Do **not** treat `~/.claude` or `~/.grok` as this store. |
| **Project wiki** | Per-project ticket and decision pages, not global memory. |
| **Raw record** | Every message EYAS persists, kept a second time word for word and compressed. Written automatically since 0.8.23; no page displays it, and the assistant reaches it only through recall. |

Host Claude / Grok memory on the machine is **not** the source of truth, and models cannot reach it. Claude Code always runs isolated and loads no host configuration or auto-memory; Grok and Kimi run in their own EYAS home; the security gate refuses reads as well as writes of any other tool's memory; and MCP servers that keep a memory outside EYAS are blocked. The master prompt tells every agent the same (see [Prompts — the memory contract](/docs/en/ai/prompts/#the-memory-contract-in-the-master-prompt)). See [Memory outside EYAS is refused](#memory-outside-eyas-is-refused).

## Features

Subtitle in the app: *5-tier hybrid memory system — working, episodic, semantic/procedural vault, archive*.

### Actions

| Control | Meaning |
|---------|---------|
| **Today's note** | Jump to / create today's note |
| **Consolidate Now** | Run the consolidator (promote/demote memories) |
| **Refresh** | Reload stats |

Above the tabs, the **Morning briefing** card shows the latest nightly reflection digest when there is one (the reflection job is off by default: `memory.reflection.enabled`).

### Tabs

| Tab | Content |
|-----|---------|
| **Overview** | Stats, salience charts and recent episodic memories, then the **Recall engine** card and the **Quarantine a provider's memory** card (owner only) |
| **Working Memory** | Short-TTL blocks (24h) |
| **Episodic Memory** | Facts/episodes with salience |
| **Vault Files** | Markdown vault browser |
| **Archive** | Low-salience archived items |
| **Graph** | Memory graph view |
| **Tags** | Tag browser |
| **Review** | Review queue for memory hygiene |

### Overview

| Stat | Meaning |
|------|---------|
| **Working Blocks** | Active working blocks (24h TTL) |
| **Episodic Facts** | Episodic count (+ invalidated) |
| **Vault Files** | Semantic + procedural markdown files |
| **Archived** | Low-salience archive count |
| **Ready for promotion** → vault | High-value episodic candidates |
| **Ready for demotion** → archive | Low-salience candidates |
| Salience min / avg / max | Distribution |
| **Top Tags** / **Episodic — By Source** | Breakdowns |

Below the stats come the [Recall engine](#recall-engine) card and the [Quarantine a provider's memory](#quarantine-a-providers-memory) card.

### Tab details

Each **Working Memory** row shows *N chars · accessed N× · expires (time)*.

On **Episodic Memory**, click a row to open its detail:

| Field | Meaning |
|-------|---------|
| **Salience** | Importance score |
| **invalidated** | No longer trusted or current |
| **ID / Source / Source ID / Agent** | Provenance |
| **Access count / Conversation count** | Usage |
| **Valid from / Invalidated at / Created / Last accessed** | Lifecycle timestamps |
| **Embedding hash** | Whether the item has a vector |
| **Tags** | The item's tags |

**Vault Files**:

| Control | Meaning |
|---------|---------|
| **Files** | Vault paths |
| **Frontmatter** | YAML metadata |
| **tags:** / **links:** | Tags and wikilinks |
| **Content** | Markdown body |
| **Backlinks** | Notes linking here |

Each **Archive** row shows *archived (date) · original (date)* and *id · original id*. The consolidator moves low-salience items here.

### Recall engine

The **Recall engine** card on **Overview** shows, read-only, the machinery every model recalls through. It is the same whichever chat provider answers, and nothing on it can be changed from the card.

| Line | What it shows |
|------|---------------|
| **Embedder** | The local model that turns memory and queries into vectors: *Multilingual e5 (local)* when the multilingual-e5-small weights loaded, otherwise *Hashed stem embedder (local fallback)*, with the model id underneath. *Off* only when no embedder could be built at this start; vector recall is then off (see [Vector search always runs locally](#vector-search-always-runs-locally)). |
| **Summaries with a vector** / **Facts with a vector** | *X of Y*. Y is the summaries and facts recall can return: current, not superseded, not quarantined; items tagged `contains-secrets` are left out unless `memory.recall.includeSecrets` is on. X is how many of them already have a vector from the current embedder. A gap closes within seconds of the next memory write. Vectors made by an earlier embedder do not count; they are replaced at the next start. |
| **Vectors last updated** | When the background vector worker last ran in this server process. It reads *Not since start* until its first pass after a restart, which comes a couple of seconds after start. |
| **Project partitions** | How many projects and project types have vectors filed in their own partition — what keeps one project's memory out of another's recall. Only partitions that hold vectors now count; global memory always has its own. |
| **Raw record** | Whether the [raw record](#the-raw-record) is being captured: `memory.l0.enabled` is on and the capture started at boot. |
| **Tool output capture** | `memory.l0.captureToolResults`. *Off* whenever the raw record is off, because nothing is recorded then. |
| **Reasoning capture** | `memory.l0.captureThinking`. Also *Off* whenever the raw record is off. |
| **Recall notes with secrets** | `memory.recall.includeSecrets` |
| **Recall budget (100k-token window)** | `memory.index.budgetChars` (2,400 characters by default): the size of the recall block at a 100k-token context window; the block scales with the answering model's window (see [Standing memory lines](#standing-memory-lines)). |

The card shows the configuration EYAS is running with and reads it on every page load; a change in `local.yaml` shows after a restart. It is backed by `GET /api/v1/memory/engine`, which needs read access to memory (the owner, admin, user and agent roles; a guest gets `403`). It returns counts, switches and the embedder's id only — never memory content.

## Durable notes

A durable note is a lasting fact, not a record of something that happened: who
you are, how you want to be worked with, what a project's constraints are. Each
one is a single markdown file in the vault, and every turn the model is given a
**one-line index** of them — the summaries only, each line with an id — inside
the recalled-memory block attached to your message (see
[How recall reaches the model](#how-recall-reaches-the-model)). It opens a whole
note with `memory_expand` when the line turns out to matter, and looks further
with `memory_search` (see [Looking further](#looking-further-memory_search-and-memory_expand)).

The same block also carries what EYAS **retrieved for the current message** —
conversation summaries, facts, vault notes, episodic memory and earlier
messages — plus the full text of the best matches. The model does not have to
call `memory_search` for those hits to appear. Past messages are searchable
because they are already stored — recall makes no extra copy of them. (The raw
record below is a separate and deliberate second copy.) The separate *Related
prior work* block that used to be appended to the system prompt is gone: prior
work now arrives inside the recalled-memory block.

Two frontmatter fields drive this:

| Field | What it does |
|-------|--------------|
| `kind` | `user`, `feedback`, `domain`, `project` or `reference` — also the ranking order |
| `summary` | The single line that appears in the index |

`user` and `feedback` are ranked first, because they change how every answer is
produced. `domain` is the project type (shared by sibling projects); `project`
is this one project. A note with no `kind` is read as `feedback` if it lives in
`procedural/` and as `reference` otherwise — never as `user`: claiming an
undeclared note is a fact about you would put it at the top of every prompt.
Without a `summary` the note's first real line is used, so a file written by
hand in any editor works with no EYAS-specific frontmatter at all.

Where they live: `<data dir>/vault/semantic/`, `procedural/`, `projects/` and
`project-types/` — by default under `data/vault/`. The vault always lives in
the data directory and follows `EYAS_DATA_DIR`; it has no path setting of its
own (see [Configuration — Data directory and vault](/docs/en/deploy/configuration/#data-directory-and-vault)).
Write one yourself and EYAS picks it up.

**These fill themselves.** Once a reply has been delivered — in a chat, a
background card run, a specialist or delegated run, a team member's run, an
A2A task or a channel reply — a small model call
on EYAS's background model reads the exchange and asks whether anything in it
is still true and still useful in a month (see
[Capture runs on the background model](#capture-runs-on-the-background-model)). It may return up to two notes, and on most turns it correctly
returns none. This never happens inside the critical path of your answer, and a
capture that fails costs you a note, never a reply.

Only a length check and a per-conversation ceiling stand in front of that call, and you can switch it off — see [Capture is on by default](#capture-is-on-by-default). Writing a note by hand always works. Agents cannot write memory: EYAS records it automatically, and `save_memory` is retired — it writes nothing and tells the agent to use `memory_search` instead. OpenCode's model cannot write either: the EYAS memory plugin inside OpenCode offers only `memory_search` and `memory_expand`.

A candidate note passes the same instruction filter as facts and summaries
before it is written (see [Why some sentences are refused](#why-some-sentences-are-refused)),
and every note a model writes carries an `origin` in its frontmatter — `by:
capture`, plus the provider, the model and the conversation where known — so it
is remembered as model-written, never as your own words.

A fact you repeat reinforces the note that already exists rather than creating a
second one: the new wording is appended as a dated bullet under `## History`,
never written over the old. Text is masked by the privacy module before it
reaches disk, not when it is read back, with the same function and rules as
outgoing model traffic: dates are kept, and mask- and block-class values are
replaced — an IBAN in a note is stored as `[IBAN]`. That is true of vault notes;
the raw record below, the conversation summaries and the facts are stored
verbatim inside EYAS and masked only when they leave it (see
[Memory and privacy](#memory-and-privacy)).

**Project memory.** A fact learned inside a project's conversations is filed
under `projects/<project-id>/`, ranks ahead of general reference notes while you
are working in that project, and is not shown anywhere else — another project's
notes never reach your prompt. The **General** project that every conversation
starts in is not a project identity: facts learned there are kept as facts about
you or about how you want to be worked with, so they follow you everywhere
instead of being buried in a catch-all.

### Capture is on by default

Capture runs on **every** conversation, globally, unless you set `memory.capture.enabled: false` (in `local.yaml`, then restart). It runs on every way EYAS runs a model: your own chat turns, background card runs, specialist and delegated runs (`run_specialist` / `delegate_to_agent`, ticket-to-code pipeline stages included), A2A tasks from a peer agent, each team member's run and each channel reply (Telegram, e-mail, Slack, …). All of them go through the same gate and the same settings, and `memory.capture.enabled: false` switches every path off. A run that answered nothing writes no row. A message shorter than `minUserChars` never buys a model call, and a conversation gets at most `maxPerConversation` of them. A specialist or team member runs in its own sub-conversation, so it has its own ceiling; a channel conversation shares one ceiling across all its messages. So every specialist, team member and channel reply whose instruction is at least `minUserChars` long can spend one extra background model call. When no background model is eligible, or the budget is at *stop*, no call is made and the run is recorded as a skip (see [Capture run ledger](#capture-run-ledger)).

**Who wrote the message decides how it is read.**

- Your own chat messages are read as yours.
- A delegated task, a team brief, a hand-off brief or a card's goal is read as a task instruction that an agent may have written for you. Only facts it states about you, the project or the world are kept, never the task's own steps.
- A channel message or an A2A task is a third party's words. It can never create a note about who you are (`user`) or a rule for how to work (`feedback`) — tell EYAS those in the app. It can produce only `reference`, `project` or `domain` notes, which carry `trust: peer` in their frontmatter and are stored at peer trust, not as model-derived. Such a note never adds to one of your existing notes: a restated fact gets its own file. The length gate counts only the sender's words, so a short "ok" over a channel buys no model call.

| Gate | Default | Meaning |
|------|---------|---------|
| `memory.capture.enabled` | **on** | Master switch |
| `minUserChars` | 40 | Unicode code points; shorter messages skip the model call |
| `maxPerConversation` | 20 | Model-spend ceiling (successful, unparsable, rejected-shape, instruction-filter (`poison_gate`) and error runs count; too-short, no-eligible-model and budget-stop skips do not, because no model was called) |
| `maxInputChars` | 4000 | Your message and the reply are each clipped to this many characters before the capture model sees them |

There is no keyword list in any language. `{"notes":[]}` is the common and
correct extractor answer (0–2 notes, kinds `user` / `feedback` / `domain` /
`project` / `reference`).

### Capture runs on the background model

Memory capture, the nightly consolidation and the reflection briefing all use
EYAS's **background model**: an API provider, or a CLI that can run an isolated
call (today Claude Code; Grok CLI and Kimi Code CLI once EYAS has verified their
isolation on this host). The order is the Heartbeat routing tier, then the
install default, then API providers, then CLIs that can run isolated. It never
falls back to a provider the gateway picks on its own, and never to a CLI that
cannot isolate.

Every extraction, consolidation and reflection call is **isolated**: one turn,
no tools, no CLI-native memory or configuration, and the instruction sent as
the system prompt. When the extraction model is remote, block-class values in
the exchange reach it masked (`[IBAN]`) with dates intact, so a turn that
mentions an IBAN still produces its note.

With an API provider or Claude Code enabled, nothing visible changes. On an
install with no eligible background model — for example Grok-only or Kimi-only
before their isolation is verified:

- **Capture makes no model call.** Each qualifying turn writes a capture-ledger
  row with the skip reason `no_eligible_model` and no provider. It is a recorded
  skip, not an error.
- **Nightly consolidation** does not turn recurring episodic memories into a
  vault note. Those clusters are left untouched (not summarised, not
  invalidated) and are promoted on a later night once an eligible model exists.
- **The reflection / morning briefing** keeps only its deterministic part (for
  example overdue tasks), with no model-written accomplishments, learnings or
  suggestions.

When the model budget is at *stop*, capture records the skip reason
`budget_stop` and makes no call.

Without isolation the extractor once read the owner's host memory, reported the
fact "already recorded", and the EYAS vault stayed empty. That is the bug this
closes.

### Capture run ledger

Every outcome that reaches the gate writes a `memory_capture_runs` row: skips
with their reason (`too-short`, `cap-reached`, `unparsable`, `rejected-shape`,
`poison_gate`, `no_eligible_model`, `budget_stop`, `error`), extractions with
the kinds they wrote (a `poison_gate` run still counts the notes from the same
answer that were saved), plus a `provider` column: `provider/model`, `provider/route` when a CLI
answered without naming its model (for example `claude-code/isolated-cli`), or
null when no model was called. A failed or empty extraction call writes an
`error` row naming the provider it attempted. The `entry_path` column records
which run path the row came from: `interactive`, `background`, `delegation`,
`pipeline`, `a2a`, `team` or `channel` (empty on rows written before this
release). Two silences are
deliberate: capture switched off writes nothing, and a run with no
assistant text never reaches the gate. A **God Mode** race returns its own
stream before the post-turn block, so the race's own turn writes no vault note
and no row here; each worker runs as a background run of its own and is
captured there, reading the task as an agent-written instruction.
The raw record below is a separate ledger and does cover them.

## How recall works

Every turn, whatever model answers, EYAS attaches what it remembers to your message in one block:

- **Standing notes** — a one-line index of durable notes and summaries, each line with an id the model can open;
- **Retrieved hits** — the summaries, facts, notes, episodic memories and earlier messages that match this message, ranked by relevance, age and who wrote them;
- **The best matches in full** — the full text of the top two (four for a model that cannot call tools).

All of it comes only from the memory the conversation may see (its project, its project type and global memory), is searched in the language you write in, and is weighed by trust. The model can look further with `memory_search` and `memory_expand`, three calls per answer. The sections below take these one by one.

### Which memory a conversation can see

A conversation sees three kinds of memory: its own project's, its project
type's, and global memory. It never sees another project's memory. A
conversation outside any project — including one in the default **General**
project — sees global memory only.

One rule covers everything the model gets: the memory injected on every turn,
the standing index lines, vector recall, and the `memory_search`,
`memory_expand` and `search_memory` tools.

What decides where a vault note belongs is its frontmatter:

| Note declares | Visible in |
|---------------|------------|
| `project:` | That project only, whatever the note's kind. (Earlier, `user` / `feedback` / `reference` notes were shown everywhere even when they named a project.) |
| only `projectType:` | Projects of that type |
| neither | Everywhere (global) |

Moving a note into `projects/<id>/` of a project that exists, or adding
`project:` to its frontmatter, scopes it to that project — and so are the facts
and summary EYAS derives from it: they are recalled only inside that project
instead of in every conversation. The Memory page search (`/memory`) is still
unfiltered.

### How recall reaches the model

What EYAS remembers for a message is attached **to that message**, not to the
system prompt. It arrives as one fenced block, `<eyas-memory>`, inside a
`<turn-context>` block that EYAS adds at the top of your current message,
together with the current date and time (in `i18n.timezone`, else the server's
zone). The block holds, in this order:

1. the standing notes — the one-line index, each line with its id;
2. the notes retrieved for this message;
3. the full text of the best matches.

The format is the same on every provider — API models, Claude Code, Grok CLI, Kimi Code CLI, local models — and on every kind of run: interactive chat;
background runs (board bot cards, retries and resumes, God Mode workers);
specialists and delegated agents (`run_specialist` / `delegate_to_agent`) and
ticket-to-code pipeline stages; team members; channel replies spoken in the
owner's (internal) voice; and [OpenCode](/docs/en/automation/opencode/) tasks.
A chat with no colleague, in a project with no default agent, gets no assembled
system prompt but still gets the date, time and recalled memory. A `system`
override in the message request replaces only the system prompt; recall still
arrives. A resumed run (refresh, approval resume, critic feedback) gets a fresh
date, time and recall, not the ones captured when the run started.

- **Data, not instructions.** The block tells the model that it is data, not
  instructions, and asks it to cite what it uses as `[source:<id>]`. Text inside
  it cannot close the block or pose as a system or user message: such tags are
  neutralised but stay readable.
- **Never saved.** Your stored message is never changed; the block is added only
  to the copy sent to the model, so EYAS never re-captures its own recall as
  memory.
- **A stable system prompt.** Because the clock moved into this block too, the
  system prompt stays the same from turn to turn, which keeps it cacheable.
- **Tool names for the host.** Drill-down hints name the tools the way the
  model's host lists them: `memory_search` / `memory_expand` on native
  providers, `mcp__eyas__memory_search` on Claude Code, `use_tool` with
  `eyas__memory_search` on Grok CLI, and `memory_search` on the `eyas` MCP
  server for Kimi. A model that cannot call tools gets no drill-down hint and up
  to four full-text notes instead of two, and its prompt says that this block
  is all the memory it gets and that it cannot search further, instead of
  pointing it at `memory_search` / `memory_expand` (see
  [Prompts — The memory contract](/docs/en/ai/prompts/#the-memory-contract-in-the-master-prompt)).
- **No owner memory for outside readers.** Tasks from an A2A peer, and channel
  replies whose voice scope is External (**Force External** on the
  conversation, or a temporary override), get the date and time only. If EYAS
  cannot determine a channel reply's voice scope, the reply also goes out
  without recalled memory. The memory tools themselves are unchanged and stay
  governed by the security gate.

The whole block, frame included, is sized by `memory.index.budgetChars`
(see [Standing memory lines](#standing-memory-lines)), scaled with the window of
the model that answers — for an OpenCode task, the window OpenCode lists for
the chosen model (see [OpenCode — Memory sent with a task](/docs/en/automation/opencode/#memory-sent-with-a-task)). In the
[Context composition](/docs/en/daily/conversations/#context-composition) panel,
recall is the **memory-recall** section in the **turn** zone, next to
**turn-time** (the clock); the *memory-index* and *related-work* sections no
longer appear. The panel's **Memory delivered** box shows, for every provider,
the model and window the block was sized for, how many items were recalled and
how many in full against the block's cap, why recall was withheld if it was,
and the turn's drill-down calls out of the cap of 3.

To compare providers over a period, **Observability → Context** has a **Memory delivery by provider** card: for each provider, how many turns carried memory, the average items per layer and memory tokens on those turns, and how often the model opened memory itself. Similar numbers mean every model received the same memory. See [Observability](/docs/en/admin/observability/).

### What recall searches with

Every turn searches memory with the same query, whether it is a chat or a
background or scheduled run of a conversation. The query is built, without a
model call, from:

- your current message (if it is empty, your last message in this conversation);
- your previous, different message (first 400 characters);
- the conversation's title (first 120 characters; an *Untitled* placeholder is
  ignored);
- the conversation's task description or goal (first 400 characters).

It is at most 1,200 characters, your message comes first, and a part already
contained in an earlier one (for example a title made from your first message)
is not repeated. Only this conversation's own messages are used, never another
conversation's. So a short follow-up such as *yes, do it* recalls the task
under discussion, and a background run of a conversation without a description
still searches by its title. (Before, chat searched with the current message
alone, and a background run with the task description alone.)

**The search reads your language.** The language is taken from the query
itself. For a short message with no clear language, EYAS uses the language the
conversation has been held in; if that is unknown too, the common function
words of every supported language are ignored. So Hungarian, German, Spanish
and French function words (*hogy*, *csak*, *aber*, *para*, *avec* …) no longer
count as search terms or let unrelated notes through, and Klingon queries get
the stronger keyword weighting. The model's own `memory_search` queries — OpenCode's included — resolve their language the same way.

### How recall ranks

Every model, every entry path and the `memory_search` / `memory_expand` tools
use the same ranking. Nothing needs configuring or migrating.

- **Relevance first**: how well a note or past message matches your message.
  Then how recent it is and how important it is, plus a small bonus for memory
  from the same task (conversation) or the same project.
- **Age counts per kind of memory.** Facts go stale fastest (about a month),
  past messages in about three months, summaries and vault notes slowly (about a
  year), and pinned summaries never age. For a vault note, age means when EYAS
  last indexed it — when the note last changed; for a past message, when it was
  written. (Before, every note and past message counted as brand new.)
- **Who wrote it weighs.** Your own messages and text written by EYAS agents or
  models count fully; tool output and third-party imported text weigh 0.6×; text
  from channel senders weighs 0.3×. This uses the trust EYAS stored when it
  saved the item (see [Trust: who wrote it](#trust-who-wrote-it)).
- **Never recalled:** text flagged as a possible prompt injection
  (quarantined), also through the summary of the conversation it came from, a
  model's own reasoning, and recorded tool calls (see
  [Tool results are not recorded](#tool-results-are-not-recorded--and-why-to-leave-it-that-way)).
- **A past message is its own words.** A recalled line from an earlier
  conversation shows that message's own text — the passage around your search
  words, at most 280 characters — instead of the conversation's summary or only
  its id. Vault notes and past messages compete on equal terms (before, keyword
  matches from past messages always ranked ahead of matching notes), and a note
  imported into the raw record comes back once, as the note.
- The Memory page search (`GET /api/v1/memory/search`) and the `memory_search`
  fallback show past messages' own text too, never flagged text, model
  reasoning or recorded tool calls.

### Vector search always runs locally

Whatever chat provider answers — Claude Code, Grok, Kimi or an API provider —
EYAS turns memory into vectors on the machine itself: with the
multilingual-e5-small model when its weights are available, otherwise a
simpler built-in hashed embedder (lower quality, no download needed). Memory
text is never sent to a provider's embedding API in order to be recalled.

- The **Embedding** routing tier now only feeds the older vault and episodic
  search index; recall never uses it. (Earlier, setting that tier quietly
  switched off vector recall of summaries and facts and sent them to that API
  at every start.) When the embedder of that older index changes, the index is
  emptied once and rebuilt automatically.
- **New memory is searchable within seconds.** When EYAS writes a
  conversation's buffered messages to memory — when the task closes, after 30
  idle minutes, or when the buffer is full — the summaries and facts it extracts
  get their vectors about half a second later, not only after a restart.
- Superseded summaries, superseded or deleted facts, quarantined items and
  items marked as holding secrets (unless `memory.recall.includeSecrets` is on)
  are removed from the vector index, so they no longer take recall slots.
- The local e5 model is loaded at start on every install, also where an
  Embedding tier is set (about 100 MB of RAM). If it cannot load, EYAS uses the
  fallback embedder and keeps working. `eyas doctor` shows which one is in use
  on its **Memory embedder** line — see [CLI](/docs/en/deploy/cli/#what-doctor-checks).

Nothing needs configuring and nothing needs migrating: vectors made by an
earlier embedder are replaced automatically at the next start.

### Looking further: memory_search and memory_expand

When the recalled-memory block is not enough, the model calls
`memory_search`, then `memory_expand` to open a hit. `search_memory` is an
alias of `memory_search`.

- **3 calls per answer, on every provider.** The three tools together allow 3
  calls per answer — API models, Claude Code, Grok and Kimi alike. The count
  restarts with each new message you send and does not run out mid-answer,
  however long the model's own tool loop runs.
- **Opening a past message.** `memory_expand` on an `rw:` id returns the
  original message text, up to 8,000 characters, with its source type and
  trust. It adds the conversation's summary as context only when that summary
  is itself recallable (not flagged, not derived from secrets unless
  `memory.recall.includeSecrets` is on).
- **Locked to the conversation's project, by EYAS on the server.** Whatever the
  model, a CLI or a bridge sends, the tools read the conversation's own
  project, its type and global memory. A `scope` or project argument is
  ignored: looking at another project is something you do in the UI, never a
  tool argument. A call naming a conversation EYAS does not know returns the
  error *memory scope unresolved* and no results.
- Outside clients of EYAS's own MCP server have no EYAS conversation: their
  memory tool calls read global memory only, with a limit of 3 calls per 90
  seconds. The same limit applies to OpenCode calls that are not tied to a task.
- **OpenCode** offers the model the same two tools, with the same names and arguments, read-only. For a task EYAS delegates with `opencode_run`, they are locked to that conversation's project and share the calling turn's 3 calls. Everywhere else — an OpenCode terminal session started in the panel, a session EYAS did not create, or a signed-in caller who is not the session's user — they read global memory only. An OpenCode server attached from outside has no access to EYAS memory. See [OpenCode](/docs/en/automation/opencode/).

Each host lists these tools under its own name — `memory_search` on API
providers, `mcp__eyas__memory_search` in Claude Code, `use_tool` with
`eyas__memory_search` in Grok. See [MCP — tool names per host](/docs/en/ai/mcp/#tool-names-per-host).

### Standing memory lines

Every line of the standing memory index shows an id that `memory_expand`
opens: `(vt:<path>)` for a vault note, `(gs:<id>)` for a conversation summary.
`memory_expand` also opens entity ids (`en:<id>`): it returns the entity's
name, type, aliases and up to 10 current facts from the memory the
conversation can see.

The summary lines in the index are pinned summaries, the project's own summary,
and up to 5 most recent task summaries of the same project (or, outside a
project, of other projectless conversations) — never another project's, never
the current conversation's own, and never quarantined ones. (Earlier: the 20
most important summaries from any project.)

`memory.index.budgetChars` (2400 characters by default, about 600 tokens) is
the size of the **whole recalled-memory block**, frame included: standing notes,
retrieved notes and full-text matches together. That default is meant for a
model with a 100k-token context window; the block scales with the answering
model's window (up to 2.5× from 250k tokens, less below about 29k tokens, and none at all
for a very small window). An OpenCode task is sized the same way, for the
window OpenCode lists for its model, or exactly `memory.index.budgetChars` when
that window is unknown (before, OpenCode always got the unscaled value). Standing notes
come first but always leave room — up to half of the block — for what was
retrieved for the current message. Notes that do not fit are summed up in a
closing line, *… N more notes not shown*, which names the drill-down tool the
way the host lists it; they stay reachable through `memory_search`. Raise the
budget in `config/local.yaml` (and restart) when your `user` and `feedback`
lines no longer fit. Earlier versions shipped 8000 in `config/default.yaml` —
see the [upgrade note](/docs/en/deploy/configuration/#memory-index-and-recall).

On the first start after upgrading, EYAS files every existing memory vector
under its project, once and in batches (logged as *L3 repartition: vectors
filed under their project*). If it cannot finish, it logs a warning and tries
again at the next start. Nothing needs to be done.

### Project notes without a project

A note whose kind is `project` or `domain` but that carries no `project:` /
`projectType:` is **global**: it appears in the standing index, in
`memory_search` and in recall for every conversation, ranked as a project
note. Moving it into `projects/<id>/` — or stamping `project:` into its
frontmatter — scopes it to that project. Notes brought in by an import start out
this way until you create the matching projects.

### Imported secrets stay out of recall

The importer never drops a file because it holds a credential. It is stored
verbatim and the item carries the tag `contains-secrets` — as a note tag, a
skill capability or an episodic tag, depending on what it became.

By default such an item is left out of everything the model reaches on its own:
the standing index, recall, `memory_search`, the reflection job, the nightly
consolidator and the skill matcher. It is never embedded and never handed to
the optional enrichment model. The Memory page still shows it to you in full.

**Everything derived from it stays out too.** The tag carries over from the
note or episode to its copy in the raw record, to every fact EYAS extracted
from it and to every summary built from it; a fact that is already known
becomes secret as well when a tagged note confirms it later. Such a raw row,
fact or summary is not embedded, not listed in the standing lines, not returned
by `memory_search` or `GET /api/v1/memory/search`, and cannot be opened with
`memory_expand`. When an entity is expanded, its secret facts are left out, and
a past message whose conversation summary is secret is shown without that
summary. (Before, these derived facts and summaries could still reach the
model.) A note written straight to disk with `contains-secrets` in its
frontmatter is treated as secret even before the vault indexer has seen it.

Setting `memory.recall.includeSecrets: true` in `config/local.yaml` and
restarting opens all of it to the model, as before.

**Upgrade.** On the first start after upgrading, EYAS marks the existing raw
rows, facts and summaries that came from tagged notes and episodes — once,
before building vectors — and logs a line. If another note or episode gets the
tag later, the next start marks its derived rows too. Markers are only ever
added: removing `contains-secrets` from a note by hand does not make the
summaries and facts already derived from it recallable again.

This gate stops automatic inclusion; it is not a filesystem sandbox. An agent
that holds file-read tools can still read the original file on disk. An
imported agent persona and an approved workspace rule file are not gated at all
— there the content *is* the prompt — so review those rows before you approve
them.

The tags `legacy` (an old memory folder) and `third-party` (someone else's
product documentation) are ordinary, fully recallable notes; they only say
where a note came from. Every imported item also carries `source:<adapter>`,
naming the adapter that read it. A note you write yourself may declare
`contains-secrets` in its own frontmatter and gets the same treatment. See
[Data import & export](/docs/en/admin/data-port/).

### Memory and privacy

EYAS stores memory raw and masks it on the way out. When memory is sent to a
remote model — injected into the prompt, or returned by `memory_search`,
`memory_expand` and the other memory tools — the privacy policy masks it for
that destination, and the same memory item is masked identically either way.
A local model (loopback, or a host listed as local in the privacy policy)
receives it unmasked. Vault notes are also masked at rest when they are
written (dates are kept).

Memory tool results are masked the same way on **every** path a model can use
to read EYAS memory: API and local providers, Claude Code's in-process EYAS
tools, Grok and Kimi over EYAS's MCP bridge, external MCP clients of EYAS's own
MCP server, and the OpenCode sidecar (its task prompt, the recalled memory sent
with the task, and the answers of its `memory_search` / `memory_expand` tools). A CLI, an external MCP
client and OpenCode always count as remote. If the privacy scan fails, the
result is withheld rather than sent unmasked. See
[Security & privacy — Where masking applies](/docs/en/admin/security-privacy/#where-masking-applies).

### Memory outside EYAS is refused

Agents are told that EYAS memory is the only memory they have, that EYAS
records it, and that they reach it with `memory_search` / `memory_expand`. That
is also enforced:

- **The security gate refuses reads as well as writes** of other tools' memory
  (`~/.claude`, `~/.grok`, `~/.codex`, `~/.gemini`, `~/.kimi`, `~/.cursor`,
  OpenCode's folders, `ai-memory` folders and the rest of the list), Obsidian
  vaults, every path in `security.foreignMemoryPaths`, EYAS's own data folder
  (vault, database, keys, the CLI sign-in homes) and another conversation's
  workspace — for every model and every tool call the gate checks. The model is told, for example, *Memory outside EYAS (Claude Code) — use memory_search / memory_expand from EYAS* — except on Grok CLI, which ends its answer at a refused call without its model seeing the reason (see [Providers — Grok CLI and Kimi Code CLI](/docs/en/ai/providers/#grok-cli-and-kimi-code-cli)). Earlier, only writes and shell access to
  `~/.claude`, `~/.grok` and `ai-memory` were blocked, and reads were allowed.
- **Claude Code's own tools** pass the same check before they run, including
  reads Claude Code would allow on its own inside its working folder.
- **Searches are judged by what they can reach.** A CLI's own search (Grep,
  Glob, a recursive shell command) whose folder contains another tool's memory,
  a vault or EYAS's data is refused as *Search too broad*, because the CLI
  cannot leave that place out; and a Folder that contains such a place can no
  longer be saved. See
  [Security & privacy — Memory outside EYAS](/docs/en/admin/security-privacy/#memory-outside-eyas).
- **The kernel file sandbox.** Claude Code's shell commands and Grok CLI's own
  tools also run inside the operating system's file sandbox where one is
  available, which blocks the same places even when a shell command reaches
  them in ways EYAS cannot read (see
  [Providers — Kernel file sandbox](/docs/en/ai/providers/#kernel-file-sandbox)).
  **Security Events** lists what is protected on this server in its
  **Memory outside EYAS** card.
- **The CLIs run isolated.** Claude Code loads no host `CLAUDE.md`, settings,
  skills, MCP servers or auto-memory; Grok CLI and Kimi Code CLI run in their
  own EYAS home and never see `~/.grok`, `~/.kimi` or `~/.claude`. See
  [Providers](/docs/en/ai/providers/#claude-code-isolation).
- **MCP servers that keep a second memory** (the Memory knowledge-graph server,
  Qdrant, Obsidian, MCPVault, …) or that point at a protected folder are blocked
  for every model. See [MCP](/docs/en/ai/mcp/#memory-store-servers-are-blocked).

**Migration.** Agents that used to read `~/.claude/CLAUDE.md`, `~/.grok`
memory, vault notes or files under `data/` directly are now refused (**Security Events** shows each refusal). Bring that knowledge into EYAS once with
[Data import](/docs/en/admin/data-port/). Details and what is not covered yet:
[Security & privacy — Memory outside EYAS](/docs/en/admin/security-privacy/#memory-outside-eyas).

---

## The raw record

**Nothing said is lost.** Every message EYAS writes down — yours, the
assistant's, and the output of background agent runs — is now kept a second
time, word for word, in a raw record beside the conversation itself. It is
compressed on the way in (roughly 2.7× smaller on real text) and filed under a
hash of its own bytes, so the same sentence repeated inside one conversation is
stored once and counted twice.

**What reads it.** There is no page and no command that shows the raw record
to you. The assistant reaches it only through memory recall, inside the same
project scope as everything else: the summaries and facts EYAS works out from
it (below) appear as standing memory lines and search hits, and
`memory_search` / `memory_expand` can open them and raw rows — see
[Which memory a conversation can see](#which-memory-a-conversation-can-see).

What has changed for you today is where your words live. A conversation is no
longer the only copy of what was said in it: closing, archiving or deleting a
conversation leaves the raw record standing, and there is no button anywhere
that erases it. If that is not what you want, switch the raw record off before
you use EYAS for anything you would later want gone (see below).

Writing is batched rather than immediate. Messages are held per conversation
and written out when the conversation closes (or is moved into a closed stage),
when about 8,000 tokens have piled up, when the conversation has been idle for
30 minutes, or when EYAS shuts down — a restart loses nothing that was already
said.

Each message is also stamped with where it came from, and that stamp is never
inherited. A summary or fact can never end up trusted more than the words it
was made from — see [Trust: who wrote it](#trust-who-wrote-it).

### Trust: who wrote it

How far EYAS trusts a remembered text depends on **who wrote it**, not on which
side of the conversation it appeared.

| Trust | What it covers |
|-------|----------------|
| **owner** | What you type in a conversation, including a God Mode turn |
| **derived** | Text an agent or EYAS itself wrote: the model's answers, a task one agent delegates to another, a handoff brief, the prompt that Prompt coach / Prompt enhancer composes around your draft, a board card's goal when it runs in the background, and the brief a team member receives |
| **peer** | Messages from channel senders (Telegram, e-mail and other channels) and tasks another system sends over A2A, and the vault notes memory capture draws from them (`trust: peer`) |
| **ingested** | Tool output |
| **quarantined** | Flagged text — kept, but never recalled |

Facts and summaries are never trusted more than the text they came from, so a
line like *Target model: X* in a coach prompt, or *Deadline: Friday* in a
delegated task, can no longer become an owner-level fact. Recall weighs these
tiers too (see [How recall ranks](#how-recall-ranks)): tool output and imported
third-party text count 0.6×, channel senders 0.3×, quarantined text never.

**Background and team instructions are remembered too:** a card's goal when a
background run starts it, and each team member's brief. Each distinct
instruction is remembered once, however often the run is retried or resumed.
Nothing new appears in the conversation itself.

**Vault notes have a trust level as well.** A note a model wrote is *derived*,
not yours — the automatic per-turn notes, nightly consolidation and team
summaries. You can recognise them by an `origin` entry in the frontmatter
(`by: capture`, `consolidation` or `team`, plus the provider, the model and the
conversation where known), the `auto-consolidated` tag, or their link to the
conversation that captured them. Removing a note's `origin` by hand does not
make a capture note owner-trusted again, because the capture link still marks
it. A note capture drew from a channel message or an A2A task carries
`trust: peer` and is stored at peer trust; it never reinforces a note trusted
more than it, so a restated fact gets its own file.
Notes you wrote by hand or imported yourself stay *owner*. You can add `trust:`
to a note's frontmatter, but it can only **lower** the level, never raise it:
`trust: quarantined` keeps a note out of the standing memory lines, and the
assistant cannot open it with `memory_expand` (the file stays in the vault and
in the Vault browser).

**Upgrade.** At the first start after upgrading, EYAS reads each vault note
once to record its trust level, so that start takes a little longer. A few
seconds later a one-time background pass corrects the memory of existing vault
notes — model-written notes lose owner level, project notes move into their
project — and rebuilds their facts and summary. Nothing needs to be done, and
the pass does not repeat.

### What EYAS works out from it — with no model call

Each time a batch is written, EYAS reads back what it just wrote and works out,
on its own:

- **facts** from `key: value` lines in the text, plus a few from the
  conversation's own board card (title, project, project type, agent);
- **a short summary** of at most 280 characters — the first and last message
  plus a few of the most characteristic sentences between them;
- **entities**: dates, `@mentions`, `#tickets`, code identifiers, backticked
  terms, capitalised names;
- **topics**, and an **importance score** built from how long the conversation
  is, how much of it is yours, whether it contains decision wording (in five
  languages), whether it is closed, and whether you pinned it.

None of this calls a model. No provider is contacted, no API key is used, no
budget is spent, and there is nothing to configure. The other side of that
bargain is that it reads carefully rather than cleverly: it finds what was
stated plainly and misses what was merely implied.

Facts do not pile up. Saying the same thing again links to the fact that is
already there. Saying something new about the same subject — a deadline that
moves from Monday to Friday — retires the old fact with an end date instead of
overwriting it, so there is exactly one current answer and an intact history
behind it. Nothing is edited in place and nothing is thrown away. A fact also
never inherits a project or conversation label that its own sources do not all
carry.

Summaries and facts are what the standing memory lines (`gs:` ids), recall,
`memory_search` and `memory_expand` read. They get their search vectors about
half a second after a batch is written (see
[Vector search always runs locally](#vector-search-always-runs-locally)).

### What it costs you, and how to switch it off

The raw record grows with use, and **nothing prunes it yet** — there is no
retention setting and no cleanup job in this release. Measured, a recorded
message costs on the order of 5 KB on disk once its indexes are counted, so
expect the database to grow noticeably faster than it did before.

Three settings in `config/default.yaml`, all under `memory`:

| Setting | Default | Meaning |
|---------|---------|---------|
| `memory.l0.enabled` | **on** | Master switch. `false` records nothing at all; takes effect at the next restart |
| `memory.l0.extractInLegacy` | **on** | `false` keeps the text and works nothing out from it — no facts, no summaries, no topics |
| `memory.engine` | `legacy` | Decides only whether the deterministic fact extraction runs: `v2` always extracts; `legacy` extracts while `memory.l0.extractInLegacy` is on (the default). Recall is always the layered recall described on this page, whichever value is set |

`memory.capture.enabled: false` does **not** switch the raw record off. That
one governs vault notes and the small model call behind them; these two are
independent, and turning either off leaves the other running.

`eyas doctor` reports whether compression is available and which implementation
is in use. If none is, EYAS says so in the log and records nothing, rather than
quietly filling a buffer.

### Tool results are not recorded — and why to leave it that way

`memory.l0.captureToolResults` is **off by default**. Read this before you turn it on.

One switch covers every tool an agent run calls, whatever model answers: EYAS's own tools; EYAS tools that Claude Code, Grok or Kimi call over the EYAS bridge; and the built-in tools of Claude Code, Grok and Kimi — running commands, reading, writing or searching files. It also covers OpenCode: the tools OpenCode runs inside an `opencode_run` task, and the output of the conversation's OpenCode terminal (the terminal icon in the conversation's top bar), recorded only for a conversation that exists and belongs to the terminal's user. OpenCode's final answer and diffs are the `opencode_run` result and are recorded like any other tool result. (Before, OpenCode stored its terminal output and events whatever this switch said.)

- Only calls that actually ran are recorded. A failed call is recorded and marked as an error. Refused (denied), skipped and approval-waiting calls are not recorded, and neither are empty results or repeats of the same call.
- Each recorded call keeps what the call returned: the tool name, the output, whether it failed, the outcome, and who ran it (EYAS or the model's own CLI). The first 2,048 characters of the call's arguments are kept beside it as provenance only: they are not full-text indexed and never shape the topics, names or facts EYAS extracts.
- Only calls made inside an agent run that belongs to a conversation are recorded. A tool called outside any agent run (for example by an external MCP client) is not recorded. Terminal output is recorded only for a conversation that exists and belongs to the terminal's user.
- Recorded calls are filed under the conversation's project with trust *ingested* (see [Trust: who wrote it](#trust-who-wrote-it)).

With it on, the raw record keeps the **entire output of every tool call, word for word and unedited**, plus the first 2,048 characters of its arguments. That means a command's full output, the contents of every file the assistant reads, and any one-time code or token a tool happens to return — all of it sitting in the database as ordinary text. Nothing masks it, nothing scans it, and compression is not encryption. Vault notes pass through the privacy module before they are written; recorded tool results do not.

**What comes back into a prompt.** A recorded tool call is never recalled or quoted: not in the memory EYAS adds to a turn, not through `memory_search` or `memory_expand`, not in the Memory page search, and not in the summary of its conversation. Only its output shapes the topics and the names (a file or function name, for example) that EYAS extracts from the conversation; the arguments shape nothing. So a password a tool typed into a form, a search term or a path the model passed never becomes a topic, a name or a fact, and a token a command printed or a web page a tool fetched never reappears in another conversation's prompt — also not when that prompt goes to a remote model.

`memory.l0.toolResultMaxBytes` (8 KB) caps the record of what the call returned — tool name, output, error flag, outcome and who ran it — cut on a character boundary with a visible truncation marker. The arguments do not count against it; they are clipped separately to their first 2,048 characters. With the switch on, EYAS logs a warning at every start that tool results are stored verbatim and unredacted and that nothing scans or encrypts them.

### Model reasoning (audit only)

`memory.l0.captureThinking` (default **off**) keeps the reasoning ("thinking")
of any model that reports it in the raw record, one entry per model call. It is
for audit only: never turned into facts, never recalled into a prompt. It is
stored verbatim and unredacted like tool results, and EYAS prints a startup
warning while it is on.

Both switches are read at the start of every run from the running
configuration; a change in `local.yaml` applies after EYAS restarts.

**Provenance.** Recorded tool results and reasoning, and the replies of
background, team and delegated runs, now record the provider and model that
actually answered (not always the one requested, for example after a fallback)
and how the run started: interactive, background, team, delegation, A2A,
channel or pipeline. Older rows simply lack these fields.

### Why some sentences are refused

Text that reads like an instruction to the assistant is not allowed to become a
trusted fact. "Ignore all previous instructions", a "from now on you are…" role
change, or anything dressed up to look like a system message is refused
outright. Plain commands aimed at the assistant, orders to run a tool, and
"forget everything" wording are kept but marked untrusted, so that a later
recall can leave them out. The check covers English, Hungarian, German, Spanish
and French.

When a summary is refused, EYAS steps down rather than giving up: first to a
plainer summary, then to only the sentences that read clean, and last to a stub
that names the conversation without repeating its text. You never lose the
conversation, only the summary of it.

This is a pattern filter, not a proof, and it errs towards caution: ordinary
working prose such as `Run the following command in the pod: …` is sometimes
marked untrusted too. Text marked as a possible prompt injection (quarantined)
is never recalled or opened with `memory_expand`, also not through the summary
of the conversation it came from.

**Notes a model writes pass the same filter.** The per-turn memory capture, the
nightly consolidation summaries and the team-session summaries are checked
before anything is written to the vault, and any hit refuses the write:

- **Capture:** the refused note is dropped. The capture run is recorded with the
  reason `poison_gate`, and it counts against `maxPerConversation`, because the
  model was called.
- **Consolidation:** nothing is written and the episodic memories stay; the next
  nightly run tries again.
- **Team sessions:** only the offending finding or decision is left out.

Refusals appear in the server log with the detector's name, never with the
refused text, so a false positive is visible, never silent.

---

## Quarantine a provider's memory {#quarantine-a-providers-memory}

Use this when a model — typically a CLI such as Grok CLI, Kimi Code CLI or Claude Code — ran without EYAS's isolation and may have answered from memory outside
EYAS, such as another tool's memory folder or an Obsidian vault. Its answers
were saved into EYAS memory like any other turn and could then come back to
every model.

**Where:** **Memory → Overview**, card **Quarantine a provider's memory**. Only
the owner can use it; admins and users see *Only the owner can quarantine or
release memory.*

1. Tick one or more **Providers**. The list shows every provider that has
   written memory, with the number of its rows that can still be recalled.
2. Optionally set **From** / **To** dates. They are whole local days and
   inclusive; empty means no limit.
3. Click **Preview**. It shows how many raw rows, facts, summaries and capture
   notes would be hidden, and from how many conversations. Nothing changes yet.
4. Click **Quarantine**, then confirm it inline. Cancel changes nothing.

**What is hidden from every model**, on every path (the per-turn memory block,
`memory_search` / `memory_expand`, the standing memory index and vector search):

- the provider's replies and the tool output of its runs — by the provider
  recorded on each row; older rows without one use the provider the
  conversation is fixed to;
- every fact and summary derived from them, including a conversation's summary
  that also covers your messages, and any fact with at least one such source;
- the capture notes of the affected conversations. They move to the vault
  folder `.quarantine/<id>/…`, so they drop out of the vault browser, the note
  index and search.

**What is not affected:** your own messages are never quarantined; the
conversation transcript is unchanged; nothing is deleted. The provider's future
turns are still saved normally — quarantine is a cleanup, not a block, so
switch the conversation to another model or make sure the CLI runs isolated.
Semantic notes that nightly consolidation wrote from several conversations
carry no link to a conversation and are not traced; review those in the vault
browser.

**History and release.** The history lists each quarantine with its providers,
time and counts, and a **Release** button (or *Released &lt;date&gt;*).
Release restores exactly the trust levels the rows had before and moves the
notes back. If a new note has taken a restored note's path, the old one comes
back as `<name>-restored.md`, still marked as model-written. A note deleted from
the `.quarantine` folder by hand is reported as missing; everything else is
still restored. Anything the automatic poisoning check had already quarantined
stays quarantined, and so do facts and summaries created from quarantined rows
after the quarantine. Quarantining the same selection again does nothing;
overlapping quarantines can be released independently.

**Audit.** Every apply and release is written to the audit log (actions
`memory.quarantine.apply` / `memory.quarantine.release`, module `memory`) and
the server log; the exact record (row ids by previous trust level, moved notes)
is kept in the memory purge log.

**API (owner only; `delete` on MemoryEntry).** The body is `{providers:
string[], from?: epochMs, to?: epochMs, conversationIds?: string[]}`; an invalid
body gets `400`. `GET /api/v1/memory/quarantine` returns `{entries, providers}`;
`POST /api/v1/memory/quarantine/preview` returns `{counts}`; `POST
/api/v1/memory/quarantine` returns `201 {id, counts}`, or `200 {id: null}` when
there is nothing left to quarantine; `POST /api/v1/memory/quarantine/:id/release`
returns `404` for an unknown id and `409` if already released.

## Shared memory blocks (retired)

The agent tools `memory_block_read` and `memory_block_write` no longer exist.
What agents had stored in blocks is not lost: on the first start after the
upgrade, every block is copied once into EYAS memory as a model-written note,
and from then on it is found like any other memory — in the standing recall,
with `memory_search` and with `memory_expand` (as an `rw:` hit). Blocks become
global memory, as they always were in practice (any agent could read any
block). A block whose text looks like an instruction to the assistant is kept
for audit but never recalled. A custom agent whose tool list still names
`memory_block_*` simply no longer gets those tools; nothing fails.

## Related

- [Knowledge base](/docs/en/knowledge/knowledge-base/)
- [Documents](/docs/en/knowledge/documents/)
- [Project wiki](/docs/en/knowledge/client-wiki/)
- [Providers](/docs/en/ai/providers/) (CLI isolation)
- [Security & privacy](/docs/en/admin/security-privacy/) (memory outside EYAS)
- [Data import](/docs/en/admin/data-port/)
- [Configuration](/docs/en/deploy/configuration/) (`memory.l0.*` keys)
- [Tools](/docs/en/automation/tools/)
- [OpenCode](/docs/en/automation/opencode/) (memory tools inside OpenCode)
- [Observability](/docs/en/admin/observability/) (memory delivery by provider)

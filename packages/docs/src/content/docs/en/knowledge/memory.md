---
title: Memory
description: What EYAS remembers — automatic vault notes, five tiers, the raw record of every message, and when to use which store.
---

**What this is for.** Memory is EYAS's own long-term store. A durable fact you state in a conversation becomes a vault note without anyone asking, and the same note is what every later conversation reads back. This page is where you inspect working blocks, episodic facts, vault files, and the review queue — not where you curate a wiki. Since 0.8.23 EYAS also keeps a raw record of every message it persists; that one is written but not yet readable anywhere, and **The raw record** below is all there is to know about it.

## When to use it

- You want the assistant to remember who you are, how you work, or a project's constraints.
- A fact was stated in chat and you want to confirm it landed in the vault (or why a capture was skipped).
- You need to review, tag, graph, or consolidate memories — or jump to **Today's note**.
- You are choosing between Memory, the Knowledge wiki, Documents, and hand-written vault files (see below).
- You want capture off for this instance (`memory.capture.enabled: false`) — or the raw record off as well (`memory.l0.enabled: false`).

## Typical workflow

1. Open **Memory** in the sidebar (**Content** section) — route `/memory`. (Also listed under **Settings → AI & Model**.)
2. Check **Overview** (counts, salience, recent episodic), then **Vault Files** for durable notes.
3. Have a conversation longer than ~40 characters that states a lasting fact. Return here after the reply — you should see a new vault note (kind `user`, `feedback`, `domain`, `project`, or `reference`).
4. If nothing appeared, it was too short, capture is off, or the turn was God Mode (those write no vault note). Hand-write a note in the vault if you need it anyway. A God Mode turn still leaves the reply that won in the raw record — see **The raw record** below.

## Which store to use

| Store | Job |
|-------|-----|
| **Memory** (this page) | Automatic + agent-written facts. EYAS injects a one-line index into later prompts. Source of truth for "what the assistant knows about you." |
| **Knowledge** wiki | Curated pages **you** edit (spaces, tree, versions). Not filled by capture. |
| **Documents** | Files you upload (PDF, images, …) for retrieval — not durable identity notes. |
| **Vault files** (hand-written markdown) | Same vault as capture (`data/vault/…`). Write one yourself; EYAS picks it up. Do **not** treat `~/.claude` or `~/.grok` as this store. |
| **Project wiki** | Per-project ticket and decision pages, not global memory. |
| **Raw record** | Every message EYAS persists, kept a second time word for word and compressed. Written automatically since 0.8.23; nothing reads or displays it yet. |

Host Claude / Grok memory on the machine is **not** the source of truth. Isolated CLI calls and the default-off `loadClaudeMd` setting exist so a second memory cannot pre-empt the vault.

## Features

Subtitle in the app: *5-tier hybrid memory — working, episodic, semantic/procedural vault, archive.*

## Actions

| Control | Meaning |
|---------|---------|
| **Today's note** | Jump to / create today’s note |
| **Consolidate Now** | Run consolidator (promote/demote memories) |
| **Refresh** | Reload stats |

## Tabs

| Tab | Content |
|-----|---------|
| **Overview** | Stats + salience charts + recent episodic |
| **Working Memory** | Short-TTL blocks (24h) |
| **Episodic Memory** | Facts/episodes with salience |
| **Vault Files** | Markdown vault browser |
| **Archive** | Low-salience archived items |
| **Graph** | Memory graph view |
| **Tags** | Tag browser |
| **Review** | Review queue for memory hygiene |

## Overview stats

| Stat | Meaning |
|------|---------|
| **Working Blocks** | Active working blocks (24h TTL) |
| **Episodic Facts** | Episodic count (+ invalidated) |
| **Vault Files** | Semantic+procedural markdown files |
| **Archived** | Low-salience archive count |
| Ready for promotion → vault | High-value episodic candidates |
| Ready for demotion → archive | Low-salience candidates |
| Salience min/avg/max | Distribution |
| Top tags / by source | Breakdowns |

## Working memory row

chars · accessed N× · expires time

## Episodic row / detail

| Field | Meaning |
|-------|---------|
| **salience** | Importance score |
| **invalidated** | No longer trusted/current |
| **ID / Source / Source ID / Agent** | Provenance |
| **Access count / Conversation count** | Usage |
| **Valid from / Invalidated at / Created / Last accessed** | Lifecycle timestamps |
| **Embedding hash** | Vector index presence |

## Vault browser

| Control | Meaning |
|---------|---------|
| File list | Vault paths |
| **Frontmatter** | YAML metadata |
| **tags / links** | Wikilinks and tags |
| **Content** | Markdown body |
| **Backlinks** | Notes linking here |

## Archive

archived at · original created · ids — consolidator moves low-salience items here.

## Durable notes

A durable note is a lasting fact, not a record of something that happened: who
you are, how you want to be worked with, what a project's constraints are. Each
one is a single markdown file in the vault, and every turn the agent is given a
**one-line index** of them — the summaries only. It reads a whole note with
`search_memory` when the line turns out to matter.

A second per-turn block retrieves **related prior work** from the vault,
episodic memory, and past conversation messages, using the current
message as the query. The model does not have to call `search_memory`
for those hits to appear. Bodies still load through `search_memory`.
Past messages are searchable because they are already stored — this block
makes no extra copy of them. (The raw record below is a separate and
deliberate second copy; nothing reads it yet.)

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

Where they live: `data/vault/semantic/`, `data/vault/procedural/`,
`data/vault/projects/`, `data/vault/project-types/`. Write one yourself and EYAS picks it up.

**These fill themselves.** Once a reply has been delivered, a small model call
reads the exchange and asks whether anything in it is still true and still
useful in a month. It may return up to two notes, and on most turns it correctly
returns none. This never happens inside the critical path of your answer, and a
capture that fails costs you a note, never a reply.

What stands in front of that call is a single length check — a message shorter
than `minUserChars` (40 characters by default) never buys one — plus a ceiling of
`maxPerConversation` (20) model calls per conversation. There is no keyword list
in any language. Switch the whole thing off with `memory.capture.enabled: false`
in `config/default.yaml`. Writing a note by hand and an agent calling
`save_memory` both still work exactly as before.

A fact you repeat reinforces the note that already exists rather than creating a
second one: the new wording is appended as a dated bullet under `## History`,
never written over the old. Text passes through the privacy module before it
reaches disk, not when it is read back. That is true of vault notes; the raw
record below is stored verbatim, without that pass.

**Project memory.** A fact learned inside a project's conversations is filed
under `projects/<project-id>/`, ranks ahead of general reference notes while you
are working in that project, and is not shown anywhere else — another project's
notes never reach your prompt. The **General** project that every conversation
starts in is not a project identity: facts learned there are kept as facts about
you or about how you want to be worked with, so they follow you everywhere
instead of being buried in a catch-all.

Agents recall with `search_memory`. Default **`scope` is `current`**: this
project, its type, and global user / feedback / reference notes — not other
projects. Pass `scope: all` when the agent must look across the whole vault.
The Memory page search (`/memory`) is unfiltered.

### Project notes without a project

A note whose kind is `project` or `domain` but that carries no `project:` /
`projectType:` is **global**: it appears in the always-on index, in
`search_memory` and in related work for every conversation, ranked as a project
note. Moving it into `projects/<id>/` — or stamping `project:` into its
frontmatter — scopes it to that project. Notes brought in by an import start out
this way until you create the matching projects.

The always-on index has a character budget, `memory.index.budgetChars`, 2400 by
default. Raise it when your `user` and `feedback` lines no longer fit into it.

### Imported secrets stay out of recall

The importer never drops a file because it holds a credential. It is stored
verbatim and the item carries the tag `contains-secrets` — as a note tag, a
skill capability or an episodic tag, depending on what it became.

By default such an item is left out of everything the model reaches on its own:
the always-on index, `search_memory`, related work, the reflection job, the
nightly consolidator and the skill matcher. It is never embedded and never
handed to the optional enrichment model. The Memory page still shows it to you
in full. Setting `memory.recall.includeSecrets: true` in `config/local.yaml`
and restarting opens it to the model.

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

### Capture is on by default

Capture runs on **every** conversation, globally, unless you set
`memory.capture.enabled: false` in `config/default.yaml`. A small model call
attaches **after** the reply has been delivered — never in the critical path.
A capture that fails is a missing note, never a failed conversation.

| Gate | Default | Meaning |
|------|---------|---------|
| `memory.capture.enabled` | **on** | Master switch |
| `minUserChars` | 40 | Unicode code points; shorter messages skip the model call |
| `maxPerConversation` | 20 | Model-spend ceiling (successful, unparsable, and error runs count; too-short skips do not) |

There is no keyword list in any language. `{"notes":[]}` is the common and
correct extractor answer (0–2 notes, kinds `user` / `feedback` / `domain` /
`project` / `reference`).

### Isolated CLI — EYAS memory only

Extraction runs in an **isolated** model context: no host filesystem settings,
no CLI-native memory, no bridged tools, a single turn. Conversations on the
Claude Code CLI default **`loadClaudeMd` off** — they do not load `~/.claude`
settings, CLAUDE.md, host skills, or project `.mcp.json`. Isolated and opted-out
calls also set `CLAUDE_CODE_DISABLE_AUTO_MEMORY` and `strictMcpConfig`.

Grok / Kimi (ACP) have no isolation switch; their provider panels say so rather
than pretending. Agents are told to use `search_memory` / `save_memory` only,
and the file-writing gate denies `~/.claude`, `~/.grok`, and `ai-memory` paths.

Without isolation the extractor once read the owner's host memory, reported the
fact "already recorded", and the EYAS vault stayed empty. That is the bug this
closes.

### Capture run ledger

Every outcome that reaches the gate writes a `memory_capture_runs` row: skips
with their reason, extractions with the kinds they wrote, plus a `provider`
column (`provider/model`, or null when no model was called). Two silences are
deliberate: capture switched off writes nothing, and a background run with no
assistant text never reaches the gate. **God Mode** turns return their own
stream before the post-turn block, so they write no vault note and no row here.
The raw record below is a separate ledger and does cover them.

---

## The raw record

**Nothing said is lost.** Every message EYAS writes down — yours, the
assistant's, and the output of background agent runs — is now kept a second
time, word for word, in a raw record beside the conversation itself. It is
compressed on the way in (roughly 2.7× smaller on real text) and filed under a
hash of its own bytes, so the same sentence repeated inside one conversation is
stored once and counted twice.

**Read this before anything else: you cannot see any of it yet.** This release
only starts the recording. There is no page, no search box and no command that
reads the raw record back, and none of it is put in front of the assistant.
What reaches your prompts today is exactly what reached them before — the
one-line vault index and the related-work block described above. Recall comes
in a later release.

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
inherited: what **you** wrote is owner-level, what the model wrote is only
derived from it, and tool output is ingested from elsewhere. A summary can
never end up trusted more than the words it was made from.

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

As above: none of this is readable yet either.

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
| `memory.engine` | `legacy` | Which engine serves memory. Setting it to `v2` changes nothing you can observe today |

`memory.capture.enabled: false` does **not** switch the raw record off. That
one governs vault notes and the small model call behind them; these two are
independent, and turning either off leaves the other running.

`eyas doctor` reports whether compression is available and which implementation
is in use. If none is, EYAS says so in the log and records nothing, rather than
quietly filling a buffer.

### Tool results are not recorded — and why to leave it that way

`memory.l0.captureToolResults` is **off by default**. Read this before you turn
it on.

With it on, the raw record keeps the **entire output of every tool call, word
for word and unedited**, plus the first 2,048 characters of the arguments it
was called with. That means a command's full output, the contents of every file
the assistant reads, and any one-time code or token a tool happens to return —
all of it sitting in the database as ordinary text. Nothing masks it, nothing
scans it, and compression is not encryption. Vault notes pass through the
privacy module before they are written; recorded tool results do not.

Each recorded result is capped at `memory.l0.toolResultMaxBytes` (8 KB) and cut
on a character boundary with a visible truncation marker. With the flag on,
EYAS prints a warning at every start saying exactly this.

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
marked untrusted too. Since nothing reads these layers yet, the only effect
today is a number in the run ledger.

---

## Shared memory blocks (agent tools)

In addition to the five-tier UI, agents can use **scoped memory blocks** (Letta-style) via tools — durable shared notes for multi-turn and multi-agent work.

| Scope | Shared among |
|-------|----------------|
| **company** | Whole instance |
| **agent** | One agent |
| **team** | Team orchestration |
| **run** | Single run |

| Tool | Meaning |
|------|---------|
| `memory_block_read` | Read block content |
| `memory_block_write` | Append or replace content; formatted into prompts when relevant |

These are separate from Working Memory rows on this page but complement them for cross-conversation state.

## Related

- [Knowledge base](/docs/en/knowledge/knowledge-base/)
- [Documents](/docs/en/knowledge/documents/)
- [Project wiki](/docs/en/knowledge/client-wiki/)
- [Providers](/docs/en/ai/providers/) (CLI isolation / `loadClaudeMd`)
- [Data import](/docs/en/admin/data-port/)
- [Configuration](/docs/en/deploy/configuration/) (`memory.l0.*` keys)
- [Tools](/docs/en/automation/tools/)

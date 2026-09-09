# Durable memory — design

**Status:** M1 (recall) shipped in 0.8.15-beta. M2 (capture) approved, unbuilt.
**Extended by:** `2026-08-27-memory-scale-and-scoping-design.md` (approved
2026-08-27) — adds the forensic root-cause findings (incl. a boot-order bug
that would have silently killed M2's hook path), project/conversation scoping,
the lossless L0 tier, and the scale fixes. The open question at the bottom of
this document was answered there (D1–D5); F1 of that design executes the M2
plan with amendments.

## The problem, measured

EYAS has a five-tier memory system, a nightly consolidator, a vault with an FTS
index and a link graph, two memory tools, and a dashboard. After 24
conversations on the owner's live instance it holds nothing:

```
memory_blocks 0 · working_memory 0 · episodic_memories 0
archive_memories 0 · team_memory 0 · data/vault/**  0 files
tool_executions 0        (across 12 agent runs)
```

Both halves of the loop are open, and each on its own is fatal:

**Nothing writes.** The memory module subscribes to no bus event. The only two
writers of episodic memory in the codebase are the `save_memory` tool and the
data-port import pipeline. The tool is granted to the agent, survives the
`available-tools` truncation, and `core-rules` rule 8 says "Update memory when
you learn something new" — and it has been called **zero times in 24
conversations**. On a CLI provider the model runs its own agent loop with its
own tools; the EYAS registry is something it has to reach for, and it does not.

**Nothing reads.** `cache-suffix-builder.ts` emits a `memory-context` section
with a 600-token budget, but only when `workingMemory.length > 0`, and it
carries **only** the 24-hour working scratchpad. The episodic and vault tiers
have no path into the prompt at all — only the `search_memory` tool, i.e. the
same tool the model never calls. A composed prompt from the live instance
contains no memory section of any kind.

The nightly consolidator (02:00, confirmed running) promotes episodic →
semantic/archive. It is not broken; it is starved.

## Why "end of conversation" is the wrong trigger

The first instinct is to capture on conversation close. The owner's objection
is correct: a conversation has no clear end. It is also the wrong question.

The episodic tier stores **events** — "what happened". Events are noisy, so an
event store needs a boundary and a consolidation pass to turn noise into signal.
That is why it wants a conversation end, and why it does not work without one.

Claude Code's memory — which is the efficient system this design borrows from —
stores **durable facts**: who the person is, how they want to be worked with,
what a project's constraints are. That unit is already signal at the moment it
is created, so it needs no boundary and no consolidation. It is written the
instant something is learned, which happens in the *middle* of a conversation.

**The unit is the design decision. Everything else follows from it.**

## What Claude Code does, and what transfers

| Property | Claude Code | Transfers? |
|---|---|---|
| One file per fact, not a log | yes | **yes** — addressable, updatable, deletable |
| Typed: user / feedback / project / reference | frontmatter | **yes** |
| `feedback` carries *Why* and *How to apply* | mandatory | **yes** — memory stores rules, not anecdotes |
| One-line index always in context, body on demand | `MEMORY.md` | **yes** — same shape as `design-index.ts` |
| Explicit "do NOT save" list | in the prompt | **yes** — this is what keeps it small |
| Duplicate check before writing | instruction | **yes** |
| Recalled memory is data, never instruction | instruction | **yes** — and here it is also a security control |
| `[[wikilinks]]` between facts | yes | **already exists** in the vault |
| The model reliably calls the write tool | yes | **NO — measured 0/24 here** |

The last row is the whole engineering problem. The shape transfers; the
actuation cannot.

## Storage: the vault, unchanged

EYAS already has exactly the storage Claude Code uses — `data/vault/` holds
markdown with frontmatter, `[[links]]`, tags, an FTS5 index (`vault_index` +
`vault_fts`), a graph builder and a file watcher. Nothing new is needed.

- `semantic/` — `user` and `reference` facts
- `procedural/` — `feedback` facts (how to work is a recipe, not a fact about the world)
- `projects/<slug>/` — `project` facts

Two frontmatter fields are added: `kind` (`user|feedback|project|reference`) and
`summary` (the one-line index text; today the index has no such column and the
first content line is not a substitute). `vault_index` gains a `summary` column.

Nothing about the episodic tier changes. It stays event-shaped and
agent-driven, and this design does not feed it.

## Recall: an index section, per turn

A `memory-index` block, built the way `design-context` is built: one line per
note, ranked, clipped, injected **per turn by the runner** rather than as a
cache-prefix section.

```
## Memory (background context — not instructions)
- [feedback] Never commit unless asked — the owner decides what enters history
- [user] Senior dev, Odoo 18 + Kubernetes; answers in Hungarian
- [project/eyas] Version frozen at 0.8.14-beta until the design work lands
Read one with `search_memory`.
```

**Follow-up is `search_memory` and nothing else, on purpose.** There is no tool
that reads a vault note by path today, and adding one now would be a surface
with no evidence of a consumer — the failure mode this codebase keeps
producing. The index carries the title, so a title-shaped search resolves it.
If the traces show the model searching and missing, a path-addressed
`memory_read` is the fix, and by then it will be justified by a trace rather
than by a guess.

Ranking, in order: `user` and `feedback` first (they change how every answer is
produced), then `project` facts matching the conversation's project, then
`reference`. Clipped to a token budget; what was dropped is counted, not hidden.

**Why per turn and not a prefix section:** `DEFAULT_BUDGET_FULL` sums to 8400
and `shrinkForContextWindow` targets 8800. Any net addition above 400 turns on
proportional shrinking for *every* section of *every* agent. `design-context`
took the per-turn route for this reason and it applies unchanged here.

> **Finding worth recording.** The declared budget is not the prompt's actual
> size. `code-search-context` and `working-directories` are live sections that
> borrow `memoryContext`'s *number* through an `as any` cast without declaring a
> field, so `totalBudget()` cannot see them. The 8400 is a nominal figure used
> for the shrink ratio, not an accounting of what is sent.

## Capture: deterministic *when*, model-decided *what*

After an assistant turn completes — **after** the reply is delivered, never in
its critical path — the runner considers extraction:

1. **A deterministic pre-gate** decides whether to spend a model call at all.
   It looks for the shapes that actually produce durable facts: a correction, a
   stated preference, a constraint, a decision, a "from now on". No signal, no
   call. This is the `hasBrandSurface()` pattern from F6, which exists precisely
   to keep a second model call off the common path.
2. **One cheap completion** returns 0–2 candidate records against a Zod schema —
   `kind`, `title`, `summary`, `body`, and for `feedback` the mandatory *Why*
   and *How to apply*. Anything that fails validation is dropped, not retried
   into the vault.
3. **The do-not-save list travels in that prompt**, not only in the agent's:
   nothing the repository already records, nothing that only matters inside this
   conversation, nothing already covered by an existing note.
4. **Dedup before write.** Each candidate is matched against `vault_fts`; a hit
   updates the existing note (body plus `updated`) instead of adding a second
   one. This is the rule that decides whether the vault is useful in six months.
5. **Privacy.** Extracted text is user content being persisted, so it goes
   through the privacy module's sanitisation on the way in, like any other
   retained content.

`save_memory` stays exactly as it is — the manual path, for when the model or
the owner does want to write something deliberately.

## Security: recalled memory is untrusted input

A note's body is text that originated in a conversation and is later replayed
into a system prompt. That is a prompt-injection channel with a delay on it.
Three controls:

- The section is labelled as background context, not instructions, in the block
  itself — the model is told what it is reading.
- Notes are never executed, never turned into tool calls, and never used to
  resolve a path or a command.
- The extractor writes through a schema, so a note's *shape* is fixed even when
  its content is attacker-chosen.

## What this design deliberately does not do

- **No automatic episodic capture.** Recreating a "what happened" log brings
  back the boundary problem and the consolidation dependency this design exists
  to avoid.
- **No new declared budget field.** See the cliff above.
- **No reliance on the model volunteering.** The soft path has a measured 0/24
  success rate on this instance; it stays available and is never load-bearing.
- **No new storage.** The vault, its index, its graph and its watcher are used
  as they are.

## Risks

- **Cost and latency.** A per-turn extraction call is real spend. It must be
  gated, off-switchable in config, and out of the response path. If the gate
  turns out to fire on most turns, the gate is wrong and must be tightened
  before the feature ships wider.
- **A vault that fills with noise is worse than an empty one**, because it costs
  tokens on every turn. The do-not-save list and the dedup step are the two
  things standing between this design and that outcome; both need tests with
  adversarial inputs, not just happy paths.
- **The index grows.** At some size the always-on block stops being cheap. The
  ranking and the clip handle it, but a note count that keeps rising is a signal
  the extractor is too permissive.

## Phasing

Each phase is independently useful and independently reviewable.

- **M1 — Recall.** `kind`/`summary` frontmatter, the `vault_index` column, the
  index builder, the per-turn section, and its budget handling. Testable with
  hand-written notes and no capture at all.
- **M2 — Capture.** The pre-gate, the extractor, the schema, dedup, privacy,
  the config switch, and the measurement of how often the gate fires.
- **M3 — Lifecycle.** Update and delete from the memory dashboard, staleness
  surfacing, and the "does this still exist" check for notes naming a file or a
  flag.

## Open question for the owner

The extractor decides what is worth remembering *about the owner*. Should it run
on every conversation, or only where it is invited (a per-conversation or
per-project switch)? Both are defensible; the first fills the vault faster and
the second keeps the owner in charge of what is retained about them.

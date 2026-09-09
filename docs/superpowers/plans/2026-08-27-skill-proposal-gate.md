# A matched skill must be accepted before it is used

**Goal:** a skill never reaches the model until a human has said yes, and an
active skill is visible while it is active.

**Why:** `google-drive-integration` matched "make an HTML page showing the time"
at score 0.9 and was injected silently. The injection also emptied the tool list
(fixed separately), and the run produced the wrong design. Nothing in the UI
ever said a skill was involved.

**Owner's decision (2026-08-27):** **blocking.** The turn waits for the answer,
and the answer is a button, not typing.

## Shape

The turn stops before the model is called, not after. The skill match already
happens before the SSE stream opens, so there is a clean point to stop at:
nothing has been streamed, and no assistant message exists yet. The user's
message is already stored — that is correct, it was really sent.

```
match → decision?  accepted → inject silently (it was approved)
                   declined → skip silently (it was refused)
                   none     → emit `skill_proposal`, close the stream, run nothing
```

Resuming is a re-run, not a suspended request: holding an SSE connection open
until a human clicks would survive neither a restart nor a closed tab. The
client posts the decision, then re-sends with `resume: true`, which skips
storing the user message again.

## Decisions this locks in

- **Per conversation, per skill.** Accepting once does not accept it everywhere;
  a skill is right for a conversation, not for all time.
- **Declining is remembered too**, so a bad match asks once and never again in
  that conversation.
- **The proposal shows why it matched** — name, score and `matchedPattern`. On
  the observed failure that would have read `Google Drive · 0.9 · name`, which
  is instantly recognisable as wrong.
- **The background path proposes nothing.** No human is there. It applies only
  what was already accepted, and otherwise runs without a skill.
- **An accepted skill stays visible** while it is active, with a way to drop it.

## Files

| File | Responsibility |
|---|---|
| `src/modules/conversations/schema.ts` (modify) | `conversation_skill_decisions` |
| `src/modules/conversations/skill-gate.ts` (create) | the pure decision, and the store |
| `src/modules/conversations/routes.ts` (modify) | stop-and-propose; the decision endpoint; `resume` |
| `src/modules/agent/conversation-runner.ts` (modify) | apply an accepted skill, never propose |
| `src/web/src/hooks/use-streaming.ts` (modify) | the `skill_proposal` frame |
| `src/web/src/stores/conversation-store.ts` (modify) | hold the proposal |
| `src/web/src/pages/conversations/components/skill-proposal-card.tsx` (create) | two buttons |
| `src/web/src/pages/conversations/conversation-page.tsx` (modify) | render it, resume on answer |
| locales × 6 | ~8 keys |

## Verification

`bun run test` — 58 failing in 9 files, unchanged. `bun run lint` — 51.
`bun run build:web`, `bun run docs:build`. Never `bun run full-docs`.
No commits.

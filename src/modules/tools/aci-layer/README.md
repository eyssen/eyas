# ACI Layer — Agent-Computer Interface Output Formatting

**Phase 3M** — SWE-agent-inspired post-processing for raw tool output.

## Why

Tool outputs can be huge: a `grep -r` across a repo, a 5000-line shell log, a
100-match search result. Piping the raw dump into the model wastes tokens and
buries the signal in noise. The ACI layer intercepts the raw result, applies a
small per-tool transformation, and returns a compact LLM-friendly string plus
a `followUpHint` that points the model at a narrower query.

This is NOT about enforcing hard byte caps (the executor already does that in
`capOutput`). This is about *shape*: giving the model the useful part of the
output in the cheapest form, and telling it how to ask for more.

## Strategies

| Strategy       | Default For                   | Behaviour                                                                 |
| -------------- | ----------------------------- | ------------------------------------------------------------------------- |
| `head-tail`    | shell commands, fallback      | Keep first 100 + last 50 lines, `... <N lines truncated> ...` in middle.   |
| `line-grep`    | `shell.grep`, `search.grep`   | Substring match on `ctx.hintPattern` (case-insensitive by default).        |
| `structured`   | search tools, JSON payloads   | Recursive truncation: array cap 50, string leaf cap 2000, depth cap 8.     |
| `file-chunk`   | file/document/memory reads    | 200-line window with `startLine` slider and total-line count.              |

All strategies add a `followUpHint` when they dropped content, guiding the
model toward a narrower query, a regex, or a sliding window.

## Design Notes

- **Pure functions.** Strategies are `(raw, ctx) => FormattedOutput`. No
  shared state, no IO, safe to share the formatter across concurrent calls.
- **Substring-only hint matching.** `line-grep` deliberately does NOT compile
  user-supplied regex patterns (CWE-1333, ReDoS). If you need regex, pre-
  validate with a library like `recheck` and wrap a custom strategy.
- **Resolution order.** The dispatcher checks overrides → exact default →
  longest dotted-prefix match → fallback (`head-tail`). That lets you
  register at any granularity (`search`, `search.code`, `search.code.ast`).
- **No new dependencies.** The layer is plain TypeScript, MIT-compatible.

## Public API

```ts
import { createAciFormatter } from '@modules/tools/aci-layer'

const aci = createAciFormatter()

const result = aci.format(rawOutput, {
  toolName: 'shell.exec',
  hintPattern: 'ERROR',        // used by line-grep
  maxOutputChars: 20_000,      // char-level safety net
})

// result.formatted is the string to send to the model
// result.followUpHint (when truncated) tells the model how to narrow
```

### Registering an override

```ts
import { lineGrepStrategy } from '@modules/tools/aci-layer'

aci.registerStrategy('shell.exec', lineGrepStrategy)
```

## Integration with `tool-executor.ts`

The formatter is NOT wired into the executor yet — that is a separate
session. The intended one-line integration is:

```ts
// src/modules/tools/tool-executor.ts — after capOutput() runs
const formatted = aciFormatter.format(result.output, {
  toolName,
  hintPattern: ctx.parentGoal,    // or pull from context/task
})
// then attach `formatted.formatted` / `formatted.followUpHint` to the
// model-facing message, while keeping the raw output in the audit log.
```

Keep the raw output flowing to the audit trail; only the *model-facing*
copy passes through the ACI layer.

## Token Savings — Rough Estimate

A typical 5000-line shell log is ~200 KB ≈ 55 000 tokens. With `head-tail`
defaults (100 head + 50 tail + one marker line ≈ 151 lines ≈ 6 KB), the
model-facing payload drops to roughly **1 700 tokens** — a **~97%
reduction** while preserving the command echo at the top and the exit
status / error context at the bottom.

Search results with 100 matches (each ~1 KB) go from ~30 000 tokens to
~15 000 tokens under `structured` (50-element array cap) — **~50% cheaper**,
with the model reliably nudged toward a narrower query.

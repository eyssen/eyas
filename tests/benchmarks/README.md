# EYAS Internal Benchmark Harness (Phase 4F)

A regression-oriented benchmark suite for EYAS agents. Designed to:

1. **Represent EYAS's real workload** — email triage, coding, ops, research, meetings.
2. **Resist gaming** — each run picks a random prompt variation; a separate
   held-out set is run on release to detect memorization.
3. **Run on every release** — fast enough to be a CI regression gate.

Industry benchmarks (SWE-bench, OSWorld) were partially exploited in 2025; EYAS
keeps its own private set so training-set contamination is not a concern.

## Layout

```
tests/benchmarks/
├── runner/            # TypeScript harness (loader, scorer, runner, types)
├── tasks/             # Versioned task files per category (15-20 tasks)
├── held-out/          # Separate set, only run on releases (3-5 tasks)
├── reports/           # Output — JSON + Markdown per run
└── scripts/           # Bash wrapper + TS entry point for CI
```

## Running locally

```bash
# All tasks, main set only
bash tests/benchmarks/scripts/run-benchmarks.sh

# Release-style run (includes held-out)
bash tests/benchmarks/scripts/run-benchmarks.sh --held-out

# Single category
bash tests/benchmarks/scripts/run-benchmarks.sh --category=coding

# Specific task
bash tests/benchmarks/scripts/run-benchmarks.sh --task=email-triage-001
```

The default `agentFactory` in `scripts/run-benchmarks.ts` is a stub. Replace
with a real EYAS agent when wiring into your release pipeline.

Harness unit tests:

```bash
bun vitest run tests/benchmarks/runner/
```

## Scoring

- **Deterministic gates** (hard fail → composite 0):
  - `mustMentionKeywords` — case-insensitive substring matches
  - `mustNotMention` — forbidden substrings
  - `mustMatchRegex` — treated as substring phrases (no `new RegExp` compile,
    to avoid ReDoS; see `runner/scorer.ts`)
  - `maxTokens`, `maxCostUsd`, `maxDurationSec` — per-task budget caps
- **LLM-as-judge rubric** (0–100): strict JSON-only prompt, parsed and clamped
- **Composite score**: rubric score (or 0 if any gate failed). `status`:
  - `passed` if composite ≥ 70
  - `failed` if composite < 70
  - `errored` if the agent threw

## Anti-gaming features

- `promptVariations[]` — runner picks one at random per run (seeded for test
  reproducibility).
- `held-out/` tree — separate taskset, run periodically, never mixed into the
  main training/tuning signal.
- Seeded deterministic RNG (`runner/prompt-variations.ts`) lets the harness
  run reproducibly in tests while still sampling broadly in production.

## Adding a new task

1. Pick a category (`email-triage`, `coding`, `ops`, `research`, `meetings`)
   or propose a new one (extend `BenchmarkCategory` in `runner/types.ts`).
2. Create `tests/benchmarks/tasks/<category>/NNN-short-name.json`:

   ```json
   {
     "id": "coding-006",
     "category": "coding",
     "prompt": "Primary wording of the task.",
     "promptVariations": [
       "An equivalent rewrite.",
       "Another equivalent rewrite."
     ],
     "context": { "arbitrary": "json" },
     "expectedOutcome": {
       "action": "optional-canonical-label",
       "mustMentionKeywords": ["keyword"],
       "mustNotMention": ["forbidden phrase"],
       "rubric": [
         "First criterion the output must satisfy",
         "Second criterion…"
       ]
     },
     "maxTokens": 4000,
     "maxCostUsd": 0.05,
     "maxDurationSec": 30
   }
   ```

3. Make sure the `id` is unique across `tasks/` AND `held-out/`.
4. Run `bun vitest run tests/benchmarks/runner/` — the test
   `real task files > loads every bundled task file without error` will catch
   a malformed JSON or missing rubric immediately.

### Held-out tasks

Drop additions in `tests/benchmarks/held-out/<category>/`. Treat them as
write-only from the agent-development side — do NOT tune agent prompts
against them; their purpose is to detect overfitting on the main set.

## Report format

Each run writes two files into `reports/`:

- `report-<ISO timestamp>.json` — full structured result, one entry per task
- `report-<ISO timestamp>.md` — human-readable summary (sample below)

```
# Benchmark run 2026-04-16T17:45:00.000Z

- Tasks: 20 / 20 attempted
- Passed (score >= 70): 14
- Failed: 4
- Errored: 2
- Avg score: 76.3
- Total cost: $0.42
- Total duration: 94.2s
- Regression vs previous run: +2.1 points

## Per-task results

| Task              | Category     | Status  | Score | Notes                         |
|-------------------|--------------|---------|-------|-------------------------------|
| email-triage-001  | email-triage | passed  | 88    | Identifies urgency, drafts…   |
| coding-005        | coding       | failed  | 0     | must-mention:(page - 1)       |
| ops-004           | ops          | errored | 0     | Error: gateway timeout        |
```

## MIT-compatible dependencies only

The harness uses only Node/Bun built-ins plus Vitest. No new runtime deps
are introduced — matches EYAS's MIT-only policy.

# skill-generation (Phase 3J — Hermes self-improvement)

Auto-generates skill artifacts (SKILL.md + bindings) from successful agent
traces and validates them against the Phase 4F benchmark runner with a
two-proportion z-test (or Fisher's exact for small samples). Skills that
improve success rate by ≥5 percentage points with p<0.05 are auto-adopted;
skills that later regress in production are auto-rolled-back.

This is a clean rebuild; the deprecated `skill-evolution` module is NOT
touched.

## Pipeline

```
agent traces (event-store)
    │
    ▼
candidate-extractor   ── groups traces by tool-chain, mines triggers ──▶ SkillCandidate[]
    │
    ▼
skill-generator       ── writes SKILL.md + metadata.json under generated-skills/<slug>/
    │
    ▼
ab-runner             ── runs baseline + candidate on benchmark subset ──▶ ABResult
    │                    two-proportion-z (N ≥ 10) OR fisher-exact (N < 10)
    ▼
adopter               ── adopt / reject / more-data based on ABResult
    │
    ▼
rollback              ── monitors production outcomes; unregisters on regression
```

## Files

| File                        | Responsibility |
| --------------------------- | -------------- |
| `manifest.ts`               | `EyasModule` manifest |
| `index.ts`                  | Public API, `buildSkillGenerationServices` factory, stub registry |
| `types.ts`                  | `SkillCandidate`, `GeneratedSkill`, `ABResult`, `AdoptionEvent`, ports |
| `schema.ts`                 | Drizzle tables: `generated_skills`, `skill_ab_experiments`, `skill_adoption_events` |
| `candidate-extractor.ts`    | trace groups → `SkillCandidate` |
| `skill-generator.ts`        | candidate → `SKILL.md` + `metadata.json` (+ Zod validation) |
| `ab-runner.ts`              | baseline/candidate runner with stats + recommendation |
| `statistical-test.ts`       | two-proportion z-test and Fisher's exact, written from scratch |
| `adopter.ts`                | applies AB decisions through the registry port |
| `rollback.ts`               | monitors production success rate, unregisters on regression |
| `routes.ts`                 | HTTP endpoints under `/api/v1/skill-generation/` |

## Adoption thresholds

Defaults live in `types.ts` under `DEFAULT_ADOPTION_THRESHOLDS`:

| Threshold         | Default | Notes |
| ----------------- | ------- | ----- |
| `minImprovement`  | 0.05    | Absolute success-rate delta (5pp) |
| `alpha`           | 0.05    | Two-sided p-value cut-off |
| `zTestMinN`       | 10      | Below this per arm → Fisher's exact |

Rationale: 5pp is the smallest practical gain to justify the complexity of
maintaining an adopted skill. α=0.05 is the conventional cut-off for a
first pass; raising α to 0.01 would require roughly 2× the trials for the
same power. The 10-trial cut-off for z-test vs Fisher is the standard rule
of thumb (both np and n(1-p) should be ≥ 10 for the normal approximation
to the binomial to hold).

## Statistical methodology

- **Large N (≥ 10 trials per arm):** two-proportion z-test with pooled
  variance under H0 (equal proportions). Returns z-score and two-sided
  p-value via Abramowitz-Stegun rational approximation of the normal CDF.
- **Small N (< 10 per arm):** Fisher's exact test on the 2×2 contingency
  table. Two-sided p-value is the sum of hypergeometric probabilities of
  all tables as extreme as — or more extreme than — the observed one
  (probability-based two-sided definition). Computed in log-space with
  Lanczos lgamma to stay numerically stable for N up to a few hundred.

Both tests handle degenerate inputs (0 trials, identical arms) by returning
`NaN` or the conventional `p=1` respectively.

## Rollback monitoring (stub)

The rollback module exposes `checkAndRollback(input)` which takes a rolling
window of production successes/failures for an adopted skill and decides
whether to unregister. The monitoring *loop* itself is stubbed — it should:

1. Subscribe to `ToolResult` events whose metadata indicates they were
   produced through a given adopted skill.
2. Maintain a rolling window (default 30 outcomes) per adopted skill.
3. Call `checkAndRollback` when the window fills.
4. If rollback fires, persist an `AdoptionEvent` with `action='rejected'`
   and reason `rolled-back: ...`; an operator UI can surface these.

**TODO (phase 3K):** wire the monitoring loop to the event-store and audit
module.

## HTTP surface

| Method | Path | Purpose |
| ------ | ---- | ------- |
| `GET`  | `/api/v1/skill-generation/candidates` | Extract candidates from traces in the lookback window |
| `POST` | `/api/v1/skill-generation/candidates/:id/generate` | Materialise SKILL.md for a candidate |
| `POST` | `/api/v1/skill-generation/experiments` | Run A/B on a generated skill |
| `POST` | `/api/v1/skill-generation/experiments/:id/adopt` | Apply an experiment's decision |

## Testing

```bash
bun vitest run tests/modules/skill-generation/
```

Unit tests cover: candidate extraction, skill generation (including Zod
re-parse), statistical tests (against hand-computed known values), A/B
runner happy/reject/more-data paths, adopter flows, and full integration
from trace → adoption.

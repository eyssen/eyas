# Memory Consolidator (Phase 3C)

Nightly background agent inspired by Letta / MemGPT. Promotes memories across
tiers, extracts skill candidates, refreshes per-client wiki summaries, and
garbage-collects orphaned rows.

## Status

Phase 3C implements the **module skeleton + deterministic memory-promotion
logic**. Skill extraction and DeepWiki refresh are declared as integration
points but stubbed. Semantic promotion (LLM summariser) is stubbed too —
only the detection + invalidate half is live.

## Placement

Submodule of `src/modules/memory/` (see `manifest.ts` for rationale).

```
src/modules/memory/consolidator/
├── manifest.ts                   # Submodule metadata
├── index.ts                      # createConsolidator(deps)
├── types.ts                      # Public types + dependency ports
├── promotion-rules.ts            # Pure rule functions (unit-testable)
├── skill-candidate-extractor.ts  # STUB — scans event-store, flags traces
├── wiki-refresher.ts             # STUB — iterates active clients
├── orphan-gc.ts                  # Deletes unanchored + expired memory rows
├── schedule.ts                   # Scheduler registration (cron `0 2 * * *`)
└── README.md                     # this file
```

## Rules implemented

| Rule                     | Condition                                                                                          | Action                                          |
|--------------------------|----------------------------------------------------------------------------------------------------|-------------------------------------------------|
| working → episodic       | age > 6h AND (accessCount >= 2 OR importance >= 7)                                                 | create episodic row, delete working block       |
| episodic → semantic      | >= 3 members share content fingerprint AND most-recent access < 30 days                            | invalidate episodic members (TODO: vault write) |
| semantic tombstone       | vault entry untouched > 180 days                                                                   | (TODO phase-3D) mark archived, not deleted      |
| orphan GC                | episodic row with sourceId that is not reachable AND created > 14 days ago                         | delete + log                                    |

`importance` is parsed from working-memory content when it is a JSON object
of shape `{ text, importance }`; otherwise defaults to 0 so the rule falls
back to access count.

Fingerprinting is cheap: lowercase + collapse whitespace + trim. Phase 3E
will swap this for embedding-based clustering.

## Runtime surface

```ts
interface SleepTimeConsolidator {
  runOnce(): Promise<ConsolidationReport>
  isRunning(): boolean
  getLastRun(): { startedAt, finishedAt, success, report } | null
}
```

Every phase is wrapped in its own `try/catch` — a failing phase records into
`report.errors` and the next phase still runs.

## Integration points

### Scheduler

- Job name: `memory.consolidator.nightly`
- Default cron: `0 2 * * *`
- Registered via `registerConsolidatorJob({ scheduler, consolidator })`
- Leader-election enforced by the existing `SchedulerService` — multi-node
  deploys will only run this once per cluster per fire.
- Long-running: the scheduler's per-job lock is renewed via heartbeat, so a
  slow consolidation won't be preempted by the same node starting over.

### Skill proposals (stubbed)

`SkillCandidate` objects are returned from `runOnce()` and counted in
`report.skillCandidates`. No table yet — the `persistSkillCandidates` dep is
a no-op unless overridden.

TODO(phase-3J):
- Create a `skill_candidates` table (columns: id, session_id, slug, rationale,
  tool_call_count, status, proposed_at).
- Wire `persistSkillCandidates` to INSERT rows.
- Build a review UI for maintainers to approve/reject candidates.
- Replace the placeholder `slug` / `rationale` with real pattern mining.

### Wiki proposals (stubbed)

Same shape as skill candidates. No table yet — `persistWikiProposals` no-ops.

TODO(phase-3F):
- Build the per-client wiki adapter that actually diffs the last 24h of
  activity against the current wiki state and returns meaningful proposals.
- Create `wiki_edit_proposals` table + persistence.
- Hook a reviewer UI; only human approval should apply edits.

### Semantic promotion (partially stubbed)

`index.ts` calls `invalidate(id)` on every episodic member of an eligible
cluster, which prevents that cluster from re-firing on the next run. The
actual vault note write happens in Phase 3E once the consolidator has a
model bridge for summarisation.

### Vault tombstoning (stubbed)

`findSemanticTombstoneCandidates()` is a pure function and covered by future
tests, but `index.ts` doesn't call it yet because VaultService writes are
owned by a different phase. Report counter stays at 0 until Phase 3D wires
it in.

## Testing

```
bun vitest run tests/modules/memory/consolidator/
```

Three test files:
- `promotion-rules.test.ts` — pure-function rule coverage
- `orphan-gc.test.ts` — DB-level GC behaviour
- `consolidator-integration.test.ts` — full runOnce() via fakes

## Operational notes

- **No auto-apply.** Skill and wiki proposals always go to a review queue.
- **No destructive delete** on semantic vault entries. Tombstone = archive,
  never rm.
- **Audit-first.** Every deletion goes through the injected logger.
- **Reentrancy-safe.** `isRunning()` is checked both in the scheduler
  handler and inside `runOnce()`.

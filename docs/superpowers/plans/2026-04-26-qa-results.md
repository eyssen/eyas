# QA Results — Autonomous Agent Prompt Architecture v2

**Date:** 2026-04-26
**Status:** DEFERRED — Manual QA pass not yet completed.

## Note

The manual QA pass for the v2 prompt architecture (Tasks 37–53) is deferred.
Automated integration + migration tests cover the core behaviour. A human-driven
QA session (voice profile editor, forge proposal flow, agent wizard, cascade merge
in the UI) should be completed before the 0.9.0 release.

## Automated coverage as of 2026-04-27

- `tests/integration/end-to-end-primary-agent.test.ts` — 5 tests
- `tests/integration/sub-agent-delegation.test.ts` — 3 tests
- `tests/integration/voice-scope-override.test.ts` — 8 tests
- `tests/integration/identity-self-edit.test.ts` — 3 tests
- `tests/integration/soul-forge-proposal.test.ts` — 2 tests
- `tests/integration/cascade-merge.test.ts` — 1 test
- `tests/integration/provider-adapter-parity.test.ts` — 6 tests
- `tests/integration/voice-scenarios.test.ts` — 10 parametric tests
- `tests/performance/prompt-cache-anthropic.test.ts` — 2 unit tests + 1 gated
- `tests/migration/migrate-v1-to-v2.test.ts` — 4 tests

## Items for manual QA

- [ ] Agent wizard: create new primary agent from template, verify workspace files appear in the frontend editor
- [ ] Voice profile editor: change preset, save, verify SOUL.md re-rendered
- [ ] Forge proposal: agent proposes soul change via `forge_propose_soul_change`, user approves in UI, voice profile updated
- [ ] Identity self-edit: agent updates IDENTITY.md section, notification appears with diff, revert button works
- [ ] Cascade merge: create project-type with AGENTS.md, create project, verify cascade appears in agent's assembled prompt
- [ ] Per-conversation voice override: set to `external` in conversation header, verify scope badge updates

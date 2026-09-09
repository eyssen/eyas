# Claude Config Isolation Default — Decision Record

**Date:** 2026-08-28
**Status:** Approved
**Extends:** `2026-08-27-memory-scale-and-scoping-design.md` (F1/F1.5 durable memory)

## Problem

Main conversations on the `claude-code` provider run with `loadClaudeMd=true` (default).
The provider implements "true" by *omitting* the SDK `settingSources` option — and the
installed CLI (agent-sdk 0.2.89 bundle) treats an absent `--setting-sources` flag as
"load everything": `~/.claude/settings.json` (including hooks and permission rules),
`~/.claude/CLAUDE.md` + rules + machine-level auto-memory, the project tier walked up
from `cwd` (CLAUDE.md, `.claude/` tree, `.mcp.json` MCP servers), local tier, and
user/project skills. Verified against the bundled `cli.js`
(`allowedSettingSources:["userSettings","projectSettings","localSettings","flagSettings","policySettings"]`
is the initial state; the flag handler is the only setter). The SDK's *documentation*
claims the opposite (omitted = none) — the shipped code wins, and live test #4 of the
F1 workstream proved the leak (machine `~/.claude` memory reached a conversation).

Consequences today:

1. EYAS's own memory (vault index, rule 8) is contradicted by a second, machine-level
   memory the model can see — "already known" facts never get captured.
2. Host hooks (session auto-save, PreToolUse guards) execute inside EYAS conversations.
3. The toggle's ON path is fragile: it relies on the CLI's undocumented default; if the
   SDK ever matches its docs, ON silently becomes a no-op.

## Decisions

- **D1 — Default flip:** `loadClaudeMd` defaults to **false**. EYAS's own memory is the
  single source of truth in main conversations. All three default expressions change
  together: `manifest.ts:29`, `provider.ts:234`, `provider-panel.tsx:83`.
- **D2 — Honest ON path:** when the user opts in, the provider sends an explicit
  `settingSources: ['user','project','local']` (deterministic, SDK-upgrade-proof —
  today's ON behaviour made explicit) instead of omitting the option. UI copy says
  honestly what ON loads: the whole machine-level Claude config including hooks, not
  just CLAUDE.md.
- **D3 — Clean flip, no migration stamp:** existing installs (settings blob without the
  key) flip to false. Rationale: beta, the whole point is isolation, one click in the
  Providers UI re-enables it. CHANGELOG carries the notice.
- **D4 — No fake switch for grok-cli/kimi-cli:** ACP has no isolation parameter and
  grok 1.0.5 has no suppression flag (empirically: it loads `~/.grok/Agents.md` AND
  `~/.claude/Claude.md` + `~/.claude/settings.local.json` permissions globally,
  cwd-independent). Kimi baseline unverified (binary absent). Per the standing
  provider principle ("do not fabricate one"), no advisory toggle is added. Instead:
  the Providers panel hints state plainly that these CLIs load their own machine-level
  config/memory and EYAS cannot disable it; the kimi provider gains the same honesty
  comment grok already has; `supportsIsolatedCompletion` stays unset for both.
  Research follow-up (F3): grok `--agent-profile` / env surface — if a real
  suppression switch ships, the toggle is added in the claude-code pattern.
- **D5 — Resume residual documented, not fixed:** a session created before the flip
  restores its previously loaded context when resumed, until it goes stale. Session
  invalidation would be disproportionate; the CHANGELOG notes it.

## Out of scope

- Renaming the `loadClaudeMd` settings key (stored blobs keep working).
- Any behaviour change for API providers or isolated requests (capture path is
  already `settingSources: []` via `isolated: true`).
- Version bump (0.8.15-beta freeze).

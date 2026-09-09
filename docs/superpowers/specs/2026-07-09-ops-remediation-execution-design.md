# Ops Remediation Execution — Design Spec

Date: 2026-07-09
Status: Approved (design); pending implementation plan
Scope: EYAS `ops` module (#41). Companion feature `pipelines` (#42) is a separate spec.

## 1. Context & Goal

The `ops` module observes incidents, runs diagnosers, and generates remediation
**proposals** from runbooks. Today the proposal **apply** path is fake:

- `reconcile-loop.ts` `apply()` returns `ok:true` for `kubectl` with `(stub) would run: …`
  and never executes anything.
- `actions/gitops-committer.ts` `openPullRequest()` returns a deterministic **stub URL**
  and never opens a PR.
- `createOpsRoutes` exists but is **never mounted**, so the ops API/UI is unreachable.
- The `approval-bridge` defines an `ApprovalQueue` interface but is backed only by an
  in-memory stub — the real security-gate autonomy queue is not wired.

Goal: make apply **real and honest** — execute read-only `kubectl` diagnostics directly,
open real pull requests for GitOps mutations behind human approval, mount the routes,
and replace every fake-success path with an explicit, honest result.

Key safety property already baked into the module: `kubectl` proposals are restricted to a
**read-only allow-list** (`logs, describe, get, top, events, rollout` [status], `explain`)
with an argument sanitizer. All **mutations** are expressed as `gitops-pr` proposals (a
manifest change opened as a PR that a human reviews/merges and a GitOps controller applies).
**EYAS never mutates the cluster directly.**

## 2. Locked Decisions

1. **PR provider = abstraction (Gitea + GitHub).** A common `PrProvider` interface with two
   implementations, selected by config. Bot token always from the secrets module, never hardcoded.
   The same `PrProvider` is reused by the pipelines feature (#42).
2. **kubectl = direct in-process execution of read-only diagnostics.** `Bun.spawn` with no shell,
   allow-list + arg sanitizer re-checked at exec time. Gated by `ops.kubectl.enabled` (default
   `false`) and the presence of a kubeconfig / in-cluster credentials. Read-only diagnostics
   **auto-run** (no approval). If disabled or unconfigured → **honest error**, never fake success.
3. **gitops-pr (mutations) require human approval** via the security-gate `autonomy_approvals`
   queue before the PR is opened.
4. **Honesty contract:** no `apply()` branch may return `ok:true` unless it actually performed the
   action. Unconfigured/unsupported paths return `ok:false` with a clear reason.

## 3. Scope

**In scope**
- `PrProvider` interface + Gitea and GitHub implementations (native `fetch`, no SDK).
- `kubectl-executor` (spawn, no shell, allow-list/sanitize at exec, gated, honest).
- Wire `apply()` to the executor + PR provider; remove the stubs.
- Wire `ApprovalBridge` to the security-gate autonomy queue; gate gitops-pr apply on approval.
- Mount `createOpsRoutes` in `ops` `onStart`.
- `ops` config schema (Zod) + secrets lookups.
- Tests (unit + route), no real cluster / real PR in tests.

**Out of scope**
- `helm-upgrade` execution — remains an explicit "not supported yet" honest result.
- Autonomous incident→apply without human involvement for mutations.
- Frontend ops dashboard beyond confirming the existing routes are reachable (the ops UI page,
  if any, is tracked separately; this spec ensures the API works and is CASL-protected).
- The pipelines feature (#42).

## 4. Architecture & Components

### 4.1 `PrProvider` (new — `src/modules/ops/actions/pr-provider.ts`)
```ts
export interface OpenPrInput {
  filePath: string          // path in the infra/gitops repo
  content: string           // the file's desired NEW full content (committed as-is on `branch`)
  title: string
  body: string
  branch: string            // head branch to create
}
export interface PrProvider {
  openPullRequest(input: OpenPrInput): Promise<{ prUrl: string; number: number }>
}
export function createGiteaPrProvider(cfg: {
  baseUrl: string; owner: string; repo: string; baseBranch: string; token: string
}): PrProvider
export function createGitHubPrProvider(cfg: {
  baseUrl?: string; owner: string; repo: string; baseBranch: string; token: string
}): PrProvider
export function createPrProviderFromConfig(cfg, getToken): Promise<PrProvider | null>
```
- Uses native `fetch` against the provider REST API (create branch/blob/commit/PR). SSRF is not a
  concern here (operator-configured base URL), but the base URL is validated as https and non-empty.
- Returns `null` when `ops.pr.provider` is unset or the token secret is missing → apply reports honest error.

### 4.2 `kubectl-executor` (new — `src/modules/ops/actions/kubectl-executor.ts`)
```ts
export interface KubectlExecResult { ok: boolean; output?: string; error?: string; durationMs: number }
export function createKubectlExecutor(cfg: {
  enabled: boolean; kubeconfigPath?: string; binary?: string /* default 'kubectl' */
}): { exec(command: string, args: string[]): Promise<KubectlExecResult> }
```
- `enabled=false` → `{ ok:false, error:'kubectl execution disabled' }` (honest).
- Re-validates `command` against `ALLOWED_KUBECTL_COMMANDS` and each arg through `sanitizeArg`
  (imported from `kubectl-generator.ts`); a rejected command/arg → `ok:false` (defense-in-depth).
- `Bun.spawn(['kubectl', command, ...args], { env: kubeconfigPath ? { KUBECONFIG } : inherit })`,
  **no shell**, captures stdout/stderr, bounded output, honors a timeout.
- Missing binary / exec failure → `ok:false` with the error message.

### 4.3 `apply()` rewrite (`reconcile-loop.ts`)
- `kubectl` → `kubectlExecutor.exec(command, args)` → map to `ApplyResult` (real output or honest error).
- `gitops-pr` → **approval gate first** (see §7); on approval, resolve the desired file content from
  the proposal payload (use `payload.patch` directly when it is full file content; when it is a diff,
  fetch current content via the provider and apply it — the exact resolution is pinned in the plan),
  then `prProvider.openPullRequest({ filePath, content, ... })` → real `prUrl`; if `prProvider` is
  null → `ok:false` `'PR provider not configured'`.
- `helm-upgrade` / unknown → `ok:false` `'<type> is not apply-able yet'` (unchanged, already honest).
- Dependencies (`kubectlExecutor`, `prProvider`, `approvalBridge`) are injected into
  `createReconcileLoop`/`createOpsServices` so the module stays unit-testable.

### 4.4 Route mounting (`ops/index.ts` `onStart`)
- `createOpsRoutes(ctx.http, services)` after services are built. Auto-protected by deny-by-default;
  handlers already use `requirePermission` on `OpsIncident`/`OpsAction`/`OpsRunbook` subjects
  (registered in `onStart`). `apply` requires `OpsAction:apply`.

## 5. Config Schema (`src/core/config/schema.ts`)
```yaml
ops:
  kubectl:
    enabled: false            # default false — opt-in
    kubeconfigPath: null       # optional; null → in-cluster service account
    binary: kubectl
  pr:
    provider: null             # 'gitea' | 'github' | null
    baseUrl: null              # e.g. https://gitea.internal
    owner: null
    repo: null
    baseBranch: main
```
Zod: `ops` optional; nested defaults as above. PR token is **not** in config — read from secrets
key `ops-pr-token` (system scope) at startup.

## 6. Security Model
- Read-only kubectl: allow-list + sanitizer enforced at both proposal and exec time; no shell;
  bounded output/timeout; runs under EYAS's k8s credentials (in-cluster SA or kubeconfig) which
  should be granted a **read-only** RBAC role.
- Mutations: only via `gitops-pr`, behind autonomy approval, applied by an external GitOps
  controller after a human merges — no direct cluster write from EYAS.
- CASL: `OpsAction:apply` required on the apply route; approve on the autonomy queue route.
- Fail-closed/honest when unconfigured; secrets never logged.

## 7. Approval Integration
- A dedicated ops autonomy category **`ops_apply`** is seeded into `autonomy_categories` (per Cap 7
  conventions; default level requires approval) so operators can tune its autonomy level.
- `ApprovalBridge` gains a real `ApprovalQueue` backed by `ctx.securityGate.autonomyPolicy`:
  - `enqueue(proposal)` → `autonomyPolicy.createApproval({ category:'ops_apply', tool_name:'ops.apply',
    input_json: proposal.payload, preview: proposal.summary, reason })` → returns the approval id.
  - `status(id)` → look up that approval's `status` via `autonomyPolicy` (add a `getApproval(id)` helper
    if one is not already exposed; otherwise filter `listApprovals()`) → `'pending'|'approved'|'rejected'`.
- `apply()` for `gitops-pr`: if `proposal.requiresApproval` and not yet approved → the route returns
  `202 { queued: true, approvalId }` instead of applying; a second apply call after approval proceeds.
  Read-only kubectl proposals set `requiresApproval:false` → auto-run.

## 8. Data Flow
```
incident → observer/diagnoser → proposal (kubectl read-only | gitops-pr)
  kubectl:   apply → kubectlExecutor.exec → real stdout | honest error
  gitops-pr: apply → approval queue (enqueue) → human approves → prProvider.openPullRequest → prUrl
                                             → human rejects  → apply blocked (honest)
result persisted on the proposal; incident status → 'applied' | 'proposed'
```

## 9. Testing Strategy
- `pr-provider.test.ts`: Gitea + GitHub happy path with **mocked fetch** (assert request shape,
  parse prUrl/number); null-when-unconfigured; token-missing → honest.
- `kubectl-executor.test.ts`: disabled → honest; disallowed command/arg → rejected; success path
  with a **mocked/faked spawn** (no real kubectl); timeout/binary-missing → honest.
- `reconcile-apply.test.ts`: kubectl apply maps executor result; gitops-pr requires approval then
  opens PR; unconfigured provider → honest; helm-upgrade → not-supported.
- `approval-bridge.test.ts`: enqueue/status against a fake autonomy queue; auto vs. required.
- `ops-routes.test.ts`: routes mounted; `OpsAction:apply` enforced (401/403); apply returns real result.
- No test performs a real cluster call or opens a real PR.

## 10. Deployment & Credentials
- Read-only k8s RBAC Role (get/list/watch on the relevant resources) bound to EYAS's ServiceAccount,
  **or** a mounted kubeconfig at `ops.kubectl.kubeconfigPath`. Absent → kubectl apply fails honestly.
- PR bot token stored via secrets as `ops-pr-token`. Absent → gitops-pr apply fails honestly.
- Both default OFF (`ops.kubectl.enabled:false`, `ops.pr.provider:null`) so a stock deploy is inert
  but honest (no fake success), matching the "version freeze / external testing" posture.

## 11. Phased, Approval-Gated Build Plan
Each phase is TDD, ends green (full suite + typecheck), and stops for review before the next.
- **P1 — PrProvider** (shared building block): interface + Gitea + GitHub + config/secrets factory + tests.
- **P2 — kubectl-executor**: executor + gating + tests.
- **P3 — apply() rewrite + honesty**: wire executor + provider into `apply()`, remove stubs, tests.
- **P4 — Approval wiring**: ApprovalBridge → autonomy queue; ops_apply category; gitops-pr gate; tests.
- **P5 — Route mount + config**: `createOpsRoutes` in onStart; `ops` Zod config; route tests.
- Checkpoints: after P1 (shared block review), after P4 (security review of the approval+exec path),
  before commit. Commit only on explicit request.

## 12. Risks & Mitigations
- **kubectl arg injection** → no shell + allow-list + sanitizer at exec; bounded output/timeout.
- **Over-broad k8s RBAC** → spec mandates a read-only role; documented; exec still allow-listed.
- **PR spam / wrong repo** → operator-configured single repo; approval gate on mutations.
- **Fake success regressions** → explicit test asserting unconfigured paths return `ok:false`.
- **Approval bypass on resume** → apply always re-checks approval status before executing.

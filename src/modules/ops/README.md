# Ops Agent module

Kubernetes ops agent. The module acts like a slow-tempo Kubernetes
controller: **observe → diagnose → propose → approve → apply**. The default
stance is **propose-only** — nothing is applied to the cluster without an
explicit approval, even for `info` severity. Cluster URL, kubeconfig, and
GitOps repo live in instance config — never as product defaults.

## Why

Auto-remediation without approval is a footgun. The goal is to cut the
operator-to-fix latency without ever taking a destructive action on the
strength of a possibly-spoofed metric.

## Pipeline

1. **Observe.** Three observers turn raw inputs into `Incident` rows:
   - `k8s-event-observer` — Kubernetes Warning events.
   - `prometheus-observer` — Alertmanager webhook payloads.
   - `log-anomaly-observer` — structured anomalies from the bus.
2. **Verify.** Every incident bearing a `signedRecord` is passed to
   `signed-metrics.verify()`. On `valid: false` the incident is marked
   `suppressed` and the pipeline ends — no diagnosis, no proposal.
3. **Diagnose.** A deterministic runbook matcher runs first; only on miss
   does the LLM fallback run (when configured).
4. **Propose.** Runbooks carry a `suggested_action`. The proposal layer
   builds a `ProposalPayload` — kubectl command + args, or a GitOps PR
   diff, or a manual handoff. **Nothing is shelled out here.**
5. **Approve.** Proposals land in the approval queue (in-memory by default,
   hands off to security-gate when wired). Approval is always explicit.
6. **Apply.** Only approved proposals can be applied. `onStart` injects a
   `KubectlExecutor` and a `PrProvider` from `config.ops` + secrets. Both
   default off (`kubectl.enabled: false`, `pr.provider: null`); `apply()`
   honestly refuses until an operator opts in.

## Signed-metrics integration (core anti-spoof)

The module takes a `SignedVerifier` from the signed-metrics module. Its
contract:

```ts
const result = signedVerify(signedRecord)
if (!result.valid) markSuppressed(result.reason)
```

In **strict mode** (default) an incident without any `signedRecord` is ALSO
suppressed. Dev/test can flip `strictSigned: false`. This matches the RSA 2025
framing: un-signed telemetry is treated as untrusted input, and the operator
never acts on untrusted input without explicit human approval.

## Runbooks

See `./runbooks/README.md`. Glob matchers (`*`, `?`) are used instead of full
regex to eliminate ReDoS concerns on operator-authored patterns.

## Permissions

| Subject | Actions | Owner | Admin | User |
|---------|---------|:-----:|:-----:|:----:|
| `OpsIncident` | `read`, `reconcile` | ✓✓ | ✓✓ | ✓ |
| `OpsAction` | `read`, `approve`, `apply` | ✓✓✓ | ✓✓ | ✓ |
| `OpsRunbook` | `read` | ✓ | ✓ | ✓ |

Apply is **owner-only** by default. A dedicated `ops_apply` role can be
provisioned via the permissions registry if ops needs to be delegated.

## Config (instance, not product)

- **kubectl.** `config.ops.kubectl.enabled` (default `false`) plus optional
  `kubeconfigPath` / `binary`. Disabled or missing executor →
  `ok:false, error:'kubectl executor not configured'`.
- **GitOps PR.** `config.ops.pr.provider` (`gitea` | `github` | `null`) plus
  owner/repo and the `ops-pr-token` secret. Unset →
  `ok:false, error:'PR provider not configured'`.

## Stubs (future sessions)

- **Helm upgrade action.** `propose()` creates a placeholder payload but the
  apply path just records a 'not apply-able yet' error.
- **LLM diagnoser.** Uses a narrow `LlmClient` interface; will route through
  the full `ModelGateway` (tier/budget aware) later.
- **K8s watch loop.** The observer is transform-only — a future runtime loop
  (scheduler-driven polling or the K8s watch API) feeds it.

## HTTP routes

- `GET  /api/v1/ops/incidents` — list, filters: `status`, `severity`, `limit`
- `GET  /api/v1/ops/incidents/:id`
- `POST /api/v1/ops/incidents/:id/reconcile`
- `GET  /api/v1/ops/actions/:id`
- `POST /api/v1/ops/actions/:id/approve`
- `POST /api/v1/ops/actions/:id/apply` — `apply` action on `OpsAction` only
- `GET  /api/v1/ops/runbooks`

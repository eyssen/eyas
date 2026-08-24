# Signed Metrics / Telemetry Integrity

Phase 3K. Motivated by RSA 2025 AIOps-spoofing research: before ops-agents
act on metrics or log anomalies, those inputs must be tamper-evident. This
submodule provides signing and verification for metric/log records so
downstream consumers (e.g. `ops-agent`) can detect manipulation.

## Design

- **Primary algorithm:** `ed25519` via Node's built-in `crypto.sign` /
  `crypto.verify`. Asymmetric — producers hold private keys, consumers
  only need the public key.
- **Fallback:** `hmac-sha256` for constrained environments where both ends
  share a secret and asymmetric crypto is overkill.
- **No third-party deps.** Everything uses `node:crypto`.
- **Canonicalization:** before signing, `payload + kid + ts + alg` is
  serialized with `canonicalize()` (sorted object keys, deterministic
  across platforms). The `kid` and `ts` are covered by the signature to
  prevent cross-key replay and timestamp shifting.
- **Key rotation:** the `KeyStore` holds one active key at a time. When
  rotated, the previous active key is marked retired and remains
  acceptable for `verify` during a retention window (default 7 days).
  After retention, it is expired and rejected.
- **Clock skew tolerance:** `verify` allows up to 5 minutes of future
  skew on `ts` by default; past `ts` is unbounded (records may be old).
- **Never logs signing-key material.** Keys are exposed to callers only
  through public metadata (`{ kid, algorithm, createdAt }`).

## Threat model

### What this protects against

- **Metric spoofing by downstream attacker.** If an attacker injects fake
  metrics into the store / message bus / file after emission, verification
  fails: they do not hold the signing key.
- **Silent payload tampering in transit.** Flipping a single byte of the
  payload, `kid`, or `ts` invalidates the signature.
- **Replay across keys.** `kid` is part of the signed bytes, so moving a
  signature from one key to another record under a different kid fails.
- **Timestamp shifting forward.** Forward skew beyond `maxClockSkewMs`
  (default 5 min) is rejected. Backward-dated records are still accepted
  (legitimate for late-arriving batches) but the signature still binds
  the original timestamp.
- **Key compromise window.** Rotation lets operators bound exposure: a
  compromised key can be retired immediately, and expires after retention.

### What this does NOT protect against

- **Producer compromise.** If the signer itself is subverted, the
  attacker can sign anything. Use the secrets module's master key to keep
  signing keys encrypted at rest, and consider hardware-backed keys for
  high-assurance deployments.
- **Suppression.** A record that is never emitted can never be verified
  missing. Pair with heartbeats / expected-rate checks upstream.
- **Replay within the same key & window.** A valid signed record can be
  re-submitted. Consumers that care about freshness must track
  `(kid, ts, payload-hash)` tuples and drop duplicates.
- **Metadata leakage.** The `payload` is signed but not encrypted —
  anyone on the wire can read it. Add transport-level encryption (TLS,
  WSS) if confidentiality is required.

## Persistence

This implementation is pure / in-memory. Production integrations should:

1. Serialize each `SigningKey` (excluding the secret material) for audit.
2. Encrypt the secret material via the EYAS secrets-module master key
   before writing it to `data/keys/`.
3. Load and re-populate the `KeyStore` on `onStart`.

The submodule deliberately does not import the secrets module so it can
be unit-tested in isolation and reused outside EYAS.

## Integration points

- **ops-agent.** Wrap metric emission with `sign()`, and have the agent
  call `verify()` before consulting any metric or log anomaly event.
- **Prometheus exporter.** Attach a detached signature as an exemplar or
  sidecar record; do not pollute the metric line itself.
- **Event bus.** When publishing `observability.anomaly.*` events, wrap
  the event payload in `SignedRecord<AnomalyEvent>` and verify on the
  consumer side.
- **Audit module.** `sign()` the canonical form of each audit entry so
  the audit log itself is tamper-evident; enables independent integrity
  checks during incident response.

## API example

```ts
import { createSignedMetrics } from '@modules/observability/signed-metrics'

const svc = createSignedMetrics()
await svc.generateKey() // or sign() will lazily generate

const record = svc.sign({ metric: 'llm.tokens.total', value: 42, at: Date.now() })
// …send `record` through the bus / exporter / log…

const result = svc.verify(record)
if (!result.valid) {
  // reject / alert — `result.reason` explains why
}
```

## Rotation

```ts
const { newKid, retiredKid } = await svc.rotateKey()
// old records signed with `retiredKid` still verify for `retentionMs`
```

---
title: Security & privacy
description: Security gate, event stream, audit log, and PII scanning — before tools run and after.
---

**What this is for.** Three operator surfaces sit behind this chapter. The **security gate** is the runtime policy that allows, denies, or escalates a tool call *before* it runs. **Security events** (`/security`) is the stream of those decisions. **Audit** (`/audit`) is the immutable action log (with optional rollback). **Privacy** (`/privacy`) is PII scanning, sanitisation, and policy — including the same sanitiser that durable memory capture runs *before* a vault write.

## When to use it

- A tool call was denied and you need the checkpoint, risk, and reason.
- You want to confirm browser tools cannot hit private/metadata hosts (SSRF).
- You are about to enable autonomy and need to see what the gate will escalate.
- You must check whether PII is leaking into logs, vault notes, or outbound prompts.

## Typical workflow

1. Open **Security** (`/security`). Filter by decision (**Allow / Deny / Escalate**), risk, tool, checkpoint.
2. Open **Audit** (`/audit`) for who did what, module, result (**success / error / denied / rolled back**), cost. Rollback is a confirm action when offered.
3. Open **Privacy** (`/privacy`). Read scan stats, then **Test PII Scanner** with sample text.
4. Combine with [Autonomy](/docs/en/agents/autonomy/) (approvals) and [Secrets](/docs/en/admin/secrets/).
5. For SSH to other machines, see [Nodes](/docs/en/admin/nodes/) — destructive patterns need an explicit force flag.

## Features

| Area | Route / meaning |
|------|-----------------|
| **Security gate** | Runtime policy before dangerous tools |
| **Security events** | `/security` event stream |
| **Audit** | `/audit` immutable action log |
| **Privacy** | `/privacy` retention / redaction controls |

### Browser SSRF protection

Browser tools block requests to **private / metadata** hosts (cloud metadata, loopback, RFC1918, etc.) to reduce server-side request forgery risk. Prefer `browser_snapshot` (numbered interactive elements) over screenshots when agents only need structure. Indexes are invalid after navigation. The headless profile is EYAS-owned (`data/browser/profile`); the daily Chrome profile is rejected (Chrome 136+ blocks Default-profile CDP). `browser_evaluate` runs in the page, not in Node. `browser_totp` is **yellow**: it reads a seed from Secrets/Keychain and returns only a short-lived code (pass it to `browser_fill`). The action-cache JSON stores locators, never secrets or fill values. The optional [Browser Use](/docs/en/automation/browser-use/) sidecars (recommended: agent-browser under `data/browser/agent-browser/profile`; legacy Python CLI) never disable the Chromium sandbox automatically, never call `chat` / AI Gateway, and never attach to the daily Chrome profile.

### Remote node SSH

Remote-node **SSH invoke** (via Nodes) runs guarded commands; **destructive** command patterns require an explicit force flag. Non-SSH node types may return not-implemented for invoke.

### Memory capture sanitisation

Durable notes are sanitised by the privacy module **before they touch disk**, not at read time — a read-time redaction would leave raw text in the file and in the FTS index. Capture itself is switched with `memory.capture.enabled` in `config/default.yaml` (default **on**). See [Memory](/docs/en/knowledge/memory/) and [FAQ](/docs/en/reference/faq/).

## Fields and controls

<h2 id="security-events">Security events (`/security`)</h2>

Subtitle: *Tool execution decisions and security audit log.*

| Control | Meaning |
|---------|---------|
| Stats | **Total Events**, **Denial Rate**, **Top Blocked Tools** |
| Decision filter | **All / Allow / Deny / Escalate** |
| Risk filter | **low / medium / high / critical** |
| Checkpoint filter | Free text |
| Columns | Timestamp, Tool, Decision, Checkpoint, Risk, Agent, Reason |

Empty: *No security events found.*

<h2 id="audit">Audit (`/audit`)</h2>

Subtitle: *Action logging, snapshots, and rollback tracking.*

| Control | Meaning |
|---------|---------|
| Stats | Total entries, actions/day, top module, total cost |
| Filters | Action, module, from, to |
| Columns | Timestamp, User, Action, Module, Target, Result, Cost |
| **Rollback** | Restore from snapshot (confirm) |

Results: **success / error / denied / rolled-back**.

<h2 id="privacy">Privacy (`/privacy`)</h2>

Subtitle: *PII scanning, data protection policies, and privacy compliance.*

| Control | Meaning |
|---------|---------|
| Stats | **Total Scans**, **PII Detected**, **PII Types** |
| Scanner performance | Scanner, scans, matches |
| **Test PII Scanner** | Paste text (email, phone, SSN, credit card, …) |
| Results | **BLOCKED** / **Route to Local** / no PII |
| **Show sanitized text** | Redacted preview |

## Related

- [Autonomy](/docs/en/agents/autonomy/)
- [Users](/docs/en/admin/users/)
- [Tools](/docs/en/automation/tools/)
- [Observability & nodes](/docs/en/admin/observability/)
- [Nodes](/docs/en/admin/nodes/)
- [Memory](/docs/en/knowledge/memory/)

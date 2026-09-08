# Email Triage Agent Template

An agent **template** (persona + prompt + tool allowlist + rule engine) that
processes every inbound email, classifies it into a next-action bucket, drafts
a reply when appropriate, and routes everything else to human approval.

Modeled on the Superhuman / Shortwave triage flow, but local-first and
conservative by default — nothing is ever auto-sent.

## Scope of this phase (4C)

- **In scope:** template manifest, classifier (deterministic + LLM fallback),
  action router, natural-language rule compiler, in-memory rule store,
  fixture-backed tests.
- **Out of scope:** IMAP / Microsoft Graph adapters (Phase 2 — deferred),
  actual agent runner invocation, DB persistence of rules, frontend.

The template is built against an event shape the Phase 2 adapter will emit,
so it slots in without refactoring when the adapter ships.

## Action buckets

| Bucket        | Meaning                                                              |
|---------------|----------------------------------------------------------------------|
| `archive`     | Newsletters, low-signal notifications.                               |
| `quick-reply` | Simple factual questions — an auto-draft is produced for approval.   |
| `todo`        | Requires dedicated work; creates a task on the board.                |
| `escalate`    | Ambiguous, sensitive, or above triage authority — human reviews.     |
| `delegate`    | Matches a rule like *"forward anything from X to Y"*.                |

## Classification pipeline

1. **Deterministic rule pass.** Compiled rules (from the in-memory store) are
   sorted by priority and the first match wins.
2. **Heuristics.** Bulk / newsletter headers, meeting-invite hints, invoice
   keywords, phishing markers.
3. **LLM fallback.** When still undecided, the email is sent to the model
   with `TRIAGE_SYSTEM_PROMPT` plus a strict-JSON user prompt, and the
   response is parsed into a `ClassificationResult`.
4. **Safety floor.** The LLM can never choose `quick-reply` for emails
   mentioning money, contracts, legal, authentication, etc. — those are
   forced to `escalate`.

## Natural-language rules

Users write rules in natural language. Example:

> *"Forward anything from Kovács to finance@acme.com when the subject
> mentions invoices."*

`RuleCompiler.compile(...)` hands the string to the LLM (with a strict JSON
system prompt), validates the response, and returns a structured rule:

```json
{
  "id": "auto-uuid",
  "label": "Kovács invoices to finance",
  "matcher": {
    "from":    { "contains": "kovács", "caseInsensitive": true },
    "subject": { "regexIsh": "invoice|számla", "caseInsensitive": true }
  },
  "action": { "type": "delegate", "to": "finance@acme.com", "template": "FYI" }
}
```

### About `regexIsh`

`regexIsh` is **not** a real regular expression. The classifier treats it as
a `|`-separated list of literal substrings and does a plain `String.includes`
check. This is intentional — LLM-authored rules and user NL input are
untrusted, so passing them to `new RegExp()` would be a ReDoS footgun
(CWE-1333). The mini-language is still enough to express the common case
(`invoice|bill|számla`).

## Registering the template

The template is shape-compatible with the existing agent registry but kept
decoupled to avoid circular imports. Wire it up from bootstrap:

```ts
import { emailTriageTemplate } from '@modules/agent-templates/email-triage'
import { registerTemplate } from '@modules/agent/agent-templates'

registerTemplate(emailTriageTemplate)
```

## Integrating with the Phase 2 email adapter

The adapter will emit an event with this shape:

```ts
interface EmailReceivedEvent {
  type: 'email.received'
  email: InboundEmail
  mailboxId: string
}
```

The triage agent subscribes to `email.received`, runs the classifier, and
routes the result. Tests in `tests/modules/agent-templates/email-triage/`
simulate the event with fixture payloads.

## Files

```
manifest.ts                 - template id, version, subscriptions, storage hints
template.ts                 - persona + prompt + tool allowlist + seed rules
prompt-sections.ts          - system prompt, classifier/compiler user prompts
classifier.ts               - rule pass + heuristics + LLM fallback
action-router.ts            - bucket → concrete TriageAction
natural-language-filters.ts - NL facade + in-memory RuleStore
rule-compiler.ts            - NL → CompiledRule (LLM + validator)
types.ts                    - shared types (no deps)
index.ts                    - barrel
```

## Tests

```bash
bun vitest run tests/modules/agent-templates/email-triage/
```

- `classifier.test.ts` — every fixture goes through deterministic + heuristic
  paths; LLM fallback is exercised with a mock client.
- `action-router.test.ts` — each bucket → the correct `TriageAction`.
- `rule-compiler.test.ts` — NL → structured matcher, plus the error path.
- `integration.test.ts` — simulated `email.received` event → classify →
  route.

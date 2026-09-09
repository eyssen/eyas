# F7 — Design deletion from the UI, and AI-run visibility

> **For agentic workers:** these are the two items the design system left open
> after F0–F6 and the live-testing round. Both are bounded.

**Goal:** a design can be deleted from the interface, and a multi-minute AI edit
reports progress and survives a page reload.

**Spec:** `docs/superpowers/specs/2026-08-26-design-and-brand-system-design.md`
(this plan is a post-hoc repair of two gaps that document did not anticipate).

## Global constraints

- Version frozen at `0.8.14-beta`. Never touch `package.json`, `version.json`.
- Every user-facing string in `en, hu, de, es, fr, tlh`.
- Measurement baseline that must not grow: `bun run test` → 58 failing in 9
  files; `bun run lint` → 51.
- Nothing is committed by this work.

---

## Part 1 — Deleting a design

`DELETE /designs/:id` exists (`routes.ts:437`) and `designService.remove()`
already drops versions, links and the file tree. Only the button is missing, and
the manual says so out loud.

**Where the button goes: the detail header, beside rename.** Not on the list
cards — those are `<Link>` elements, and a destructive control inside a
navigation target is a misclick waiting to happen. This also matches
`agent-detail-page.tsx:224`, the house precedent for a header `Trash2`.

**The confirmation names what is lost.** `confirm(t(...))` is the established
pattern (twelve call sites). A design carries versions and attachments, and the
attachment count is the part a person cannot see from the detail page — so the
`GET /designs/:id` response gains a sibling `links` object
(`{ total, byModule }`) derived from `design_links`. Confirming blind is the
failure mode worth spending a `COUNT(*)` on.

**Steps**
- [ ] `design-service.ts`: `linkSummary(designId)` → `{ total, byModule }`.
- [ ] `routes.ts`: `GET /designs/:id` returns `{ design, links }`.
- [ ] Test: positive `DELETE` case in `tests/modules/design/routes.test.ts`
      (today only the guest-403 is covered), and a `linkSummary` case.
- [ ] `design-detail-page.tsx`: `Trash2` in the header, `confirm`, then
      `navigate({ to: '/design' })`.
- [ ] `design.detail.delete` / `design.detail.deleteConfirm` × 6 locales.
- [ ] Six manuals: fold deletion into "Renaming" → "Renaming and deleting", and
      delete the "What is not here yet" section that only existed to say this.

## Part 2 — AI-run visibility

`POST /designs/:id/ai` is synchronous and was measured at **8 min 43 s** on a
CLI provider. The only client state is a `busy` boolean, so the panel shows a
spinner and a reload loses everything — including the reason a failed edit
failed.

**The request stays synchronous; every attempt gains a persisted row.** The row
is not logging, it is fault tolerance: once the outcome lives in a queryable
place, losing the HTTP response stops meaning losing the result. A proxy that
times out at 60 s (nginx's default) no longer destroys a nine-minute edit — the
server finishes, the row records it, the panel finds it on the next poll.
Turning the route into a 202 + job id would only shorten the HTTP hold, at the
cost of the existing API contract and the `commit:false` candidate path.

**Time is stored as epoch milliseconds**, against this codebase's ISO habit,
because these two columns are read to compute a duration. `datetime('now')`
yields `YYYY-MM-DD HH:MM:SS`, which `new Date()` parses as **local** time — a
silent off-by-hours in any non-UTC browser. The runs response also carries the
server's `now`, so the frontend can subtract clock skew instead of assuming the
two clocks agree.

**Four statuses, not three:** `running | ok | failed | interrupted`. A run
orphaned by a restart is not a model failure and does not deserve the same
message, so it gets its own terminal state, applied at module registration to
every row still marked `running`.

**Steps**
- [ ] `schema.ts`: `design_ai_runs` + index on `(design_id, started_at)`.
- [ ] `design-ai-runs.ts`: `start`, `finish`, `list`, `latest`,
      `reconcileInterrupted`, and pruning to the last 50 rows per design.
- [ ] Test first: `tests/modules/design/design-ai-runs.test.ts`.
- [ ] `routes.ts`: record around `editDesign` — including the
      `designs.writeFiles` throw, which is a failed run too — and
      `GET /designs/:id/ai/runs`.
- [ ] `index.ts`: construct the service, reconcile at registration.
- [ ] `ai-run-view.ts` (frontend, pure): `clockOffset`, `runElapsedMs`,
      `formatDuration`, `describeRun`. Tested in `tests/web/`.
- [ ] `design-detail-page.tsx`: elapsed counter while in flight, the slow-edit
      hint, a banner for the last non-ok run, and a 5 s poll while one is
      running.
- [ ] ~9 keys × 6 locales. No pluralised strings — `t()` interpolates
      `{{vars}}` and has no plural support.
- [ ] Six manuals: what the panel now reports, in the AI subsection.

## Verification

`bun run lint` · `bun run test` (diff the failing FILE list against the
baseline, matching on `^ FAIL` only) · `bun run build:web` · i18n parity
contract · `bun run docs:build`. Never `bun run full-docs`.

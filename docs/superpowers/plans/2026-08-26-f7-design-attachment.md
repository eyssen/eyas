# F7 — Attaching a design where it is actually used — Implementation Plan

**Goal:** Make the conversation↔design link reachable — from the UI, from an
agent, from a project — and make every model path see it.

**Spec:** `docs/superpowers/specs/2026-08-26-design-and-brand-system-design.md` §2
("reference a design in a turn; agents create and modify designs through tools")

---

## What is actually missing

The link machinery shipped in F2 and half of it was never reachable:

| Piece | State |
|---|---|
| `design_links` table, `link`/`unlink`/`linkedTo` service | done |
| `POST/DELETE /designs/:id/links` routes | done |
| `buildDesignContext()` → the model | done, wired into interactive chat ONLY |
| Any UI that creates a link | **missing** |
| Any agent tool that creates a link | **missing** |
| Background runs seeing attached designs | **missing** |
| Project-level attachment + inheritance | **missing** |

`projects.design_system_id` (the BRAND) has the same shape of gap: column,
service, PATCH route and live resolver all exist, and nothing in the app sets
it. Only the instance default is reachable today.

---

## Decisions

### D1 — Project designs are a UNION with the conversation's, not an override

The brand resolver overrides (`conversation → project → ancestry → default`)
because there is exactly ONE brand. A design attachment is many-to-many: a
conversation can reference several designs, and so can a project.

With a list, override is the wrong semantics — attaching one extra design to a
conversation would silently detach the project's three. So the conversation sees
the union, deduplicated, and the UI marks the project's as inherited (they are
detached from the project, not from the conversation).

Nobody has asked to opt a conversation OUT of its project's designs, so there is
no exclusion mechanism. Adding one now would be a second concept with no caller.

### D2 — The attachment control is an icon, not a field

The conversation top bar is full. The control is a single icon button with a
count, opening a dropdown; the row it would otherwise occupy does not exist.

### D3 — `design_link` takes a conversation id, never "the current one"

The tool is called from a run that already knows its conversation, but the
tool layer has no ambient conversation the tool can trust. Passing the id
explicitly keeps it honest, and matches `design_list`'s existing owner filter.

---

## Tasks

### Task 1 — Union context

- `buildDesignContext(designs, conversationId, projectId?)`, deduplicated by id,
  each entry marked inherited or direct.
- Tests: conversation only; project only; both, deduplicated; neither → null;
  a design linked to BOTH appears once; the large-canvas summary path still
  triggers on the summed size.

### Task 2 — Every model path

- `conversations/routes.ts`: pass the conversation's `project_id`.
- `conversation-runner.ts`: add the same section to the background path, in the
  same fail-soft try/catch. Tests: a background run whose conversation has an
  attached design gets a `design-context` section recorded; a run with none is
  byte-identical to before.

### Task 3 — `design_link` / `design_unlink`

- `category: 'custom'` like the rest, so both MCP bridges pass them to CLI
  providers.
- Tests: links, unlinks, refuses an unknown design, refuses an owner module
  outside a known set, is idempotent.

### Task 4 — Conversation top-bar control

- Icon + count, dropdown listing every design with a checkmark for the attached
  ones and a lock for the inherited ones. Attaching/detaching calls the existing
  routes. Six locales.

### Task 5 — Project attachment

- In the project form: the design list (multi-select) and the brand
  (`designSystemId`) select. The brand half closes the original request's
  "attach a brand to a project and every conversation inherits it" — the
  resolver has been waiting for it since F1.
- Project design links go through the same routes with
  `ownerModule: 'projects'`, so there is no new table and no new endpoint.

### Task 6 — Docs, changelog, memory

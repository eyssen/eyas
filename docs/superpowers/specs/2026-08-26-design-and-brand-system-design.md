# Design Canvases & Brand System — Design

**Date:** 2026-08-26
**Status:** Draft for review
**Modules:** new `brand`, new `design`; touches `core/http`, `prompt-wizard`, `agent`, `communication`, `board`, `conversations`, `tools`, `notifications`
**Predecessor:** `docs/superpowers/specs/2026-08-25-scheduler-runnability-and-execution-log-design.md`

---

## 1. Problem

EYAS can produce text, and it can produce files. It cannot produce anything
that *looks like* it came from one organisation. There is no stored notion of
what a thing should look like, and no place to keep a visual plan while it is
being worked on.

Two capabilities are missing, and they are commonly confused with each other:

1. **A brand** (design system): colours, typography, components, logo, tone —
   a durable, reusable definition that many outputs share.
2. **A design** (canvas): one concrete multi-artboard deliverable — a screen
   flow, a landing page, a flyer, a deck — that *uses* a brand.

The request is for both, plus the binding between them and the rest of EYAS:
a brand attaches to a **project**, every conversation in that project inherits
it automatically, and everything the agents produce there — HTML, email
templates, flyers, documents — is produced in that brand.

## 2. Scope

Approved on 2026-08-26. In scope, across seven phases:

- Brand entity with **four origins**: manual editor, import, AI extraction from
  an existing source, and AI generation from a brief with conversational
  steering.
- Project → conversation brand inheritance reaching **every** model-call entry
  point.
- Design canvases: storage, viewing, hand editing, AI editing, versioning,
  import/export, Claude-Design format compatibility.
- Interactive prototypes (working controls, variant switches).
- Print output: poster/flyer/brochure artboards, PDF and PNG export.
- Conversation integration: reference a design in a turn; agents create and
  modify designs through tools.

Out of scope, explicitly: real-time multi-user co-editing (the save model is
whole-document compare-and-set, same as Claude Design); pushing to third-party
destinations (Canva, Figma, Miro); binary webfont upload (see §11.6).

## 3. Verified evidence

Every claim below was read from source in this repository, not inferred.

### 3.1 — The project→model channel does not exist today

`resolvePromptChain` (`src/modules/board/services/prompt-service.ts:7`)
implements the full `project_type → project → conversation` cascade with `+`
append semantics and is covered by ten assertions in
`tests/modules/board/prompt-service.test.ts`. Repository-wide it has **zero
production callers** — its definition and that test file are the only
references.

The same holds for the `prompt_templates` level cascade. The `/prompts` UI
writes `project_type` rows with `target_id = NULL`; `getActive` matches on
`target_id = ?`; the rows can therefore never resolve. `scripts/migrate-prompts-v2-drop-cols.ts`
DROPs the table.

`data/projects/<id>/AGENTS.md` is read by `project-context-loader.ts:38-55` and
rendered into the `project-context` prefix section
(`cache-prefix-builder.ts:28-42`). **Nothing writes it** — `projectAgentsPath`
and `projectTypeAgentsPath` (`workspace-paths.ts:27,32`) have exactly one
consumer each, the loader.

> **Binding consequence:** every mechanism that *looks* like the right hook for
> per-project instructions is inert. A brand must not be hung off any of them.
> The acceptance criterion for brand delivery is never "the column exists" but
> "a brand token appears in a recorded `context_compositions` section".

### 3.2 — Roughly half of model calls bypass the assembler

`buildForPrimary` is called from four places: interactive chat
(`conversations/system-prompt.ts:56-62`), the background runner
(`agent/conversation-runner.ts:398-404`), team members
(`agent/orchestrator.ts:812-818`, using the parent's `projectId`), and the
prompt preview route (`prompt-wizard/routes.ts:50-65`, hardcoding
`projectId: null`).

Everything else builds a system prompt by hand:

| Path | Code | Consequence |
|---|---|---|
| `ctx.agents.executeAgent` | `agent/index.ts:512` — `system: agentDef.systemPrompt \|\| ''`, self-records `entryPoint: 'unassembled'` | every `delegate_to_agent` subagent |
| `channel-run-agent` | `communication/channel-run-agent.ts:53` — `[agent.systemPrompt ?? '', constraints].join('\n')` | **every inbound email / Telegram / Slack reply** |
| Claude Code SDK subagents | `model/submodules/claude-code/provider.ts:34-48` — `prompt: a.systemPrompt \|\| …` | anything the SDK `Task` tool spawns |
| Research report generator | `research/report-generator.ts:21-35,61` | passes **no** system prompt at all |

Conversations created by the orchestrator (`orchestrator.ts:743-758`), by
channels (`communication/index.ts:611`) and by the scheduler have
`project_id = NULL`; `ConversationService.create()`'s INSERT has no
`project_id` column (`conversation-service.ts:78-83`).

### 3.3 — The prompt budget has a cliff at 8400/8800

`DEFAULT_BUDGET_FULL` (`prompt-wizard/token-budget.ts:22-37`) sums to exactly
**8400**. `shrinkForContextWindow` targets `min(8800, floor(ctx * 0.4))`
(`:45`), and `prompt-wizard/index.ts:167` hardcodes a 200 000 context window,
giving **8800**. Since `8400 <= 8800`, the shrink branch never fires today.

> **Binding consequence:** any net budget addition above 400 tokens turns
> `shrinkForContextWindow` from a no-op into proportional scaling and silently
> shrinks the project cascade, all four workspace files and the skills/tools
> lists **for every agent, everywhere**. New budget must be *carved out* of an
> existing allocation, never added.

Two keys already read via `as any` in `cache-suffix-builder.ts`
(`codeSearchContext`, `workingDirectoriesContext`) do not exist in
`SectionBudget` and silently fall back. New keys go in the real interface.

### 3.4 — The 1 MiB body cap is global and unoverridable from a module

`src/core/http/server.ts:23` mounts `app.use('*', bodyLimitMiddleware)` with a
1 MiB default. Its own doc-comment tells upload routes to mount their own
instance; **no route does**, and there are zero call sites of
`createBodyLimitMiddleware` outside the middleware file. `documents` passes no
`limits`, so the service believes it enforces 50 MB while HTTP 413s at 1 MiB.

### 3.5 — Nothing can be framed, and nothing sanitises

`app.use('*', securityHeadersMiddleware)` sets `X-Frame-Options: DENY` and CSP
`frame-ancestors 'none'` on every Hono response, so `<iframe src="/api/...">`
is blocked even same-origin. DEFAULT_CSP has no `frame-src`, so `blob:` and
`data:` iframe sources fall back to `default-src 'self'` and are blocked too.

The SPA shell and `/docs` bypass Hono entirely (`src/main.ts:92-105`) and set
only `Content-Type` — `index.html` carries **no CSP at all**.

Session auth is an httpOnly `eyas_session` cookie plus a header-presence CSRF
check. There is no HTML sanitizer in either `package.json`. The only `<iframe>`
in the frontend is `providers-page.tsx:378` with
`sandbox="allow-scripts allow-same-origin allow-popups"`.

> **Binding consequence:** artboard HTML renders in a `srcdoc` iframe with
> `sandbox="allow-scripts"` and **never** `allow-same-origin`. That combination
> would let AI-authored script drive the whole API as the logged-in user.

### 3.6 — Assets cannot currently be delivered

`GET /api/v1/documents/:id/download` hardcodes `Content-Disposition: attachment`
(`documents/routes.ts:96`); the local provider's `getUrl()` returns `null`
unconditionally (`local-provider.ts:85-87`); `Cross-Origin-Resource-Policy` is
`same-origin`. No EYAS-hosted image can load in an email client or an exported
page. SVG is accepted through an extension fallback with `allowedTypes`
effectively `*/*`; only the accidental `attachment` disposition prevents stored
XSS today.

### 3.7 — CLI providers are a tool blind spot

The three CLI providers (`claude-code`, `grok-cli`, `kimi-cli`) ignore
`request.tools` entirely. Tools reach them only through the in-process MCP
bridge built from `ctx.tools.registry.list()` **minus categories `'shell'` and
`'browser'`** (`mcp-bridge.ts:9-10`). `write_file`/`edit_file` are
`category: 'shell'`, so on CLI providers file writes go through the SDK's own
Write/Edit and never enter `tool-executor` — no PreToolUse hook, no validator,
no `tool_executions` row.

A claude-code response is always `content:[{type:'text'}]`, `stopReason:'end'`
(`provider.ts:583-600`), so anything inspecting `tool_use` blocks is a silent
no-op there.

### 3.8 — What exists to build on

- **PreToolUse hooks** are published (`tools/index.ts:77-83`), can rewrite input
  (`tool-executor.ts:382`), are fail-closed on throw, and **no module registers
  any**.
- **Zod `validator` with `.transform()`** replaces the input
  (`tool-executor.ts:423`).
- **`email_create_draft` → approve → send** is the only artifact persisted
  server-side before it leaves the system.
- **`ContextRecorder.record()`** persists every turn's composition into
  `context_compositions` / `context_sections` with an index on `source_ref`.
- **`runCheapModelPass`** (`model/cheap-pass.ts`) never throws; returns a
  fallback on missing model, error, or empty output.
- **`getAncestry()`** (`conversation-service.ts:601`) walks
  `parent_conversation_id`.

### 3.9 — Seed rows reject new fields

`board/routes.ts:116-124` forwards a hardcoded six-field allow-list on project
PATCH. `general-general`, where most conversations land, is `source='seed'`. A
new `design_system_id` is unsettable there until added to that list. Seed
*project types* reject all modification.

---

## 4. Compatibility contract with Claude Design

Compatibility is defined at the **data-format** level and nowhere else. The two
formats below were read from the bundled `design` skill and its
`seed-canvas.mjs` validator, and from the `DesignSync` tool schema.

### 4.1 — Canvas format (for designs)

A canvas is one JSON document embedded in a published HTML page inside
`<script type="application/json" id="appifact-doc">`:

```
{ "title": "<name>", "content": { "files": { "<path>": "<source>" } } }
```

- Every `*.dc.html` entry is one **artboard**. The entry file is `Main.dc.html`.
- `canvas.json` is the layout manifest. Allowed top-level keys are exactly
  `artboards`, `annotations`, `launch`, `pages`.
  - `artboards[]`: `file, x, y, w, h, title?, expand?('fit'|'fill'),
    print?('fixed'|'flow'), page?, is_interactive?`
  - `annotations[]`: `id, x, y, w, text, page?, kind?('note'|'title1'),
    size?('s'|'m'|'l'|'xl'|'xxl'), bold?, italic?,
    color?(gray|red|orange|green|teal|blue|purple|pink)`
  - `pages[]`: exactly `{ id, name }`
  - `launch`: `{view:'canvas', page?}` or `{view:'focused', file}`
- Images are stored as **bare base64** (no `data:` prefix) under their
  basename, referenced from artboards as `<img src="logo.png">`.
- Limits: 200 files, 2 MiB per entry, 200 annotations, 40 pages, 5000 chars per
  annotation. Artboard names match `^[A-Za-z0-9_][A-Za-z0-9 _.-]{0,80}\.dc\.html$`;
  stems are unique case-insensitively. Image extensions:
  `.png .jpg .jpeg .gif .webp .avif .bmp .svg`.

An artboard (`.dc.html`) is a "Design Component":

- `<script src="./support.js">` in `<head>` — a marker the runtime replaces.
- `<x-dc>` root; `<helmet><style>` for document-level CSS.
- `{{dotted.path}}` holes — **lookups only**, never expressions. Operators
  outside the braces are literal text.
- `<sc-for list="{{xs}}" as="x" hint-placeholder-count="3">`,
  `<sc-if value="{{c}}" hint-placeholder-val="{{true}}">`,
  `<dc-import name="Card" hint-size="100%,120px">` (mounts sibling `Card.dc.html`).
- `<script data-dc-script data-props='{...}'>` containing
  `class Component extends DCLogic { renderVals() { … } }` — classic JS, no
  imports, no `render()`; gets `this.props`, `state`/`setState`, React class
  lifecycle.
- `data-props` editors (`text|color|int|float|range|boolean|enum|null`, plus
  `options`, `min`/`max`/`step`/`unit`, `section`) are what render as **tweak
  chips**. `$preview: {width, height}` is a size hint.
- Events are supported as whole-value attributes in JSX camelCase:
  `onClick="{{ handler }}"` where `handler` comes from `renderVals()`.

### 4.2 — Design-system project format (for brands)

A plain file tree. Each component preview HTML carries a **first-line** marker:

```html
<!-- @dsCard group="Buttons" -->
```

from which `_ds_manifest.json` is compiled. Cards carry `name`, `subtitle`,
`path`, `viewport {width, height}`, `group`.

> **Design decision:** the EYAS brand store uses exactly this layout. An EYAS
> brand is therefore importable into, and exportable from, a Claude Design
> design-system project with no translation layer.

### 4.3 — What is deliberately not compatible

The Claude Design canvas **editor** is a ~2.4 MB precompiled Anthropic payload
shipped inside the skill. It is not MIT-licensed and not redistributable. EYAS
is MIT (`CLAUDE.md`: dependencies must be MIT/BSD/ISC/Apache-2.0; GPL family
forbidden).

> **Binding consequence:** EYAS implements its own `.dc.html` runtime and its
> own canvas editor as original MIT code. The built-in design prompt is written
> from scratch, not copied from the skill text. Compatibility means a file
> authored in one tool renders in the other — not shared code.

Also not carried over: the `store: 'db'` live-store marker, the `comments`
array (Claude Design's comment capability), and design-system colour tokens
that depend on the claude.ai backend.

---

## 5. Architecture

### 5.1 — Two entities, one AI engine

```
brand (design system)                 design (canvas)
  colours, type, components,            .dc.html artboards + canvas.json
  logo, tone                            + images
  file tree + @dsCard                   {title, files} container
       │                                        │
       │  projects.design_system_id             │  design_links (multi-owner)
       ▼                                        ▼
   every model call                     conversations / projects / standalone
       │                                        │
       └──────────► one AI editing engine ◄─────┘
                    (shared prompt, T0/T1/T2 executor, validator gate)
```

Both entities are **file trees with a DB index over them**, not blobs in a
column. That choice is load-bearing:

- It makes the T2 executor possible — an agent edits with ordinary file tools.
- It makes versioning a directory snapshot, diffable and exportable.
- It matches the `@dsCard` philosophy: the manifest is *derived* from the files.

The DB row holds identity, metadata and the current version pointer; the files
hold the truth.

### 5.2 — Storage layout

```
<dataDir>/brands/<brandId>/
  brand.json                  tokens (Zod-validated)
  _ds_manifest.json           derived from @dsCard markers
  components/<Name>.html      previews with first-line @dsCard
  assets/<sha256>.<ext>       logo variants, favicon
  versions/<n>/               snapshot

<dataDir>/designs/<designId>/
  Main.dc.html
  <Name>.dc.html
  canvas.json
  <image>.png                 stored decoded on disk; base64 only at export
  versions/<n>/
```

`resolveInstance().dataDir` is the root. Version snapshots are copies, not
diffs — a design is capped at 200 files / 2 MiB each, so a snapshot is bounded.

### 5.3 — The AI editing engine

One prompt, one validator gate, three executor tiers chosen from provider
capability. This is the answer to "should we hand the job to Claude when Claude
is the provider": **no** — hand the *hard tier* to whoever can run it, behind
one interface.

| Tier | Selected when | Mechanism |
|---|---|---|
| **T0** single-shot | always available; the floor | "here is the file, return the new one" — whole-file rewrite via `ctx.model.complete` |
| **T1** tool loop | provider receives `request.tools` (API providers) | `design_read` / `design_write` / `design_canvas` over several artboards through `agent-runner` |
| **T2** workspace | CLI provider (`claude-code`, `grok-cli`, `kimi-cli`) | files materialised into a workspace; the agent edits with native file tools; the resulting diff is imported as one new version |

Tier selection duck-types the way `memory/embeddings/model-bridge.ts:22-25`
does — the only runtime capability probe that exists. `ProviderCapabilities` on
the v2 `ModelProvider` interface is **dead code** and must not be designed
against.

The **validator gate** is provider-independent and mandatory. Every AI result,
whatever the tier, is parsed before it becomes a version:

1. Each `.dc.html` parses; `<x-dc>` root present; holes are dotted lookups;
   `sc-for`/`sc-if`/`dc-import` well-formed; `data-props` is valid JSON after
   HTML-entity decoding.
2. `canvas.json` matches the §4.1 schema exactly — stray top-level keys, an
   unlisted `page`, an unknown `launch` view, a duplicate annotation id and an
   artboard referencing a missing file are all rejected.
3. Limits hold (200 files, 2 MiB, 200 notes, 40 pages).
4. Referenced images exist as file entries.
5. A `}} ?` sequence inside a `style` attribute is rejected — the ternary trap.

On failure the engine retries once with the validator output as feedback, then
fails the edit and keeps the previous version. This is what makes a small local
model usable, and it is the reason the feature does not change behaviour when
the provider changes.

### 5.4 — Brand reach

Injection is **two mechanisms, deliberately**:

1. **A `brand-context` prefix section**, placed immediately after
   `project-context` in `buildCachePrefix`. Prefix, not suffix: the prefix is
   already project-scoped, so a brand there adds no new cache-fragmentation
   axis. `zone:'append'` is rejected — it is observability bookkeeping, not a
   real prompt zone, and `reminders` is rejected because reminders reach the
   model but are absent from `AssembledPrompt.sections`, which would make the
   context inspector under-report the brand.

   Budget: `projectCascade: 3000 → 2200`, `brandContext: 800`. Total unchanged
   at 8400. `brandContext` is added to the real `SectionBudget` interface.

   Content (~600 tokens): palette names and hexes, type stack, six to eight
   rules, a one-line tone statement.

2. **A `brand_get(section)` tool**, `category: 'custom'` so it survives the MCP
   bridge filter and reaches CLI providers. Exact values the model must
   reproduce verbatim — the full palette, the logo data-URI, component snippets
   — come from here. Prose paraphrases hex codes; a tool does not.

Resolution is **live, in the assembler**, via a new `resolveBrand(projectId,
conversationId)` dep — not copy-at-create. Copy-at-create would snapshot: a
brand edit would never reach existing conversations, and a card moved between
projects would keep the old brand. For conversations with `project_id = NULL`
the resolver walks `parent_conversation_id` through `getAncestry()`, then falls
back to an instance default if one is configured, then to unbranded.

### 5.5 — Enforcement policy

Hard enforcement is realistic **only where a deterministic renderer owns the
chrome**. That is the email shell, the notification template, the
`render_branded_html` tool and the email-draft gate.

For free-form model output it is not achievable: on CLI providers file writes
bypass `tool-executor` entirely (§3.7), so a PreToolUse hook would be enforced
on Anthropic-direct and inert on claude-code. **A brand that is enforced on
some providers and not others is worse than one that is uniformly soft.**

> **Policy: hard on the shell, soft on the content.** Prompt section + verbatim
> tool + an optional brand critic on the background path. Do not build
> provider-conditional hard enforcement.

`PostToolUse` cannot transform — `PostToolUseHook` returns `void`, the return is
discarded, throws are swallowed, and it fires after `logExecution()` has already
serialised the pre-mutation value. Do not design on it.

### 5.6 — Preview isolation

Artboards render in a nested `<iframe srcdoc sandbox="allow-scripts">`. Never
`allow-same-origin`. The iframe carries its own CSP via the `csp` attribute
where supported and an inline `<meta http-equiv="Content-Security-Policy">` in
the srcdoc otherwise, with `connect-src 'none'`, `img-src 'self' data: blob:`,
`style-src 'unsafe-inline'`, and a `font-src`/`style-src` carve-out for
`https://fonts.googleapis.com` and `https://fonts.gstatic.com` — the one
external host the format admits.

The runtime is injected into the srcdoc, replacing the `<script src="./support.js">`
marker line. Image references are resolved by literal substitution of the file
entry, as bare base64 wrapped into a `data:` URI at render time.

**Sanitizer decision:** DOMPurify (Apache-2.0, licence-clean) is added and
applied to any artboard HTML that is ever rendered *outside* the sandboxed
iframe — currently nothing, but export paths will. Inside the sandbox the
isolation is the control, not sanitisation; the format is explicitly meant to
execute script. This is written down so the knowledge module's existing
raw-HTML precedent is not silently extended.

---

## 6. Phases

Each phase ships on its own. The order is dependency-driven; F0 exists because
every later phase inherits its reach from it.

### F0 — Foundation repair

No new feature. Repairs paths that are silently broken today.

**Reach**
- Wire `executeAgent` (`agent/index.ts:494-512`) and `channel-run-agent`
  (`communication/channel-run-agent.ts:53-56`) into `buildForPrimary`. Both
  already have `conversationId`, so `conv.projectId` is one lookup; keep the
  existing fail-soft pattern.
- Set `project_id` on orchestrator children (`orchestrator.ts:743-758` uses
  plain `create()`), or make `resolveBrand` walk `getAncestry()`. Do both.
- Add `projectId` to `ToolContext`.
- Make `resolveActiveVoice` fail soft. Today it throws when an agent has no
  `SOUL.style.json`, `buildForPrimary` awaits `Promise.all` over every resolver,
  and the interactive path's catch then sends `system: ''` — one missing file
  deletes the entire prompt.
- Add `project_id` to `ConversationService.create()`'s INSERT.

**Core HTTP**
- Route-scoped body limit: allow `createApp` to mount a raised limit for a
  prefix list. Fix `documents` at the same time (it is already broken).
- A public static route for brand assets, inserted into `main.ts`'s
  `Bun.serve` handler **above** `tryServeWebSpa` (an unconditional catch-all).
  Reuse `static-files.ts` — its MIME map already covers images and fonts and it
  has a traversal guard. Set `Cross-Origin-Resource-Policy: cross-origin` and an
  explicit long `Cache-Control` there, because this path bypasses Hono and
  therefore all security headers.
- Add DOMPurify as a dependency (Apache-2.0).

**Acceptance:** a probe section injected by a test resolver appears in a
recorded `context_compositions` row for **every** entry point in §3.2 — not
four of ten. A 4 MiB upload to the raised-limit prefix succeeds.

### F1 — Brand entity and inheritance

- `design_systems` table; brand file tree per §5.2; Zod-validated `brand.json`.
- `projects.design_system_id` (nullable); conversation-level override column
  (four coordinated edits: runtime ALTER, drizzle mirror, `ConversationUpdate`,
  `UPDATE_FIELD_MAP`). Add `design_system_id` to the project PATCH allow-list
  (`board/routes.ts:116-124`) or it is unsettable on `general-general`.
- `Brand` CASL subject via `registerSubject` in `onRegister`, in try/catch.
- `brand-context` prefix section + budget carve-out per §5.4.
- `brand_get` tool, `category: 'custom'`.
- Asset store + the F0 static route; auto-generated ≤80 KB PNG logo variant and
  a data-URI encoder for email.
- Settings UI (brand list, editor, project binding), six locales.
- **Origins in this phase:** manual editor; import from a Claude Design
  design-system file tree or zip; AI extraction from a codebase path or an
  uploaded PDF/screenshot (`pdf-parse` exists; vision goes through the model
  gateway); AI generation from a brief.

**Acceptance:** a brand token string appears in a recorded `context_compositions`
section for a conversation in a project that has a brand, on an entry point from
each row of §3.2's table.

### F2 — Design canvas MVP

The "Design" menu item.

- `designs` + `design_versions` tables (artifacts' version triple, but ISO
  timestamps per house convention — artifacts' epoch-ms is the outlier).
- `design_links` junction for multi-owner binding (conversations, projects,
  knowledge), mirroring `document_links`.
- The MIT `.dc.html` runtime: template compiler for holes / `sc-for` / `sc-if` /
  `dc-import`, `<helmet>` extraction, `DCLogic` base class, `data-props`
  parsing. Render-only in this phase.
- Sandboxed preview component per §5.6.
- Pan/zoom canvas honouring `canvas.json`: artboard frames, pages, annotations
  (read-only), `launch`.
- Source editor: CodeMirror 6 (MIT).
- The AI editing engine per §5.3, with the built-in design prompt seeded per §7.
- Import: parse a published Claude Design canvas page's `appifact-doc` block.
  Export: file tree / zip, and a self-contained HTML page using the EYAS runtime.
- Conversation integration: a design picker in the composer, `design_*` tools,
  and a `design-context` section (**not** the key `'skill'` — `ContextRecorder`
  derives `skills.use_count` from that key).

**Acceptance:** a canvas exported from EYAS re-seeds in Claude Code's `/design`
helper without a validator error, and a Claude Design canvas imports and renders.

### F3 — Branded output surfaces

- `render_branded_html(content, brandId)` tool producing a self-contained page.
- Email: populate `ChannelContent.html` (plumbed to MIME in gmail/m365/nodemailer,
  **never populated** today — `communication/index.ts:660`); add
  `email_drafts.body_html`; wrap at `email_send_draft`.
- Route `notifications/channels/email.ts` through the template engine. Today it
  bypasses it with an inline
  `html: \`<h3>${payload.title}</h3>${payload.body ? \`<p>${payload.body}</p>\` : ''}\``
  (`channels/email.ts:65`), unescaped. Fix the escaping while there. `render()` / `registerTemplate()` currently have zero callers.
- Replace the hardcoded hex map in `notifications/templates.ts` with brand
  tokens. Notifications carry no `projectId`, so this is instance-level brand
  unless a link is added.
- Class hooks in `client-wiki/markdown-render.ts` (currently classless) and the
  knowledge editor's injected `<style>`.
- Hard enforcement at the email-draft gate (add a validator; note this is a
  behaviour change for existing callers).

### F4 — WYSIWYG and interactive prototypes

- Click-to-select, properties panel bound to the focused artboard, inline text
  editing, undo/redo scoped to the focused artboard.
- `data-props` editors surface as tweak chips; edits become the file's new
  defaults on save.
- `DCLogic` state and event binding execute, making working controls possible;
  `is_interactive` on the artboard.
- Flex/grid property editing, including the `repeat(N, minmax(0, 1fr))` round-trip.

### F5 — Print, PDF, PNG, and URL extraction

- Promote Playwright to a real dependency (Apache-2.0) with Dockerfile browser
  and system-library steps and graceful degradation when absent. Use
  `page.setContent()`, not the existing `browser_navigate` tool — that is
  SSRF-guarded against localhost and is `riskTier: 'red'`.
- `print: 'fixed'` exports one page at natural size (96 css px/inch);
  `print: 'flow'` paginates. PNG per artboard, PDF for the canvas.
- Brand extraction from a live URL lands here, because it needs the browser.

### F6 — Enforcement and polish

- Brand-compliance critic on the background path, modelled on `agent/critic.ts`
  (round caps, feedback re-injection). Choose the polarity deliberately: the
  security judge fails closed, the completeness critic fails open.
- App-chrome skin: runtime `<style>` injection for `:root[data-template="brand-<id>"]`,
  widening `isTemplateId`'s closed union and the build-time `@import` list.
  Tailwind v4's `@theme inline` resolves `hsl(var(--x))` at runtime, so this
  needs no rebuild.

---

## 7. The built-in design prompt

Written from scratch, English, language-neutral (`tests/modules/prompt-wizard/canonical-seed.test.ts:16-24`
asserts shipped prompts carry the "match the owner's language" rule and do not
force a human language).

Hosted as a module-owned, seeded, owner-overridable row:

1. `DESIGN_EDITOR_PROMPT` const in `src/modules/design/design-prompt.ts`.
2. `INSERT OR IGNORE` on every `onStart` with a stable literal id.
3. **Read the row back at call time**, falling back to the const — that is what
   makes owner edits win.
4. A hash-set seed migration modelled on `prompt-wizard/seed-migration.ts:14-16,120-152`:
   keep the verbatim body of every prior shipped default, sha256 them, UPDATE
   only rows still matching a known prior default.

> **Binding consequence:** every future edit to the prompt must append the
> previous text to the `PRIOR_*` array. `INSERT OR IGNORE` never refreshes, so
> omitting this freezes already-seeded installs on the old text forever.

Not a bundled skill: `conversations/routes.ts:697-700` does
`if (activeSkill) { tools.length = 0 }` — a design editor shipped as a skill
loses every tool it needs. Not an agent template: templates materialise only
during first-run setup, so existing installs would never get it.

## 8. Data model

```sql
design_systems(
  id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE,
  description TEXT, tone TEXT, source TEXT,            -- manual|import|extract|generated
  current_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')))

design_system_versions(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  design_system_id TEXT NOT NULL, version INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_by TEXT, change_note TEXT,
  UNIQUE(design_system_id, version))

brand_assets(
  id TEXT PRIMARY KEY, design_system_id TEXT NOT NULL,
  kind TEXT NOT NULL,                                   -- logo-light|logo-dark|logo-mark|favicon|font
  sha256 TEXT NOT NULL, ext TEXT NOT NULL, bytes INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')))

designs(
  id TEXT PRIMARY KEY, title TEXT NOT NULL, slug TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL DEFAULT 'freeform',                -- ui|landing|print|deck|wireframe|freeform
  -- REMOVED after review: `status TEXT NOT NULL DEFAULT 'draft'` shipped with a
  -- badge and a filter nobody called, and nothing anywhere read it. See the
  -- architecture doc's Design section.
  design_system_id TEXT, tags TEXT NOT NULL DEFAULT '[]',
  current_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')))

design_versions(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  design_id TEXT NOT NULL, version INTEGER NOT NULL,
  origin TEXT NOT NULL,                                 -- ai|manual|import
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_by TEXT, change_note TEXT,
  UNIQUE(design_id, version))

design_links(
  design_id TEXT NOT NULL, owner_module TEXT NOT NULL, owner_id TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'user',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY(design_id, owner_module, owner_id))
```

Plus `ALTER TABLE projects ADD COLUMN design_system_id TEXT` and
`ALTER TABLE conversations ADD COLUMN design_system_id TEXT`.

Conventions: snake_case columns, TEXT primary keys via `generateId()` (ULID),
booleans as INTEGER 0/1, JSON as TEXT with `'[]'`/`'{}'` defaults, ISO-8601
timestamps. Tables created by `createBrandTables(db)` / `createDesignTables(db)`
from `onRegister`. Not added to `drizzle.config.ts`. `db.get()` is unreliable
with multiple bound params — use `db.all(q)[0]` as `document-service.ts:81-85`
does.

## 9. HTTP API

All under `/api/v1`, created in `onStart` (never `onRegister` — regex-enforced
by `tests/contracts/api-auth-coverage.contract.test.ts:127`), with
`dependencies: ['permissions', 'auth']` declared, and the auth+CSRF pair added
to `auth/routes.ts` mirroring the `/api/v1/home/*` block at lines 164-165. Do
not add to `CSRF_PAIRING_DEBT_BASELINE`.

```
GET    /brands                       list
POST   /brands                       create (manual | generate | extract | import)
GET    /brands/:id                   metadata + tokens
PUT    /brands/:id                   update tokens (new version)
GET    /brands/:id/files             file tree
GET    /brands/:id/files/*           one file
PUT    /brands/:id/files/*           write one file (new version)
GET    /brands/:id/versions
POST   /brands/:id/restore/:version
POST   /brands/:id/assets            upload (raised body limit)
POST   /brands/:id/ai                AI edit / generate / extract
GET    /brands/:id/export            zip

GET    /designs                      list (filter: kind, status, brand, link)
POST   /designs                      create (blank | from-template | import)
GET    /designs/:id                  metadata + files
PUT    /designs/:id/files/*          write one file (new version)
DELETE /designs/:id/files/*
GET    /designs/:id/versions
POST   /designs/:id/restore/:version
POST   /designs/:id/ai               AI edit (tier auto-selected)
POST   /designs/:id/links            bind to conversation/project/knowledge
GET    /designs/:id/export?format=   files | zip | html | png | pdf
POST   /designs/import               from a Claude Design canvas page
```

CASL subjects `Brand` and `Design`, actions `read/create/update/delete/manage`,
enforced per route with `requirePermission(action, subject)`.

## 10. Frontend

There is **no UI registry** — `FrontendManifest.pages` and `.settings` are read
by nothing; only `.widgets` is live. Wiring is manual:

| # | File | Change |
|---|---|---|
| 1 | `src/web/src/routes/design.tsx` | new parent route |
| 2 | `src/web/src/routes/design.$designId.tsx` | new detail route |
| 3 | `src/web/src/routes/routeTree.gen.ts` | regenerate via `bun run build:web`; never hand-edit |
| 4 | `src/web/src/components/layout/sidebar.tsx` | lucide icon import + one `renderNavLink` call in the Content section |
| 5 | `src/web/src/components/layout/locales/{en,hu,de,es,fr,tlh}.json` | `nav.design` |
| 6 | `src/web/src/pages/design/**` | pages + `i18n.ts` + `locales/*.json` |

The canvas page uses `<AppLayout noPadding>`. Data through `useApi<T>` over
`lib/api.ts`. Styling with the existing `.vibrancy` / `.glass-card` /
`.page-title` classes and CSS variables only (Architecture Rule 9).

New dependencies, all licence-clean: **CodeMirror 6** (MIT) for source editing,
**DOMPurify** (Apache-2.0), **Playwright** (Apache-2.0, F5 only). The pan/zoom
canvas is hand-built — `react-grid-layout` is a 12-column grid, not free-form
artboards, and Cytoscape is graph-only.

Two frontend traps: a language switch remounts the whole route tree
(`<RouterProvider key={lang}>` in `app.tsx:38`), so unsaved canvas state must be
persisted to a store or the server; and `bun run lint` excludes `src/web`, so
only `bun run build:web` type-checks it.

## 11. Cross-cutting obligations

**11.1 i18n.** The frontend is a hand-rolled flat registry
(`src/web/src/i18n/index.ts:23-58`), **not** i18next despite CLAUDE.md. `t()` is
a plain function, not a hook. Keys must be prefixed `design.` / `brand.` — the
registry is one global namespace and an unprefixed key silently overwrites
another module's. `tests/contracts/web-i18n-parity.contract.test.ts` auto-discovers
any `locales` directory and requires exactly `en, hu, de, es, fr, tlh` with
identical flattened key sets and identical `{{placeholder}}` sets. Klingon is
not optional.

**11.2 Tests.** `tests/modules/brand/`, `tests/modules/design/`, kebab-case
`<subject>.test.ts`. Service harness: `createMemoryDb()` + `createDesignTables(db)`
+ `createDesignService(db, mockLogger)`. Route harness: bare `new Hono()` with a
fake middleware setting `userId` and `ability`. Component tests need
`// @vitest-environment jsdom` as the **first line**, above the licence header.
Contract tests that can trip: `api-auth-coverage`, `web-i18n-parity`, `widgets`,
`ws-topics` (no inline topic literals anywhere in `src/**`; a per-id topic like
`design:<id>` needs a new `OwnershipPrefix`, a `parseTopic` branch and a
registered resolver in `ws-acl.ts`, which is fail-closed).

**11.3 Docs.** Six markdown files under
`packages/docs/src/content/docs/{en,hu,de,es,fr,tlh}/<section>/`, plus
`OUTLINE.md`, `generate-skeleton.mjs` `SECTIONS`, `generate-full-docs.mjs`
`PAGE_MAP` + `META`, and `help-map.json` entries for any `<ContextualHelp>`.
Run `bun run full-docs` then `bun run docs:build`. The generators overwrite
skeleton pages.

**11.4 Architecture doc.** New numbered sections in `docs/eyas-architecture.md`
with matching TOC entries at line 72, status blockquote, Hungarian ASCII-folded
prose.

**11.5 Version.** Frozen. Do not touch `version.json`, `package.json` versions
or HTML version strings.

**11.6 Fonts.** v1 ships font *stacks*, not binaries. There is zero `@font-face`
machinery in the repo. Binary webfont upload needs the body-limit fix plus an
`@font-face` injection path plus a licensing story — deferred.

**11.7 SVG.** Brand asset upload accepts PNG/JPEG/WebP only in v1. The moment
inline serving exists, extension-sniffed SVG is a stored-XSS vector.

## 12. Risks

1. **The reach illusion.** F1 without F0 gives a brand that governs interactive
   chat and scheduled runs and is a silent no-op for every delegated subagent,
   every channel reply and every CLI-SDK subagent. The failure looks like model
   disobedience. *Highest probability, highest cost.*
2. **Building on the dead chain.** `projects.prompt`, `resolvePromptChain`,
   `prompt_templates(level='project')` and `section-merger` all look exactly
   like the right hook and are wired to nothing; one is DROPped by a migration
   script.
3. **The 8400/8800 budget cliff.** Carve out; never add.
4. **Paraphrased brand values.** Without `brand_get`, "#0A2540" becomes "a dark
   navy" and the output is off-brand in a way nobody can grep for.
5. **Provider-inconsistent enforcement.** Resolved by policy in §5.5; the risk
   is re-litigating it later and shipping a PreToolUse hook that is inert on
   half the providers.
6. **Assembler all-or-nothing fragility.** `buildForPrimary` awaits
   `Promise.all` over every resolver; `resolveActiveVoice` throws on a missing
   `SOUL.style.json` and the catch sends `system: ''`. Fixed in F0 — but any new
   resolver must be fail-soft by construction.
7. **Scope.** Three products in one ask. The phase boundaries are the mitigation;
   collapsing them produces a multi-month monolith that ships nothing.
8. **Schema and i18n tax.** Columns live in two places (runtime ALTER and the
   drizzle mirror, contract-enforced); a conversation-level field also needs
   `ConversationUpdate` + `UPDATE_FIELD_MAP` or it is accepted and silently
   dropped.
9. **Adding another dead column.** `projects.skills`, `projects.permissions`,
   `knowledge_pages.is_template`, `stages.is_hidden`, `sandboxMode`,
   `requiresPreview` are all declared-and-never-read. The house pattern is to
   add a column and forget the wiring.

## 13. Naming

`artifacts` already has an artifact kind called `design-doc`, meaning a software
architecture document. It is unrelated. In UI and code, the visual entities are
**Design** (a canvas) and **Brand** (a design system); `design-doc` is never
used for either.

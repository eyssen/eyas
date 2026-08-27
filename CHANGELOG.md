# Changelog

## [0.8.15-beta] - 2026-08-27 — Designs your agents follow

A design stops being a picture you keep somewhere else and becomes something the
work follows. Multi-artboard canvases in the Claude Design format, rendered by
EYAS's own MIT runtime: create one, import one, edit it by hand or on the canvas
or by asking, version every change through a single validator, attach it to a
conversation or a project, and export it to PNG and PDF.

Getting an agent to actually use one took longer than building it, and that is
most of what follows. The tool inventory was clipped to 15% of itself. A matched
skill emptied the tool list. Nothing that was ever written to memory could reach
a prompt, and nothing wrote to memory either. Each was invisible on its own, and
together they were why a design sat attached to a conversation and changed
nothing.

### Design (F2)

- **A "Design" menu item.** Multi-artboard canvases on a pan-and-zoom surface, in
  the Claude Design container format: `<Name>.dc.html` artboards, a `canvas.json`
  layout manifest with pages and sticky notes, and images stored as bare base64
  under their filename. A canvas exported here re-seeds there, and one published
  there imports and renders here.
- **EYAS's own runtime.** The hosting platform's editor is a ~2.4 MB precompiled
  payload under a licence this repository cannot redistribute, so the Design
  Components dialect is implemented from scratch as MIT code: dotted-path holes,
  `<sc-for>`, `<sc-if>`, `<dc-import>`, JSX-camelCase event binding, and real
  execution of the artboard's `class Component extends DCLogic` — so clickable
  prototypes, variant switches and selection state work.
- **The isolation that makes executing AI-authored JavaScript acceptable:** a
  `srcdoc` iframe with `sandbox="allow-scripts"` and never `allow-same-origin`, a
  CSP inside the srcdoc with `connect-src 'none'`, and Google Fonts as the only
  external origin. No route serves an artboard as a document — the render endpoint
  returns the srcdoc and the sandbox value in one JSON payload so they cannot
  drift apart. The runtime moves `<helmet>` content into `<head>` but drops any
  `<script>` there.
- **A validator gate on every write.** Hand edit, import or AI result, all of it
  is checked before it can become a version: an artboard with no `<x-dc>` root, a
  layout entry naming a file that is not there, an image reference with nothing
  behind it, a case-insensitive artboard-stem collision, a `launch` pointing at
  nothing, a stray top-level key in `canvas.json`, and the `}} ?` ternary inside a
  style attribute that the format drops silently. A rejected edit leaves the
  previous version byte-identical.
- **One AI pipeline, not one per vendor.** The same prompt and the same gate
  whatever the provider; only the executor tier varies — whole-canvas rewrite for
  small canvases, per-artboard iteration for large ones, both on plain text
  completion so a local model works too. A failed attempt is retried once with the
  validator's own output as the feedback.
- **Agents get `design_list`, `design_read`, `design_write` and `design_create`,**
  all `category: 'custom'` so they survive the MCP bridge and exist on the CLI
  providers. A design linked to a conversation travels with every turn as a
  `design-context` section; a large canvas is summarised and the agent fetches what
  it needs.
- Import from a published canvas page, export as raw files, as a portable canvas
  document, or as a standalone HTML page that opens and prints anywhere.

### WYSIWYG (F4)

- **Click an element, change it in a panel, and it lands in the source.**
  Typography, colour, box, border, radius and layout, including grid tracks that
  round-trip through `repeat(N, minmax(0, 1fr))`. Text is editable in place
  unless it is bound to a `{{hole}}`, which the panel says rather than silently
  overwriting the binding.
- **The design that this forced.** The artboard iframe has no
  `allow-same-origin`, so the app cannot reach its DOM. Rather than parse and
  mutate the template in the app — which would need a server-side DOM and a
  rendered-node-to-source mapping — the runtime owns the mutation: it stamps
  every template element with a stable index at parse time, applies the edit to
  its own copy, re-serialises, and posts the finished template back. The app
  splices it into the `.dc.html` file with the head marker, helmet and logic
  script preserved byte-for-byte.
- **Style edits keep `{{holes}}` in declarations they did not touch.** The patch
  works on the style attribute as text, declaration by declaration; a DOM style
  API would have destroyed the binding silently.
- **The splice refuses anything that does not read back as what was written.**
  Checking that the result merely parses is too weak: a `</x-dc>` inside a
  template closes the element early, and the file still parses — into a
  truncated artboard.
- **Messages are attributed to the artboard's own frame** before they are acted
  on, and validated against a strict shape. They come from an opaque origin and
  are exactly as untrusted as the artboard.
- **Tweak chips** from `data-props` re-render live; pinning one writes it back as
  the artboard's declared default.
- **Undo/redo** per artboard with Cmd/Ctrl+Z, and one version per explicit save
  rather than one per keystroke.
- The runtime defaults to **interact**, not edit: the canvas shows working
  prototypes, and an artboard marked `is_interactive` never enters edit mode.

### Print, PDF and PNG (F5)

- **A design canvas exports as PNG and PDF.** One artboard at 1× or 2×, one
  artboard as a PDF at its own natural size, or the whole canvas as a single
  multi-page PDF. `print: 'fixed'` artboards come out as one page at exactly
  their frame — a CSS pixel is 1/96 inch, so the size passes through without a
  conversion; `print: 'flow'` artboards paginate onto A4 or Letter.
- **The browser fact that shaped it: Chromium will not paginate inside an
  iframe.** It lays a frame out as a fixed box and clips the overflow, so a
  flowing artboard printed in the preview's sandboxed iframe would come out as
  one truncated page. Every artboard is therefore rendered as its own top-level
  document, and a canvas PDF is those PDFs concatenated with `pdf-lib`. That is
  the better answer anyway: each page keeps its natural size, a flowing report
  still paginates, and one artboard's `<helmet>` CSS cannot leak into the next.
- **Losing the sandbox attribute meant replacing it with three things.** Every
  print page opens in a throwaway browser context with no cookies and an opaque
  origin; every request is aborted in the browser process except the two Google
  Fonts origins the format admits; and the page carries the same `ARTBOARD_CSP`
  as the preview, imported rather than re-typed so the two cannot drift.
- **A broken artboard is refused, not exported blank.** Both failure layers are
  checked — the mount throwing, and the runtime's own marker when a component
  constructor or `renderVals()` throws. A PDF whose only content is
  "renderVals() threw: …" is worse than an error message.
- **The browser is optional and says so.** `playwright-core` is a real
  dependency (Apache-2.0, no postinstall, no runtime dependencies of its own);
  the ~150 MB browser binary is not. It is resolved from `EYAS_CHROMIUM_PATH`,
  then Playwright's own registry, then known system paths, and when there is
  none `/api/v1/designs/print-status` answers `available: false` with the remedy
  and the UI disables the buttons. The Docker image installs Chromium and the
  fonts a headless browser needs; deleting that layer costs ~350 MB and switches
  these two features off cleanly.
- **The Chromium sandbox is never disabled automatically.** A sandbox failure
  does not fall back to `--no-sandbox`: the renderer is the process that
  executes AI-authored artboard JavaScript, and turning a deployment problem
  into a silent security downgrade there is not a trade-off worth making
  quietly. It takes an explicit `EYAS_CHROMIUM_NO_SANDBOX=1`, and the error
  message says so.
- **`playwright` is gone as a shimmed optional module.** The browser tools and
  the print pipeline now share one resolver, so there is a single place that
  knows how to find a Chromium, and the SSRF predicates moved to
  `shared/net-guard` where the headless browser can apply them per request.
- **New dependencies:** `playwright-core` (Apache-2.0) and `pdf-lib` (MIT). The
  latter is not in the design spec's dependency list — it was added because
  concatenating per-artboard PDFs is what makes a mixed canvas correct instead
  of compromised onto one uniform paper.

### Canvas usability, and one field taken back out

- **The canvas takes a scroll wheel.** Plain scroll pans, Shift scrolls
  sideways, Ctrl/⌘ + scroll zooms — anchored on the pointer, so the thing under
  the cursor stays under the cursor. The listener is attached natively with
  `passive: false`, because React routes `onWheel` through a passive root
  listener where `preventDefault()` is ignored and Ctrl+wheel zooms the browser
  instead.
- **An artboard can be opened on its own.** A control on its title row (or a
  double-click on the title) fits it to the viewport; Esc returns to the
  previous view. This is what finally makes `artboardEntry.expand` do something:
  `fit` shrinks the whole artboard to the viewport, `fill` widens the frame to
  the viewport at natural scale and lets it scroll.
- **"Fit" now fits.** It measures the page's actual bounding box — artboards and
  annotations — instead of resetting to a hardcoded 60% at 40,40.
- **Nothing was put over the frames.** An overlay would make the entire surface
  pannable, but it would also silence every `is_interactive` prototype until you
  clicked into it. Dragging the background works, so opening an artboard is an
  explicit control rather than a gesture over a frame.
- **A design can be renamed** in place from its header.
- **`designs.status` is gone.** It rendered a badge in the list and did nothing
  else: it gated nothing, no UI ever called its filter, and it could not be
  changed from anywhere. A declared surface with no consumer — removed rather
  than given a job it did not need. Existing installs keep the column inert
  (`NOT NULL DEFAULT 'draft'`, so an INSERT that omits it still works); a table
  rebuild is not worth it, and a test pins that the old shape still works.

### Deleting a design, and watching a long AI edit

- **A design can be deleted from the interface.** The capability had been in
  the API since the canvas shipped, with no button anywhere — the manual said
  so out loud. The bin sits in the detail header beside rename, not on the list
  cards: those are links, and a destructive control inside a navigation target
  is a misclick waiting to happen.
- **The confirmation names what goes with it** — saved versions, and every
  conversation or project the design is attached to. The attachment count is
  the part nobody can see from the design's own page, so `GET /designs/:id` now
  carries a `links` summary next to the design. Asking blind is the worse
  version of asking.
- **A nine-minute AI edit no longer looks like nothing happening.** A measured
  edit on a CLI provider took 8 min 43 s behind a bare spinner. The panel now
  counts the elapsed time, says that a large canvas can take minutes, and the
  AI button in the header spins while a run is open — so it is visible without
  opening the panel.
- **A failed AI edit keeps its reason.** Every attempt is recorded before the
  model is asked and closed on every exit, including the throw, so a reload, a
  dropped connection or a proxy timing the request out no longer destroys the
  answer: the server finishes, the row records it, the panel reads it back. The
  request itself stays synchronous — turning it into a job id would only
  shorten the HTTP hold, at the cost of the existing API and the candidate
  preview path.
- **A restart is not a model failure.** A run orphaned by a dead process is
  closed as `interrupted` with its own message when the module registers,
  rather than spinning forever or being reported as something the AI got wrong.
- **Two clocks again, handled at the source.** "How long has this been running"
  subtracts a server timestamp from a browser one. The runs response carries the
  server's own `now`, the frontend derives the skew from it, and the elapsed
  figure is measured on one clock. The columns are epoch milliseconds rather
  than this module's usual ISO text, because `datetime('now')` produces a string
  `new Date()` reads as local time.
- **A second AI edit cannot start while one is running** on the same canvas.

### Attaching a design where it is actually used

- **A design can be attached to a conversation from the UI** — an icon in the
  top bar with a count, not a field: the bar is full, and this is an occasional
  act.
- **And to a project**, which every conversation created in it then inherits.
- **A project's designs are COPIED onto a conversation created in it**, the same
  way `indexedSources` and `workingDirectories` already are — set on the
  project, and a new conversation starts with them; not set, and it does not.
  The conversation owns them from then on and can detach any one, and nothing
  resolves the project again at read time. The copy is additive and idempotent,
  so it never removes a design somebody attached on purpose.
- **`design_link` and `design_unlink` tools**, so an agent can attach the canvas
  it just made. They default to the run's own conversation from the tool
  context, never a model-supplied id, and `scope` is a closed namespace —
  `conversation` or `project` — so a model cannot file a link somewhere nothing
  reads it.
- **Background runs see attached designs.** `buildDesignContext` was wired into
  interactive chat only, which meant a scheduled run worked blind on the very
  design it was supposed to be working from.

### What an agent sees of an attached design
- **A design announces itself; it does not hand its contents over.** The block
  says a design is attached and what KIND of data each of its parts holds —
  tokens, typography, components, patterns — and names the two calls that fetch
  them. On the shipped Odoo canvas that is **652 characters against a 46 763
  character design**, and it stays flat: twenty artboards fold into the same
  handful of role lines as two.
- **`design_read` takes a `part`.** It used to return either one whole artboard
  or the entire canvas, so "read only what you need" meant reading 10 KB to
  find five hex codes. A part returns the derived values for one role and
  nothing from another, off the same derivation the announcement is built from
  — the two cannot disagree about what exists.
- **Nothing is inlined, at any size.** An earlier version put the palette in the
  block, and before that the whole canvas when it fit. Both were paid on EVERY
  turn; a fetch is paid once. At two turns the fetch already wins, and only the
  fetch stops the cost growing with the canvas.
- **The block instructs rather than announces.** It says to follow the design
  and not to invent styling, instead of merely noting that one is attached.
- **The index is derived, never stored.** A stored copy would be a second thing
  to keep in sync, would travel in exports, and would confuse the Claude Design
  interop.
- **The design prompt teaches the same role vocabulary**, so newly generated
  canvases name their artboards accordingly — the structure is the design's own,
  not a classification imposed afterwards. Artboards are classified by file name
  and title, never by body text: a body that mentions "pattern" proves nothing.
- Two regex traps found on the first real design: JavaScript's `\b` is
  ASCII-only, so `\bűrlap` never matches "Űrlapelemek"; and Hungarian lengthens
  the stem vowel in the plural, so "minta" is not a prefix of "minták".

### Foundation (F0)

- **One assembly path.** `assembleSystemPrompt` is now the single fail-soft "assemble and flatten"
  helper, and `executeAgent` plus `channel-run-agent` go through it. Delegated subagents and
  channel replies get the project cascade and the workspace files they were silently missing. The
  agent definition's own prompt is **appended**, never replaced, so nothing that worked stops working.
- **A missing `SOUL.style.json` no longer empties the prompt.** The active-voice resolver ran inside
  the assembler's `Promise.all`; one agent without that file made `buildForPrimary` throw and the
  interactive path send `system: ''`. It now degrades to a neutral profile.
- **`projectId` reaches where it was lost:** orchestrator children, `ToolContext`, and
  `ConversationService.create()`.
- **New entry points in the context inspector:** `delegated` and `channel`. A channel reply now
  records what its prompt was made of, which it never did before.
- **Route-scoped body limits.** The 1 MiB global cap is now raised per prefix. This also fixes
  document uploads, which believed they allowed 50 MB while HTTP rejected them at 1 MiB.
- **Public asset route.** `<dataDir>/public` is served with `Cross-Origin-Resource-Policy:
  cross-origin`, so an EYAS-hosted image can finally load in an email client or an exported page.
  Binary types only — SVG is refused on an origin that holds the session cookie.

### Outgoing HTML, without a second entity to configure

- **A deterministic renderer owns every byte of the HTML EYAS sends** —
  notification email, channel replies, and the body of an approved email draft,
  composed at SEND time rather than frozen into the draft row.
- **It takes Markdown, never HTML.** That is the security property, not a
  convenience: accepting markup would need a sanitizer, and instead the body
  goes through the existing escape-by-construction markdown renderer while the
  shell is built in code. A caller that passes HTML gets a refusal that says to
  send Markdown.
- **The notification email channel stops building its own HTML.** It routed
  around the template engine with an unescaped inline string — which is why
  `render()` and `registerTemplate()` had zero callers. Both the escaping bug
  and the bypass are gone, and the transport is injectable so the send path is
  actually tested.
- **`ChannelContent.html` is finally populated.** It had been plumbed all the
  way to MIME since the channel layer was written and never filled in.
- **`render_html_document` tool**, so an agent can turn Markdown into a
  self-contained page or email body through the same renderer.

### The brand entity, considered and removed

- A second entity (`design_systems`: palette, typography, tone, logo) was built
  alongside designs, with its own table, CRUD, versioning, project column,
  settings card, `brand_get` tool, compliance critic and app skin. **It is
  gone.** Two adjacent concepts — "brand" and "design" — are misleading side by
  side, and what was useful about it the design already carries: an attached
  canvas puts its artboard source in the prompt, so the agent sees the colours,
  the type and the components.
- **What survived, and why:** the deterministic HTML renderer above. Its palette
  is a constant now. Everything else went with the entity — the compliance
  critic, the app skin, the URL extraction, the `brand-context` prompt section
  and the 800 tokens carved out for it (`projectCascade` gets its full 3000
  back; the total is still 8400).
- Existing installs keep two inert columns (`projects.design_system_id`,
  `conversations.design_system_id`) that nothing reads; a table rebuild is not
  worth it.

### Tools that reach the agent, and output you can find

- **The design tools reached nobody.** They were registered, both MCP bridges
  would have served them, and every agent's allow-list had been written before
  the design module existed. The symptom was a model saying "`design_read` is
  not wired", working around it, and producing the result twice — once without
  the design and once with the palette it scraped out of the prompt.
- **Seeded agents are brought up to the tool set their template grants today.**
  Same shape as the design-prompt seed migration: keep every previously shipped
  tool set, upgrade only rows that still match one exactly. An agent whose
  tools somebody edited is left alone, because that was a decision.
- **Every module that registers tools now declares `tools` as a dependency.**
  Eight did not. Registration is `(ctx as any).tools?.registry` — an optional
  chain that gives up silently — so a module ordered before the tools module
  loses its tools with no error anywhere. It worked only because bootstrap
  happens to register the tools module earlier in the file. A contract test now
  runs the real loader over the real dependency graph.
- **The MCP bridge logs the tool list it serves.** Without it, "did the model
  actually get that tool" is archaeology.
- **A conversation always has a working directory.** With none, the agent
  picks: observed output landed in `/tmp` and on the Desktop in the same
  session. When neither the request nor the project names one, the conversation
  gets a directory of its own under the data directory.
- **What an agent writes hangs off the message that produced it**, so it is
  visible in the conversation as it happens and still there after a reload —
  not only in a side panel. The outputs are collected before the assistant
  message is stored and attached to it.
- **A non-image attachment is finally visible.** Every attachment rendered as
  an `<img>` that hid itself on error, so an HTML page, a PDF or a CSV became
  an invisible broken image: an agent could write a file, register it
  correctly, and still leave no trace anywhere a user looks. Images still
  render as images; everything else is a chip with its name, its size and a
  link that opens it.
- **Background runs collect their output too**, not only interactive chat — a
  scheduled report otherwise existed only on disk.
- **The token figure says what it counts.** "299 931 token" next to a one-line
  question reads as if EYAS had sent that much context. It is what the provider
  billed for the run, and a CLI agent re-sends everything it has read on each
  of its internal turns, so it is the sum of those. The label and its tooltip
  now say so. (The number itself was correct — this is a labelling fix, not an
  accounting one.)
- **Two clocks, one comparison.** Output collection compared `Date.now()` with
  the filesystem's mtime and required strictly newer. A fast run writes its
  file in the same millisecond, some filesystems keep mtime only to the second,
  and the file was dropped — a test that passed alone and failed in a warm
  suite. There is a two-second tolerance now: wider than any rounding, far
  narrower than the age of anything already in the workspace.
- **What an agent writes also shows up in the attachments panel.** A CLI
  provider writes with its own file tool, so there is no `write_file` call to
  intercept and nothing lands in the documents table. Instead, after a turn,
  the working directory is scanned for files newer than the turn and they are
  registered as documents on the conversation. Deliberately conservative: two
  directory levels, no build or checkout directories, an allow-list of
  extensions a person would open, and a cap — a working directory can be a
  repository, and a build must not become four thousand attachments.

### The tool list the model was shown was 15% of the tool list

- **56 tools rendered to 13 586 characters against a 2 000-character budget, so
  the model saw eight.** Every `design_*` tool was among the 11 517 characters
  dropped, and the clip landed mid-sentence — taking with it the line that tells
  the model where the real schemas come from. One half of the prompt referenced
  tools the other half did not list. The observable result: an agent narrating
  "the design tool may have a different name, I'm looking for it", writing the
  requested page without the attached design, and writing it again once it had
  worked the palette out from the design index instead.
- **Descriptions are now the first thing given up, and names the last.** An
  inventory's job is to say what exists; the schemas arrive over the provider's
  tool API, which the footer states. Names-only puts all 56 tools in about
  1 000 characters — the complete list, inside the same budget.
- **The footer survives at every size**, because it is where the model learns
  the descriptions it is no longer being shown are available elsewhere.
- **Nothing trails off.** If even the names do not fit, the section says how
  many it could not list. That is the case for skills today: 228 of them need
  roughly 3 700 characters against a 1 600-character bucket, so about a third
  are named and the rest are counted. A 228-entry inventory in a system prompt
  is its own problem, now visible instead of silently cut.

### A skill has to be accepted, and never takes the tools away
- **"Make a simple HTML file that shows the time" matched the
  `google-drive-integration` skill at 0.9**, was injected silently, and the same
  code path emptied the tool list — `if (activeSkill) tools.length = 0`.
  `design_read` was named in the prompt and in the tool inventory and was not
  callable, so the agent read a stale file off disk and produced the wrong
  design. Verified from the recorded prompt: the inventory was complete and
  untruncated, the design announcement was there, and the tools never arrived.
- **The tool-stripping rule is gone**, and was not narrowed to one skill type
  either. An `integration` skill exists to be used WITH tools; a `tool` skill IS
  one; a `knowledge` skill is reference material, which is no reason an agent
  should stop being able to read a file. Nothing tested it and nothing depended
  on it.
- **A matched skill is now a proposal, and the turn waits for the answer.**
  Nothing is streamed, no assistant message is written and the model is not
  called: the run stops at the match, which happens before the stream opens.
  The user's message stays stored — it really was sent.
- **The answer is two buttons**, and the card says WHY the skill matched: name,
  score and the matched pattern. On the failure above it would have read
  `Google Drive · 0.9 · name: Google Drive` on a request to print the time.
- **Both answers are remembered, per conversation.** Accepting applies the skill
  silently from then on, because it was approved; declining means it is never
  proposed again there. A skill can be right for one conversation and wrong for
  the next, so the decision is not global.
- **Resuming is a re-run, not a suspended request.** Holding an SSE connection
  open until a human clicks would survive neither a restart nor a closed tab.
  The client re-sends with `resume: true`, which skips storing the user message
  a second time — pinned by a test that counts the messages across the stop and
  the resume.
- **The background path proposes nothing.** There is nobody to ask, so it uses
  what was already accepted and otherwise runs without a skill.
- **Without a decision store no skill is applied at all.** A decision that
  cannot be recorded would be asked for again every turn, and injecting
  silently instead is the exact bug this closes.
- The weak match that started it is left standing as a separate problem — a
  skill scoring 0.9 on an unrelated request means the matcher needs work — but a
  bad match now costs a click, not every tool and a wrong answer.

### Every tool call spun for ever on a finished run

- **The ACP client knew which tool call had ended and threw the id away.** It
  emitted `tool_use_start` with the real `toolCallId` and then a bare
  `tool_use_end` — no id, no status — so the panel could never match an end to
  a start. Seven tool rows kept spinning under a run badged `completed`.
- `tool_use_end` now carries `id` and `status`, optional so the nine providers
  that emit it bare stay valid. The grok-cli path fills both, the SSE relays
  forward them, and the two CLI providers stop guessing the id for their
  orchestration event.
- **Three ways a call can settle, in order of trust:** the `tool_result` that
  names it, the `tool_use_end` that names it, and — for a provider that names
  nothing — the oldest still-running call, because these CLIs run their tools
  one at a time. A first outcome always stands; a late end cannot turn a
  reported success into an error.
- **And a last line of defence:** finishing a run settles anything still
  running. A completed run cannot have a tool call in flight.

### Memory the model can actually see

- **The vault reaches the prompt.** A durable note — a markdown file with
  frontmatter — now contributes one line to an index the agent gets on every
  turn, on both the interactive and the background path. Before this, no memory
  tier had any path into the prompt except a tool nobody called, so a memory
  system that had been empty for 24 conversations would have stayed invisible
  even once it filled.
- **Two frontmatter fields carry it:** `kind` (`user`, `feedback`, `project`,
  `reference`) and `summary`. `user` and `feedback` rank first because they
  change how every answer is produced.
- **A note with no `kind` is never read as `user`.** It becomes `feedback` under
  `procedural/` and `reference` otherwise. Promoting an undeclared note to a
  fact about the owner would put it at the top of every prompt on a guess.
- **A hand-written Obsidian note works as-is.** With no `summary`, the note's
  first real line becomes its index entry — no EYAS-specific frontmatter needed
  for the vault to be useful.
- **The index says what it is.** A note's body is conversation text replayed
  into a system prompt later, which is a delayed prompt-injection channel; the
  block is labelled background context, not instructions.
- **Nothing is silently cut.** Whole lines are dropped to fit the budget and the
  count of what did not fit is printed. Half a summary is noise the model has to
  guess at.
- **Per turn, not a cache-prefix section** — `DEFAULT_BUDGET_FULL` sums to 8400
  against a shrink target of 8800, so a new prefix section would quietly scale
  every other section down for every agent.
- **Capture is deliberately not in this change.** The vault holds exactly what
  was put there on purpose.

### The user manual

- **The design chapter is rewritten** in all six languages
  (`knowledge/design.md`). It had grown by appending a section per feature and
  read like a build log: "Editing" and "Editing on the canvas" as separate
  topics, panning documented twice, "Import and export" competing with
  "Printing and export", and — worse — a stale claim that a small canvas is
  injected whole and a large one summarised, which stopped being true when the
  index landed.
- Eleven sections in a reading order, identical across the six languages:
  creating, getting around, opening one artboard, the three ways to edit,
  tweaks, versions, **naming artboards so an agent can find them**, attaching,
  what an agent actually sees, exporting and printing, and renaming and
  deleting.
- **Writing the chapter is what found the missing delete button.** A "what is
  not there yet" section had to exist to admit it. Both are gone now — the
  button was built, and the section it needed had nothing left to say.

### Fixed along the way

- **`triage.ts` called `require()` three times in an ESM codebase.**
  `COMPLEXITY_TO_TIER` and `CATEGORY_TIER_OVERRIDE` are runtime constants that
  had been placed in an `import type` — which erases them — so three call sites
  reached for `require('./types.js')` to get them back. That resolves only once
  something else has loaded the module, so any chat-route test running on its
  own died with "Cannot find module './types.js'" while passing in a warm suite.
  They are a value import now.

### Security

- Artboard HTML never gains `allow-same-origin`; the public asset route serves an
  allow-list of binary types only, with `nosniff` and an explicit CORP header, because it bypasses
  Hono and therefore every security-header middleware.
- DOMPurify added (taken under its Apache-2.0 option) for the HTML surfaces that follow.

### Known issues

- The 58 pre-existing test failures across 9 files (test-fixture drift) are unchanged.
- The design source editor is a plain textarea, matching the workspace file editor
  already in the app. A real code editor is deliberately deferred rather than
  introducing a second editing paradigm in the same release.
- The agentic executor tier — a CLI provider editing the materialised canvas with
  its own file tools — is designed but not wired; it needs the agent-runner
  integration. `chooseTier` never returns it, and nothing pretends otherwise.
- `bun run full-docs` regenerates every documentation page from the generator's metadata and
  **destroys hand-written prose** in the process. The committed docs and the generator have
  diverged; the design documentation was therefore hand-written into the six pages rather
  than generated.
- **The skill matcher scores badly.** `google-drive-integration` matched a request
  to print the time at 0.9, against a 0.1 threshold, out of 228 enabled skills.
  The acceptance gate means a bad match now costs a click instead of a wrong
  answer, and it is what finally makes the matcher's real quality measurable —
  but the scoring itself is untouched.
- **228 skills do not fit an inventory.** Their names alone need roughly 3 700
  characters against a 1 600 character budget, so about a third are named and
  the rest are counted. Honest, and still a lot of skills to put in front of a
  model on every turn.
- **Durable memory does not fill itself yet.** Recall works — a note in the vault
  reaches every prompt as one index line — but nothing writes one automatically.
  The vault holds exactly what was put there on purpose.
- **The permission bridge has no deterministic working-directory check.** Its
  gate is model-judged, so it refused one write to the project root and allowed
  another; an agent told to write only under its workspace put a file in the
  repository root anyway. A path comparison would settle it.

## [0.8.14-beta] - 2026-08-26 — Shape your own landing page

The landing page stops being something you're handed and becomes something you shape. The fixed
dashboard is gone; a nine-tile grid takes its place, and the extension point it's built on had
been sitting declared and unused since before this feature existed.

### Home
- **Widget grid at `/`:** drag to move, drag a corner to resize, remove a tile, or open a drawer
  and add one — including tiles from disabled modules, shown dimmed so you can see what could be
  there. Layout is per user and per breakpoint (`lg`/`md`/`sm` arrange independently) and saves
  itself ~800ms after you stop dragging.
- **Factory nine:** Pulse, Attention, Running agents, Schedule, Conversations, Board, Briefing,
  Cost, System. No stored layout means the factory layout applies — so a later release that adds
  a tile reaches everyone who never customised, automatically. A customised user is instead
  **offered** any newly-added factory widgets ("Add" / "No thanks"), never handed them silently.
- **Tiles fail alone.** A per-tile error boundary means a broken module shows "Unavailable" on
  its own tile; the other eight keep working.
- **Disabled-module tiles survive.** A tile from a disabled module drops out of the rendered grid
  but keeps its stored position and config, and returns intact when the module is re-enabled.
- **The widget extension point is alive.** `FrontendManifest.widgets` / `WidgetRegistration`
  (`src/core/types.ts`) were declared and typed but nothing populated or read them. The new
  `home` module now collects them from the module loader and serves them at
  `GET /api/v1/home/widgets`; a contract test forbids a manifest-declared widget with no frontend
  component, or the reverse.
- **Setup requests collapse:** `SetupRecommendationsCard` fired 10 requests on every open
  (providers, projects, prompts, agents, search sources, backups, ingress, autonomy, vault,
  communication). It now calls one server-cached aggregate, `GET /api/v1/home/setup-status`.
- **Dead code removed:** `AutonomyNudgeCard` — never imported, never rendered — is deleted, along
  with the fixed dashboard page it used to live on.
- Handbook: `daily/home` documents the grid, edit mode, add/remove/resize, restoring the factory
  layout, and the new-widget offer, in en, hu, de, es, fr and tlh.

### Security
- **The home endpoints were never authenticated.** `home` created its routes in `onRegister`, which
  runs for every module before any module's `onStart` — where auth mounts its middleware. Hono
  composes middleware in registration order, so nothing auth registered could ever apply: every
  `/api/v1/home/*` request failed with 401 and the UI bounced the user straight back to the login
  screen. Routes now mount in `onStart` and `home` declares `auth` as a dependency, which forces the
  order through the loader's topological sort. CSRF pairing added for the mutating layout routes.
- **A contract test now asserts what a route test structurally cannot.** Every route test in this
  repo installs its own `c.set('userId', …)`, i.e. simulates a world where auth already ran — which
  is why thousands of green tests never saw the above. `api-auth-coverage.contract.test.ts` runs the
  real dependency resolver over the real registration order and fails if a module that mounts routes
  lands before `auth`, or if an `/api/v1` segment is neither covered nor on a named public list.

### Fixed
- **Each breakpoint keeps its own arrangement.** The grid loaded the layout once at `lg` and never
  reloaded, so crossing a width threshold made the library derive an `md` layout from the `lg` one
  and save it — creating a stored row for someone who never customised (which stops future factory
  widgets reaching them) and flattening a deliberately arranged desktop layout on the way back.
- **Tiles stay inside their tiles.** Content larger than its cell escaped the frame and painted over
  neighbouring panels; it is now contained, with a visible scroll affordance where it scrolls. Pulse
  stays readable at its minimum height instead of clipping its own figures.
- **A failed fetch no longer reads as good news.** Attention, Conversations, Briefing and Board
  rendered a backend failure as a successful empty state — a dead approvals endpoint said "Nothing
  needs your attention". All nine tiles now report an unavailable source as unavailable.

### Known issues
- **The Privacy page bounces to login**, for the same reason the home page did: `privacy` registers
  before `auth`, so `/api/v1/privacy/*` never passes through the auth middleware. Its handlers use
  `requirePermission`, so the endpoints fail closed rather than being exposed — but the page is
  unusable. Not fixed here: `privacy`'s registration position is load-bearing for model wrapping.
- **17 route segments with mutating endpoints have no CSRF pairing** (a2a, artifacts, client-wiki,
  connections, costops, data-port, federation, ideas, intel, internal, ops, privacy, prompt-coach,
  skill-generation, system, team-sessions, voice). Pre-existing; frozen in a self-checking baseline
  so the list cannot grow unnoticed.
- **Disabling `auth` would start every module unprotected.** `startAll` never checks that a live
  module's declared dependencies are enabled, and `EyasModule.required` is declared but read nowhere.
- Visual layout was verified by a human on one screen size only; jsdom performs no layout, so no
  automated test covers rendering, drag-and-drop or resize.


## [0.8.13-beta] - 2026-08-25 — What actually happened

Two things that ran without leaving a trace now leave one. Every prompt records
the sections that really reached the model — in order, with sizes and what was
cut — and a scheduled job that cannot run says so on its own row instead of
sitting quietly marked active.

### Conversations
- **Context composition:** the token stripe above the header is clickable and
  opens that turn’s composition — every section that went into the prompt, in
  assembly order, with its size, whether it was truncated, and its raw content.
  Per turn, not a running total. The percentage now measures the context actually
  composed for that turn against the model’s window; the old figure summed input
  and output across the whole conversation and overstated how full the window was.

### Observability
- **Context tab:** average and peak token cost per prompt section with the sample
  count behind it, truncation rate, and estimate vs. actual — the first way to
  measure how far the token estimate drifts from what the provider reports.
  Detailed records are short-lived by design (7 days by default); the daily
  rollup survives.

### Skills
- **Inventory:** a resolution table — which copy of a skill won, what it shadows,
  where it came from, how often it was used, whether it is enabled. Duplicate ids
  resolve by a fixed ladder (user > generated > extension > core, then root, then
  path) instead of filesystem order, and the losers are recorded as shadowed
  rather than dropped silently.
- **Dead-skill detector:** finds orphaned, shadowed, never-used and dormant
  skills and files a proposal in the autonomy approval queue. It **disables; it
  never deletes**, and nothing changes until you approve. Facts are proposed at
  once; inferences wait out a grace period, and your own skills are exempt from
  the time-based rules.

### Scheduler
- **Runnability:** a job that cannot execute now says why — no handler
  registered (usually a disabled module), a trigger type that never fires on its
  own, or a schedule that could not be armed. Shown as a badge on the row, and
  **never hidden by the infrastructure filter**, since the jobs most likely to
  break are the module-seeded ones. The health strip’s “cannot run” count filters
  the list to exactly those jobs.
- **Execution log:** skipped runs now record why, and who triggered a run.
  The missing-handler case — the one early exit that recorded nothing at all —
  now writes a row, once per process, so a per-minute broken job cannot flood the
  log. `next_run_at` is refreshed on every path, so it stops drifting after a skip.
- **Truthful answers:** an invalid cron or a sub-second interval is rejected when
  you press Create instead of producing a job that silently never runs, and
  neither the API nor the agent tools report a run that did not happen. Creating,
  running and rescheduling all surface the reason when they are refused.

### Internals
- **Component tests:** first React component coverage in the repo —
  @testing-library/react (dev-only), plus 17 tests over the scheduler UI’s
  disabled states, badges, error paths and filters.
- Handbook updated in en, hu, de, es, fr and tlh across four pages.

---

## [0.8.12-beta] - 2026-08-24 — God Mode

Same task, several models, one winner. A Settings roster races in isolated
folders; they vote once on each other’s work; the winner’s files land on the
conversation and unique insights are listed — nothing is merged automatically.

### Conversations
- **God Mode:** last item in the Orchestration menu. First send confirms cost
  against the ceiling; later sends show a banner. Workers use isolated
  folders (git worktree when possible). One structured cross-review, then
  majority vote (chair / earliest finish on a tie; sole survivor if only one
  finishes). The winner workspace is promoted; unique insights are listed
  for you to apply. The **God** tab shows the step log, who voted for whom,
  each model’s comments on the others, and how the winner was chosen.
  Handbook (en/hu/de/es/fr/tlh) documents roster, isolation, decision rules,
  and how to read the God tab.

### Observability
- **God Mode tab:** ensemble run list, win-rate by model, average cost
  multiple versus a single model.

---

## [0.8.11-beta] - 2026-08-14 — Conversation working folders

A conversation now has a real workspace. Projects require a default folder
list (first = primary cwd); conversations inherit it and can override it.
Untitled threads get a name from the first request. Grok/Kimi CLI start in
that folder, not the EYAS install directory.

### Conversations
- **Working directories:** projects require a default folder list (first = primary
  cwd). Conversations inherit it, can override it, and reset it when the project
  changes. File/shell tools jail to those folders and no longer fall back to the
  EYAS process cwd. Folders tab plus a host-side directory browser.
- **Auto title:** after the first message, a still-untitled conversation
  (`Untitled` / `Névtelen` / empty) is named from that request. Immediate
  snippet, optional cheap-tier refine; a user-set title is never overwritten.
- **Context bar:** uses the model's catalog window (Grok 256k–500k), not a
  hardcoded 200k that painted a single Grok CLI turn red.
- **Grok CLI pricing:** `$2 / $6` per million (not the $15/$75 unknown-model
  fallback).
- **CLI cwd:** Grok/Kimi CLI sessions start in the conversation’s first
  working folder (same as Claude Code). They no longer inherit the EYAS
  process directory.

---

## [0.8.10-beta] - 2026-08-14 — French and Klingon locales

The product UI and the user handbook now ship **French (`fr`)** and **Klingon
(`tlh` / tlhIngan Hol)** alongside English, Hungarian, German, and Spanish.

### Languages
- Six product languages: `en`, `hu`, `de`, `es`, `fr`, `tlh`.
- i18n-parity tests require all six locale files per UI bundle.
- Settings language buttons wrap so all six labels fit.
- Setup wizard and Appearance picker offer Français and tlhIngan Hol.

### Product docs
- Starlight handbook in French and Klingon (54 chapters each).
- In-app `/docs/fr/` and `/docs/tlh/`; language switcher in the docs header.

---

## [0.8.9-beta] - 2026-08-13 — Durable tunnel + offsite backup credentials

Cloudflare tunnel settings survive a restart, and Backup destinations accept
pasted S3/B2 keys instead of only environment-variable names.

### Ingress
- Persist hostname + vaulted tunnel token; compact `eyJ` tokens accepted
  (not only dotted JWTs).
- Status matches reality: the UI no longer expects `active` while the API
  returns `{ status: { running } }`. Connected only after Cloudflare
  registers the connector.
- In-app `?` help on Tunnel settings; handbook page (en/hu/de/es).

### Backup
- Destination form accepts pasted access keys (not only `process.env` names).
- Pasted secrets are vaulted; B2 endpoint/region normalized.
- Backup list shows offsite upload status.

### Product docs
- Admin → Ingress (en/hu/de/es): tunnel token, persist, live status.

---

## [0.8.8-beta] - 2026-08-13 — Incremental code indexer

A full Odoo checkout can be indexed without freezing the server. Files are
persisted in batches; reindex skips unchanged paths; Search Sources shows
live chunk counts while `indexing`.

### Search indexer
- Incremental, batched persist (40 files at a time) so a full Odoo checkout
  no longer has to sit in RAM before any row is written.
- Tree-sitter WASM grammar/parser cache + dispose parse trees (was reloading
  the grammar on every file).
- Large classes store an outline + methods, not the whole class body twice.
- XML/JSON/YAML/HTML/CSS/SQL indexed as one chunk per file.
- Reindex skips unchanged files via `search_file_state` mtime; the HTTP loop
  stays responsive; Search Sources polls chunk count while `indexing`.
- Odoo family also skips `*_demo.xml`.

### Product docs
- User handbook (en/hu/de/es): large-tree indexing, resume on reindex.

---

## [0.8.7-beta] - 2026-08-12 — Multi-version code search pin + project defaults

Agents can pin **which** indexed codebases (e.g. Odoo 18c vs 18e vs custom addons)
a conversation may use — no silent version mixing. Project defaults inherit onto
new threads; handbook and env bootstrap cover the operator path.

### Search sources (multi-version)
- Source config metadata: **`label`**, **`version`**, **`edition`**, **`family`**,
  **`tags`**, **`include`/`exclude`**, **`maxFiles`** / **`maxFileSize`**.
- One checkout = one source (e.g. `18c`, `18e`, `eyssen-erp`). UI form + badges.
- Bootstrap idle sources from **`EYAS_ODOO_SOURCES_JSON`** (preferred) or
  `EYAS_ODOO_SOURCE_PATHS` when no labeled sources exist yet.
- **`search_indexed`** accepts `sourceIds[]` / `labels` / `version` / `edition`.
- Tools: **`get_search_context`**, **`set_search_context`** (conversation pin).
- Conversation **`search_context`** JSON + right-rail **Sources** tab (multi-checkbox).
- Project **`indexed_sources`** (search source IDs) as default pin — applied on
  conversation create and on project change.
- Shared **`resolveSearchContext`**: tool args → conversation → project → type →
  safe fallback (`needsPin` when multiple odoo-family versions would mix).
- Prompt suffix **`<code-search-context>`** for the active pin.
- Odoo tools use the same pin; cites are **`[source:odoo-src:label:file:line]`**.
- Code indexer: odoo-family excludes (`i18n`, `static`, …), higher default file
  cap, `rootLabel` / `module` metadata; reindex reuses embeddings by
  **content_hash**.

### Product docs
- User handbook (en/hu/de/es): Search Sources multi-version, conversation
  **Sources** tab, project default code sources, env bootstrap, tools, glossary.

---

## [0.8.6-beta] - 2026-08-08 — Model-agnostic coding surface (L1–L3)

EYAS owns the coding hands for every model — not only Claude Code SDK builtins.
First-class file tools, verify-before-done, worktree isolation on complex teams,
review helpers, local Odoo source search, and universal Pre/Post tool hooks.

### Coding surface (P0)
- **`read_file`**, **`write_file`**, **`edit_file`** (exact replace), **`grep`**,
  **`glob`** — workspace/worktree jail, sensitive-path deny, Zod validators,
  ACI-friendly output caps.
- **`run_command`** uses agent worktree `workingDirectory` when set.

### Review helpers (P2)
- **`git_status`**, **`git_diff`** (read-only) for PR-style review without shell.
- Coding and review agent templates grant the new file + git tools.

### Orchestration (P1)
- Team proposals use **git worktrees** for `complex` and `epic` (not only epic).
- Config **`agent.verifyCommands`** / **`verifyCwd`**: deterministic lint/test
  after a run, before the LLM critic; failures feed the feedback-resume path.

### Odoo source chain (P3)
- **`odoo_search_model`**, **`odoo_search_field`**, **`odoo_search_xml_id`**
  against local checkouts (`EYAS_ODOO_SOURCE_PATHS`).
- Bundled skill: `config/skills/coding/odoo/odoo-dev-chain.md`.

### Universal tool hooks (P4)
- **PreToolUse / PostToolUse** on every `ToolExecutor` path (all providers).
- Default safety hook blocks `.git` via file tools; registry on `ctx.tools.hooks`.
- Security-gate tiers + `FILE_ACCESS_TOOLS` cover snake_case coding tools.

### Product documentation
- User manual (en/hu/de/es): tools catalogue, agent configure, teams, configuration,
  skills, glossary updated for the coding surface.

---

## [0.8.5-beta] - 2026-08-08 — Grounding, connections, prompt coaches, multi-role readiness

Employee-replacement readiness release: agents retrieve and cite indexed sources
before inventing facts, CLI hosts share the same tool surface, durable shared
memory and external system inventory land, and prompt writing gets model-aware
coaches from one-off drafts through project/agent system prompts.

### Prompt writing
- **Model-aware Prompt Enhancer** (conversation drafts): shapes prompts for the
  thread’s model family (Claude, OpenAI, Gemini, Grok, Kimi), task-type chips
  (general/coding/research/analysis/writing/agentic/files-vision), quality
  scoring with checklist gaps, and concise/thorough alternatives. Dead wizard UI
  removed.
- **Scoped Prompt Coaches** for durable layers: project, project-type, and agent
  `systemPrompt` — same iterative help without mixing cascade/persona concerns.

### Grounding & hybrid search
- Hybrid search engine: FTS (Orama) + in-memory vector cosine index, fused with
  RRF and query-adaptive weights; degrades honestly to FTS when embeddings are
  unavailable.
- Embed-on-index: chunks store `embedding` BLOB + model when Ollama/OpenAI embed
  providers are present; startup reloads vectors into the index.
- `search_indexed` returns stable `citationId` / `cite` (`[source:…]`) fields;
  `list_search_sources` helps agents list configured sources before inventing
  facts.
- Completeness critic: deterministic grounding pre-check + RULE 6 for research /
  implement-from-source goals that claim completion without retrieval evidence;
  coding/data tool suggestions prefer search tools.

### CLI MCP tool parity (Grok / Kimi ACP)
- Stdio MCP server + loopback bridge (`/api/v1/internal/cli-mcp/*`) with
  short-lived secrets; ACP `session/new` receives non-empty `mcpServers`.
- Grok CLI and Kimi Code CLI providers inject the bridge (Claude Code already
  had in-process MCP) so host CLIs share EYAS ToolExecutor tools.

### Connections inventory
- New core module `connections`: named multi-instance inventory of external
  systems (Odoo, GitHub, GitLab, Linear, Notion, Jira, Slack API, MCP, custom HTTP).
- Catalog + CRUD API, health adapters, agent propose → human approve flow
  (optional autonomy queue), secrets vault binding (`conn-{id}-{field}`).
- Agent tools: `connections_list`, `connections_catalog`, `connections_test`,
  `connections_propose`.
- UI: `/connections` (active / pending / catalog), en/hu/de/es.

### Domain tools — Odoo + email
- Optional `odoo` module: JSON-RPC client + tools (`odoo_search_tasks`,
  `odoo_get_task`, `odoo_message_post`, `odoo_write_task` — write gated).
- Email draft → approve → send (`email_create_draft`, `email_approve_draft`,
  `email_send_draft`) with local draft store; send requires approved status.

### Durable memory, SLA, browser, failover
- **Memory blocks** (`memory_blocks` + `memory_block_read/write` tools): company /
  agent / team / run scopes with append/replace and prompt formatting.
- **SLA evaluation** in proactive heartbeat (`slaBreaches`: overdue + stale).
- **Browser hardening:** SSRF block for private/metadata hosts; `browser_snapshot`
  accessibility-tree tool (token-efficient).
- **Auto-failover planner:** when `EYAS_AUTO_FAILOVER=1` (or config), fill empty
  tier fallbacks from a second live provider (never overwrites set fallbacks).
- Ticket-to-code deploy artifact carries closed-loop checklist (human merge required).

### Multi-role execution
- **A2A task executor** wired to `agents.executeAgent` (conversation + agent run;
  no longer instant-fail “execution not available”); mailbox list/get on the
  communication service.
- **Remote-node SSH invoke** via `ssh2` (destructive-command guard unless
  `forceDestructive`); non-SSH types still 501.
- **Skill curator gate:** auto-adoption blocked unless a recent private benchmark
  snapshot meets min pass ratio + average score.

### Eval harness
- `tests/benchmarks` default agent factory is category-aware (email classifier +
  structured coding/ops/research handlers); `--stub` keeps CI plumbing smoke.
  `EYAS_BENCH_LIVE=1` optional live server path.

### Product documentation
- User/admin docs (`packages/docs/`, en/hu/de/es) updated for all 0.8.5 surfaces:
  Prompt Enhancer/Coach, hybrid search & grounding, Connections, tools catalogue,
  memory blocks, SLA, MCP CLI parity, A2A execution, security (SSRF/SSH), routing
  auto-failover, skill curator gate, glossary. New **Admin → Connections** page
  + help-map / sidebar entry.

---

## [0.8.4-beta] - 2026-08-02 — Security closure, durable autonomy, operator platform

Everything shipped after the 0.8.3-beta memory/prompt-enhancer release, previously
split across multiple `0.8.3-beta` CHANGELOG headers plus unreleased August work.
Covers F0–F2 security and autonomy loops, governed CLI providers, operator UX
(home, board, Schedule Hub), install/self-update/backup lifecycle, expanded model
providers, multi-instance channels, and new modules (voice, intel, ideabox, costops).

### Install, lifecycle & self-update
- Default HTTP port **3100** (avoids Grafana/CRA on `:3000`); `EYAS_HOME` +
  `local.yaml` merge; port-clash detection; multi-project Docker Compose.
- `eyas start` / `stop` / `restart`; one-line curl/PowerShell installers;
  optional installer `--version` / `-Version` for empty-system restore pin.
- Auto-build frontend on `start`/`serve` when the web build is missing or stale.
- Setup recommendations checklist (replaces autonomy-only home nudge).
- Status bar version reads `version.json` via `getVersion()` (no hardcoded `1.0.0`).
- **Self-update v1:** GitHub `eyssen/eyas` release/tag + CHANGELOG detection;
  `eyas update check` / `apply`, `GET`/`POST /api/v1/system/update`, Settings
  Updates card, status-bar badge. Apply always requires a working backup module
  and creates a fresh backup before checkout/rebuild/restart — no silent upgrades.

### Backup & offsite destinations
- Full-system backup packs `data/`, `config/`, `.env`, `version.json`, and compose
  overrides (excludes nested backups/tmp/runtime); sidecar manifest records
  `eyasVersion`; Backup UI shows version.
- Configurable primary offsite target after local `tar.gz`: S3/B2, FTP, Dropbox,
  SSH. Secrets are env/secret-ref names only; B2-style S3 setup documented in README.

### Providers & models
- **Kimi API** + **Kimi Code CLI** (wizard host-CLI detection).
- Claude Code **Fable** model alias; stable product display names; Terminal icons
  for `*-cli` hosts.
- OpenClaw-aligned OpenAI/Anthropic-compatible catalog (xAI, Mistral, Groq,
  Together, DeepSeek, MiniMax, vLLM, …).
- **Grok CLI ACP** provider + dual-CLI setup wizard (Claude Code + Grok).
- Claude Code session store; self-healing routing-tier defaults; providers
  off-by-default until configured.

### Communication — multi-instance channels
- Channel catalog with **instance-level credentials** and agent bindings (same
  type, e.g. Signal, can serve multiple agents).
- Configure/reconnect APIs, `list_channels` / `channel_send` tools, dashboard
  setup recommendation, agent detail **Channels** tab.
- Communication UI: per-card add instance, step-by-step setup guides, human
  field labels for Signal/Telegram.
- Channel hardening: reply-guard, progress placeholders/watchdog; Google Chat /
  Teams stubs; A2A peers.

### Product documentation & in-app help
- **Starlight multi-language docs** (`packages/docs/`, en/hu/de/es): user/admin
  product documentation covering setup, daily work, agents, automation, knowledge,
  communication, AI providers, admin, deploy/CLI, and reference.
- Served by the main EYAS process at **`/docs/`** (same origin/port); auto-build
  on `start`/`serve` when missing or stale (`docs:build`, soft-fail if omitted).
  Env: `EYAS_SKIP_DOCS_BUILD`, `EYAS_FORCE_DOCS_BUILD`, `DOCS_BASE` for standalone
  static export. Docker image and install script build the docs package.
- **help-map.json** + **ContextualHelp** (`?` on page titles) resolve to the
  active UI language; sidebar **Documentation** link. Vite proxies `/docs` in
  frontend dev.

### Operator surfaces
- **Home Attention Surface:** approvals, pinned/recent conversations, mission-
  control snapshot, briefing, next jobs (replaces empty dashboard).
- **First-turn team auto-propose** from orchestration mode + complexity
  (still requires user approval).
- **Context Rail** on conversations (notes + business history, Next activities,
  Files); runtime strip separated from chatter; idle/working noise dropped.
- Board defaults to **All projects**; rich kanban meta restored (status, due,
  tokens, agent, subtasks, aging, WIP); `/conversations` → `/board`.
- Dialogs use theme tokens (`bg-background` / `border-border`) instead of
  hardcoded dark overrides.
- **Schedule Hub:** `next_run_at`, PATCH reschedule, timeline/projections API,
  24h stats, dead-letter, concurrency limits, execution retention; `agent_run` +
  board recurring handlers; `schedule_*` tools; Gantt/list/calendar UI with
  assigned-agent badges (en/hu/de/es).
- Board multi-views (July): Linear-style grouped list + ⌘K, timeline/run-trace,
  dashboard, orchestration + stage-flow graph.
- UI i18n: English / Hungarian / German / Spanish throughout.

### New modules & data portability
- **Voice:** local STT/TTS (Whisper/Piper) + Telegram voice replies.
- **Intel** fact registry, **Ideabox** funnel, **Costops** ledger.
- Ops host-guards: disk space, channel watchdog, stuck runs; optional bumblebee scan.
- Stage WIP limits + card aging; Google Docs tools; MCP `connectors.hu`.
- Settings **data port** import wizard (multi-tier memory + own-skill routing);
  richer vault memory graph UI.

### Platform foundations (July, condensed)
- Prompt assembler: DB-backed master identity + core-rules, warm base personality,
  memory/team resolvers, master-seed refresh on upgrade; real system prompt on
  interactive/background/delegated runs.
- Autonomy / self-improvement: feature-flagged loops, approval-gated applies,
  forge/self-learning/skill-generation model-authored proposals, proactive
  heartbeat composer, settings card + onboarding.
- Skill-generation module live: routes, gated owner-approval adoption, scheduler,
  skills-registry adapter.
- Templates/themes: nebula/atelier/halo/terminal/sequoia skins, status-bar module,
  Appearance + wizard template picker.
- Users: archive-not-delete, protect agent users, restore archived.
- Ops dashboard + ticket-to-code pipeline + real remediation execution (kubectl/PR
  gate); vendor-neutrality scrub of shipped surface.
- Mission Control team role + parent edges; per-agent `maxTurns` and tool progress
  under Claude Code; phase-nested run tree + `maxParallelAgents`.

### Fixes
- Non-blocking `agentPostBoot` recovery (fire-and-forget after listen; batch-capped);
  UTC-correct daily stats (`date('now')` vs UTC `completed_at`).
- Privacy phone sanitization no longer rewrites ticket IDs as `[PHONE]`.
- Grok ACP `mcpServers` on `session/new`; ops/intel scheduler seed CreateJobInput shape.
- Conversation switch hardening; theme token mapping via `@theme inline`.

---

### F2 durable loops — park/resume, verification, auto-retry, cost producer
Eleven-task closure of the autonomy loops left open after F0/F1: a durable park-and-resume
interrupt for gated tool calls (instead of deny-and-continue), a completeness critic that
checks a run's own transcript against its goal before it can claim `completed`, auto-retry
and tier failover for transient provider errors, restart-survivable team sessions, a real
tokens/cost producer, and ownership-scoped WebSocket/REST surfaces. Every deliverable below
lands on a clean backend + web type check and a green full suite.

### Behavior changes to know before relying on this build
- **BREAKING — provider failures now fail the run.** `grok-cli` and `claude-code` used to
  swallow transport/result errors and let the run finish as if nothing happened; both now
  always throw (`grok-cli` rethrows after its `error` frame, `claude-code` throws
  `ProviderRunError` on any non-`success` SDK result subtype). Run success rates will look
  different after upgrade — they're honest now, not silently inflated.
- Mission Control's run list now includes team and delegation runs, not just background
  runs — because those shapes are supervised for the first time (see below), there are
  simply more rows than before for the same amount of actual work.
- Every background run that would finalize `completed` now spends one extra cheap-tier
  model call (the completeness critic), and complex goals spend one more for plan
  generation. A run that exhausts `maxTurns` is now its own terminal status, `max_turns`,
  and is no longer reported as `completed`.
- Historical runs/conversations/team sessions keep `cost_usd`/`total_cost_usd` at `0` —
  the new cost producer is forward-only, there is no backfill.
- Tier-based cross-provider failover ships **dormant**: `DEFAULT_TIERS` seeds every tier
  with empty `fallbackProviderId`/`fallbackModelId`, so no existing install gets
  cross-provider failover until an operator sets a fallback provider/model per tier in the
  routing UI. Same-provider retry-once is always active; that part is not gated.
- `PATCH /api/v1/conversations/:id` now Zod-validates the client-settable `status` to
  `{'idle', 'waiting', 'archived'}` (400 on anything else) — a client can no longer PATCH a
  conversation into (or out of) `waiting_approval`; that status is runner-owned, so a parked
  conversation can't be flipped back into a claimable state from the outside
  (`src/modules/conversations/routes.ts`).
- First in-codebase SQLite table rebuild: `autonomy_approvals` gained a `'revoked'` status
  value, which SQLite's `CHECK` constraint can't add via `ALTER TABLE` — the migration
  renames the table, recreates it with the new constraint, copies rows, and drops the old
  one (`src/modules/security-gate/autonomy-policy.ts`). It runs once at boot on upgrade;
  if a second process touches the same SQLite file during that boot window it will wait on
  `busy_timeout` and can fail to start — this is retryable, just restart it.

### Durable park-and-resume approvals (replaces deny-and-continue)
- An autonomous supervised run (background, team, delegation, or pipeline) that escalates a
  gated tool call now **parks**: the run and its conversation move to `waiting_approval`,
  the loop ends cleanly (no `handle.complete`), and the pending call is queued as an
  approval row carrying its arguments, an arg hash, and the run id
  (`src/modules/agent/agent-runner.ts`, `src/modules/agent/run-supervisor.ts`). CLI
  providers (Grok ACP, claude-code) park through an interrupt + approval-sink path instead
  of the native event. Interactive chat is unchanged — it still gets deny-and-continue plus
  a queued approval, never a park.
- The approval row is the grant: `autonomy_approvals` gained `arg_hash`, `run_id`,
  `consumed_at`, and `kind` columns. Operator approve consumes the grant exactly once via a
  CAS `UPDATE … WHERE consumed_at IS NULL` before the tool is allowed to re-run
  (`autonomy-policy.ts#consumeGrant`) — a changed argument set never matches a stale grant
  and re-escalates instead. A run lineage that re-parks five times fails outright with
  `error_kind='approval_loop'` rather than looping forever.
- Approve/reject drive a warm-resume via the existing checkpoint machinery
  (`src/modules/agent/approval-resume.ts`): approved runs re-issue the exact call with a
  reviewer message telling them to proceed; rejected runs get a denial message telling them
  not to retry the action. TTL expiry (`security.approvalTtlHours`, default 72h) resolves
  the same way as a reject. An hourly sweep retries approved-but-unconsumed grants and
  covers boot-time ordering, and any resume failure is recorded on the approval row
  (`resume_error`) instead of silently leaving the run stuck.
- The approvals list endpoint is now ownership-scoped for non-admin callers (parent-chain
  resolution, same pattern as team-session ownership), and the raw `input_json` (tool
  arguments) is projected out of non-admin/non-owner responses.

### Supervision extended to team + delegation runs
- Team-member and delegation/pipeline runs now get a real `agent_sessions` row,
  checkpoints, and an event-store transcript — the same supervision background runs
  already had. This is what makes park-and-resume, the critic, and cost attribution work
  for these shapes too, and it's why Mission Control now lists them (see behavior note
  above).
- Member/delegation completion status is now the run's real outcome instead of a
  hardcoded `'completed'` string; a member that throws now reports `failed`, and a
  delegated call that returns no text is reported as empty text with its real status
  instead of the previous fabricated `'Task completed.'`.

### Verification-before-done — completeness critic + plan-as-rubric
- Every supervised run that would finalize `completed` (never `max_turns`/`failed`/
  `cancelled`) is now judged by a cheap-tier completeness critic
  (`src/modules/agent/critic.ts`) against its goal — and, for background runs complex
  enough to have triggered planning, against the plan's per-step success criteria
  (`src/modules/agent/plan-store.ts`, new `agent_plans` table). The critic is fail-open: no
  provider available or an unparseable verdict just marks the run `unverified`, it still
  completes.
- An `incomplete` verdict triggers exactly one feedback resume with the critic's own
  reasoning injected as a reviewer message; a second `incomplete` finalizes the run
  `completed` with `verification='failed'` rather than looping.
- New `agent_sessions.verification` column (`passed | failed | unverified`) surfaced as a
  badge on the agent-runs page.

### Auto-retry + boot warm-resume + budget engine
- Background runs that fail with a retryable `error_kind` (rate-limit, overload, timeout,
  network) and have made fewer than 3 attempts are rescheduled with a 60s/300s/900s backoff
  and resumed from checkpoint by a sweep (`src/modules/agent/retry-sweep.ts`); each retry
  attempt is its own `agent_sessions` row linked via `parent_run_id` — existing
  completed-run counters and reporters keep counting rows as before, so retried runs will
  show up as multiple rows for one logical task.
- A new post-boot pass (`agentPostBoot`) warm-resumes checkpoint-bearing background runs
  that a restart just cold-failed, and resets conversations stuck in `working` with no live
  run back to `idle`. `waiting_approval` rows are left untouched across a restart.
- The F1-era budget engine (`createBudgetEngine`) is now actually instantiated and wired to
  every token-usage call site — `eyas.agent.budget.alert` fires for the first time; it
  previously existed but was never connected to anything.

### Cost producer — real tokens/cost, finally
- `agent_sessions.tokens_used/cost_usd`, `conversations.total_cost_usd`, and
  `team_sessions.total_cost_usd` are now written from the runner's own turn accumulation at
  run boundaries, instead of staying structurally zero (the F1 CHANGELOG's known gap).
  `ai_traces` rows gain `conversation_id`/run attribution from request metadata.
- New shared, config-overridable pricing table (`src/shared/model-pricing.ts`) pins
  `ollama`/`lmstudio` (local providers) to $0 — this closes a real bug where local-model
  calls were being priced at cloud rates and eating into the global budget for free work.
  claude-code's SDK-reported `total_cost_usd` and cache-token counts are read and preferred
  over the estimate when present.
- Mission Control's token/cost counters and daily stats are real numbers now, not stubs.

### Team-session durability — phase cursor + re-drive
- `team_sessions` persists a phase cursor (`current_phase`/`phase_status`) and per-member
  results (new `team_phase_results` table); the driver is extracted
  (`src/modules/agent/team-driver.ts`) so the approve route, the resume route, and a boot
  scan all share it. A restarted server re-drives `running` team sessions from the
  persisted cursor and leaves `paused` ones waiting durably — completed phases are not
  re-run. This closes the F1-era wedge where a `paused` team session that survived a
  restart could never actually be resumed.

### WS + REST ownership scoping
- Per-id content topics (`chat:<id>`, `team:<id>`, `orchestration:<id>`,
  `notifications:<userId>`) are now ownership-scoped at WebSocket subscribe time: a
  fail-closed ACL (`src/core/http/ws-acl.ts`) does a fresh role lookup per subscribe, denies
  unknown per-id prefixes outright, and sends a `subscribe_denied` NACK frame instead of
  silently registering — an unauthenticated or cross-owner subscribe used to just work.
  The orchestration REST replay routes (`GET /api/v1/orchestration/runs*`) are scoped with
  the same resolver. Sockets are now closed on logout and account suspension.
- `board:<projectId>` stays open to any authenticated user in F2 — there's no board
  membership model yet to scope it against; that's a deliberate, recorded gap, not an
  oversight.

### Follow-ups (deferred out of this wave)
- A team member that gets parked for approval and is then refused because of a status
  race is not currently picked up by auto-retry.
- There is no UI button yet for `POST /team-sessions/:id/resume` — a `paused` or
  boot-parked team session needs the raw API call until a later wave adds the control.
- A parked run can't be cancelled directly; the only way out today is reject (which
  resumes the run with a denial message) or letting the TTL expire.
- Interactive (non-autonomous) chat intentionally never parks — only autonomous supervised
  shapes do; interactive escalations keep the existing grant-then-retry flow.
- Cost-denominated agent budgets, a per-run budget denominator on the AgentCard, an
  interactive inline-approve UI, and periodic WebSocket TTL sweeps are recorded as future
  work, not attempted here.


### CLI-provider governance, orchestration visibility, effort levels

### Security — CLI providers fail closed
- **Grok ACP governed**: removed `--always-approve`; every ACP `session/request_permission`
  and `fs/read_text_file` / `fs/write_text_file` request now routes through the shared
  Cap 7 permission bridge (security gate + autonomy ladder, fail-closed without a gate).
  ACP tool kinds map onto the gate's canonical vocabulary (`execute`/`delete`→Bash,
  `edit`/`move`→Write, …); allows always pick `allow_once`, never `allow_always`
  (`src/modules/model/submodules/grok-cli/acp-governance.ts`).
- **claude-code**: the ungoverned `bypassPermissions` fallback is gone — no security
  gate now means headless `default` permission mode (fail-closed) + warning log.
- `createPermissionBridge` moved to `src/modules/model/permission-bridge.ts` (shared
  by both CLI providers; the old claude-code path re-exports it).

### Orchestration visibility for every claude-code run
- SDK hooks now install for ALL governed runs, not only team runs: plain conversations
  get their own run (`runId = conversationId`) with a `conv:<id>` root node,
  `sub:<agent_id>` subagent nodes nested beneath it, and run_started/run_completed frames.
- Exact tool attribution via hook `agent_id` (parallel Task fan-out included) replaces
  the single-active-subagent heuristic; PostToolUse/PostToolUseFailure emit tool_result.
- Subagent-originated stream content (`parent_tool_use_id`) no longer leaks into the
  main answer stream — it renders in the run tree instead.
- **Persistence + replay**: `orchestration_events` table + `OrchestrationEventService`
  (drop-in broadcaster: persists + broadcasts), `GET /api/v1/orchestration/runs` and
  `GET /api/v1/orchestration/runs/:runId/events`; 7-day retention prune at startup.
- Frontend: run-tree store `loadRun()` replay hydration on conversation load, team-session
  rehydration after reload, RunTree mounts for any run with nodes; the board graph's
  orchestration mode gained a real data source (run list + live WS follow + run selector).
- SSE: `tool_use_end` forwarded; `tool_result` now carries `toolUseId` (frontend matches
  by id — the old name-keyed matching never hit).

### Effort levels (provider-agnostic)
- `ModelRequest.effort` (`low|medium|high|max`) mapped per provider: claude-code →
  SDK `effort` + adaptive thinking; Anthropic API → `output_config.effort` on
  adaptive-thinking models, effort-derived `budget_tokens` on older ones; OpenAI →
  `reasoning_effort` on o-series (`max`→`high`); Grok CLI ignores it (no surface).
- Per-conversation `effort` column (PATCH-able, UI select replaces the budget presets
  that were silently discarded on adaptive models; editable mid-conversation).
- Per-agent `effort` column on `agent_definitions`, forwarded into SDK subagent
  definitions (`AgentDefinition.effort`) and the agent edit form.
- Autonomous/background runs now honor the conversation's thinking/effort (previously
  always thinking-off).

### Orchestration mode (per conversation)
- New `orchestration` column: `solo` (no provider-native fan-out — Task tool and
  subagent roster stripped), `auto` (default), `deep` (fan-out directive injected into
  the system prompt + effort defaults to `max`). Provider-aware directive: claude-code
  is steered to native Task fan-out, other providers to `propose_team`/`delegate_to_agent`.
- Precedence note: EYAS `executeTeam` owns phases/checkpoints; a team subagent running
  on claude-code may still fan out natively (nested one level, rendered under its
  `conv:<id>` node) unless the conversation is set to `solo`.


### F0 security closure

Eight-task hardening pass closing the gaps found in the 07-28 subagent orchestration
review: audit trails that recorded `'unknown'`, security modules wired in code but
never registered, a judge and permission bridges that could fail open, and an MCP
tool surface reachable without the normal authorization path. Every non-allow
decision is now audited, every unclassified tool escalates instead of running, and
the tool executor is the one place a tool call can be authorized.

### Audit trail — real subjects, secrets access logged
- Bus-emitted events now stamp their real `action`/`module` on the resulting audit
  entry instead of `'unknown'` (`src/core/bus/local-bus.ts`, `src/modules/audit/index.ts`).
- Secrets module: scope-denied and privileged reads/writes are now audited via a
  lazy sink (`src/modules/secrets/audit-sink.ts`) that falls back to `logger.warn`
  if the audit service isn't up yet, instead of being silently dropped.

### Privacy module — actually registered
- The `privacy` module (PII egress scanning, shipped `privacy.yaml` ruleset) is
  now registered in `src/core/bootstrap.ts` — it existed in code since an earlier
  wave but was never wired in, so it never ran.
- New per-call `lazy-gateway` (`src/modules/model/lazy-gateway.ts`) resolves the
  privacy + tracing wrappers at call time, so `agent-runner`, `orchestrator`, and
  the LLM judge all go through them instead of capturing an un-wrapped reference
  at module-load time (the earlier eager-capture bug this closes).

### LLM security judge — vendor-neutral, fail-closed
- Removed the hardcoded Anthropic provider pick; the judge now resolves a
  provider through the same tier resolver (`getTierResolver`) as ordinary
  requests, so any configured provider can serve as judge.
- Judge prompt rewritten to a nonce-sandwiched template demanding a strict JSON
  verdict; **zero configured providers now escalates to human approval instead
  of defaulting to allow**, and an unparseable verdict denies rather than passing
  through. No more "verdict shopping" across providers on an ambiguous result
  (regression-tested).
- `agent-runner` routes judge escalations into the approval-queue flow.

### CLI permission bridges — exhaustive fail-closed verdicts
- `src/modules/model/permission-bridge.ts` (shared by claude-code and the Grok
  ACP provider, `src/modules/model/submodules/grok-cli/acp-governance.ts`):
  **only an explicit gate `allow` proceeds** — `deny`, `escalate`, `judge_error`,
  an unrecognized decision, or the gate throwing all deny, fail-closed.
  `escalate` additionally enqueues an approval-queue entry; every non-allow
  verdict is pino-logged.
- **BREAKING:** an EYAS install with no judge-capable model configured now
  **denies `Write`/`Edit`/`Bash` in interactive claude-code/Grok CLI chats**
  until a model is configured or the owner approves the queued request — the
  previous `bypassPermissions`/`--always-approve` fallbacks that allowed these
  tools with no judge are gone.

### Deterministic gate — unknown tools escalate, paths denylisted
- Unrecognized tool names now **escalate** (human approval) instead of the
  previous silent allow; the gate also consults the tool registry's `riskTier`.
- New sensitive-path denylist for file/shell tools (`deterministic-gate.ts`):
  `master.key`, the SQLite data directory, `.env`/`.envrc`/`.ENV` (case-insensitive,
  directory-aware), `.ssh`, SSH key files, and the configured DB path.
- Every gate decision is now audit-logged, including green allows (previously
  only denials were). Denial-streak lockouts gain a 10-minute cooldown recovery
  instead of staying locked indefinitely. `WebFetch`/`WebSearch` moved from green
  to **yellow** (judge-reviewed). ACP tool kinds with no canonical mapping get a
  reserved name instead of falling through to an attacker-supplied title
  (closes a title-spoofing gap).

### Autonomous classification contract
- New `ModelRequestMetadata.origin` + `isAutonomousRequest`: only explicitly
  human-attended origins count as interactive — **absence of an origin now
  means autonomous, fail-closed** (previously the reverse). All run-construction
  call sites are labeled.
- Delegation/team/pipeline runs are now ladder-gated by this classification:
  locked-category tools (e.g. `run_command`) deny on these runs until the F2
  approval-resume flow lands — a known, accepted blast-radius increase flagged
  for follow-up.

### Tool executor — single authorization choke point + MCP closure
- `src/modules/tools/tool-executor.ts` is now the one place a tool call is
  authorized: CASL actor check + security gate + autonomy ladder, failing
  closed if authorization isn't wired.
- MCP server routes moved from `/mcp/*` to `/api/v1/mcp/*`, now behind auth and
  a CASL `execute Tool` check (previously reachable without going through the
  normal authorization path). The `mcp-server` submodule now ships
  **default-disabled** with no runtime toggle — enabling it requires editing
  the manifest source directly.
- Role `user` gains the `execute Tool` ability; `executeAgent` delegation and
  pipeline runs now carry a proper tool-execution context (previously missing,
  which would have made those paths reject every call under the new choke point).


### F1 dead-wiring closure

Nine-task follow-up closing the dead-wiring gaps found in the same 07-28
review: builtin tools that resolved their backing services to `undefined`
at bind time, agent templates whose tool lists matched no registered tool,
a conversation-update path duplicated by a hand-written 25-branch
if-chain, team-session context that never reached subagent runs, a
Mission Control/board/team WebSocket surface with no working transport,
and a board column meant to trigger unattended agent runs that no code
ever armed. Every seam below is proven live against the real
registry/executor/bus, not just unit-mocked.

### Behavior changes to know before relying on this build
- Background/autonomous runs of conversations with `thinking`, `effort`,
  or `orchestration: deep` set now actually **spend** the tokens those
  settings imply — previously the columns were silently ignored on the
  scheduled/board run path (thinking was always off). Existing scheduled
  conversations that already had these fields set will start costing more.
- Dragging a card into — or **creating** a card directly in — a
  bot-capable stage (`botListen`, or one with an `autoAssigneeId`) now
  arms it and starts an unattended agent run, using the card title as the
  goal when no prompt is set. This is wider than "drag only."
- Two agents that both hold `move_to_stage`/`assign_task` can, in
  principle, ping-pong a card back and forth; bounded by budget,
  `maxTurns`, and the single-flight/claim-recheck choke point in
  `bot-executor`, but not structurally prevented.
- Any agent created from a template before this wave — or with a
  persisted empty/NULL tools list — previously ran with **zero** usable
  tools (placeholder names matched nothing, and an empty list resolved to
  "no tools" instead of "no restriction"). Such agents now fall back to
  the full, per-call-gated tool menu the next time they run — a real
  capability increase for agents that were silently inert.
- Mission Control's per-run progress bars and cost figures still read
  zero at this wave — the F2 cost producer (later in this release) is
  what writes `tokens_used`/`cost_usd` onto `agent_sessions`.

### Tools — every builtin now hits a real service, not `undefined`
- Root cause was two independent defects: (1) `onRegister` built each tool
  factory against `(ctx as any).memory`/`knowledge`/`documents`/`research`/
  `search.engine` before those services were published in `onStart`,
  capturing `undefined` for the process lifetime; (2) even the services
  present at bind time were called through methods that don't exist
  (`board.listProjects`, `documents.listByResource`,
  `conversations.getStatus`, `search.search`, `memory.search(query, opts)`).
- Fix: the F0 lazy-getter pattern applied to every tool factory
  (`src/modules/tools/register-builtins.ts`) — services now resolve
  **per call**; a not-yet-ready service returns a structured `{ error }`
  instead of throwing.
- `search_indexed`, `search_knowledge`/`get_page`/`create_page`,
  `list_documents`/`read_document`, `search_memory`/`save_memory`,
  `list_projects`/`move_to_stage`, `get_conversation_status`, and
  `research` all now call the real, currently-shipped service API.
- **Ruling (D1) — empty tools list means "all tools."** An agent whose
  persisted `tools` is `NULL` or `[]` now resolves to the full tool menu
  (still individually gated by the security gate/autonomy ladder), not
  zero tools; fixed at all three run-path call sites (`agent/index.ts`,
  `conversation-runner.ts`, `orchestrator.ts`).
- **Ruling — `send_agent_message`/`read_agent_messages` stay green**
  (in-process, session-scoped, no egress) via an explicit autonomy-category
  override, hardened so a `null` override can never exempt a RED-tiered tool.
- **Ruling — `research` reclassified green → yellow**, matching
  `WebFetch`/`WebSearch` (web search/fetch is the same exfiltration-class
  egress; now judge-reviewed like its SDK siblings instead of
  deterministically auto-allowed).
- All 16 agent templates' `tools:` arrays renamed from placeholder strings
  to real registered tool names (the placeholders matched nothing, so
  every template-created agent ran with zero tools); every template also
  gained the coordination set (`delegate_to_agent`, `write_team_memory`,
  `read_team_memory`, `send_agent_message`, `read_agent_messages`). Both
  agent-creation INSERT paths (the `auth` setup wizard, `team-bootstrap`)
  now persist `tools` at all — previously omitted from the column list
  entirely.

### Conversations — schema-driven update, settings + team context threaded
- `conversation-service.ts`'s hand-written 25-branch `update()` if-chain
  is replaced by a single loop over a typed `UPDATE_FIELD_MAP`
  (`satisfies Record<keyof ConversationUpdate, …>` — a field added to one
  without the other is now a compile error); `teamSessionId` is a
  first-class, directly persisted column.
- Autonomous/background/board-triggered runs now read and honor the
  conversation's `thinking`/`effort`/`orchestration` settings (see the
  cost behavior note above).
- `teamSessionId` (+ derived `sessionId`/`agentRole`) now threads through
  every run shape: orchestrator subagents, `executeAgent` delegation,
  channel-triggered runs, and sub-conversations. `injectTeamMemory` — dead
  since it was written — is revived and actually injects teammates'
  memory into the system prompt, hardened against prompt injection
  (data-framing sentence, fixed-point tag-stripping so a hostile memory
  entry can't forge a closing tag and smuggle instructions past the
  boundary, `[unattributed]` instead of a forgeable `[system]` tag).
- **PATCH `/conversations/:id` now strips `teamSessionId`** from client
  request bodies — the field became directly writable the moment it
  joined `ConversationUpdate`, and a client PATCH could otherwise forge
  team-session membership.
- **Ownership enforcement added to every team-session route** (propose,
  memory read/write, get, list, approve, reject, resume) — previously any
  authenticated user could bind to, read, or act on another user's team
  session; `approve` was the sharpest gap, since it could start (and bill)
  an execution against a foreign session.

### WebSocket — the wire is real, front to back
- The bus→WS bridge is rebuilt on a shared `WS_TOPICS` module
  (`src/shared/ws-topics.ts`) instead of ad hoc string subjects on each
  side; a contract test bans string-literal `subscribe(`/`broadcast(`
  call sites and requires every topic to have both a backend producer and
  a frontend consumer.
- Frames are now thin, **projected** payloads — an allow-listed key set
  per topic, not the raw bus event — so run-failure error text, autonomy
  actor/decision detail, and rendered budget-alert sentences no longer
  ride the wire to every subscriber of a shared topic.
- Mission Control's snapshot socket (previously an unwired, tested-but-dead
  pusher) is replaced with a REST snapshot fetch plus a thin live ping
  that triggers a refetch; a real session registry now backs it (it was
  rendering an empty fallback while runs were actually in flight). Pause/
  resume are hidden in the UI — the registry has no suspend primitive and
  both endpoints now answer a hard 500 instead of silently no-op-ing;
  Interrupt remains the supported control.
- The monthly `model:budget:reset` event finally has a subscriber —
  previously zero, meaning an agent that hit its monthly budget stayed
  blocked forever.
- Frontend: team-proposal state now survives a page reload (REST-hydrated
  team-session discovery on conversation load), the team-memory dashboard
  panel auto-expands on hydration and on live approval, and the run tree
  replays from persisted `orchestration_events` instead of only showing
  runs that started after the page loaded.

### Board → agent trigger + `assign_task`
- Stage automation (`src/modules/board/stage-automation.ts`) now actually
  arms a card for autonomous pickup when it enters a `botListen` stage or
  one with an `autoAssigneeId` set — previously `bot-executor` polled for
  a `'waiting'` status nothing ever wrote, gated on a stage auto-assignee
  column that was insert-only dead (no UI, no update path). A bus kick
  (`card_armed` / `task_assigned`) now wakes the executor immediately
  instead of waiting for the 10-minute cron sweep (kept as a
  crash-recovery fallback). See the behavior note above — this also fires
  on card **creation**, not just a drag-move.
- New `assign_task` tool — async handoff to another agent via a
  sub-conversation, capped at an ancestry depth of 5 to bound delegation
  chains; yellow risk tier. See the behavior note above on the ping-pong
  possibility with `move_to_stage`.
- Stage editor gained an Auto-assign column (all four locales: en/hu/de/es).

### Testing infrastructure
- New contract-test harness (`tests/helpers/tool-contract.ts`) runs tool
  factories through the *real* registry + executor with the F0
  authorization choke point active, rather than mocking the executor
  away — the tool-seam fixes above were TDD'd red-then-green against it.
- New i18n-parity contract test for `src/web` locale bundles (en/hu/de/es
  key + placeholder parity), alongside the existing backend one.
- New `ws-topics` contract test enforcing the shared-topic-module
  convention described above.

### Follow-ups (deferred out of this wave; several closed in F2 above)
- Mission Control's per-run progress/cost bars needed a producer writing
  `tokens_used`/`cost_usd` onto `agent_sessions` — closed in F2 (cost producer).
- `PATCH /conversations/:id` still leaves other system-managed fields
  client-writable (`parentConversationId`, `agentId`, `sdkSessionId`,
  `totalCostUsd`) — same shape as the `teamSessionId` fix, not yet swept.
- `assign_task`'s default global pickup stage can land a child card off a
  project-scoped board (spec-conformant today, not reconciled).
- No component-test infrastructure for the new/changed `src/web` UI
  (verified via `tsc`/`vite build` + store/hook unit tests only — no
  jsdom render-level tests).
- Per-conversation "streak" keying and a few other minor items noted in
  the F1 ledger remain open; see
  `.superpowers/sdd/2026-07-28-eyas-f1-dead-wiring/progress.md` for the
  complete list.

---

## [0.8.3-beta] - 2026-04-19 — Memory rewrite (5-tier + vault + sqlite-vec) + Prompt Enhancer

Scope: Phase 1 security hardening Wave 1c, Phase 2 email provider wiring,
Phase 3 inspiration patterns (E/F/G/M + integrations), Phase 4 bootstrap
registration, Phase 5 observability + i18n integration, a comprehensive
memory-module rewrite (5-tier + Obsidian-parity vault + sqlite-vec), and
the new Prompt Enhancer sub-conversation feature with its own routing
tier. All changes land on a clean type check and a green test suite.

### Memory module — Obsidian-parity rewrite
- **sqlite-vec integration:** Native vector storage via the `vec0` virtual
  table, activated through Bun's `Database.setCustomSQLite` pointing at
  homebrew libsqlite3. Embedding dimensions initialised lazily on first
  write. Cosine similarity queries run against the same SQLite file as
  the rest of memory — no external service required.
- **Reciprocal Rank Fusion hybrid search:** FTS5 BM25 ranks and vector
  similarity ranks fused via RRF, with explicit AFTER INSERT / UPDATE /
  DELETE triggers on `episodic`, `semantic`, and `archive` FTS tables.
  `escapeFtsQuery` rewritten to tokenise → AND-join so multi-word queries
  return hits instead of phrase-matched zeros.
- **Semantic promoter (consolidator):** LLM summariser condenses episodic
  clusters into semantic memories on a scheduled tick. Review queue
  persistence for skill / wiki proposals so the consolidator can surface
  promotions without auto-adopting them.
- **Obsidian-compatible vault:** wikilink parser for `[[note]]`,
  `[[note|alias]]`, `[[note#heading]]`, `[[note^block]]`, `![[embed]]`.
  Dataview-style query API (`vault-query.ts`). Daily notes + templates
  service. Tag pivot service backing an aggregate tag view.
- **Graph + backlinks:** endpoints resolve wikilink targets against
  basenames, titles, and aliases so the graph and backlinks panels stop
  showing empty results for isolated nodes. Cytoscape.js graph view,
  clickable tag pivot, review queue UI.
- **Routes:** new `/api/v1/memory` endpoints for graph, backlinks, tags,
  templates, review queue, dataview query, episodic/:id, archive.
  Working-block character counts resolve via `contentLength ?? length`
  (no more empty counters).
- **Frontend Memory page:** full dashboard rewrite — Overview, Working,
  Episodic, Semantic, Archive, Graph, Tags, Review tabs. Every row in
  every tab is clickable; detail modals use explicit opaque backgrounds
  to avoid transparency bleed on top of the vibrancy backdrop.
- **Agent-scoping:** SQL injection path eliminated — the agent_id list
  filter now flows through parameterised queries.

### Prompt Enhancer (new feature)
- **Sub-conversation architecture:** a "wand" button next to the paperclip
  in the conversation input opens a dialog that spawns a child
  conversation with `goalDescription='prompt-enhancer'`. The system
  prompt installs a coach persona that emits a `<final-prompt
  carry-attachments="all|none">…</final-prompt>` block once it converges.
- **File attachments + carry-over:** the dialog supports the same upload
  / paste / drop flow as the main input. When the enhancer signals
  `carry-attachments="all"`, Apply pushes the refined text back into the
  parent input AND attaches the documents by ID (no re-upload — the file
  store is reference-counted via the link table).
- **Dedicated `prompt_enhancer` routing tier:** the enhancer runs on its
  own tier in the `routing_tiers` table. Seed logic upgraded to upsert
  missing defaults so existing databases receive the new tier. The
  enhancer-route looks up `resolveForTier('prompt_enhancer')` at
  sub-conversation creation time and sets `providerId`/`modelId` before
  the first user message.
- **SSE consumption in the dialog:** the `/messages` endpoint streams
  Server-Sent Events, so the dialog drains the stream via a dedicated
  `postMessageStreamed` helper and then refetches the full conversation
  — the previous `api.post` path was rejecting the stream as "Non-JSON
  response: OK".
- **Providers page:** new Prompt Enhancer row with a Wand2 icon in the
  Routing Tiers configurator.

### Other changes in this window

### Phase 1 — Security (Wave 1c)
- **S5 Privacy sanitization:** Replaced offset-based reconstruction that
  drifted whenever a PII replacement changed length. Each ModelRequest
  segment (system prompt, string message, text block) is now scanned and
  sanitized in isolation — indices cannot leak between neighbours.
- **S7 Worktree lifecycle:** Module-scope tracker + SIGTERM/SIGINT/exit
  handlers plus `gcOrphanedWorktrees(basePath)` at startup. Zombie
  `agent/*` branches left by SIGKILL'd prior runs are swept automatically.
- **S8 Delegation TOCTOU:** `validate` + `createChildConversation` now run
  inside one `ctx.db.transaction(...)`. Execution still runs outside the
  lock so long-running LLM calls never hold a writer.

### Phase 2 — Email providers wired into channel router
- Microsoft 365 (Graph + OAuth2), Gmail API (OAuth2), and the generic
  SMTP/IMAP adapter all plug into the existing Channel router via a new
  EmailProvider → Channel bridge. Each configured provider becomes its
  own channel keyed by mailbox address; any combination runs concurrently.
- Bridge preserves threading (`inReplyTo`, `References`), strips duplicate
  "Re:" subject prefixes, and fails init gracefully so a misconfigured
  provider cannot block the others.

### Phase 3 — Inspiration patterns
- **3E Interactive Planning:** Zod Plan/Step/Risk schema, complexity
  detector heuristic, LLM plan generator with JSON recovery and retry,
  immutable approval transitions. Runner wrapper (`maybePlanTask`) sits
  ahead of `runner.run()` without modifying it — fail-closed when no
  approval callback is wired.
- **3F Approval Tier Mode:** paranoid/balanced/autopilot policy with
  call-site > per-tool > per-user > per-risk-tier > global precedence.
  Integrated into agent-runner: approved tool calls can gate on a
  `onApprovalRequired` callback; absent callback or callback throw
  resolves to fail-closed denial. Default: autopilot — unchanged runtime.
- **3G Flow runner:** deterministic Zod-typed DAG with cycle detection at
  build time, per-node input/output schema enforcement, stable
  topological order, abort-safety. Fan-in uses a source-id-keyed record
  unless an explicit `edge.map` is supplied.
- **3M ACI output truncation:** per-tool output formatter with verbatim /
  line-head-tail / json-head / binary-summary / byte-trim strategies.
  Truncation markers embed an optional follow-up hint so the model
  knows how to retrieve the omitted portion.

### Phase 4 — Bootstrap integration
- 7 inspiration modules (event-store, artifacts, mission-control, ops,
  client-wiki, skill-generation, pipelines.ticket-to-code) registered in
  `bootstrap.ts`. Dependency order resolved by `ModuleLoader.resolveDependencies()`.
- CASL subjects seeded for event-store, client-wiki, skill-generation
  with role-appropriate defaults (agent can propose skills but not adopt;
  event-store is read-mostly; wiki is collaborative).

### Phase 5 — Integration & polish
- **Prometheus `/metrics` endpoint:** `createPrometheusExporter` wired
  into observability.onStart. Secret-driven hardening
  (`prometheus-bearer-token`, `prometheus-ip-allowlist`). Exposes 5
  collector families (agent, tool, model, http, runtime).
- **OpenTelemetry tracing:** `createOtelService` wired, OTLP/HTTP exporter
  activated only when `otel-endpoint` secret is set. Noop processor
  otherwise so instrumentations stay zero-cost. `onStop` flushes and
  shuts down the service for clean Kubernetes pod termination.
- **i18n parity guard:** tests/core/i18n-parity.test.ts auto-discovers
  every locale under `src/core/i18n/locales/` and validates same
  namespaces, same keys, same placeholder sets against the HU reference.
  New baseline namespaces for `approval` and `planning` shipped in both
  locales for the forthcoming frontend work.

### Type + test hygiene
- **tsc: 100 → 0 errors.** EyasDb gains generic `all<T>` / `get<T>`,
  routes factories relaxed to `Hono<any>`, path-param asserts where
  Hono's narrower typing rejects a runtime invariant, explicit mock
  return types, ambient declarations (`src/optional-modules.d.ts`) for
  dynamically-imported optional deps (imapflow, discord.js, @slack/bolt,
  playwright).
- **Baseline test failures: 16 → 0.** TaskSourceAdapter tests switched
  to a Drizzle wrapper (they were passing the raw sqlite handle),
  ProjectService seed-guard added to `update()` to match `delete()`,
  LlmJudge fail-closed test updated to expect the typed `judge_error`
  decision, Scheduler E2E renamed 'Skill Evolution Scan' → 'Forge Scan'.
  Vault-watcher E2E tests now `it.skipIf(!EYAS_TEST_VAULT_DIR)` to avoid
  false failures when test cwd ≠ server cwd.

### Phase 5 — Notifications completion
- **Batch / digest engine wired:** `notification_batch_queue` schema,
  `createBatchEngine` exposed via router, preferences now carry a
  `deliveryMode` column (`immediate` | `batched`). Critical severity
  always bypasses batching.
- **Retry engine wired:** `notification_retry_queue` schema, exponential
  backoff (30s → 60s → 120s → dead letter at 3 attempts), router
  auto-enqueues retries whenever a channel `send()` returns false or
  throws. `/api/v1/notifications/retry-stats` for ops visibility.
- **Webhook channel wired:** DB-backed per-user endpoint
  (`notification_webhooks` table) with HMAC-SHA256 signatures
  (`X-EYAS-Signature: sha256=…` when a shared secret is set). Routes
  GET/PUT/DELETE `/api/v1/notification-webhooks` with SSRF-aware URL
  validation (blocks loopback, `169.254.169.254`, `.internal`, non-http(s)
  schemes).
- **Template engine wired:** channel-specific renderers (email HTML
  table digest, telegram markdown, webhook JSON, web plain text) with
  HTML escape. Custom `registerTemplate(eventPattern, template)` with
  exact-then-wildcard matching.
- **Periodic processor:** module `onStart` spawns a 30s interval tick
  that drains `batchEngine.processDue()` and `retryEngine.processDue()`,
  cleaned up in `onStop`.
- **i18n:** `notifications` namespace baseline in HU + EN (settings,
  webhook, retry, severity labels).

### Test coverage
- ~130 new / fixed tests added across Phase 1-5. Notifications wiring
  adds 38 tests (templates 13, batch 9, retry 8, webhook 8) across 4 new
  files. Final suite: **269 files / 2472 passed / 3 skipped / 1
  pre-existing E2E failure (functional-memory episodic list ordering —
  unrelated, tracked separately)**.

### Autonomous Agent Prompt Architecture v2 — Phase 10: Integration tests + docs

#### Test harness (`tests/helpers/test-eyas.ts`)
- **`setupTestEyas()`** — lightweight harness for integration tests: tmpdir data
  folder, in-memory SQLite + Drizzle, real workspace loader/writer/soul pipeline,
  stub model provider (no LLM calls). Returns typed `api`, `assembler`,
  `workspaceLoader`, `workspaceWriter`, `db`, `dataDir`, `shutdown`.
- `makeMockVoiceProfile()` — helper exported for delegation chain tests.

#### Integration tests (`tests/integration/`)
- **`end-to-end-primary-agent.test.ts`** — 5 assertions: workspace files created,
  agent name substituted, prefix tags (`<core-identity>`, `<agent-identity>`,
  `## My mission`), suffix contains `Voice scope: INTERNAL`, token budget < 8800.
- **`sub-agent-delegation.test.ts`** — originating agent voice signature preserved
  through delegation chain; specialist prompt contains `<core-identity>`,
  `<subagent-role>`, `<task>`, `<delegated-voice>`.
- **`voice-scope-override.test.ts`** — 8 assertions covering the full 5-level
  priority hierarchy: per-message > ephemeral > per-conversation > per-channel > auto.
  Also covers ephemeral TTL expiry.
- **`identity-self-edit.test.ts`** — `workspace_update_identity` tool: section
  update fires notification with diff, revert restores file, rate limit blocks
  4th update in a day.
- **`soul-forge-proposal.test.ts`** — `forge_propose_soul_change` inserts row,
  `SoulProposalApplier.apply()` updates SOUL.style.json + re-renders SOUL.md,
  assembler prefix hash changes after apply.
- **`cascade-merge.test.ts`** — project-type AGENTS.md + project AGENTS.md +
  agent AGENTS.md all appear in prefix; order: type < project < agent.
- **`provider-adapter-parity.test.ts`** — AnthropicAdapter sets `cache_control:
  ephemeral` on prefix block; OpenAIAdapter concatenates prefix+suffix; Ollama
  capabilities declare `promptCache=none`; all verified without real API calls.
- **`voice-scenarios.test.ts`** — parametric test over 10 fixture scenarios.

#### Performance gate (`tests/performance/prompt-cache-anthropic.test.ts`)
- Synchronous unit test (always runs): verifies prefix block carries
  `cache_control: { type: 'ephemeral' }`.
- Gated test (`describe.skipIf(!EYAS_REAL_ANTHROPIC)`): documents the ≥ 80%
  cache hit ratio gate for 10-turn loops; skipped in CI.

#### Migration test (`tests/migration/`)
- **`helpers/seed-v1.ts`** — seeds all 16 templates as v1 rows + `simulateMigration()`.
- **`migrate-v1-to-v2.test.ts`** — roundtrip: seed → snapshot → bootstrap workspaces
  → assert IDENTITY.md/SOUL.md per tier → rollback → assert v1 columns restored.

#### Fixtures (`tests/fixtures/voice-scenarios.json`)
- 10 voice scope scenarios: owner-dm, owner+team, owner+known-contact,
  owner+unknown-external, outbound-proactive, multi-team-member, broadcast-public,
  team-only (no owner), mixed large group, proactive-to-external.

#### Docs
- `docs/eyas-architecture.md` — Section 44 (Prompt Wizard) updated with v2
  summary: file-based workspace, assembler pipeline, cache boundary, voice system.
- `docs/user/agent-voice-guide.md` — new Hungarian user guide: 6 dimenzió,
  8 preset, tiltott szófordulatok, override beállítások.
- `docs/superpowers/plans/2026-04-26-qa-results.md` — manual QA stub (deferred).

---

## [0.8.2-beta] - 2026-04-14

### Features
- **Extended Thinking:** Conversation-level thinking mode (Off / Low / Medium / High / Max) with token budget presets (5k–100k). Provider pass-through for Anthropic and Claude Code SDK. Thinking blocks displayed as collapsible violet panels during streaming. Locked after first message.
- **Markdown Rendering (Streamdown):** Vercel Streamdown integration for streaming-aware markdown in chat messages — GFM tables, syntax-highlighted code blocks (Shiki CDN), copy/download buttons, bold/italic/lists. Handles unterminated blocks during streaming gracefully.
- **MCP Tool Bridge:** EYAS tools exposed to Claude Code SDK via in-process MCP server. Agents can use EYAS tools (memory, search, knowledge, documents) alongside SDK built-in tools.
- **Static Frontend Serving:** SPA fallback added to main.ts entry point.

### Fixes
- **Claude Code SDK Isolation:** `settingSources: []` (SDK isolation mode) prevents `~/.claude/` user-level configs from leaking into EYAS conversations when `loadClaudeMd` is disabled.
- **Streamdown Controls:** Table fullscreen disabled (fixed overlay incompatible with split panel layout). Copy and download buttons retained.

### Documentation
- Architecture spec: `streamdown` dependency, `thinking`/`thinking_budget` columns in conversations schema.
- Specification HTML: Extended Thinking + Markdown Rendering in Conversation Pipeline section.
- Overview HTML: Extended Thinking in Model spec, 2 new rows in feature comparison table.
- MCP Tool Bridge design spec added.

## [0.8.1-beta] - 2026-04-12

### Security Hardening
- Path traversal protection on all file-serving endpoints.
- Parameterized queries audit across all modules.
- JWT token validation hardened, expiry edge cases resolved.
- SameSite cookie attributes, origin header verification.
- WebSocket auth hardening for Hand Hub remote connections.
- PBKDF2 iterations increased to 600K for master key derivation.

### Features
- **Skill Ecosystem:** 221 bundled skills across 16 categories, 3 types (knowledge, tool, integration), 15 API integrations.
- **Agent Wizard:** AI-assisted agent creation via conversation skill.
- **Embedding Provider:** Dedicated embedding provider in model module.
- **WebSocket Frontend:** Full real-time integration for board, chat, agent progress.
- **Smart Memory Lifecycle:** Memory tier promotion/demotion, context builder v2.
- **Team Sessions:** Parallel agent coordination, shared memory, real-time dashboard.
- **Agent System Overhaul:** No hardcoded agent names, agent memory, delegation, channel binding.

### Test Coverage
- 1353 tests passing (158 test files).

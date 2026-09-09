# Claude Config Isolation Default Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Flip the claude-code provider's `loadClaudeMd` default to false (EYAS memory = single source of truth), make the opt-in path explicit and honest, and state plainly on the grok/kimi panels that those CLIs cannot be isolated.

**Architecture:** Three default expressions flip together (backend manifest, provider factory, frontend panel). The ON path stops relying on the CLI's undocumented "absent flag = load everything" default and sends an explicit `settingSources` list. No new settings key, no API/storage change (settings blob is schemaless). grok/kimi get honesty copy + a code comment, no fake switch.

**Tech Stack:** TypeScript 5.9 strict ESM, Bun, Vitest, React 19, module-local i18n (six languages).

**Spec:** `docs/superpowers/specs/2026-08-28-claude-config-isolation-default.md`

## Global Constraints

- **NEVER commit, push, or create branches.** Work directly in the current working tree on `main`. Reports only — the human commits.
- Version freeze: `0.8.15-beta` — no version bumps anywhere.
- Every user-facing string exists in ALL SIX locales: en, hu, de, es, fr, tlh (module-local `locales/*.json`).
- English code and comments.
- The settings key stays `loadClaudeMd` (stored blobs keep working). No storage/API changes.
- Do NOT set `supportsIsolatedCompletion` on grok-cli or kimi-cli (ACP cannot isolate — "do not fabricate one").
- The working tree already contains large unrelated uncommitted changes (F1 memory workstream). Touch ONLY the files this plan names; never revert or "clean up" anything else.
- Pre-existing baselines: 9 test files already FAIL, lint has 51 pre-existing findings. Do not try to fix them; only keep the suites this plan touches green.

---

### Task 1: Backend — default flip + explicit ON source list

**Files:**
- Modify: `src/modules/model/submodules/claude-code/provider.ts` (lines ~213-215, ~234, ~403-414)
- Modify: `src/modules/model/submodules/claude-code/manifest.ts:29`
- Test: `tests/modules/model/claude-code/provider-isolated.test.ts`

**Interfaces:**
- Consumes: existing `ClaudeCodeProviderOptions.loadClaudeMd?: boolean` and the `settingSources` block in `stream()`.
- Produces: provider default `loadClaudeMd = false`; ON now emits `settingSources: ['user','project','local']`; OFF/isolated emit `[]` (unchanged). Task 2's UI expression must mirror the manifest expression introduced here.

- [ ] **Step 1: Update the two behavior tests in `tests/modules/model/claude-code/provider-isolated.test.ts`**

Replace the test currently named `'changes NOTHING when the flag is absent'` (lines 94-101) with these two tests:

```ts
  it('sends the explicit full source list when the owner opted in', async () => {
    const provider = createClaudeCodeProvider({ ...toolDeps, loadClaudeMd: true, getGovernance: () => governance() as any })
    await drain(provider.stream(req as any))
    // Explicit, not omitted: the installed CLI treats an ABSENT
    // --setting-sources flag as "load everything" while the SDK docs promise
    // the opposite (omitted = none). Stating the intent survives both
    // readings and any SDK upgrade.
    expect(h.captured.options.settingSources).toEqual(['user', 'project', 'local'])
    expect(h.captured.options.mcpServers?.eyas).toBeTruthy()
    expect(h.captured.options.tools).toContain('Read')
    expect(h.captured.options.maxTurns).toBe(25)
  })

  it('defaults to isolation: a provider built without the option sends settingSources []', async () => {
    const provider = createClaudeCodeProvider({ ...toolDeps, getGovernance: () => governance() as any })
    await drain(provider.stream(req as any))
    expect(h.captured.options.settingSources).toEqual([])
  })
```

Leave the `'still honours loadClaudeMd=false on an ordinary request'` test (lines 103-108) unchanged. Leave all isolated-mode tests unchanged.

- [ ] **Step 2: Run the file to verify the two new tests fail**

Run: `bun run vitest run tests/modules/model/claude-code/provider-isolated.test.ts`
Expected: FAIL — `settingSources` is `undefined` for opted-in, and `undefined` for the option-less provider (old default true skips the branch).

- [ ] **Step 3: Implement in `provider.ts`**

(a) Option doc, currently line 213-215:

```ts
  /**
   * Load the host machine's Claude config into non-isolated sessions:
   * settings.json (hooks, permission rules), CLAUDE.md at every tier, user &
   * project skills, project .mcp.json servers (default: false — EYAS's own
   * memory is the single source of truth).
   */
  loadClaudeMd?: boolean
```

(b) Destructure default, line 234: change `loadClaudeMd = true` to `loadClaudeMd = false`.

(c) Replace the block at lines 403-414 (comment + `if`) with:

```ts
      // Machine-level Claude config is opt-in. OFF (the default) sends
      // settingSources: [] — no filesystem settings at all: no settings.json
      // (hooks, permission rules), no CLAUDE.md at any tier, no host skills,
      // no project .mcp.json. EYAS's own memory is the only memory.
      // ON sends the explicit full list instead of omitting the option: the
      // installed CLI treats an ABSENT --setting-sources flag as "load
      // everything" while the SDK docs promise the opposite — relying on
      // either reading would break on an SDK upgrade, so the intent is
      // always stated.
      //
      // An isolated request forces isolation REGARDLESS of the setting: the
      // owner's ~/.claude memory reaching an extraction call is precisely how
      // a durable fact went unrecorded — the model read the fact in its own
      // loaded memory and reported it already known, which EYAS's vault
      // flatly was not.
      queryOptions['settingSources'] = isolated || !loadClaudeMd ? [] : ['user', 'project', 'local']
```

- [ ] **Step 4: Implement in `manifest.ts`**

Line 29: change

```ts
  const loadClaudeMd = config.settings?.loadClaudeMd !== false // default: true
```

to

```ts
  const loadClaudeMd = config.settings?.loadClaudeMd === true // opt-in — default: false
```

- [ ] **Step 5: Run the test file to verify it passes**

Run: `bun run vitest run tests/modules/model/claude-code/provider-isolated.test.ts`
Expected: PASS (all tests).

- [ ] **Step 6: Run the whole claude-code suite + typecheck**

Run: `bun run vitest run tests/modules/model/claude-code/` and the project typecheck command from `package.json` (e.g. `bun run typecheck` — check the scripts block).
Expected: PASS / no new type errors.

---

### Task 2: Frontend — expression flip, honest copy, kimi honesty comment

**Files:**
- Modify: `src/web/src/pages/providers/provider-panel.tsx:83`
- Modify: `src/web/src/pages/providers/locales/en.json`, `hu.json`, `de.json`, `es.json`, `fr.json`, `tlh.json`
- Modify: `src/modules/model/submodules/kimi-cli/provider.ts` (comment only, inside `stream()` near line ~181)

**Interfaces:**
- Consumes: Task 1's manifest expression (`=== true`); the frontend read must mirror it exactly.
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Flip the UI expression**

`provider-panel.tsx:83`: change

```ts
  const loadClaudeMd = detail?.settings?.loadClaudeMd !== false
```

to

```ts
  const loadClaudeMd = detail?.settings?.loadClaudeMd === true
```

No other panel logic changes: the toggle button already writes an explicit boolean via `handleSettingChange`, and the amber `claudeMdWarning` block already renders only when ON — both stay correct.

- [ ] **Step 2: Update the four locale keys in ALL SIX files**

In each of `src/web/src/pages/providers/locales/{en,hu,de,es,fr,tlh}.json` set these exact values (keys already exist; this fixes the misleading "Load CLAUDE.md" label, describes what ON really loads, and repairs the hu/de/es `grokAcpHint` strings whose `grok agent stdio` code span was lost):

`providers.panel.loadClaudeMd`:
- en: `Load host Claude config`
- hu: `Gépszintű Claude-konfig betöltése`
- de: `Host-Claude-Konfiguration laden`
- es: `Cargar configuración Claude del host`
- fr: `Charger la configuration Claude de l'hôte`
- tlh: `juH Claude SeH yIlaD`

`providers.panel.loadClaudeMdHint`:
- en: `Load the host machine's Claude config into conversations — settings.json (hooks, permission rules), every CLAUDE.md tier, skills and project .mcp.json servers. Off by default: EYAS's own memory stays the single source of truth.`
- hu: `A gép Claude-konfigurációjának betöltése a beszélgetésekbe — settings.json (hookok, jogosultsági szabályok), minden CLAUDE.md szint, skillek és a projekt .mcp.json szerverei. Alapból kikapcsolva: az EYAS saját memóriája marad az egyetlen igazságforrás.`
- de: `Lädt die Claude-Konfiguration des Host-Rechners in Unterhaltungen — settings.json (Hooks, Berechtigungsregeln), alle CLAUDE.md-Ebenen, Skills und die .mcp.json-Server des Projekts. Standardmäßig aus: EYAS' eigenes Gedächtnis bleibt die einzige Wahrheitsquelle.`
- es: `Carga la configuración Claude de la máquina host en las conversaciones — settings.json (hooks, reglas de permisos), todos los niveles de CLAUDE.md, skills y los servidores .mcp.json del proyecto. Desactivado por defecto: la memoria propia de EYAS sigue siendo la única fuente de verdad.`
- fr: `Charge la configuration Claude de la machine hôte dans les conversations — settings.json (hooks, règles de permissions), tous les niveaux CLAUDE.md, les skills et les serveurs .mcp.json du projet. Désactivé par défaut : la mémoire propre d'EYAS reste la seule source de vérité.`
- tlh: `juH qoq Claude SeH ja'chuqmeyDaq yIlaD — settings.json (hookmey, chaw' chutmey), Hoch CLAUDE.md patlhmey, laHmey je Qu' .mcp.json jabwI'mey. motlh chu'Ha'lu': EYAS qawHaq neH vIt Hal mob taH.`

`providers.panel.grokAcpHint`:
- en: `Conversations run through \`grok agent stdio\` (Agent Client Protocol). Session resume and tool use use the host Grok login. The grok CLI loads its own machine-level config and memory (~/.grok — and demonstrably ~/.claude too); EYAS cannot disable this.`
- hu: `A beszélgetések a \`grok agent stdio\` (Agent Client Protocol) útján futnak. A session folytatás és a tool-használat a host Grok bejelentkezést használja. A grok CLI betölti a saját gépszintű konfigurációját és memóriáját (~/.grok — és bizonyítottan a ~/.claude-ot is); ezt az EYAS nem tudja letiltani.`
- de: `Unterhaltungen laufen über \`grok agent stdio\` (Agent Client Protocol). Session-Fortsetzung und Tool-Nutzung nutzen die Host-Grok-Anmeldung. Die grok-CLI lädt ihre eigene Host-Konfiguration und ihr eigenes Gedächtnis (~/.grok — und nachweislich auch ~/.claude); EYAS kann das nicht deaktivieren.`
- es: `Las conversaciones se ejecutan a través de \`grok agent stdio\` (Agent Client Protocol). La reanudación de sesión y el uso de herramientas usan el inicio de sesión de Grok del host. La CLI de grok carga su propia configuración y memoria a nivel de máquina (~/.grok — y demostradamente también ~/.claude); EYAS no puede desactivarlo.`
- fr: `Les conversations passent par \`grok agent stdio\` (Agent Client Protocol). La reprise de session et l'utilisation des outils s'appuient sur la connexion Grok de l'hôte. La CLI grok charge sa propre configuration et mémoire au niveau machine (~/.grok — et de façon avérée ~/.claude aussi) ; EYAS ne peut pas le désactiver.`
- tlh: `\`grok agent stdio\` (Agent Client Protocol) ja'chuq ta'. poH qa' 'ej jan lo' juH Grok yI'el lo'. grok CLI juH SeH qawHaq je yIlaDtaH (~/.grok — ~/.claude je); EYAS chu'Ha'laHbe'.`

`providers.panel.kimiAcpHint`:
- en: `Conversations run through \`kimi acp\` (Agent Client Protocol). Session resume and tool use use the host Kimi login. The kimi CLI may load its own machine-level config and memory; EYAS cannot disable or verify this.`
- hu: `A beszélgetések a \`kimi acp\` (Agent Client Protocol) útján futnak. A session folytatás és a tool-használat a host Kimi bejelentkezést használja. A kimi CLI betöltheti a saját gépszintű konfigurációját és memóriáját; ezt az EYAS nem tudja sem letiltani, sem ellenőrizni.`
- de: `Unterhaltungen laufen über \`kimi acp\` (Agent Client Protocol). Session-Fortsetzung und Tool-Nutzung nutzen die Host-Kimi-Anmeldung. Die kimi-CLI lädt möglicherweise ihre eigene Host-Konfiguration und ihr eigenes Gedächtnis; EYAS kann das weder deaktivieren noch überprüfen.`
- es: `Las conversaciones se ejecutan a través de \`kimi acp\` (Agent Client Protocol). La reanudación de sesión y el uso de herramientas usan el inicio de sesión de Kimi del host. La CLI de kimi puede cargar su propia configuración y memoria a nivel de máquina; EYAS no puede desactivarlo ni verificarlo.`
- fr: `Les conversations passent par \`kimi acp\` (Agent Client Protocol). La reprise de session et l'utilisation des outils s'appuient sur la connexion Kimi de l'hôte. La CLI kimi peut charger sa propre configuration et mémoire au niveau machine ; EYAS ne peut ni le désactiver ni le vérifier.`
- tlh: `\`kimi acp\` (Agent Client Protocol) ja'chuq ta'. poH qa' 'ej jan lo' juH Kimi yI'el lo'. kimi CLI juH SeH qawHaq je yIlaDlaH; EYAS chu'Ha'laHbe' 'ej 'ollaHbe'.`

(In JSON, the backtick characters above are literal backticks inside the string values — the existing en/fr grokAcpHint values already use them.)
Leave `providers.panel.claudeMdWarning` unchanged in all six locales — it renders only when ON and its advice is still correct.

- [ ] **Step 3: Add the honesty comment to the kimi provider**

In `src/modules/model/submodules/kimi-cli/provider.ts`, at the top of `async *stream(request: ModelRequest)` (immediately after line 181's opening), insert:

```ts
      // NOTE (mirrors grok-cli): `ModelRequest.isolated` is deliberately NOT
      // honoured here, and this provider does not advertise
      // supportsIsolatedCompletion. ACP `session/new` accepts `cwd`,
      // `mcpServers` and a `_meta` carrying systemPromptOverride/maxTurns —
      // and nothing that stops the CLI loading its OWN machine-level config
      // and memory into the session. The kimi CLI's baseline is additionally
      // UNVERIFIED (unlike grok, which demonstrably loads ~/.grok and even
      // ~/.claude globally). Honouring the flag halfway would claim an
      // isolation this cannot deliver — revisit if kimi gains a real
      // suppression switch; do not fabricate one.
```

- [ ] **Step 4: Verify**

Run: `bun run vitest run tests/modules/model/claude-code/ tests/modules/model/kimi-cli/ 2>/dev/null || bun run vitest run tests/modules/model/` (run whichever kimi test dir exists; if none, just the claude-code dir) and validate all six JSON files parse: `for f in src/web/src/pages/providers/locales/*.json; do bun -e "JSON.parse(await Bun.file('$f').text())" || echo "BROKEN: $f"; done`
Expected: tests PASS, no BROKEN lines. Also run the web build's typecheck if one exists in `package.json` scripts (do not fix pre-existing web lint findings).

---

### Task 3: Docs — changelog, architecture note, user docs

**Files:**
- Modify: `CHANGELOG.md` (inside the existing `## [0.8.15-beta]` entry)
- Modify: `docs/eyas-architecture.md` (model providers section)
- Modify: `packages/docs/src/content/docs/{en,hu,de,es,fr,tlh}/ai/providers.md` — see Step 3 caveat
- Regenerate: `packages/docs/field-catalog.json` via the catalog script

**Interfaces:**
- Consumes: Task 2's locale strings (the catalog regen exports them).
- Produces: nothing.

- [ ] **Step 1: CHANGELOG subsection**

Inside the existing `## [0.8.15-beta]` entry, after the memory-capture/self-writing-memory section (grep for the memory section heading), add:

```markdown
### Claude config isolation is now the default

- **`loadClaudeMd` defaults to OFF.** Conversations on the Claude Code CLI no
  longer load the host machine's Claude config — no `settings.json` (hooks,
  permission rules), no CLAUDE.md at any tier, no host skills, no project
  `.mcp.json` servers. EYAS's own memory is the single source of truth; what
  the model knows is what EYAS recorded. Existing installs flip too — one
  click on the provider panel opts back in.
- **The ON path is explicit now.** Opting in sends
  `settingSources: ['user','project','local']` instead of omitting the option.
  The installed CLI treats an absent flag as "load everything" while the SDK
  docs promise the opposite — the toggle no longer depends on either reading,
  and the panel copy says honestly that ON loads the whole machine config,
  hooks included, not just CLAUDE.md.
- **No fake switch for Grok/Kimi.** ACP has no isolation parameter and the
  grok CLI has no suppression flag (it demonstrably loads `~/.grok` and even
  `~/.claude` globally); the kimi baseline is unverified. Their panels now say
  so instead of pretending otherwise.
- **Known residual:** a CLI session created before the flip restores its
  previously loaded context when resumed, until the session goes stale.
```

- [ ] **Step 2: Architecture note**

In `docs/eyas-architecture.md`, find the claude-code / model-provider description (grep `claude-code` or `Claude Code CLI`) and append two sentences to it:

```markdown
Host Claude config is opt-in: by default the provider sends `settingSources: []`
(no machine-level settings.json, CLAUDE.md, skills or `.mcp.json`), so EYAS's own
memory is the single source of truth; opting in sends the explicit
`['user','project','local']` list rather than relying on the CLI's
load-everything default. Grok/Kimi (ACP) cannot be isolated and carry an honesty
note instead of a switch.
```

- [ ] **Step 3: User docs pages (six languages) — check generation first**

First inspect `packages/docs/scripts/` (e.g. `generate-full-docs.mjs`, `export-field-catalog.mjs`) and the frontmatter/markers of `packages/docs/src/content/docs/en/ai/providers.md` to determine whether that page is hand-maintained or generator-owned. If generator-owned, put the new content wherever the generator sources it (and report where); if hand-maintained, append this paragraph (translated per language, matching each page's existing tone):

- en: `**Host Claude config (Claude Code CLI).** By default EYAS keeps conversations isolated from the host machine's Claude configuration — no settings.json (hooks, permission rules), no CLAUDE.md files, no host skills or project .mcp.json servers — so EYAS's own memory is the single source of truth. The "Load host Claude config" switch on the provider panel opts back in. The Grok and Kimi CLIs always load their own machine-level config; EYAS cannot disable that.`
- hu: `**Gépszintű Claude-konfig (Claude Code CLI).** Az EYAS alapból elszigeteli a beszélgetéseket a gép Claude-konfigurációjától — nincs settings.json (hookok, jogosultsági szabályok), nincs CLAUDE.md, nincsenek gépszintű skillek és projekt .mcp.json szerverek —, így az EYAS saját memóriája az egyetlen igazságforrás. A provider-panel „Gépszintű Claude-konfig betöltése" kapcsolójával lehet visszakapcsolni. A Grok és a Kimi CLI mindig betölti a saját gépszintű konfigurációját; ezt az EYAS nem tudja letiltani.`
- de: `**Host-Claude-Konfiguration (Claude Code CLI).** EYAS isoliert Unterhaltungen standardmäßig von der Claude-Konfiguration des Host-Rechners — keine settings.json (Hooks, Berechtigungsregeln), keine CLAUDE.md-Dateien, keine Host-Skills und keine .mcp.json-Server des Projekts —, sodass EYAS' eigenes Gedächtnis die einzige Wahrheitsquelle ist. Der Schalter „Host-Claude-Konfiguration laden" im Provider-Panel aktiviert sie wieder. Die Grok- und Kimi-CLIs laden ihre eigene Host-Konfiguration immer; EYAS kann das nicht deaktivieren.`
- es: `**Configuración Claude del host (Claude Code CLI).** Por defecto, EYAS aísla las conversaciones de la configuración Claude de la máquina host — sin settings.json (hooks, reglas de permisos), sin archivos CLAUDE.md, sin skills del host ni servidores .mcp.json del proyecto —, de modo que la memoria propia de EYAS es la única fuente de verdad. El interruptor «Cargar configuración Claude del host» del panel del proveedor la reactiva. Las CLI de Grok y Kimi siempre cargan su propia configuración de máquina; EYAS no puede desactivarlo.`
- fr: `**Configuration Claude de l'hôte (Claude Code CLI).** Par défaut, EYAS isole les conversations de la configuration Claude de la machine hôte — pas de settings.json (hooks, règles de permissions), pas de fichiers CLAUDE.md, pas de skills de l'hôte ni de serveurs .mcp.json du projet — de sorte que la mémoire propre d'EYAS est la seule source de vérité. Le commutateur « Charger la configuration Claude de l'hôte » du panneau du fournisseur la réactive. Les CLI Grok et Kimi chargent toujours leur propre configuration machine ; EYAS ne peut pas le désactiver.`
- tlh: `**juH Claude SeH (Claude Code CLI).** motlh EYAS ja'chuqmey juH qoq Claude SeHvo' mach — settings.json (hookmey, chaw' chutmey) tu'be', CLAUDE.md ghItlhmey tu'be', juH laHmey Qu' .mcp.json jabwI'mey je tu'be' — vaj EYAS qawHaq neH vIt Hal mob. provider panel „juH Claude SeH yIlaD" SeH yIchu'qa'laH. Grok Kimi CLI je juH SeHchaj reH lulaD; EYAS chu'Ha'laHbe'.`

- [ ] **Step 4: Regenerate the field catalog**

Find the catalog script in `package.json` scripts (survey: `bun run catalog`, backed by `packages/docs/scripts/export-field-catalog.mjs`) and run it so `packages/docs/field-catalog.json` picks up Task 2's locale strings. Report the diff stat of the regenerated file; do not hand-edit it.

- [ ] **Step 5: Verify**

Run: `bun run vitest run tests/modules/model/claude-code/` one final time (guards against accidental source edits) and confirm `git status --porcelain` shows changes ONLY in the files this plan names (plus the regenerated catalog).
Expected: PASS; no stray files.

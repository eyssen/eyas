# Optional agent-browser sidecar — Design

**Date:** 2026-08-29
**Status:** Approved in chat (`jöhet a kód`) — implemented, commit only if asked
**Module:** existing extra `browser-use` (`required: false`); Connections/MCP catalog (second surface)
**Upstream:** Vercel Labs `agent-browser` 0.35.x, **Apache-2.0**, https://github.com/vercel-labs/agent-browser
**Predecessor (do not re-litigate):**
- Extra module wraps CLI, never vendors a third-party lib or LLM SDK — `2026-08-29-browser-use-and-videouse-design.md` §2
- Native `browser_*` stays the public-page lane; Chrome 136+ daily-profile CDP is refused first — `2026-08-29-browser-tools-expansion-design.md` §4
- Playwright MCP is catalog-only (`mcp_playwright_*`); Python `browser-use` MCP is rejected (LLM key + `retry_with_browser_use_agent`)
- Sidecar sequence already decided: `@playwright/mcp` (shipped) → **agent-browser** → `chrome-devtools-mcp` later. This spec is that second step.
- LLM always the EYAS model module.

---

## 1. Problem

The extra module’s logged-in lane is Python `browser_use_exec`: stdin of CLI 3.0 helpers (`click_at_xy`, …), Python 3.11+, `uvx` fallback, telemetry stripped by hand. That is a second agent language, not `@eN` refs, and it still tries to drive “the user’s real Chrome” — which Chrome 136+ blocks on the Default profile.

Vercel `agent-browser` is the sidecar that matches the EYAS contract:

| Property | Why it fits |
|---|---|
| Apache-2.0 npm/Homebrew/Cargo CLI | MIT-compatible. EYAS does **not** vendor the Rust crate. |
| No LLM in the default binary path | Snapshot / click / fill / MCP are tools. `chat` and the dashboard Chat tab are a **separate** Vercel AI Gateway loop (`AI_GATEWAY_API_KEY`) — EYAS must never call them. |
| `snapshot` → `@e1` refs | Same mental model as numbered `browser_snapshot` / Playwright MCP refs. |
| `state save` / `state load` | Cookies + storage without attaching to daily Chrome. |
| `--allowed-domains` | Navigation + subresource allowlist (opt-in upstream; EYAS can inject from settings). |
| `agent-browser mcp` | Native stdio MCP. No third-party `mcp-agent-browser` wrapper. |
| `agent-browser install` | Chrome for Testing (own browser). `--profile <path>` is a persistent **directory**, not the operator’s Default profile. |
| `doctor --offline --quick --json` | Fail-closed probe without network. |

Gaps we must not import: `chat`, dashboard AI, `--profile Default` (copies daily Chrome), `--auto-connect` / `connect <port>` to a running daily Chrome, `--no-sandbox`, `--engine lightpanda`, cloud `--provider` / captcha / stealth plugins, Python `browser-use` MCP.

---

## 2. Recommendation — **alongside, agent-browser is the recommended sidecar**

Keep Python `browser_use_status` / `browser_use_exec`. Do **not** delete them in this wave.

Make **agent-browser the recommended sidecar** for new logged-in / persistent-auth work.

### 2.1 Why not *instead*

- The Python tools, `/browser-use` card, skill, and six-locale docs already shipped. Removing them without a migration is a breaking extra-module change.
- Operators who already set `EYAS_BROWSER_USE_BIN` should keep working.
- The two CLIs are not substitutes: Python stdin is “write Python against CLI 3.0”; agent-browser is argv / MCP with `@e1`.

### 2.2 Why not *equal* (two first-class sidecars)

Chrome 136 already made “attach to the Chrome I use every day” a lie. The honest logged-in path is an **EYAS-owned `userDataDir` + state file**, which is native to agent-browser and awkward in Python `click_at_xy`. Promoting both equally would teach the agent two red tools for the same job.

Playwright MCP stays the a11y-ref / live-tab MCP. Native `browser_*` stays the default for public pages. agent-browser does **not** replace those.

### 2.3 Lane table (after this wave)

| Job | Recommended tools |
|---|---|
| Public page | native `browser_*` (Playwright, numbered indexes, EYAS profile) |
| a11y-ref MCP / live tab (extension) | Playwright MCP → `mcp_playwright_*` |
| Persistent auth, `@e1`, domain allowlist, own profile | **agent-browser** (`agent_browser_status` then `agent_browser_run`, or `mcp_agent_browser_*`) |
| Legacy Python CLI (already installed) | `browser_use_status` then `browser_use_exec` — kept, not promoted |
| Desktop OS | Hands |
| Console / HAR / WebMCP | `chrome-devtools-mcp` — **out of scope** (next in the old sequence) |

Skill and docs say: if the agent-browser doctor is Ready, prefer it over `browser_use_exec`.

---

## 3. Scope

In scope (one extra-module wave, no new module id):

1. Binary resolve + fail-closed doctor, Hyperframes/Chromium shape: `EYAS_AGENT_BROWSER_BIN` → settings `agentBrowser.cliPath` → `agent-browser` on PATH. Empty env is unset. A **set-but-missing** path is refused loudly (no PATH fallback).
2. Tools: `agent_browser_status` (green), `agent_browser_run` (red, approval).
3. `/browser-use` second card, badge **Recommended**. Existing Python card stays.
4. MCP catalog row `agent-browser` (`agent-browser mcp --tools core,state`) plus Connections type `agent-browser`, same doctor. Tools arrive as `mcp_agent_browser_*` through the existing MCP bridge.
5. Chrome 136: EYAS-owned `--profile <dir>` under `{dataDir}/browser/agent-browser/profile`. Daily Chrome/Edge/Chromium profiles rejected via existing `assertEyAsUserDataDir`. `--profile Default` / named Chrome profiles / `--auto-connect` / raw `--cdp` **forbidden**.
6. Six-locale docs + UI i18n + skill. `eyas doctor` probe only if cheap; the source of truth is the module doctor.

Out of scope:

- Vendoring the Rust crate / `cli/` / `bin/agent-browser-*` into this repo.
- `npx` / Cargo auto-install of the CLI (unlike Hyperframes render). Missing binary = unavailable + remedy.
- Replacing or deleting `browser_use_exec`.
- Calling `agent-browser chat`, dashboard Chat, or setting `AI_GATEWAY_*`.
- Lightpanda, CamoFox, stealth, CAPTCHA plugins, Browserbase/Steel/Kernel as core.
- `chrome-devtools-mcp`.
- Changing native `browser_*` or Playwright MCP policy.

---

## 4. Runtime

### 4.1 Resolve (no Rust, no vendor)

Order, first hit wins:

1. `settings.agentBrowser.cliPath` if non-empty and `existsSync`
2. `process.env.EYAS_AGENT_BROWSER_BIN` trimmed; if non-empty and missing → **missing** check, stop
3. `runner.which('agent-browser')`
4. else unavailable

Remedy (English in doctor; UI/docs translated):  
`Install with \`npm i -g agent-browser\` then \`agent-browser install\`, or \`brew install agent-browser\` then \`agent-browser install\`, or set EYAS_AGENT_BROWSER_BIN to the binary.`

Never `cargo install` from EYAS. Never copy upstream `bin/` into the tree.

### 4.2 Doctor (fail-closed)

Timeout 8s (same as Browser Use / Playwright MCP). `available` is true only when the extra is enabled **and** no check is `missing`.

| id | missing when | remedy |
|---|---|---|
| `cli` | binary unresolved | install / `EYAS_AGENT_BROWSER_BIN` |
| `version` | `--version` non-zero, timeout, or empty stdout | reinstall CLI |
| `doctor` | `doctor --offline --quick --json` non-zero, timeout, unparseable, or `ok: false` / `ok === false` | print sidecar message; never run `doctor --fix` |
| `browser` | JSON says Chrome/CFT missing | `agent-browser install` (operator, not the agent) |
| `profile` | resolved profile path fails `assertEyAsUserDataDir` | point at `{dataDir}/browser/agent-browser/profile` |
| `telemetry` | always `ok` | detail: `DO_NOT_TRACK=1`; `AI_GATEWAY_API_KEY` stripped on every spawn |

Status API does **not** hit the network (offline + quick). Live launch tests stay with the operator’s own `agent-browser doctor`.

HTTP:

- `GET /api/v1/browser-use/status` — **extend** payload, do not break the Python card:

```ts
{
  available: boolean          // Python CLI (unchanged)
  enabled: boolean
  checks: Check[]
  agentBrowser: {
    available: boolean
    enabled: boolean
    recommended: true
    checks: Check[]
  }
}
```

Frontend: two cards. Old clients that ignore `agentBrowser` still render the Python card.

### 4.3 Spawn env (always)

```
DO_NOT_TRACK=1
AGENT_BROWSER_PROFILE={dataDir}/browser/agent-browser/profile
AGENT_BROWSER_DOWNLOAD_PATH={dataDir}/browser/downloads   // or Documents dir if wired
AGENT_BROWSER_CONTENT_BOUNDARIES=1
AGENT_BROWSER_SESSION=eyas
```

Delete from the child env (even if the host has them): `AI_GATEWAY_API_KEY`, `AI_GATEWAY_URL`, `AI_GATEWAY_MODEL`, `BROWSER_USE_API_KEY`.

Never pass `--no-sandbox`. Never forward `EYAS_CHROMIUM_NO_SANDBOX` / `EYAS_CHROMIUM_PATH` (this sidecar uses Chrome for Testing, not the Playwright/Hyperframes binaries).

Optional from settings: `AGENT_BROWSER_ALLOWED_DOMAINS` / `--allowed-domains` (comma-separated). Empty = do not pass the flag (upstream default is unrestricted). When set, also keep `--content-boundaries`.

State files live under `{dataDir}/browser/agent-browser/state/` (EYAS-owned, gitignored with the rest of `data/`).

### 4.4 Settings (extend `browser_use_settings` JSON)

```ts
{
  enabled: boolean                    // Python CLI (existing)
  cliPath: string | null              // Python
  allowUvx: boolean
  allowCloud: boolean
  agentBrowser: {
    enabled: boolean                  // default true (doctor still fail-closed if bin missing)
    cliPath: string | null
    allowedDomains: string[]          // default []
  }
}
```

PUT `/api/v1/browser-use/settings` accepts the nested object; unknown keys ignored. Zod on write.

---

## 5. Agent tools

### 5.1 `agent_browser_status`

Green. Same shape as `browser_use_status`, but returns `agentBrowser` doctor only (or the nested object). Description: *Check the optional Vercel agent-browser CLI (Apache-2.0). Missing binary returns a remedy. Does not need Python. Prefer this sidecar over browser_use_exec when Ready. Headless browser_* do not need this.*

### 5.2 `agent_browser_run`

Red, `requiresApproval: true`, autonomy `external_message`, timeout 180s + 5s (same as Python exec).

Input — **exactly one** of:

- `argv: string[]` — appended after the resolved binary (`agent-browser snapshot -i` → `["snapshot","-i"]`)
- `batch: string[][]` — `agent-browser batch --json` with JSON on stdin (no Python)

Hard rules before spawn:

1. Doctor must be `available`; else return checks + remedy (same as Python exec).
2. First token of `argv`, and of every `batch` row, must be on the **verb allowlist**.
3. Reject the whole call if any arg is `--no-sandbox`, `--disable-setuid-sandbox`, `--auto-connect`, `--cdp`, `--engine`, `--provider`, `--model`, or `--profile` with a daily profile / `Default` / empty.
4. `--profile` / `--state` paths, if present, must pass `assertEyAsUserDataDir` (for dirs) or resolve under `{dataDir}/browser/agent-browser/` (for state files). Otherwise inject `--profile` = default EYAS dir.
5. Forbidden verbs (even if upstream adds them): `chat`, `dashboard`, `plugin`, `install`, `upgrade`, `auth`, `connect`, `mcp`, `profiles`, `doctor`.
6. `eval` stays allowed (page JS, like `browser_evaluate`) — still red.

**v1 verb allowlist:**  
`open`, `snapshot`, `click`, `dblclick`, `fill`, `type`, `press`, `keyboard`, `hover`, `select`, `check`, `uncheck`, `wait`, `screenshot`, `get`, `tab`, `back`, `forward`, `reload`, `close`, `state`, `cookies`, `storage`, `eval`, `upload`, `scroll`, `scrollintoview`, `focus`, `dialog`, `frame`, `is`, `find`, `read`.

Return `{ code, stdout, stderr }` capped (20k / 8k), same as Python exec.

Do **not** invent a Python-stdin equivalent. The agent already has a model.

### 5.3 MCP catalog (second surface, same binary)

MCP registry entry (bundled, Apache-2.0, category Browser):

- id `agent-browser`
- command: resolved binary if known at install time, else `agent-browser`
- args: `mcp`, `--tools`, `core,state`
- env: `DO_NOT_TRACK=1` plus the spawn env in §4.3
- **Never** `--tools all` or `debug` (those profiles include `chat`)
- Setup guide: install CLI + `agent-browser install`; never daily Chrome profile; never Python MCP; never `chat`

Connections catalog type `agent-browser`, Test = fail-closed doctor then “MCP server connected”, same as Playwright MCP.

Sanitize on add/update/spawn (`sanitizeMcpStdioLaunch` or a sibling in `src/shared/agent-browser.ts`):

- detect `agent-browser` / `agent_browser` command
- strip sandbox flags
- strip `chat` from args
- if `--tools` contains `all` or `debug`, rewrite to `core,state`
- `assertEyAsUserDataDir` on profile/state
- reject `mcp-agent-browser` npm wrapper (unneeded; native MCP exists)
- keep rejecting Python browser-use MCP

If both MCP and `agent_browser_run` are available, the skill prefers MCP tools when that server is connected; otherwise `agent_browser_run`. Status is always the extra-module doctor.

---

## 6. Security

| Tool | Risk | Approval | Autonomy |
|---|---|---|---|
| `agent_browser_status` | green | no | — |
| `agent_browser_run` | red | yes | `external_message` |
| `mcp_agent_browser_*` | existing MCP bridge + per-tool gate | existing | treat mutating browser tools as `external_message` if classified; otherwise MCP default |

Destructive-resume hard-block: add `agent_browser_run` next to `browser_use_exec`.

SSRF: native `browser_navigate` still uses `assertSafeBrowserUrl`. The sidecar is a subprocess; EYAS cannot intercept every `open`. Mitigations: optional domain allowlist, `--content-boundaries`, verb allowlist, no `connect`/`--cdp`/`--auto-connect`, no daily profile, red + approval.

`eval` / `upload` stay in the allowlist because the native lane already has them (red). Upload paths should be workspace-jailed when we pass them through; if the CLI takes raw paths, reject `..` and require workspace or `{dataDir}/browser/` prefixes in v1 (fail closed on other paths).

Auth vault (`agent-browser auth save` with passwords) is **out**. Secrets stay in EYAS secrets / Keychain. After a human login in the EYAS-owned profile, `state save` is the persistence path.

---

## 7. UI

Route stays `/browser-use`. No new nav item.

1. Lane hint updated: four lanes (headless / **agent-browser recommended** / Python legacy / Hands). Playwright MCP still documented, not a card here.
2. Card A — **Agent Browser** (new, **Recommended**): Ready/Not ready from `agentBrowser`. Empty copy names `npm i -g agent-browser` + `agent-browser install` / `EYAS_AGENT_BROWSER_BIN`.
3. Card B — existing Python Browser Use CLI (no recommended badge).
4. Help `?` still `automation.browser-use`.

i18n: every new string in `en` `hu` `de` `es` `fr` `tlh` under `src/web/src/pages/browser-use/locales/`.

---

## 8. Docs (six locales)

| File | Change |
|---|---|
| `packages/docs/src/content/docs/<lang>/automation/browser-use.md` | New subsection **Agent Browser (recommended sidecar)**. Python subsection retitled legacy. Lane table adds the row. Chrome 136 / own profile. Never `chat`. |
| `…/automation/tools.md` | `agent_browser_status` / `agent_browser_run` in the table; Python row stays |
| `…/admin/connections.md` | Catalog card Agent Browser (if Connections lists catalog types) |
| `…/ai/mcp.md` | Catalog install + `--tools core,state` + never `all`/`debug` |
| `…/deploy/configuration.md` | `EYAS_AGENT_BROWSER_BIN`, default profile dir |
| `…/admin/security-privacy.md` | own userDataDir, allowlist, no daily Chrome, no AI Gateway |
| `config/skills/integrations/browser-use.md` | Prefer agent-browser when Ready; argv not Python; do not call `chat` |
| `docs/eyas-architecture.md` | Short extra-module paragraph after implementation |
| `CHANGELOG.md` | After implementation, not in this spec wave |

---

## 9. Tests (no live Chrome)

Unit, mocked `CliRunner` (copy `tests/modules/browser-use/tools.test.ts` + `tests/shared/playwright-mcp.test.ts`):

- `EYAS_AGENT_BROWSER_BIN` wins when the file exists
- set-but-missing BIN → missing, no PATH fallback
- empty / whitespace BIN → PATH
- PATH hit → ok
- nothing → missing + remedy mentions `EYAS_AGENT_BROWSER_BIN`
- `doctor --offline --quick --json` timeout / non-zero / `ok:false` → unavailable
- daily profile `--profile` rejected; EYAS data dir accepted
- `chat`, `--no-sandbox`, `--auto-connect`, `--profile Default`, `plugin`, `--tools all` rejected
- spawn env has `DO_NOT_TRACK=1` and does **not** contain `AI_GATEWAY_API_KEY`
- `agent_browser_run` with doctor missing returns remedy, does not spawn
- batch JSON stdin, not Python
- MCP sanitize rewrites `debug`/`all` → `core,state`
- Python `browser_use_exec` tests unchanged

---

## 10. Files (implementation, after approval)

| Path | Role |
|---|---|
| `src/shared/agent-browser.ts` | resolve, doctor, spawn env, verb allowlist, MCP detect/sanitize (keep Playwright policy in `playwright-mcp.ts`) |
| `src/modules/browser-use/doctor.ts` | nested `agentBrowser` status |
| `src/modules/browser-use/tools.ts` | two new tools |
| `src/modules/browser-use/settings-store.ts` | nested settings |
| `src/modules/browser-use/routes.ts` | status payload + settings Zod |
| `src/modules/security-gate/autonomy-policy.ts` + `types.ts` | `agent_browser_run` red / `external_message` |
| `src/modules/communication/submodules/mcp-client/registry.ts` | catalog row |
| `src/modules/connections/catalog.ts` | Connections type |
| `src/web/src/pages/browser-use/*` | two cards + 6 locales |
| `tests/shared/agent-browser.test.ts` + extra-module tests | §9 |
| docs + skill | §8 |

`src/modules/browser-use/index.ts` stays one extra; description mentions both CLIs.

---

## 11. Key decisions

1. **Alongside, not instead** — Python CLI kept; agent-browser is the recommended sidecar for new work.
2. **Same extra module** — no new sidebar, no new module id.
3. **Do not vendor Rust** — operator installs the published CLI; EYAS only wraps it.
4. **LLM stays in EYAS** — strip `AI_GATEWAY_*`; refuse `chat` / dashboard / `--tools all|debug`.
5. **Chrome 136** — EYAS-owned `--profile` directory; refuse Default / daily profile / auto-connect / CDP-to-running-Chrome.
6. **Fail-closed doctor** — missing/empty BIN, timeout, non-zero, `ok: false` → unavailable with a remedy. No silent npx, no `doctor --fix`.
7. **Two agent surfaces** — typed CLI (`agent_browser_run`) for the extra module + optional MCP catalog using the same binary. Native `browser_*` and Playwright MCP unchanged.
8. **Allowlist verbs** — argv/batch, not arbitrary shell, not Python stdin.

---

## 12. Open questions (for chat approval)

None that block the spec. Optional nits if you want to change them before code:

- MCP catalog in the **same** wave (recommended: yes, it is small and matches Playwright MCP).
- Domain allowlist default **empty** (upstream) vs fail-closed require a list (stricter than native `browser_*`). Spec uses empty = unrestricted.

---

## 13. PR plan (after approval; one local branch, commit only if asked)

Single implementation pass, not stacked PRs, unless you ask to split:

1. Shared doctor/resolve/sanitize + unit tests (no live browser).
2. Extra-module tools, settings, routes, autonomy, `/browser-use` two cards, 6 UI locales.
3. MCP + Connections catalog row + sanitize hook.
4. Six-locale product docs, skill, architecture one-liner, CHANGELOG.

No commit / no push unless you ask.

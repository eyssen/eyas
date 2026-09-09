# Headless `browser_*` expansion — Design

**Date:** 2026-08-29
**Status:** Approved in chat (native `browser_*` expansion; no Python, no new Chromium)
**Modules:** existing `src/modules/tools/builtin/browser-session.ts` + `browser-tools.ts`; `src/shared/playwright-loader.ts`; Documents ingest; docs `automation/tools` + `automation/browser-use`
**Predecessor (do not re-litigate):**
- Numbered DOM (`data-eyas-index`) already on `browser_snapshot` / click / fill — `2026-08-29-browser-use-and-videouse-design.md` §1
- Browser-use extra module is the *logged-in real Chrome* sidecar, not this
- No Python `browser_use` lib, no vendored LLM SDK, no Stagehand/Skyvern in-process, no default Chrome profile CDP (Chrome 136+)

---

## 1. Problem

Headless `browser_*` can navigate, click/fill by index, screenshot, and snapshot. Agents still cannot:

- open or switch tabs
- go back
- wait for a selector / URL / load
- hover, select `<select>`, handle `alert`/`confirm`/`prompt`
- upload a file, download into Documents
- run page JS (`evaluate`)
- keep cookies across the 5-minute process lifetime

Snapshot indexes die on navigation in theory; the manager does not enforce it, so a click can hit the wrong node after `goto`.

## 2. Scope

In scope (same Playwright Chromium, same SSRF, same 5-minute *process* session, UA `EYAS/1.0 Browser Agent`):

| Capability | Tool |
|---|---|
| Tabs | `browser_tabs` `{ action: list\|open\|switch\|close, id?, url? }` |
| Back | `browser_back` |
| Wait | `browser_wait` `{ kind: selector\|timeout\|url\|load, … }` |
| Hover | `browser_hover` (selector **or** index) |
| Select | `browser_select` (selector **or** index + `values`) |
| Dialog | `browser_dialog` `{ action: accept\|dismiss, promptText? }` — arms the next dialog |
| Upload | `browser_upload` — workspace-jailed paths and/or `documentIds` |
| Evaluate | `browser_evaluate` `{ expression }` — page-only `eval`, JSON result capped |
| Download | `browser_download` — Playwright download → `documents.upload` + link conversation `ai` |
| Cookies | Playwright `storageState` save/load; persistent context with **EYAS-owned** `userDataDir` |

Out of scope:

- Python sidecar, Cloud API, stealth/CAPTCHA, attaching to the operator's daily Chrome/Edge profile
- New Chromium binary / new npm browser stack
- Changing design-module print (`headless-browser.ts` stays on `launchChromium`)

## 3. Snapshot refs

Each tab holds `snapshotSeq` (monotonic) and `lastSnapshotSeq`.

- `browser_snapshot` stamps `data-eyas-index`, sets `lastSnapshotSeq = snapshotSeq`, returns `snapshotId` (`t{tabId}s{seq}`).
- Main-frame `framenavigated` (navigate, back, click-through) increments `snapshotSeq` and clears `lastSnapshotSeq`.
- Click / fill / hover / select / upload by `index` require `lastSnapshotSeq === snapshotSeq`. Optional `snapshotId` must match. Otherwise: *Interactive snapshot is stale — call `browser_snapshot` again.*

CSS `selector` is unchanged (exactly one of selector or index).

## 4. Profile and storageState

- Default `userDataDir`: `{instance.dataDir}/browser/profile`.
- Override: `EYAS_BROWSER_USER_DATA_DIR`, still rejected if it looks like a daily Chrome/Edge/Chromium profile (`Application Support/Google/Chrome`, `~/.config/google-chrome`, `%LOCALAPPDATA%\Google\Chrome\User Data`, …). Chrome 136+ refuses CDP on the Default profile; we refuse it first.
- Launch via `chromium.launchPersistentContext` (same binary resolution as `launchChromium`). Closing the 5-minute process does **not** wipe the profile.
- `browser_storage` `{ action: save\|load }` reads/writes `{dataDir}/browser/storage-state.json` (Playwright cookies + origins). Load is additive `addCookies` / origin localStorage, not a second Chromium.

## 5. Security

| Tool | Risk | Approval | Autonomy |
|---|---|---|---|
| navigate, click, fill, hover, select, upload, evaluate, download, dialog, tabs open, storage load | red | yes | `external_message` |
| wait, back, tabs switch/close, storage save, screenshot, content | yellow | yes | not extra-gated unless red |
| snapshot, tabs list | yellow | yes | — |
| close | yellow | no | — |

- SSRF (`assertSafeBrowserUrl`) on every navigate, tab-open URL, and wait-for-url.
- `evaluate` runs **in the page**, never in Node. Result JSON capped (50k).
- Upload paths go through `resolveToolPath` (workspace jail). `documentIds` use Documents download, never arbitrary host files.
- Download size uses Documents limits. Missing Documents module → file kept under `{dataDir}/browser/downloads` and the tool says so.
- No `--no-sandbox` unless `EYAS_CHROMIUM_NO_SANDBOX=1` (existing loader rule).

## 6. Wiring

- `createBrowserTools({ getDocuments })` — documents resolved per call, same lazy trap as other builtins.
- `registerBuiltinTools` passes `getDocuments`.
- Destructive-resume hard-block: `browser_upload`, `browser_evaluate`, `browser_download`, `browser_select`, `browser_dialog` (plus existing click/fill).

## 7. Tests

Unit, no live Chromium required:

- Daily-profile path rejected; EYAS data dir accepted
- Persistent launch calls `launchPersistentContext` with the EYAS dir
- Index click works after snapshot, fails after `goto` / `goBack`
- Tabs open/switch/list/close (last tab cannot close)
- wait / hover / select / dialog arm / upload `setInputFiles` / evaluate cap / download → `documents.upload` + `link`
- SSRF still blocks private hosts (existing tests)

## 8. Docs

Six locales (`en` `hu` `de` `es` `fr` `tlh`):

- `packages/docs/src/content/docs/<lang>/automation/tools.md` — headless tool table
- `packages/docs/src/content/docs/<lang>/automation/browser-use.md` — three lanes stay; headless now lists the new primitives and the EYAS-owned profile (never the daily Chrome profile)
- `admin/security-privacy.md` — profile + storageState note

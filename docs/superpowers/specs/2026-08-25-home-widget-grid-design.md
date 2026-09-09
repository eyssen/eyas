# Home — Customisable Widget Grid — Design Spec

> **Date:** 2026-08-25
> **Status:** Draft (awaiting owner review)
> **Scope:** Replaces the fixed dashboard at `/` with a per-user, drag-and-drop widget grid
> shipped with a factory default layout. Backend: one new small core module (`home`).
> **Prompted by:** RUBRIC (getrubric.app) command-centre review, 2026-08-24 session. That
> product's panels are hand-written JSON with no reconciliation against reality; every widget
> here computes from a live module endpoint. That difference is the point of the design.

## 1. Problem

The current dashboard (`src/web/src/pages/dashboard/dashboard-page.tsx`, 534 lines) is a fixed
three-section reading surface. Four concrete defects:

1. **Almost nothing is actionable.** The only controls on the whole page are approve/reject on an
   approval row (`dashboard-page.tsx:311-330`). A failed scheduler job, a stuck agent, or an
   anomaly can be *seen* elsewhere but not *acted on* here — and a failed job is not surfaced at
   all.

2. **Fixed composition.** Nine of the ~50 modules can reach the landing page; the rest have no
   route to it. Every future module faces the same closed door.

3. **The widget extension point exists and is dead.** `FrontendManifest.widgets`
   (`src/core/types.ts:237`) and `WidgetRegistration` (`src/core/types.ts:245-247`) are declared
   and typed. **No module populates them and no code reads them.** Same defect class as
   `AutonomyNudgeCard` (§5).

4. **Request cost.** One dashboard open issues **16 HTTP requests**: 6 from `dashboard-page.tsx`
   (`:132-137`) and **10 from `SetupRecommendationsCard`** (`setup-recommendations-card.tsx:103-117`
   — providers, projects, prompts, agents, search sources, backups, ingress, autonomy features,
   vault, communication setup). The setup requests fire on every open regardless of whether setup
   is long finished.

## 2. Non-goals

- No agent-writable dashboard state. Every tile reads a module endpoint; nothing is a cached
  snapshot an agent maintains by hand.
- No new scheduler WS topic (§4.3 explains the consequence and records the backlog item).
- No change to `PageRegistration` / sidebar navigation, despite it carrying the same
  untranslated-`title` defect as `WidgetRegistration` (§6). Backlog item.
- No parallel old/new dashboard behind a feature flag (§5).

## 3. The widget contract

### 3.1 Why two halves

Modules live in the backend process; React components live in the Vite bundle. There is no
dynamic module loading, so a module cannot ship a component. The contract is therefore split, and
joined by a contract test (§7).

**Backend half — declaration.** The module manifest declares that the widget exists. The new
`home` module collects these from the module loader and serves them:

```
GET /api/v1/home/widgets → { widgets: [{ id, titleKey, module, available, reason? }] }
```

`available: false` when the owning module is disabled or CASL denies this user. Unavailable
widgets are still listed — the drawer shows them dimmed, so the user can see what could be there.

`WidgetRegistration` changes (`src/core/types.ts:245-247`):

```ts
// before
export interface WidgetRegistration {
  id: string; title: string; defaultSize: 'small' | 'medium' | 'large'
}

// after
export interface WidgetRegistration {
  id: string          // '<module>.<widget>', e.g. 'scheduler.upcoming'
  titleKey: string    // i18n key — NOT a display string (§6)
  capability?: string // CASL subject/action gate; omitted = module gate only
}
```

`title` → `titleKey` because the drawer renders it and an English string in a manifest cannot be
translated. `defaultSize`'s three names cannot express a 12-column layout; geometry moves to the
frontend definition, which is where the grid lives.

**Frontend half — implementation.** `src/web/src/pages/home/widget-registry.ts`:

```ts
export interface WidgetDef {
  id: string
  titleKey: string
  icon: LucideIcon
  layout: { w: number; h: number; minW: number; minH: number }
  refresh: {
    topics?: WsTopicKey[]   // subscribe; refetch on thin ping
    pollMs?: number         // interval, gated (§4.2)
  }                         // both = hybrid (Pulse, §4.1); neither = load once
  configSchema?: ZodType                     // e.g. board tile: { projectId }
  Component: FC<{ config: unknown }>
}
```

### 3.2 Refresh declaration

The project's WS rule is explicit (`src/shared/ws-topics.ts:8-10`): *frames stay thin (ids +
refetch pings); data crosses CASL-guarded REST*. `refresh` encodes which discipline a tile
follows so the grid can enforce it centrally rather than each tile inventing its own.

## 4. Data flow and cost

### 4.1 Factory nine

| Tile | Source | Refresh | Actions |
|---|---|---|---|
| Pulse | `GET /api/v1/home/pulse` (§4.4) | ws `mission-control` **+ 60s poll** | each figure links to its list |
| Attention | `/autonomy/approvals` ×2, `/conversations`, `/proactive/alerts` | ws `autonomy` | approve, reject, retry, open |
| Running agents | `/mission-control/snapshot` | ws `mission-control` | interrupt, pause, resume |
| Schedule | `/scheduler/timeline`, `/scheduler/executions` | poll 60s (§4.3) | run now, pause, open log |
| Conversations | `/conversations?active=true` | poll 60s | open |
| Board | `/projects/:id/board` | ws `board:{projectId}` | open card |
| Briefing | `/memory/briefing` | poll 900s | open memory |
| Cost | `/costops/summary` + MC totals | poll 60s | — |
| System | `/observability/anomalies`, `/scheduler/health` | poll 60s | open trace |

Four event-driven, five polled. Pulse is the one hybrid: its running/waiting/cost figures arrive
on the `mission-control` ping, but its **failed-job count cannot** — the scheduler broadcasts
nothing (§4.3) — so it also polls at 60s. A tile whose figures come from modules with different
broadcast maturity must declare the weaker discipline, or it will silently show a stale number.

### 4.2 `useWidgetData`

`useApi` (`src/web/src/hooks/use-api.ts`) cannot back a tile as-is: it has no polling, and it
calls `setData(null)` on every refetch (`:21`, `:28`) — deliberate for conversation switching, but
on a tile it means every refresh flashes through an empty state. Nine tiles would visibly flicker.

`useWidgetData` wraps it with:
- **stale-while-revalidate** — previous data stays on screen until the new response lands;
- **`ws`** — subscribes to the declared topics, refetches on the ping, zero idle traffic;
- **`poll`** — interval that runs *only* while `document.visibilityState === 'visible'` **and** the
  tile is on screen (`IntersectionObserver`). A forgotten tab must not burn rate limit.

### 4.3 Scheduler has no WS topic

Verified against the `WS_TOPICS` catalogue (`src/shared/ws-topics.ts:14-27`): there is no
scheduler topic; job execution broadcasts nothing. The Schedule tile therefore polls at 60s.
Adding a `scheduler` topic is the cleaner fix and is **out of scope here** — recorded as a backlog
item, not silently assumed.

### 4.4 Two aggregate endpoints, and only two

- `GET /api/v1/home/pulse` — the five Pulse figures come from three modules (mission-control,
  scheduler, autonomy). Without aggregation the smallest tile would be the most expensive.
- `GET /api/v1/home/setup-status` — replaces the 10 calls in `SetupRecommendationsCard`, 60s
  server-side cache.

There is deliberately **no** bootstrap endpoint returning every tile's initial data: that would
require `home` to know every other module's shape, which is precisely the coupling the module-first
architecture forbids. Each tile calls its own module's endpoint.

### 4.5 Honest request accounting

The factory nine touch **14 distinct endpoints** on open: `home/pulse`, `autonomy/approvals`
(×2 queries), `conversations?active=true`, `proactive/alerts`, `mission-control/snapshot`,
`scheduler/timeline`, `scheduler/executions`, `projects/:id/board`, `memory/briefing`,
`costops/summary`, `observability/anomalies`, `scheduler/health`, `home/setup-status`.

So **open cost goes 16 → 14, not 16 → 8.** The setup aggregation saves 9, and the four extra
tiles spend most of it back. Two tiles request the same path (`conversations?active=true` for both
Attention and Conversations; `mission-control/snapshot` for both Pulse and Running agents), so a
small in-flight dedupe in `useWidgetData` — same path within one tick shares one request — removes
those 2 and is required anyway to stop duplicate tiles double-fetching.

**The real gain is steady-state, not open cost.** Today all 16 refire on every mount with no
polling discipline at all. After: four tiles idle at zero traffic until a WS ping, five poll at 60s
and stop entirely when the tab is hidden or the tile scrolls out of view (§4.2). Claiming a large
open-cost win here would be false; the design is justified by what happens in the following hour,
not the first 200ms.

## 5. Layout persistence

```sql
CREATE TABLE home_layouts (
  user_id      TEXT NOT NULL,
  breakpoint   TEXT NOT NULL DEFAULT 'lg',    -- lg | md | sm
  items        TEXT NOT NULL,                 -- JSON [{ i, x, y, w, h, config }]
  base_version INTEGER NOT NULL DEFAULT 0,    -- factory-default version this row was reconciled against
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, breakpoint)
)
```

**D1 — No row means factory default.** Rows are created on first customisation, never at
registration. A user who has not customised follows the `DEFAULT_LAYOUT` constant in code, so a
later release that adds a tile to the factory layout reaches them automatically. "Restore factory
layout" is a single `DELETE`.

**D2 — Customisers get an offer, not a rewrite.** `DEFAULT_LAYOUT` carries a version. When it
exceeds a row's `base_version`, the page shows a dismissible bar: *"2 new widgets available:
… [Add] [No thanks]"*. **Add** appends them; **No thanks** raises `base_version` and adds nothing.
Auto-insertion into a customised layout is rejected: a deliberately arranged home page must not
rearrange itself. Without D2, D1's cost is that the most engaged users freeze on the oldest layout.

**D3 — Per-widget `config`.** The board tile needs `projectId`; the type alone is not enough. The
item key `i` is `<widgetId>#<n>`, so the same widget can be placed twice (two projects side by
side).

**D4 — Unknown widgets are retained, not rendered.** Disabling a module drops its tile from the
rendered grid but keeps the item in the stored JSON; re-enabling restores position and config.
Deleting would let every module toggle silently mutilate the layout.

**D5 — Breakpoints are stored separately.** `(user_id, breakpoint)` — arranging `lg` on the desktop
leaves `md`/`sm` following the factory default until touched there.

Writes go to `PUT /api/v1/home/layout`, ~800ms debounced after a drag. The server does not trust
the client: unknown `i` shape or out-of-range `x/y/w/h` is rejected. `config` cannot be validated
against a widget's own `configSchema` server-side — that schema lives in the frontend `WidgetDef`,
out of the server's reach. Backend validation of `config` is structural only: it must be a plain
object whose JSON serialisation is at most 4096 bytes, so a client can't use the layout row as
unbounded storage.

## 6. Migration of the existing dashboard

| Existing | Disposition |
|---|---|
| `dashboard-utils.ts` (`buildAttentionItems`, `pickPinned`, `pickRecent`, `pickDueFocus`, `pickNextJobs`) | Unchanged. Pure, covered by `tests/web/dashboard-utils.test.ts`; the Attention / Conversations / Schedule tiles call the same functions. No logic rewrite, no regression surface. |
| `dashboard-section.tsx` (`DashboardSection`, `DashboardRow`) | Becomes `WidgetFrame`. It already provides title, icon, badge + tone, "open" link, loading and empty states; gains the drag handle and remove button. |
| `status-dot.tsx` | Unchanged. |
| `dashboard-page.tsx` (534 lines) | Split: ~60-line page (grid + header); the rest moves into six widget files. |
| `SetupRecommendationsCard` (361 lines) | **Not a widget** — a fixed strip above the grid that hides itself when no recommendation is open. It is onboarding, not instrumentation; as a widget a new user could remove the very card meant to walk them through setup. Gains the §4.4 aggregate endpoint. |
| `AutonomyNudgeCard` (46 lines) | **Delete — dead code.** Nothing imports it (verified across `src/web/src`), including `dashboard-page.tsx`. It carries its own `localStorage` key and three i18n keys and has never rendered. |
| `pages/dashboard/locales/*.json` (79 keys × 6 languages) | Redistributed per widget; key names preserved where the string is unchanged. |

**Single-step cutover, no feature flag.** There is no external user population to migrate
gradually, and every function of the old page appears on the new one — the factory layout is a
superset of today's content.

## 7. i18n

Six languages are CI-enforced (`tests/contracts/web-i18n-parity.contract.test.ts`), so a missing
translation is a build failure, not a review catch. ~60 new keys: nine tile titles and empty
states, edit mode, the drawer, the new-widget offer bar, error states — in `en`, `hu`, `de`, `es`,
`fr`, `tlh`.

The `title` → `titleKey` change in §3.1 exists for this reason. `PageRegistration.title`
(`src/core/types.ts:241`) has the same defect and is **not** touched here — backlog.

## 8. Testing

| Layer | Assertion |
|---|---|
| **Contract** (`tests/contracts/widgets.contract.test.ts`) | Every manifest-declared widget has a frontend component **and** vice versa. Follows `ws-topics.contract.test.ts` (215 lines), which bans one-sided wiring for topics. This is the only thing preventing the widget system from decaying into what `WidgetRegistration` is today. |
| **Backend** | Zod rejects unknown `i` shape, out-of-range geometry, and a `config` that isn't a plain object or exceeds the 4096-byte cap (no `configSchema` check — that schema is frontend-only, §5) · `DELETE` restores factory · disabled module's item survives in stored JSON but is absent from the response (D4) · raising `DEFAULT_LAYOUT` version produces an offer, never an insertion (D2). |
| **Component** (harness exists — `tests/web/scheduler-page.test.tsx`) | Grid renders the factory nine · edit mode reveals handles and drawer · add/remove persists · **a failing tile degrades itself, not the page** (per-tile error boundary). |
| **Hooks** | stale-while-revalidate leaves no empty flash · polling stops when the document is hidden or the tile scrolls out. |
| **i18n** | Covered by the existing parity contract. |

The per-tile error boundary is the load-bearing one: if `/costops/summary` returns 500, the Cost
tile must read "unavailable" while the other eight work. Without it, one module fault whites out
the application's landing page.

## 9. Dependency

`react-grid-layout@2.2.4` — **MIT**, peer `react >= 16.3.0` (satisfies React 19). Transitive:
`clsx`, `prop-types`, `fast-equals`, `react-draggable`, `react-resizable`,
`resize-observer-polyfill` — **all MIT**. No GPL/LGPL/AGPL in the chain; project licence policy
satisfied.

Rejected alternative: a dependency-free 12-column CSS grid with a per-tile "move up / move down /
width" menu. It reaches the same arrangements, but indirect rearrangement is rarely used, and an
unused customisation surface makes the whole grid pointless.

## 10. Backlog items surfaced (not in scope)

1. `scheduler` WS topic — job execution broadcasts nothing today (§4.3).
2. `PageRegistration.title` is an untranslated backend display string (§7).
3. Skills cannot be run from the UI: the `skills` module has no run endpoint (list / match /
   toggle only), so a RUBRIC-style "skill deck" tile with model + effort selection needs new
   backend surface first.

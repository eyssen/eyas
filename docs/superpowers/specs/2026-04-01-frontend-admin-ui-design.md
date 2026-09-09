# Frontend Infrastructure + Admin UI Design

> EYAS 1.0 — React 19 frontend with macOS-inspired design, setup wizard, and admin pages

## Decisions

| Question | Decision | Rationale |
|----------|----------|-----------|
| Scope | Single spec: infra + admin UI | Infra without pages is untestable; pages need infra |
| Component library | shadcn/ui (full install) | Consistent design system from day one |
| Layout | Sidebar (220px) + Top bar | Best of both: sidebar for nav, top bar for global actions |
| Design theme | macOS Sequoia style | Vibrancy material, 0.5px borders, generous spacing, Apple-like polish |
| Color modes | Dark + Light, user switchable | Dark default, light via toggle in top bar |
| Routing | TanStack Router | Type-safe, spec-required, file-based convention |
| State | Zustand | Lightweight, spec-required, perfect for auth state |
| API client | Custom fetch wrapper | Auth header injection, error handling, typed responses |

## Design Language

### macOS Sequoia Style

**Dark mode:**
- Background: deep navy gradient (`#0a0a14` → `#0e1020`)
- Sidebar + top bar: vibrancy material (`backdrop-filter: blur(30px)`, `rgba(20,20,40,0.7)`)
- Cards: frosted glass (`rgba(255,255,255,0.03)`, `border: 0.5px solid rgba(255,255,255,0.06)`)
- Border radius: 12px cards, 7px nav items, 8px inputs
- Accent: indigo (`#818cf8` / `#6366f1`)
- Active nav: left glow bar (3px, box-shadow)
- Typography: SF Pro Display feel — large bold titles (20px, -0.5px letter-spacing), generous spacing
- Section labels: uppercase, 10px, 0.5px letter-spacing, muted

**Light mode:**
- Background: soft gray gradient (`#f5f5f7` → `#ebebf0`)
- Sidebar + top bar: white vibrancy (`rgba(255,255,255,0.7)`, `backdrop-filter: blur(30px)`)
- Cards: white frosted glass with subtle shadow (`box-shadow: 0 1px 3px rgba(0,0,0,0.04)`)
- Accent: Apple system blue (`#007aff`)
- Same border radius, spacing, and typography as dark

### CSS Variable System

All colors defined as CSS custom properties in `globals.css`. shadcn/ui's theming system (HSL variables) adapted to our oklch/rgba values. The `dark` class on `<html>` toggles between modes.

### Logo

The eYssen wordmark logo (SVG) is used in the top bar. Two color variants:
- **Dark mode:** Red (`#c8102e`) + white (`#ffffff`) — red "e" and "ssen" strokes, white "Y" connector
- **Light mode:** Red (`#c8102e`) + dark gray (`#4a4a4a`) — red strokes, gray connector

The logo SVG is stored at `src/web/src/assets/eyssen-logo-dark.svg` and `eyssen-logo-light.svg`. The top bar switches between them based on the active theme. After the logo, "EYAS" text appears in semibold.

For the favicon: a simplified "E" from the logo in red (#c8102e) on transparent background.

## Layout Structure

```
┌──────────────────────────────────────────────────┐
│  Top Bar (48px)                                  │
│  [E EYAS]  [      ⌘K Search       ]  [◑ 🔔 👤]  │
├──────────┬───────────────────────────────────────┤
│ Sidebar  │  Main Content                         │
│ (220px)  │                                       │
│          │  Page Title                            │
│ NAV      │  Subtitle                              │
│ ─────    │                                       │
│ Dashboard│  ┌─────┐ ┌─────┐ ┌─────┐              │
│ Providers│  │Card │ │Card │ │Card │              │
│ Secrets  │  └─────┘ └─────┘ └─────┘              │
│ Users    │                                       │
│          │  ┌──────────────────────┐              │
│ PINNED   │  │ Content area         │              │
│ (later)  │  │                      │              │
│          │  └──────────────────────┘              │
│ ─────    │                                       │
│ Settings │                                       │
└──────────┴───────────────────────────────────────┘
```

### Top Bar Elements

| Position | Element | Notes |
|----------|---------|-------|
| Left | eYssen logo + "EYAS" | SVG wordmark (theme-aware) + semibold "EYAS" text |
| Center | Search bar | `⌘K` shortcut hint, placeholder text, cmdk integration later |
| Right | Theme toggle | ◑ icon, toggles dark/light |
| Right | Notifications | 🔔 icon, badge dot when active (later) |
| Right | User avatar | Initials in gradient circle, dropdown: profile, logout |

### Sidebar Elements

| Section | Items | Notes |
|---------|-------|-------|
| Navigation | Dashboard, Providers, Secrets, Users | Icon + label, active state with left glow bar |
| Pinned | (placeholder) | For pinned tasks, added later |
| Bottom | Settings | Separated by 0.5px border |

## Pages

### 1. Setup Wizard (`/setup`)

Full-screen, no sidebar/topbar. Centered card with step indicator.

**Steps (from backend API):**
1. Master Password — two password fields, min 8 chars validation
2. Root Owner — username, password, display name
3. First Agent — agent name

Each step: title, description, form fields, "Continue" button. Progress bar at top showing step N of M. On completion, redirect to login.

**Route guard:** If `GET /api/v1/setup/status` returns `complete: false`, redirect all routes to `/setup`.

### 2. Login (`/login`)

Centered card, no sidebar/topbar. Username + password fields, "Sign in" button. On success: store token in Zustand + localStorage, redirect to `/`.

**Route guard:** If no auth token, redirect to `/login`.

### 3. Dashboard (`/`)

Stats cards grid (4 columns): Providers, Models, Secrets, Users — each with count and status indicator.

Below: two-column layout:
- Left (2/3): Active Providers list with model counts, status dots
- Right (1/3): System info (version, status, uptime, setup status)

### 4. Providers (`/providers`)

List of all 4 provider slots (Anthropic, OpenAI, OpenRouter, Gemini).

Each provider card shows:
- Provider name and icon
- Status: active (green dot) / inactive (gray, "No API key")
- Model count if active
- "Configure" button → opens dialog

**Configure dialog:**
- API key field (password type, never shows stored value)
- "Save API Key" button → `POST /api/v1/secrets` with `name: '<provider>-api-key', scope: 'system'`
- "Remove API Key" button → `DELETE /api/v1/secrets/<provider>-api-key?scope=system`
- Note: provider activates on next server restart (or hot-reload later)

### 5. Secrets (`/secrets`)

Table view: name, scope, module, created date, actions.

**Features:**
- Filter by scope (system, user, agent)
- "Add Secret" button → dialog with name, scope dropdown, value (password field)
- Delete button per row (with confirmation)
- Value is NEVER displayed — only metadata

### 6. Users (`/users`)

Table view: username, display name, role, type (human/agent), status, created date.

**Features:**
- "Add User" / "Add Agent" buttons → dialog
- Role badge (owner, admin, user, agent)
- Status indicator (active/inactive)
- Edit button → dialog for display name, email, role

### 7. Settings (`/settings`)

Placeholder page for now. Will contain:
- System configuration
- Module enable/disable
- Theme customization
- Future: backup, security settings

For MVP: shows system info (version, config values) and dark/light mode preference.

## Technical Infrastructure

### File Structure

```
src/web/src/
  main.tsx                          ← Entry point
  app.tsx                           ← Router provider + theme provider
  globals.css                       ← CSS variables (dark + light themes)

  lib/
    utils.ts                        ← cn() helper (existing)
    api.ts                          ← API client (fetch wrapper)

  stores/
    auth-store.ts                   ← Zustand: token, user, login/logout
    theme-store.ts                  ← Zustand: dark/light mode

  hooks/
    use-api.ts                      ← useQuery-like hook for API calls
    use-setup-guard.ts              ← Redirect to /setup if not complete
    use-auth-guard.ts               ← Redirect to /login if not authenticated

  components/
    ui/                             ← shadcn/ui components (Button, Input, Card, etc.)
    layout/
      app-layout.tsx                ← Sidebar + Top bar + Main wrapper
      sidebar.tsx                   ← Navigation sidebar
      top-bar.tsx                   ← Top bar with search, theme, user menu
      theme-toggle.tsx              ← Dark/light mode switch
      user-menu.tsx                 ← Avatar dropdown (profile, logout)

  pages/
    setup/
      setup-page.tsx                ← Setup wizard (full-screen)
      setup-step.tsx                ← Individual step form
    login/
      login-page.tsx                ← Login form (full-screen)
    dashboard/
      dashboard-page.tsx            ← Stats + provider overview
    providers/
      providers-page.tsx            ← Provider list with configure dialogs
    secrets/
      secrets-page.tsx              ← Secrets table with CRUD
    users/
      users-page.tsx                ← User/agent management
    settings/
      settings-page.tsx             ← System settings (placeholder)

  routes/
    __root.tsx                      ← TanStack Router root
    index.tsx                       ← / → Dashboard
    setup.tsx                       ← /setup
    login.tsx                       ← /login
    providers.tsx                   ← /providers
    secrets.tsx                     ← /secrets
    users.tsx                       ← /users
    settings.tsx                    ← /settings
```

### API Client (`lib/api.ts`)

```typescript
interface ApiClient {
  get<T>(path: string): Promise<T>
  post<T>(path: string, body?: unknown): Promise<T>
  patch<T>(path: string, body?: unknown): Promise<T>
  delete<T>(path: string): Promise<T>
}
```

Features:
- Auto-injects `Authorization: Bearer <token>` from auth store
- Base URL from Vite env or `/api/v1` (Vite proxy handles in dev)
- JSON content type for all requests
- Error responses thrown as typed errors with status code and message
- 401 responses auto-clear auth store and redirect to login

### Auth Store (`stores/auth-store.ts`)

```typescript
interface AuthState {
  token: string | null
  user: { id: string; username: string; displayName: string; role: string } | null
  isAuthenticated: boolean
  login(username: string, password: string): Promise<void>
  logout(): void
  fetchMe(): Promise<void>
}
```

Token persisted in localStorage. On app init, if token exists, call `GET /api/v1/auth/me` to validate and fetch user info. If 401, clear token.

### Theme Store (`stores/theme-store.ts`)

```typescript
interface ThemeState {
  theme: 'dark' | 'light'
  toggle(): void
  set(theme: 'dark' | 'light'): void
}
```

Persisted in localStorage. Applies `dark` class on `<html>` element. Default: dark.

### Route Guards

**Setup guard:** Before any route renders, check `/api/v1/setup/status`. If `complete: false`, redirect to `/setup`. The setup page itself bypasses this check.

**Auth guard:** After setup check, if no valid token in auth store, redirect to `/login`. The login and setup pages bypass this check.

**Flow:**
```
App start → Setup complete? → No → /setup
                            → Yes → Token valid? → No → /login
                                                  → Yes → requested route
```

## Dependencies (frontend)

| Package | Purpose |
|---------|---------|
| `@tanstack/react-router` | Type-safe routing |
| `zustand` | State management (auth, theme) |
| `@radix-ui/*` | shadcn/ui primitives (multiple packages) |
| `class-variance-authority` | shadcn/ui variant styling |
| `cmdk` | Command palette (⌘K search, later) |

All are MIT-licensed.

shadcn/ui components (generated into `components/ui/`):
Button, Input, Card, Dialog, Label, Table, Badge, DropdownMenu, Toast, Tabs, Separator, Avatar, ScrollArea, Select

## Not In Scope

- Real-time WebSocket updates (Phase 9 expansion)
- Command palette search functionality (⌘K UI only, search later)
- Notification system (bell icon placeholder only)
- Pinned tasks in sidebar (placeholder only)
- User profile page
- Agent-specific settings pages
- Provider-specific settings pages (beyond API key)
- i18n (English only for now, Hungarian later)
- Mobile responsive (desktop-first)
- Vitest frontend tests (manual testing for now, frontend tests in later phase)

# Frontend Infrastructure + Admin UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a complete React 19 frontend with macOS Sequoia-inspired design, setup wizard, login, dashboard, and admin pages (providers, secrets, users, settings).

**Architecture:** TanStack Router for type-safe routing with setup/auth guards. Zustand for auth + theme state. Custom fetch-based API client with auto auth headers. shadcn/ui component library with macOS vibrancy material design. The frontend is a Vite SPA at `src/web/` that proxies API calls to the Bun backend on port 3000.

**Tech Stack:** React 19, TanStack Router, Zustand, shadcn/ui, Tailwind CSS v4, Vite 6, Lucide React icons

**Spec:** `docs/superpowers/specs/2026-04-01-frontend-admin-ui-design.md`

**Note:** The spec explicitly excludes frontend tests. Each task is verified by building successfully (`npm run build`) and visual inspection in the browser. No Vitest tests for frontend code.

---

## File Map

### New Files

| File | Responsibility |
|------|----------------|
| `src/web/src/lib/api.ts` | API client with auth header injection |
| `src/web/src/stores/auth-store.ts` | Zustand: token, user, login/logout |
| `src/web/src/stores/theme-store.ts` | Zustand: dark/light mode |
| `src/web/src/hooks/use-api.ts` | useQuery-like hook for data fetching |
| `src/web/src/components/layout/app-layout.tsx` | Sidebar + Top bar + Main wrapper |
| `src/web/src/components/layout/sidebar.tsx` | Navigation sidebar |
| `src/web/src/components/layout/top-bar.tsx` | Top bar (logo, search, theme, user) |
| `src/web/src/components/layout/theme-toggle.tsx` | Dark/light switch |
| `src/web/src/components/layout/user-menu.tsx` | Avatar dropdown |
| `src/web/src/components/ui/*.tsx` | shadcn/ui components (14 components) |
| `src/web/src/pages/setup/setup-page.tsx` | Setup wizard |
| `src/web/src/pages/setup/setup-step.tsx` | Individual step form |
| `src/web/src/pages/login/login-page.tsx` | Login form |
| `src/web/src/pages/dashboard/dashboard-page.tsx` | Stats + overview |
| `src/web/src/pages/providers/providers-page.tsx` | Provider management |
| `src/web/src/pages/secrets/secrets-page.tsx` | Secrets CRUD |
| `src/web/src/pages/users/users-page.tsx` | User management |
| `src/web/src/pages/settings/settings-page.tsx` | System settings |
| `src/web/src/routes/__root.tsx` | TanStack Router root |
| `src/web/src/routes/index.tsx` | / route |
| `src/web/src/routes/setup.tsx` | /setup route |
| `src/web/src/routes/login.tsx` | /login route |
| `src/web/src/routes/providers.tsx` | /providers route |
| `src/web/src/routes/secrets.tsx` | /secrets route |
| `src/web/src/routes/users.tsx` | /users route |
| `src/web/src/routes/settings.tsx` | /settings route |
| `src/web/src/assets/eyssen-logo-dark.svg` | Logo for dark mode |
| `src/web/src/assets/eyssen-logo-light.svg` | Logo for light mode |
| `src/web/components.json` | shadcn/ui configuration |

### Modified Files

| File | Change |
|------|--------|
| `src/web/package.json` | Add dependencies (TanStack Router, Zustand, shadcn/ui deps) |
| `src/web/src/globals.css` | Complete rewrite: macOS Sequoia dark/light theme variables |
| `src/web/src/app.tsx` | Replace with Router provider + theme init |
| `src/web/src/main.tsx` | Minor: add theme class init |
| `src/web/tsconfig.json` | Add TanStack Router plugin paths |
| `src/web/vite.config.ts` | Add TanStack Router Vite plugin |

### Deleted Files

| File | Reason |
|------|--------|
| `src/web/src/shell/layout.tsx` | Replaced by components/layout/ |
| `src/web/src/pages/home-page.tsx` | Replaced by pages/dashboard/ |
| `src/web/src/registry/ui-registry.ts` | Replaced by TanStack Router |

---

## Task 1: Install Dependencies + shadcn/ui Init

**Files:**
- Modify: `src/web/package.json`
- Create: `src/web/components.json`

- [ ] **Step 1: Install core dependencies**

```bash
cd /Users/eyssen/GitHub/eyas/src/web
bun add @tanstack/react-router @tanstack/react-router-devtools zustand
bun add class-variance-authority @radix-ui/react-slot
```

- [ ] **Step 2: Install shadcn/ui primitive dependencies**

These are the Radix primitives needed for the 14 shadcn/ui components:

```bash
cd /Users/eyssen/GitHub/eyas/src/web
bun add @radix-ui/react-dialog @radix-ui/react-dropdown-menu @radix-ui/react-label @radix-ui/react-select @radix-ui/react-separator @radix-ui/react-scroll-area @radix-ui/react-avatar @radix-ui/react-tabs @radix-ui/react-tooltip
bun add sonner
```

- [ ] **Step 3: Create shadcn components.json**

Create `src/web/components.json`:

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": false,
  "tsx": true,
  "tailwind": {
    "config": "",
    "css": "src/globals.css",
    "baseColor": "zinc",
    "cssVariables": true,
    "prefix": ""
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "hooks": "@/hooks"
  },
  "iconLibrary": "lucide"
}
```

- [ ] **Step 4: Generate shadcn/ui components**

```bash
cd /Users/eyssen/GitHub/eyas/src/web
bunx shadcn@latest add button input card dialog label separator badge scroll-area avatar tabs select dropdown-menu tooltip --yes
```

If shadcn CLI doesn't work with the current setup, manually create the components. The key ones we need immediately are Button, Input, Card, Dialog, Label, Badge, Separator.

- [ ] **Step 5: Verify build**

```bash
cd /Users/eyssen/GitHub/eyas/src/web && bun run build
```

- [ ] **Step 6: Commit**

```bash
cd /Users/eyssen/GitHub/eyas
git add src/web/package.json src/web/bun.lock src/web/components.json src/web/src/components/ui/
git commit -m "feat(web): install shadcn/ui, TanStack Router, Zustand dependencies"
```

---

## Task 2: Theme System (globals.css)

**Files:**
- Modify: `src/web/src/globals.css`

- [ ] **Step 1: Rewrite globals.css with macOS Sequoia theme**

Replace `src/web/src/globals.css` with the complete dark + light theme system. This must be compatible with shadcn/ui's CSS variable naming convention while implementing the macOS Sequoia design.

```css
@import "tailwindcss";

@layer base {
  :root {
    /* Light mode — macOS Sequoia Light */
    --background: 240 5% 96%;
    --foreground: 240 10% 4%;
    --card: 0 0% 100%;
    --card-foreground: 240 10% 4%;
    --popover: 0 0% 100%;
    --popover-foreground: 240 10% 4%;
    --primary: 215 100% 50%;
    --primary-foreground: 0 0% 100%;
    --secondary: 240 5% 92%;
    --secondary-foreground: 240 6% 10%;
    --muted: 240 5% 92%;
    --muted-foreground: 240 4% 46%;
    --accent: 240 5% 92%;
    --accent-foreground: 240 6% 10%;
    --destructive: 0 84% 60%;
    --destructive-foreground: 0 0% 100%;
    --border: 240 6% 90%;
    --input: 240 6% 90%;
    --ring: 215 100% 50%;
    --radius: 0.75rem;

    /* Vibrancy material — light */
    --vibrancy-bg: rgba(255, 255, 255, 0.7);
    --vibrancy-border: rgba(0, 0, 0, 0.08);
    --card-glass: rgba(255, 255, 255, 0.7);
    --card-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
    --nav-active-bg: rgba(0, 122, 255, 0.1);
    --nav-active-color: hsl(215, 100%, 50%);
    --nav-active-glow: rgba(0, 122, 255, 0.4);
    --gradient-bg: linear-gradient(180deg, #f5f5f7 0%, #ebebf0 100%);
  }

  .dark {
    /* Dark mode — macOS Sequoia Dark */
    --background: 230 30% 5%;
    --foreground: 0 0% 98%;
    --card: 230 25% 8%;
    --card-foreground: 0 0% 98%;
    --popover: 230 25% 8%;
    --popover-foreground: 0 0% 98%;
    --primary: 239 84% 67%;
    --primary-foreground: 0 0% 100%;
    --secondary: 230 20% 12%;
    --secondary-foreground: 0 0% 98%;
    --muted: 230 20% 12%;
    --muted-foreground: 230 10% 50%;
    --accent: 230 20% 12%;
    --accent-foreground: 0 0% 98%;
    --destructive: 0 63% 31%;
    --destructive-foreground: 0 0% 98%;
    --border: 230 15% 15%;
    --input: 230 15% 15%;
    --ring: 239 84% 67%;

    /* Vibrancy material — dark */
    --vibrancy-bg: rgba(20, 20, 40, 0.7);
    --vibrancy-border: rgba(255, 255, 255, 0.06);
    --card-glass: rgba(255, 255, 255, 0.03);
    --card-shadow: none;
    --nav-active-bg: rgba(129, 140, 248, 0.1);
    --nav-active-color: hsl(239, 84%, 67%);
    --nav-active-glow: rgba(129, 140, 248, 0.4);
    --gradient-bg: linear-gradient(180deg, #0a0a14 0%, #0e1020 100%);
  }
}

@layer base {
  * {
    border-color: hsl(var(--border));
  }

  body {
    background: var(--gradient-bg);
    color: hsl(var(--foreground));
    font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', system-ui, sans-serif;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }
}

/* Vibrancy utilities */
.vibrancy {
  background: var(--vibrancy-bg);
  backdrop-filter: blur(30px);
  -webkit-backdrop-filter: blur(30px);
}

.glass-card {
  background: var(--card-glass);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  border: 0.5px solid var(--vibrancy-border);
  border-radius: var(--radius);
  box-shadow: var(--card-shadow);
}

/* Apple-style section labels */
.section-label {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.5px;
  text-transform: uppercase;
  color: hsl(var(--muted-foreground));
}

/* Large title (Apple HIG) */
.page-title {
  font-size: 20px;
  font-weight: 700;
  letter-spacing: -0.5px;
  color: hsl(var(--foreground));
}

/* Active nav item glow bar */
.nav-active {
  position: relative;
}
.nav-active::before {
  content: '';
  position: absolute;
  left: 0;
  top: 6px;
  bottom: 6px;
  width: 3px;
  background: var(--nav-active-color);
  border-radius: 0 2px 2px 0;
  box-shadow: 0 0 8px var(--nav-active-glow);
}
```

- [ ] **Step 2: Verify build**

```bash
cd /Users/eyssen/GitHub/eyas/src/web && bun run build
```

- [ ] **Step 3: Commit**

```bash
cd /Users/eyssen/GitHub/eyas
git add src/web/src/globals.css
git commit -m "feat(web): add macOS Sequoia dark/light theme system"
```

---

## Task 3: API Client + Stores

**Files:**
- Create: `src/web/src/lib/api.ts`
- Create: `src/web/src/stores/auth-store.ts`
- Create: `src/web/src/stores/theme-store.ts`
- Create: `src/web/src/hooks/use-api.ts`

- [ ] **Step 1: Create API client**

Create `src/web/src/lib/api.ts`:

```typescript
export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
    this.name = 'ApiError'
  }
}

function getToken(): string | null {
  return localStorage.getItem('eyas-token')
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  const token = getToken()
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  const res = await fetch(`/api/v1${path}`, {
    method,
    headers,
    ...(body !== undefined && { body: JSON.stringify(body) }),
  })

  if (res.status === 401) {
    localStorage.removeItem('eyas-token')
    localStorage.removeItem('eyas-user')
    window.location.href = '/login'
    throw new ApiError(401, 'Unauthorized')
  }

  const data = await res.json()
  if (!res.ok) {
    throw new ApiError(res.status, data.error || res.statusText)
  }
  return data as T
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  delete: <T>(path: string) => request<T>('DELETE', path),
}
```

- [ ] **Step 2: Create auth store**

Create `src/web/src/stores/auth-store.ts`:

```typescript
import { create } from 'zustand'
import { api, ApiError } from '@/lib/api'

interface User {
  id: string
  username: string
  displayName: string
  role: string
  isAgent: boolean
}

interface AuthState {
  token: string | null
  user: User | null
  isAuthenticated: boolean
  isLoading: boolean
  login: (username: string, password: string) => Promise<void>
  logout: () => void
  fetchMe: () => Promise<void>
  init: () => Promise<void>
}

export const useAuthStore = create<AuthState>((set, get) => ({
  token: localStorage.getItem('eyas-token'),
  user: null,
  isAuthenticated: false,
  isLoading: true,

  login: async (username: string, password: string) => {
    const data = await api.post<{ accessToken: string }>('/auth/token', { username, password })
    localStorage.setItem('eyas-token', data.accessToken)
    set({ token: data.accessToken })
    await get().fetchMe()
  },

  logout: () => {
    localStorage.removeItem('eyas-token')
    localStorage.removeItem('eyas-user')
    set({ token: null, user: null, isAuthenticated: false })
    window.location.href = '/login'
  },

  fetchMe: async () => {
    try {
      const data = await api.get<{ user: User }>('/auth/me')
      set({ user: data.user, isAuthenticated: true, isLoading: false })
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        set({ token: null, user: null, isAuthenticated: false, isLoading: false })
      }
    }
  },

  init: async () => {
    const token = localStorage.getItem('eyas-token')
    if (token) {
      await get().fetchMe()
    } else {
      set({ isLoading: false })
    }
  },
}))
```

- [ ] **Step 3: Create theme store**

Create `src/web/src/stores/theme-store.ts`:

```typescript
import { create } from 'zustand'

type Theme = 'dark' | 'light'

interface ThemeState {
  theme: Theme
  toggle: () => void
  set: (theme: Theme) => void
}

function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark')
  localStorage.setItem('eyas-theme', theme)
}

const stored = localStorage.getItem('eyas-theme') as Theme | null
const initial: Theme = stored || 'dark'

export const useThemeStore = create<ThemeState>((set) => ({
  theme: initial,
  toggle: () =>
    set((state) => {
      const next = state.theme === 'dark' ? 'light' : 'dark'
      applyTheme(next)
      return { theme: next }
    }),
  set: (theme: Theme) => {
    applyTheme(theme)
    set({ theme })
  },
}))
```

- [ ] **Step 4: Create useApi hook**

Create `src/web/src/hooks/use-api.ts`:

```typescript
import { useState, useEffect, useCallback } from 'react'
import { api, ApiError } from '@/lib/api'

interface UseApiResult<T> {
  data: T | null
  error: ApiError | null
  isLoading: boolean
  refetch: () => void
}

export function useApi<T>(path: string): UseApiResult<T> {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [trigger, setTrigger] = useState(0)

  const refetch = useCallback(() => setTrigger((t) => t + 1), [])

  useEffect(() => {
    let cancelled = false
    setIsLoading(true)
    api
      .get<T>(path)
      .then((d) => {
        if (!cancelled) {
          setData(d)
          setError(null)
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof ApiError ? e : new ApiError(0, String(e)))
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [path, trigger])

  return { data, error, isLoading, refetch }
}
```

- [ ] **Step 5: Verify build**

```bash
cd /Users/eyssen/GitHub/eyas/src/web && bun run build
```

- [ ] **Step 6: Commit**

```bash
cd /Users/eyssen/GitHub/eyas
git add src/web/src/lib/api.ts src/web/src/stores/ src/web/src/hooks/
git commit -m "feat(web): add API client, auth store, theme store, and useApi hook"
```

---

## Task 4: TanStack Router Setup + Route Guards

**Files:**
- Create: `src/web/src/routes/__root.tsx`
- Create: `src/web/src/routes/index.tsx`
- Create: `src/web/src/routes/setup.tsx`
- Create: `src/web/src/routes/login.tsx`
- Create: `src/web/src/routes/providers.tsx`
- Create: `src/web/src/routes/secrets.tsx`
- Create: `src/web/src/routes/users.tsx`
- Create: `src/web/src/routes/settings.tsx`
- Modify: `src/web/src/app.tsx`
- Modify: `src/web/src/main.tsx`
- Delete: `src/web/src/shell/layout.tsx`
- Delete: `src/web/src/pages/home-page.tsx`
- Delete: `src/web/src/registry/ui-registry.ts`

- [ ] **Step 1: Create root route with setup/auth guards**

Create `src/web/src/routes/__root.tsx`:

```typescript
import { createRootRoute, Outlet, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'

function RootComponent() {
  const navigate = useNavigate()
  const { isAuthenticated, isLoading, init } = useAuthStore()
  const [setupComplete, setSetupComplete] = useState<boolean | null>(null)

  useEffect(() => {
    api
      .get<{ complete: boolean }>('/setup/status')
      .then((d) => setSetupComplete(d.complete))
      .catch(() => setSetupComplete(null))
  }, [])

  useEffect(() => {
    init()
  }, [init])

  useEffect(() => {
    if (setupComplete === null || isLoading) return
    const path = window.location.pathname

    if (!setupComplete && path !== '/setup') {
      navigate({ to: '/setup' })
      return
    }
    if (setupComplete && !isAuthenticated && path !== '/login' && path !== '/setup') {
      navigate({ to: '/login' })
    }
  }, [setupComplete, isAuthenticated, isLoading, navigate])

  if (setupComplete === null || isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-muted-foreground text-sm">Loading...</div>
      </div>
    )
  }

  return <Outlet />
}

export const Route = createRootRoute({
  component: RootComponent,
})
```

- [ ] **Step 2: Create route files**

Create `src/web/src/routes/index.tsx`:

```typescript
import { createFileRoute } from '@tanstack/react-router'
import { AppLayout } from '@/components/layout/app-layout'
import DashboardPage from '@/pages/dashboard/dashboard-page'

export const Route = createFileRoute('/')({
  component: () => (
    <AppLayout>
      <DashboardPage />
    </AppLayout>
  ),
})
```

Create `src/web/src/routes/setup.tsx`:

```typescript
import { createFileRoute } from '@tanstack/react-router'
import SetupPage from '@/pages/setup/setup-page'

export const Route = createFileRoute('/setup')({
  component: SetupPage,
})
```

Create `src/web/src/routes/login.tsx`:

```typescript
import { createFileRoute } from '@tanstack/react-router'
import LoginPage from '@/pages/login/login-page'

export const Route = createFileRoute('/login')({
  component: LoginPage,
})
```

Create `src/web/src/routes/providers.tsx`:

```typescript
import { createFileRoute } from '@tanstack/react-router'
import { AppLayout } from '@/components/layout/app-layout'
import ProvidersPage from '@/pages/providers/providers-page'

export const Route = createFileRoute('/providers')({
  component: () => (
    <AppLayout>
      <ProvidersPage />
    </AppLayout>
  ),
})
```

Create `src/web/src/routes/secrets.tsx`:

```typescript
import { createFileRoute } from '@tanstack/react-router'
import { AppLayout } from '@/components/layout/app-layout'
import SecretsPage from '@/pages/secrets/secrets-page'

export const Route = createFileRoute('/secrets')({
  component: () => (
    <AppLayout>
      <SecretsPage />
    </AppLayout>
  ),
})
```

Create `src/web/src/routes/users.tsx`:

```typescript
import { createFileRoute } from '@tanstack/react-router'
import { AppLayout } from '@/components/layout/app-layout'
import UsersPage from '@/pages/users/users-page'

export const Route = createFileRoute('/users')({
  component: () => (
    <AppLayout>
      <UsersPage />
    </AppLayout>
  ),
})
```

Create `src/web/src/routes/settings.tsx`:

```typescript
import { createFileRoute } from '@tanstack/react-router'
import { AppLayout } from '@/components/layout/app-layout'
import SettingsPage from '@/pages/settings/settings-page'

export const Route = createFileRoute('/settings')({
  component: () => (
    <AppLayout>
      <SettingsPage />
    </AppLayout>
  ),
})
```

- [ ] **Step 3: Create route tree**

Create `src/web/src/routes/routeTree.gen.ts` (this is normally auto-generated by TanStack Router, but we create it manually for now):

```typescript
import { Route as rootRoute } from './__root'
import { Route as indexRoute } from './index'
import { Route as setupRoute } from './setup'
import { Route as loginRoute } from './login'
import { Route as providersRoute } from './providers'
import { Route as secretsRoute } from './secrets'
import { Route as usersRoute } from './users'
import { Route as settingsRoute } from './settings'

const routeTree = rootRoute.addChildren([
  indexRoute,
  setupRoute,
  loginRoute,
  providersRoute,
  secretsRoute,
  usersRoute,
  settingsRoute,
])

export { routeTree }
```

- [ ] **Step 4: Update app.tsx**

Replace `src/web/src/app.tsx`:

```typescript
import { RouterProvider, createRouter } from '@tanstack/react-router'
import { routeTree } from '@/routes/routeTree.gen'
import { useThemeStore } from '@/stores/theme-store'
import { useEffect } from 'react'

const router = createRouter({ routeTree })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

export function App() {
  const { theme } = useThemeStore()

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
  }, [theme])

  return <RouterProvider router={router} />
}
```

- [ ] **Step 5: Delete old files**

```bash
rm -f /Users/eyssen/GitHub/eyas/src/web/src/shell/layout.tsx
rm -f /Users/eyssen/GitHub/eyas/src/web/src/pages/home-page.tsx
rm -f /Users/eyssen/GitHub/eyas/src/web/src/registry/ui-registry.ts
rmdir /Users/eyssen/GitHub/eyas/src/web/src/shell/ 2>/dev/null || true
rmdir /Users/eyssen/GitHub/eyas/src/web/src/registry/ 2>/dev/null || true
```

- [ ] **Step 6: Create placeholder pages (so routes resolve)**

Create minimal placeholder for each page that will be implemented in later tasks. Each file exports a default component with just a page title.

`src/web/src/pages/dashboard/dashboard-page.tsx`:
```typescript
export default function DashboardPage() {
  return <div className="page-title">Dashboard</div>
}
```

`src/web/src/pages/setup/setup-page.tsx`:
```typescript
export default function SetupPage() {
  return <div className="flex h-screen items-center justify-center"><div className="page-title">Setup Wizard</div></div>
}
```

`src/web/src/pages/login/login-page.tsx`:
```typescript
export default function LoginPage() {
  return <div className="flex h-screen items-center justify-center"><div className="page-title">Login</div></div>
}
```

`src/web/src/pages/providers/providers-page.tsx`:
```typescript
export default function ProvidersPage() {
  return <div className="page-title">Providers</div>
}
```

`src/web/src/pages/secrets/secrets-page.tsx`:
```typescript
export default function SecretsPage() {
  return <div className="page-title">Secrets</div>
}
```

`src/web/src/pages/users/users-page.tsx`:
```typescript
export default function UsersPage() {
  return <div className="page-title">Users</div>
}
```

`src/web/src/pages/settings/settings-page.tsx`:
```typescript
export default function SettingsPage() {
  return <div className="page-title">Settings</div>
}
```

- [ ] **Step 7: Create placeholder layout**

Create `src/web/src/components/layout/app-layout.tsx`:

```typescript
import type { ReactNode } from 'react'

export function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-screen">
      <aside className="w-[220px] vibrancy border-r border-[var(--vibrancy-border)] p-3">
        <div className="section-label p-2">NAVIGATION</div>
        <div className="text-sm text-muted-foreground p-2">Sidebar (Task 5)</div>
      </aside>
      <div className="flex flex-1 flex-col">
        <header className="h-12 vibrancy border-b border-[var(--vibrancy-border)] flex items-center px-4">
          <span className="text-sm text-muted-foreground">Top bar (Task 5)</span>
        </header>
        <main className="flex-1 overflow-auto p-6">{children}</main>
      </div>
    </div>
  )
}
```

- [ ] **Step 8: Verify build + dev server**

```bash
cd /Users/eyssen/GitHub/eyas/src/web && bun run build
```

Start dev: `cd /Users/eyssen/GitHub/eyas/src/web && bun run dev` — verify routing works at localhost:5173.

- [ ] **Step 9: Commit**

```bash
cd /Users/eyssen/GitHub/eyas
git add src/web/src/routes/ src/web/src/app.tsx src/web/src/main.tsx src/web/src/pages/ src/web/src/components/layout/
git rm src/web/src/shell/layout.tsx src/web/src/pages/home-page.tsx src/web/src/registry/ui-registry.ts 2>/dev/null || true
git add -A src/web/
git commit -m "feat(web): add TanStack Router with route guards and placeholder pages"
```

---

## Task 5: Layout Shell (Sidebar + Top Bar)

**Files:**
- Modify: `src/web/src/components/layout/app-layout.tsx`
- Create: `src/web/src/components/layout/sidebar.tsx`
- Create: `src/web/src/components/layout/top-bar.tsx`
- Create: `src/web/src/components/layout/theme-toggle.tsx`
- Create: `src/web/src/components/layout/user-menu.tsx`
- Create: `src/web/src/assets/eyssen-logo-dark.svg`
- Create: `src/web/src/assets/eyssen-logo-light.svg`

- [ ] **Step 1: Create logo SVG placeholders**

Create `src/web/src/assets/eyssen-logo-dark.svg` and `eyssen-logo-light.svg`. These will be SVG versions of the eYssen wordmark. For now create simple text-based placeholders that the user can replace with the actual logo files later.

`src/web/src/assets/eyssen-logo-dark.svg`:
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 24" fill="none">
  <text x="0" y="18" font-family="-apple-system, system-ui, sans-serif" font-size="16" font-weight="700">
    <tspan fill="#c8102e">e</tspan><tspan fill="#ffffff">Y</tspan><tspan fill="#c8102e">ssen</tspan>
  </text>
</svg>
```

`src/web/src/assets/eyssen-logo-light.svg`:
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 24" fill="none">
  <text x="0" y="18" font-family="-apple-system, system-ui, sans-serif" font-size="16" font-weight="700">
    <tspan fill="#c8102e">e</tspan><tspan fill="#4a4a4a">Y</tspan><tspan fill="#c8102e">ssen</tspan>
  </text>
</svg>
```

- [ ] **Step 2: Create theme-toggle component**

Create `src/web/src/components/layout/theme-toggle.tsx`:

```typescript
import { Moon, Sun } from 'lucide-react'
import { useThemeStore } from '@/stores/theme-store'
import { Button } from '@/components/ui/button'

export function ThemeToggle() {
  const { theme, toggle } = useThemeStore()
  return (
    <Button variant="ghost" size="icon" onClick={toggle} className="h-8 w-8 text-muted-foreground hover:text-foreground">
      {theme === 'dark' ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
    </Button>
  )
}
```

- [ ] **Step 3: Create user-menu component**

Create `src/web/src/components/layout/user-menu.tsx`:

```typescript
import { LogOut, User } from 'lucide-react'
import { useAuthStore } from '@/stores/auth-store'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

export function UserMenu() {
  const { user, logout } = useAuthStore()
  if (!user) return null

  const initials = user.displayName
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="h-7 w-7 rounded-full bg-gradient-to-br from-primary to-primary/80 flex items-center justify-center text-[10px] font-semibold text-primary-foreground focus:outline-none focus:ring-2 focus:ring-ring">
          {initials}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <div className="px-2 py-1.5">
          <p className="text-sm font-medium">{user.displayName}</p>
          <p className="text-xs text-muted-foreground">{user.role}</p>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={logout} className="text-destructive focus:text-destructive">
          <LogOut className="mr-2 h-4 w-4" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
```

- [ ] **Step 4: Create top-bar component**

Create `src/web/src/components/layout/top-bar.tsx`:

```typescript
import { Search, Bell } from 'lucide-react'
import { ThemeToggle } from './theme-toggle'
import { UserMenu } from './user-menu'
import { useThemeStore } from '@/stores/theme-store'
import logoDark from '@/assets/eyssen-logo-dark.svg'
import logoLight from '@/assets/eyssen-logo-light.svg'

export function TopBar() {
  const { theme } = useThemeStore()

  return (
    <header className="h-12 vibrancy border-b border-[var(--vibrancy-border)] flex items-center px-4 gap-4 flex-shrink-0">
      {/* Left: Logo */}
      <div className="w-[204px] flex items-center gap-2 border-r border-[var(--vibrancy-border)] pr-4">
        <img src={theme === 'dark' ? logoDark : logoLight} alt="eYssen" className="h-5" />
        <span className="text-sm font-semibold text-foreground">EYAS</span>
      </div>

      {/* Center: Search */}
      <div className="flex-1 flex justify-center">
        <button className="flex items-center gap-2 bg-accent/50 border border-input rounded-lg px-4 py-1.5 w-[320px] max-w-full text-muted-foreground text-sm hover:bg-accent transition-colors">
          <Search className="h-3.5 w-3.5" />
          <span>Search...</span>
          <kbd className="ml-auto text-[10px] bg-background/50 px-1.5 py-0.5 rounded border border-border">⌘K</kbd>
        </button>
      </div>

      {/* Right: Actions */}
      <div className="flex items-center gap-2">
        <ThemeToggle />
        <button className="h-8 w-8 flex items-center justify-center text-muted-foreground hover:text-foreground rounded-md transition-colors relative">
          <Bell className="h-4 w-4" />
        </button>
        <UserMenu />
      </div>
    </header>
  )
}
```

- [ ] **Step 5: Create sidebar component**

Create `src/web/src/components/layout/sidebar.tsx`:

```typescript
import { Link, useLocation } from '@tanstack/react-router'
import { LayoutDashboard, Bot, KeyRound, Users, Settings } from 'lucide-react'
import { cn } from '@/lib/utils'

const navItems = [
  { path: '/', label: 'Dashboard', icon: LayoutDashboard },
  { path: '/providers', label: 'Providers', icon: Bot },
  { path: '/secrets', label: 'Secrets', icon: KeyRound },
  { path: '/users', label: 'Users', icon: Users },
] as const

export function Sidebar() {
  const location = useLocation()

  return (
    <aside className="w-[220px] vibrancy border-r border-[var(--vibrancy-border)] flex flex-col flex-shrink-0">
      <nav className="flex-1 p-2 pt-3 flex flex-col gap-0.5">
        <div className="section-label px-3 mb-1">Navigation</div>
        {navItems.map((item) => {
          const isActive = location.pathname === item.path
          return (
            <Link
              key={item.path}
              to={item.path}
              className={cn(
                'flex items-center gap-2 px-3 py-2 rounded-[7px] text-[13px] transition-colors relative',
                isActive
                  ? 'bg-[var(--nav-active-bg)] text-foreground font-medium nav-active'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
              )}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </Link>
          )
        })}

        {/* Pinned section placeholder */}
        <div className="section-label px-3 mt-6 mb-1">Pinned</div>
        <div className="px-3 py-2 text-xs text-muted-foreground/50 border border-dashed border-border/50 rounded-[7px] text-center">
          Tasks later...
        </div>
      </nav>

      {/* Bottom: Settings */}
      <div className="p-2 border-t border-[var(--vibrancy-border)]">
        <Link
          to="/settings"
          className={cn(
            'flex items-center gap-2 px-3 py-2 rounded-[7px] text-[13px] transition-colors',
            location.pathname === '/settings'
              ? 'bg-[var(--nav-active-bg)] text-foreground font-medium'
              : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
          )}
        >
          <Settings className="h-4 w-4" />
          Settings
        </Link>
      </div>
    </aside>
  )
}
```

- [ ] **Step 6: Update app-layout**

Replace `src/web/src/components/layout/app-layout.tsx`:

```typescript
import type { ReactNode } from 'react'
import { Sidebar } from './sidebar'
import { TopBar } from './top-bar'

export function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-screen flex-col">
      <TopBar />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex-1 overflow-auto p-6">{children}</main>
      </div>
    </div>
  )
}
```

- [ ] **Step 7: Verify in browser**

```bash
cd /Users/eyssen/GitHub/eyas/src/web && bun run dev
```

Open localhost:5173 — verify sidebar + top bar render correctly in dark mode. Toggle dark/light should work.

- [ ] **Step 8: Commit**

```bash
cd /Users/eyssen/GitHub/eyas
git add src/web/src/components/layout/ src/web/src/assets/
git commit -m "feat(web): add macOS Sequoia layout shell with sidebar, top bar, theme toggle"
```

---

## Task 6: Setup Wizard Page

**Files:**
- Modify: `src/web/src/pages/setup/setup-page.tsx`
- Create: `src/web/src/pages/setup/setup-step.tsx`

- [ ] **Step 1: Create setup step form component**

Create `src/web/src/pages/setup/setup-step.tsx`:

```typescript
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface StepField {
  name: string
  type: string
  label: string
  required: boolean
  placeholder?: string
}

interface SetupStepProps {
  step: { id: string; title: string; description: string; fields: StepField[] }
  onSubmit: (data: Record<string, string>) => Promise<void>
  isLast: boolean
}

export function SetupStep({ step, onSubmit, isLast }: SetupStepProps) {
  const [values, setValues] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await onSubmit(values)
    } catch (err: any) {
      setError(err.message || 'An error occurred')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">{step.title}</h2>
        <p className="text-sm text-muted-foreground">{step.description}</p>
      </div>

      {step.fields.map((field) => (
        <div key={field.name} className="space-y-1.5">
          <Label htmlFor={field.name}>{field.label}</Label>
          <Input
            id={field.name}
            type={field.type === 'password' ? 'password' : 'text'}
            placeholder={field.placeholder}
            required={field.required}
            value={values[field.name] || ''}
            onChange={(e) => setValues((v) => ({ ...v, [field.name]: e.target.value }))}
          />
        </div>
      ))}

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button type="submit" disabled={loading} className="w-full">
        {loading ? 'Please wait...' : isLast ? 'Complete Setup' : 'Continue'}
      </Button>
    </form>
  )
}
```

- [ ] **Step 2: Implement setup page**

Replace `src/web/src/pages/setup/setup-page.tsx`:

```typescript
import { useEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { api } from '@/lib/api'
import { SetupStep } from './setup-step'
import { Card, CardContent } from '@/components/ui/card'
import { useThemeStore } from '@/stores/theme-store'
import logoDark from '@/assets/eyssen-logo-dark.svg'
import logoLight from '@/assets/eyssen-logo-light.svg'

interface Step {
  id: string
  title: string
  description: string
  required: boolean
  order: number
  status: string
  fields: { name: string; type: string; label: string; required: boolean; placeholder?: string }[]
}

export default function SetupPage() {
  const navigate = useNavigate()
  const { theme } = useThemeStore()
  const [steps, setSteps] = useState<Step[]>([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.get<{ steps: Step[] }>('/setup/steps').then((d) => {
      const pending = d.steps.filter((s) => s.status === 'pending')
      setSteps(pending)
      setLoading(false)
    })
  }, [])

  const handleStepSubmit = async (data: Record<string, string>) => {
    const step = steps[currentIndex]
    await api.post(`/setup/steps/${step.id}`, data)

    if (currentIndex < steps.length - 1) {
      setCurrentIndex((i) => i + 1)
    } else {
      navigate({ to: '/login' })
    }
  }

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-muted-foreground text-sm">Loading setup...</div>
      </div>
    )
  }

  const currentStep = steps[currentIndex]
  if (!currentStep) {
    navigate({ to: '/login' })
    return null
  }

  return (
    <div className="flex h-screen items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6">
        {/* Logo */}
        <div className="flex items-center justify-center gap-2">
          <img src={theme === 'dark' ? logoDark : logoLight} alt="eYssen" className="h-6" />
          <span className="text-lg font-semibold">EYAS</span>
        </div>

        {/* Progress */}
        <div className="flex gap-1">
          {steps.map((_, i) => (
            <div
              key={i}
              className={`h-1 flex-1 rounded-full transition-colors ${
                i <= currentIndex ? 'bg-primary' : 'bg-muted'
              }`}
            />
          ))}
        </div>

        <p className="text-center text-xs text-muted-foreground">
          Step {currentIndex + 1} of {steps.length}
        </p>

        {/* Step form */}
        <Card className="glass-card">
          <CardContent className="pt-6">
            <SetupStep
              step={currentStep}
              onSubmit={handleStepSubmit}
              isLast={currentIndex === steps.length - 1}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Verify in browser**

Start backend: `bun src/main.ts` (fresh DB). Start frontend: `cd src/web && bun run dev`. Navigate to localhost:5173 — should redirect to /setup and show the master password step.

- [ ] **Step 4: Commit**

```bash
cd /Users/eyssen/GitHub/eyas
git add src/web/src/pages/setup/
git commit -m "feat(web): add setup wizard with multi-step form"
```

---

## Task 7: Login Page

**Files:**
- Modify: `src/web/src/pages/login/login-page.tsx`

- [ ] **Step 1: Implement login page**

Replace `src/web/src/pages/login/login-page.tsx`:

```typescript
import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useAuthStore } from '@/stores/auth-store'
import { useThemeStore } from '@/stores/theme-store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import logoDark from '@/assets/eyssen-logo-dark.svg'
import logoLight from '@/assets/eyssen-logo-light.svg'

export default function LoginPage() {
  const navigate = useNavigate()
  const { login } = useAuthStore()
  const { theme } = useThemeStore()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await login(username, password)
      navigate({ to: '/' })
    } catch (err: any) {
      setError(err.message || 'Invalid credentials')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex items-center justify-center gap-2">
          <img src={theme === 'dark' ? logoDark : logoLight} alt="eYssen" className="h-6" />
          <span className="text-lg font-semibold">EYAS</span>
        </div>

        <Card className="glass-card">
          <CardContent className="pt-6">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="text-center mb-4">
                <h2 className="text-lg font-semibold">Sign in</h2>
                <p className="text-sm text-muted-foreground">Enter your credentials to continue</p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="username">Username</Label>
                <Input
                  id="username"
                  type="text"
                  placeholder="admin"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoFocus
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>

              {error && <p className="text-sm text-destructive">{error}</p>}

              <Button type="submit" disabled={loading} className="w-full">
                {loading ? 'Signing in...' : 'Sign in'}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
cd /Users/eyssen/GitHub/eyas
git add src/web/src/pages/login/
git commit -m "feat(web): add login page with auth store integration"
```

---

## Task 8: Dashboard Page

**Files:**
- Modify: `src/web/src/pages/dashboard/dashboard-page.tsx`

- [ ] **Step 1: Implement dashboard**

Replace `src/web/src/pages/dashboard/dashboard-page.tsx`:

```typescript
import { useApi } from '@/hooks/use-api'
import { LayoutDashboard, Bot, KeyRound, Users } from 'lucide-react'

interface Provider {
  id: string
  name: string
  modelCount: number
}

interface HealthResponse {
  status: string
  version: string
  timestamp: string
}

export default function DashboardPage() {
  const { data: providerData } = useApi<{ providers: Provider[] }>('/model/providers')
  const { data: modelData } = useApi<{ models: unknown[] }>('/model/models')
  const { data: secretData } = useApi<{ secrets: unknown[] }>('/secrets?scope=system')
  const { data: userData } = useApi<{ users: unknown[] }>('/users')
  const { data: health } = useApi<HealthResponse>('/health')

  const providers = providerData?.providers || []
  const modelCount = modelData?.models?.length || 0
  const secretCount = secretData?.secrets?.length || 0
  const userCount = userData?.users?.length || 0

  const stats = [
    { label: 'Providers', value: providers.length, sub: providers.length > 0 ? '● active' : 'None active', subColor: providers.length > 0 ? 'text-emerald-500' : 'text-muted-foreground', icon: Bot },
    { label: 'Models', value: modelCount, sub: 'Available', subColor: 'text-muted-foreground', icon: LayoutDashboard },
    { label: 'Secrets', value: secretCount, sub: '🔒 Encrypted', subColor: 'text-purple-400', icon: KeyRound },
    { label: 'Users', value: userCount, sub: 'Registered', subColor: 'text-muted-foreground', icon: Users },
  ]

  return (
    <div>
      <h1 className="page-title">Dashboard</h1>
      <p className="text-sm text-muted-foreground mb-5">System overview</p>

      {/* Stats grid */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        {stats.map((stat) => (
          <div key={stat.label} className="glass-card p-4 relative overflow-hidden">
            <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-primary/30 to-transparent" />
            <div className="section-label">{stat.label}</div>
            <div className="text-[28px] font-bold tracking-tight mt-1">{stat.value}</div>
            <div className={`text-[10px] mt-1 font-medium ${stat.subColor}`}>{stat.sub}</div>
          </div>
        ))}
      </div>

      {/* Two-column content */}
      <div className="grid grid-cols-3 gap-4">
        {/* Active Providers */}
        <div className="col-span-2 glass-card p-4">
          <h3 className="text-sm font-semibold mb-3">Active Providers</h3>
          {providers.length === 0 ? (
            <p className="text-sm text-muted-foreground">No providers active. Add API keys in Providers settings.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {providers.map((p) => (
                <div key={p.id} className="flex items-center gap-3 p-2 rounded-lg bg-accent/30">
                  <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(52,211,153,0.5)]" />
                  <span className="text-sm flex-1">{p.name}</span>
                  <span className="text-xs text-muted-foreground">{p.modelCount} models</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* System info */}
        <div className="glass-card p-4">
          <h3 className="text-sm font-semibold mb-3">System</h3>
          <div className="flex flex-col gap-2 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Version</span><span>{health?.version || '—'}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Status</span><span className="text-emerald-500">● {health?.status || 'unknown'}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Providers</span><span>{providers.length} active</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Models</span><span>{modelCount} available</span></div>
          </div>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
cd /Users/eyssen/GitHub/eyas
git add src/web/src/pages/dashboard/
git commit -m "feat(web): add dashboard page with stats and provider overview"
```

---

## Task 9: Providers Page

**Files:**
- Modify: `src/web/src/pages/providers/providers-page.tsx`

- [ ] **Step 1: Implement providers page with configure dialog**

Replace `src/web/src/pages/providers/providers-page.tsx`:

```typescript
import { useState } from 'react'
import { useApi } from '@/hooks/use-api'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Bot, Settings2 } from 'lucide-react'

const PROVIDER_SLOTS = [
  { id: 'anthropic', name: 'Anthropic', secretName: 'anthropic-api-key', description: 'Claude models (Opus, Sonnet, Haiku)' },
  { id: 'openai', name: 'OpenAI', secretName: 'openai-api-key', description: 'GPT-4o, GPT-4 Turbo, o3' },
  { id: 'openrouter', name: 'OpenRouter', secretName: 'openrouter-api-key', description: 'Multi-provider gateway (100+ models)' },
  { id: 'gemini', name: 'Google Gemini', secretName: 'gemini-api-key', description: 'Gemini 2.5 Pro, Flash' },
]

interface Provider { id: string; name: string; modelCount: number }

export default function ProvidersPage() {
  const { data: providerData, refetch } = useApi<{ providers: Provider[] }>('/model/providers')
  const [configuring, setConfiguring] = useState<typeof PROVIDER_SLOTS[0] | null>(null)
  const [apiKey, setApiKey] = useState('')
  const [saving, setSaving] = useState(false)

  const activeProviders = providerData?.providers || []
  const activeIds = new Set(activeProviders.map((p) => p.id))

  const handleSaveKey = async () => {
    if (!configuring || !apiKey) return
    setSaving(true)
    try {
      await api.post('/secrets', { name: configuring.secretName, scope: 'system', value: apiKey })
      setConfiguring(null)
      setApiKey('')
      refetch()
    } finally {
      setSaving(false)
    }
  }

  const handleRemoveKey = async () => {
    if (!configuring) return
    setSaving(true)
    try {
      await api.delete(`/secrets/${configuring.secretName}?scope=system`)
      setConfiguring(null)
      refetch()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <h1 className="page-title">Providers</h1>
      <p className="text-sm text-muted-foreground mb-5">Configure AI providers and API keys</p>

      <div className="grid grid-cols-2 gap-3">
        {PROVIDER_SLOTS.map((slot) => {
          const active = activeIds.has(slot.id)
          const provider = activeProviders.find((p) => p.id === slot.id)
          return (
            <div key={slot.id} className="glass-card p-4 flex items-start gap-4">
              <div className="h-10 w-10 rounded-xl bg-accent/50 flex items-center justify-center flex-shrink-0">
                <Bot className="h-5 w-5 text-muted-foreground" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm">{slot.name}</span>
                  {active ? (
                    <Badge variant="secondary" className="text-emerald-500 text-[10px]">● Active</Badge>
                  ) : (
                    <Badge variant="outline" className="text-muted-foreground text-[10px]">No API key</Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">{slot.description}</p>
                {active && provider && (
                  <p className="text-xs text-muted-foreground mt-1">{provider.modelCount} models available</p>
                )}
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 flex-shrink-0"
                onClick={() => { setConfiguring(slot); setApiKey('') }}
              >
                <Settings2 className="h-4 w-4" />
              </Button>
            </div>
          )
        })}
      </div>

      <p className="text-xs text-muted-foreground mt-4">
        Note: Providers activate on server restart after adding an API key.
      </p>

      {/* Configure dialog */}
      <Dialog open={!!configuring} onOpenChange={(open) => !open && setConfiguring(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Configure {configuring?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label>API Key</Label>
              <Input
                type="password"
                placeholder="Enter API key..."
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Stored encrypted in the secrets vault. Never visible after saving.
              </p>
            </div>
          </div>
          <DialogFooter className="flex gap-2">
            {activeIds.has(configuring?.id || '') && (
              <Button variant="destructive" onClick={handleRemoveKey} disabled={saving}>
                Remove Key
              </Button>
            )}
            <Button onClick={handleSaveKey} disabled={saving || !apiKey}>
              {saving ? 'Saving...' : 'Save API Key'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
cd /Users/eyssen/GitHub/eyas
git add src/web/src/pages/providers/
git commit -m "feat(web): add providers page with API key management dialog"
```

---

## Task 10: Secrets Page

**Files:**
- Modify: `src/web/src/pages/secrets/secrets-page.tsx`

- [ ] **Step 1: Implement secrets page with CRUD**

Replace `src/web/src/pages/secrets/secrets-page.tsx`:

```typescript
import { useState } from 'react'
import { useApi } from '@/hooks/use-api'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Plus, Trash2 } from 'lucide-react'

interface Secret { id: string; name: string; scope: string; module: string | null; createdAt: string }

export default function SecretsPage() {
  const [scope, setScope] = useState('system')
  const { data, refetch } = useApi<{ secrets: Secret[] }>(`/secrets?scope=${scope}`)
  const [showAdd, setShowAdd] = useState(false)
  const [newName, setNewName] = useState('')
  const [newScope, setNewScope] = useState('system')
  const [newValue, setNewValue] = useState('')
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)

  const secrets = data?.secrets || []

  const handleAdd = async () => {
    if (!newName || !newValue) return
    setSaving(true)
    try {
      await api.post('/secrets', { name: newName, scope: newScope, value: newValue })
      setShowAdd(false)
      setNewName('')
      setNewValue('')
      refetch()
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (name: string) => {
    setDeleting(name)
    try {
      await api.delete(`/secrets/${name}?scope=${scope}`)
      refetch()
    } finally {
      setDeleting(null)
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="page-title">Secrets</h1>
          <p className="text-sm text-muted-foreground">Encrypted key-value store</p>
        </div>
        <Button size="sm" onClick={() => setShowAdd(true)}>
          <Plus className="h-4 w-4 mr-1" /> Add Secret
        </Button>
      </div>

      {/* Scope filter */}
      <div className="flex gap-2 mb-4">
        {['system', 'user', 'agent'].map((s) => (
          <Button key={s} variant={scope === s ? 'secondary' : 'ghost'} size="sm" onClick={() => setScope(s)}>
            {s}
          </Button>
        ))}
      </div>

      {/* Table */}
      <div className="glass-card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--vibrancy-border)]">
              <th className="text-left p-3 section-label">Name</th>
              <th className="text-left p-3 section-label">Scope</th>
              <th className="text-left p-3 section-label">Module</th>
              <th className="text-left p-3 section-label">Created</th>
              <th className="text-right p-3 section-label">Actions</th>
            </tr>
          </thead>
          <tbody>
            {secrets.length === 0 ? (
              <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">No secrets in this scope</td></tr>
            ) : (
              secrets.map((s) => (
                <tr key={s.id} className="border-b border-[var(--vibrancy-border)] last:border-0">
                  <td className="p-3 font-mono text-xs">{s.name}</td>
                  <td className="p-3"><Badge variant="outline" className="text-[10px]">{s.scope}</Badge></td>
                  <td className="p-3 text-muted-foreground">{s.module || '—'}</td>
                  <td className="p-3 text-muted-foreground">{new Date(s.createdAt).toLocaleDateString()}</td>
                  <td className="p-3 text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive hover:text-destructive"
                      onClick={() => handleDelete(s.name)}
                      disabled={deleting === s.name}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Add dialog */}
      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Secret</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label>Name</Label>
              <Input placeholder="my-api-key" value={newName} onChange={(e) => setNewName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Scope</Label>
              <Select value={newScope} onValueChange={setNewScope}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="system">system</SelectItem>
                  <SelectItem value="user">user</SelectItem>
                  <SelectItem value="agent">agent</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Value</Label>
              <Input type="password" placeholder="Secret value..." value={newValue} onChange={(e) => setNewValue(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={handleAdd} disabled={saving || !newName || !newValue}>
              {saving ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
cd /Users/eyssen/GitHub/eyas
git add src/web/src/pages/secrets/
git commit -m "feat(web): add secrets page with table view and CRUD dialogs"
```

---

## Task 11: Users Page

**Files:**
- Modify: `src/web/src/pages/users/users-page.tsx`

- [ ] **Step 1: Implement users page**

Replace `src/web/src/pages/users/users-page.tsx`:

```typescript
import { useApi } from '@/hooks/use-api'
import { Badge } from '@/components/ui/badge'

interface User {
  id: string
  username: string
  displayName: string
  role: string
  isRootOwner: boolean
  isAgent: boolean
  status: string
  createdAt: string
}

const roleBadgeVariant = (role: string): 'default' | 'secondary' | 'outline' => {
  if (role === 'owner') return 'default'
  if (role === 'admin') return 'secondary'
  return 'outline'
}

export default function UsersPage() {
  const { data } = useApi<{ users: User[] }>('/users')
  const users = data?.users || []

  return (
    <div>
      <h1 className="page-title">Users</h1>
      <p className="text-sm text-muted-foreground mb-5">Users and AI agents</p>

      <div className="glass-card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--vibrancy-border)]">
              <th className="text-left p-3 section-label">Username</th>
              <th className="text-left p-3 section-label">Display Name</th>
              <th className="text-left p-3 section-label">Role</th>
              <th className="text-left p-3 section-label">Type</th>
              <th className="text-left p-3 section-label">Status</th>
              <th className="text-left p-3 section-label">Created</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b border-[var(--vibrancy-border)] last:border-0">
                <td className="p-3 font-mono text-xs">{u.username}</td>
                <td className="p-3">{u.displayName}</td>
                <td className="p-3"><Badge variant={roleBadgeVariant(u.role)} className="text-[10px]">{u.role}</Badge></td>
                <td className="p-3">
                  <Badge variant="outline" className="text-[10px]">{u.isAgent ? '🤖 Agent' : '👤 Human'}</Badge>
                </td>
                <td className="p-3">
                  <span className={u.status === 'active' ? 'text-emerald-500' : 'text-muted-foreground'}>
                    {u.status === 'active' ? '●' : '○'} {u.status}
                  </span>
                </td>
                <td className="p-3 text-muted-foreground">{new Date(u.createdAt).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
cd /Users/eyssen/GitHub/eyas
git add src/web/src/pages/users/
git commit -m "feat(web): add users page with role badges and type indicators"
```

---

## Task 12: Settings Page

**Files:**
- Modify: `src/web/src/pages/settings/settings-page.tsx`

- [ ] **Step 1: Implement settings page**

Replace `src/web/src/pages/settings/settings-page.tsx`:

```typescript
import { useApi } from '@/hooks/use-api'
import { useThemeStore } from '@/stores/theme-store'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Moon, Sun } from 'lucide-react'

interface HealthResponse { status: string; version: string; timestamp: string }

export default function SettingsPage() {
  const { data: health } = useApi<HealthResponse>('/health')
  const { theme, set: setTheme } = useThemeStore()

  return (
    <div className="max-w-2xl">
      <h1 className="page-title">Settings</h1>
      <p className="text-sm text-muted-foreground mb-5">System configuration</p>

      {/* Appearance */}
      <div className="glass-card p-4 mb-4">
        <h3 className="text-sm font-semibold mb-3">Appearance</h3>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm">Theme</p>
            <p className="text-xs text-muted-foreground">Switch between dark and light mode</p>
          </div>
          <div className="flex gap-1">
            <Button
              variant={theme === 'dark' ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setTheme('dark')}
            >
              <Moon className="h-3.5 w-3.5 mr-1" /> Dark
            </Button>
            <Button
              variant={theme === 'light' ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setTheme('light')}
            >
              <Sun className="h-3.5 w-3.5 mr-1" /> Light
            </Button>
          </div>
        </div>
      </div>

      {/* System info */}
      <div className="glass-card p-4">
        <h3 className="text-sm font-semibold mb-3">System Information</h3>
        <div className="flex flex-col gap-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Version</span>
            <span>{health?.version || '—'}</span>
          </div>
          <Separator />
          <div className="flex justify-between">
            <span className="text-muted-foreground">Status</span>
            <span className="text-emerald-500">● {health?.status || 'unknown'}</span>
          </div>
          <Separator />
          <div className="flex justify-between">
            <span className="text-muted-foreground">Runtime</span>
            <span>Bun</span>
          </div>
          <Separator />
          <div className="flex justify-between">
            <span className="text-muted-foreground">Database</span>
            <span>SQLite (WAL)</span>
          </div>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
cd /Users/eyssen/GitHub/eyas
git add src/web/src/pages/settings/
git commit -m "feat(web): add settings page with theme picker and system info"
```

---

## Task 13: Full Integration Smoke Test

**Files:**
- No new files

- [ ] **Step 1: Build check**

```bash
cd /Users/eyssen/GitHub/eyas/src/web && bun run build
```

- [ ] **Step 2: Backend test suite**

```bash
cd /Users/eyssen/GitHub/eyas && bun vitest run
```

Expected: All 239 backend tests pass.

- [ ] **Step 3: TypeScript check (backend)**

```bash
cd /Users/eyssen/GitHub/eyas && bunx tsc --noEmit
```

- [ ] **Step 4: Full flow smoke test in browser**

```bash
cd /Users/eyssen/GitHub/eyas
rm -f data/sqlite/eyas.db data/sqlite/eyas.db-wal data/sqlite/eyas.db-shm data/master.key
bun src/main.ts &
sleep 3
cd src/web && bun run dev &
sleep 2
echo "Backend: http://localhost:3000"
echo "Frontend: http://localhost:5173"
```

Manual test checklist:
1. Open http://localhost:5173 → redirects to /setup
2. Complete master password step
3. Complete root owner step
4. Complete first agent step → redirects to /login
5. Login with the created user → redirects to /
6. Dashboard shows 0 providers, 0 models
7. Navigate to Providers → 4 provider cards, all inactive
8. Configure Anthropic → save API key → shows in Secrets
9. Navigate to Secrets → table shows the api key (name only)
10. Navigate to Users → shows admin + jarvis
11. Navigate to Settings → theme toggle works
12. Toggle dark/light mode → verify both themes look correct
13. User menu → Sign out → redirects to /login

- [ ] **Step 5: Fix any issues and commit**

```bash
# Only if fixes needed
cd /Users/eyssen/GitHub/eyas
git add -A src/web/
git commit -m "fix(web): integration smoke test fixes"
```

---

## Summary

| Task | Description | Key Files |
|------|-------------|-----------|
| 1 | Install deps + shadcn/ui | package.json, components/ui/ |
| 2 | Theme system (globals.css) | globals.css |
| 3 | API client + stores | api.ts, auth-store, theme-store, use-api |
| 4 | TanStack Router + guards | routes/, app.tsx |
| 5 | Layout shell | sidebar, top-bar, theme-toggle, user-menu |
| 6 | Setup wizard | setup-page, setup-step |
| 7 | Login page | login-page |
| 8 | Dashboard | dashboard-page |
| 9 | Providers page | providers-page + dialog |
| 10 | Secrets page | secrets-page + CRUD |
| 11 | Users page | users-page |
| 12 | Settings page | settings-page |
| 13 | Smoke test | Manual browser testing |

**New dependencies:** @tanstack/react-router, zustand, shadcn/ui (Radix primitives), class-variance-authority, sonner
**No frontend tests** — manual browser verification per spec.

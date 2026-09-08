import { create } from 'zustand'
import { ApiError } from '@/lib/api'

interface User {
  id: string
  username: string
  displayName: string
  role: string
  isAgent: boolean
}

interface AuthState {
  user: User | null
  isAuthenticated: boolean
  isLoading: boolean
  login: (username: string, password: string) => Promise<void>
  logout: () => void
  fetchMe: () => Promise<void>
  init: () => Promise<void>
}

// Session cookie auth — no tokens in localStorage
// The httpOnly cookie is sent automatically by the browser
async function authRequest<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Eyas-Request': '1', // CSRF protection
  }
  const res = await fetch(`/api/v1${path}`, {
    method,
    headers,
    credentials: 'include', // send cookies
    ...(body !== undefined && { body: JSON.stringify(body) }),
  })
  const data = await res.json()
  if (!res.ok) {
    throw new ApiError(res.status, data.error || res.statusText)
  }
  return data as T
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  isAuthenticated: false,
  isLoading: true,

  login: async (username: string, password: string) => {
    // POST /auth/login sets the session cookie (httpOnly)
    await authRequest('POST', '/auth/login', { username, password })
    await get().fetchMe()
  },

  logout: async () => {
    try {
      await authRequest('POST', '/auth/logout')
    } catch { /* ignore errors on logout */ }
    set({ user: null, isAuthenticated: false })
    window.location.href = '/login'
  },

  fetchMe: async () => {
    try {
      const data = await authRequest<{ user: User }>('GET', '/auth/me')
      set({ user: data.user, isAuthenticated: true, isLoading: false })
    } catch (e) {
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
        set({ user: null, isAuthenticated: false, isLoading: false })
      }
    }
  },

  init: async () => {
    // Try to fetch the current user — if the session cookie is valid, this works
    await get().fetchMe()
    if (!get().isAuthenticated) {
      set({ isLoading: false })
    }
  },
}))

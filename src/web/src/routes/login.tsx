import { createFileRoute } from '@tanstack/react-router'
import LoginPage from '@/pages/login/login-page'

export const Route = createFileRoute('/login')({
  validateSearch: (search: Record<string, unknown>) => {
    const r = typeof search.redirect === 'string' ? search.redirect : undefined
    // Open-redirect guard: allow only same-origin relative paths.
    const safe = r && r.startsWith('/') && !r.startsWith('//') && !r.startsWith('/\\') ? r : undefined
    return { redirect: safe }
  },
  component: LoginPage,
})

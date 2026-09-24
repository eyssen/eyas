import { createRootRoute, Outlet, useNavigate } from '@tanstack/react-router'
import { useCallback, useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'
import { t } from '@/i18n'

function RootComponent() {
  const navigate = useNavigate()
  const { isAuthenticated, isLoading, init } = useAuthStore()
  const [setupComplete, setSetupComplete] = useState<boolean | null>(null)
  const [setupError, setSetupError] = useState(false)

  const checkSetup = useCallback(() => {
    setSetupError(false)
    api
      .get<{ complete: boolean }>('/setup/status')
      .then((d) => setSetupComplete(d.complete))
      // Distinguish a failed request from the initial null state so the app
      // can offer a retry instead of hanging forever on the loading screen.
      .catch(() => setSetupError(true))
  }, [])

  useEffect(() => {
    checkSetup()
  }, [checkSetup])

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
      navigate({ to: '/login', search: { redirect: undefined } })
    }
  }, [setupComplete, isAuthenticated, isLoading, navigate])

  if (setupError) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4">
        <div className="text-muted-foreground text-sm">{t('common.serverUnreachable')}</div>
        <button
          type="button"
          onClick={checkSetup}
          className="rounded-md border border-border bg-background px-4 py-2 text-sm text-foreground hover:bg-accent"
        >
          {t('common.retry')}
        </button>
      </div>
    )
  }

  if (setupComplete === null || isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-muted-foreground text-sm">{t('common.loading')}</div>
      </div>
    )
  }

  return <Outlet />
}

export const Route = createRootRoute({
  component: RootComponent,
})

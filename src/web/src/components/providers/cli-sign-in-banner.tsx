// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Home banner for a Grok / Kimi CLI that is installed and enabled but not
// signed in for EYAS. Installs that relied on the host CLI login (before EYAS
// ran these CLIs in their own home) do not re-run the setup wizard, and the
// provider panel alone is easy to miss, so the sign-in is offered here too.
// Shown to owners and admins only (signing in needs manage Model); dismissed
// per browser session.

import { useState } from 'react'
import { KeyRound, X } from 'lucide-react'
import { useApi } from '@/hooks/use-api'
import { Button } from '@/components/ui/button'
import { useAuthStore } from '@/stores/auth-store'
import { CliSignInCard, isCliSignInProvider } from './cli-sign-in-card'
import { t } from './i18n'

const DISMISS_KEY = 'eyas-cli-sign-in-banner-dismissed'

interface ProviderRow {
  id: string
  /** The product name (the server's display source). */
  name?: string
  enabled: boolean
  active: boolean
  health?: { status: 'healthy' | 'auth_error'; code?: string }
}

function loadDismissed(): Set<string> {
  try {
    const raw = sessionStorage.getItem(DISMISS_KEY)
    const ids = raw ? (JSON.parse(raw) as unknown) : []
    return new Set(Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [])
  } catch {
    return new Set()
  }
}

function saveDismissed(ids: Set<string>): void {
  try {
    sessionStorage.setItem(DISMISS_KEY, JSON.stringify([...ids]))
  } catch {
    // Storage unavailable: dismissal lasts until the page reloads.
  }
}

export function CliSignInBanner() {
  const role = useAuthStore((s) => s.user?.role)
  const canManage = role === 'owner' || role === 'admin'
  const { data, refetch } = useApi<{ providers: ProviderRow[] }>(canManage ? '/model/providers' : '')
  const [dismissed, setDismissed] = useState<Set<string>>(loadDismissed)
  const [open, setOpen] = useState<string | null>(null)

  if (!canManage) return null
  const needing = (data?.providers ?? []).filter(
    (p) => isCliSignInProvider(p.id) && p.enabled && p.active && p.health?.code === 'cliSignIn' && !dismissed.has(p.id),
  )
  if (needing.length === 0) return null

  const dismiss = (id: string) => {
    const next = new Set(dismissed)
    next.add(id)
    setDismissed(next)
    saveDismissed(next)
  }

  return (
    <div className="flex flex-col gap-2" data-testid="cli-sign-in-banner">
      {needing.map((p) => {
        if (!isCliSignInProvider(p.id)) return null
        const provider = p.name || p.id
        return (
          <div key={p.id} className="glass-card space-y-3 border border-destructive/30 p-3">
            <div className="flex items-start gap-3">
              <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{t('providers.signIn.banner.title', { provider })}</p>
                <p className="text-xs text-muted-foreground">{t('providers.signIn.banner.desc', { provider })}</p>
              </div>
              <Button size="sm" className="h-7 shrink-0 text-xs" onClick={() => setOpen(open === p.id ? null : p.id)}>
                {t('providers.signIn.banner.action')}
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                className="shrink-0"
                aria-label={t('providers.signIn.banner.dismiss')}
                title={t('providers.signIn.banner.dismiss')}
                onClick={() => dismiss(p.id)}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
            {open === p.id && <CliSignInCard providerId={p.id} onChange={() => refetch()} />}
          </div>
        )
      })}
    </div>
  )
}

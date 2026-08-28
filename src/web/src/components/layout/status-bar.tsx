import { useEffect, useState } from 'react'
import { useRouterState } from '@tanstack/react-router'
import { api } from '@/lib/api'
import { t } from './i18n'

interface Snapshot {
  tasks: { open: number; overdue: number; running: number }
  agents: { running: number }
  version: string
  env: string
}

function useClock() {
  const [t, setT] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setT(new Date()), 1000)
    return () => clearInterval(id)
  }, [])
  return t.toLocaleTimeString(undefined, { hour12: false })
}

export function StatusBar() {
  const [snap, setSnap] = useState<Snapshot | null>(null)
  const [online, setOnline] = useState(true)
  const [updateAvailable, setUpdateAvailable] = useState(false)
  const [latestVersion, setLatestVersion] = useState<string | null>(null)
  const clock = useClock()
  const path = useRouterState({ select: (s) => s.location.pathname })

  useEffect(() => {
    let cancelled = false
    const refresh = () =>
      api.get<{ snapshot: Snapshot }>('/statusbar')
        .then((d) => { if (!cancelled) { setSnap(d.snapshot); setOnline(true) } })
        .catch(() => { if (!cancelled) setOnline(false) })

    refresh()
    const id = setInterval(refresh, 15000)
    return () => { cancelled = true; clearInterval(id) }
  }, [])

  // Soft poll for updates (GitHub) — less frequent than statusbar
  useEffect(() => {
    let cancelled = false
    const check = () =>
      api
        .get<{ updateAvailable?: boolean; latestVersion?: string | null }>('/system/update')
        .then((d) => {
          if (cancelled) return
          setUpdateAvailable(!!d.updateAvailable)
          setLatestVersion(d.latestVersion ?? null)
        })
        .catch(() => {
          /* ignore — statusbar stays usable offline / without permission */
        })
    check()
    const id = setInterval(check, 30 * 60_000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [])

  const view = path.replace(/^\//, '').split('/')[0] || 'dashboard'

  return (
    <footer
      className="h-[26px] vibrancy border-t border-[var(--vibrancy-border)] flex items-center gap-4 px-3 text-[11px] text-[hsl(var(--muted-foreground))] flex-shrink-0 select-none"
      style={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}
    >
      <span className="uppercase tracking-wide text-[hsl(var(--foreground))]">{view}</span>
      {snap && (
        <span className="flex items-center gap-3">
          <span>{t('statusBar.tasksOpen', { count: snap.tasks.open })}</span>
          <span className={snap.tasks.overdue ? 'text-[hsl(var(--destructive))]' : ''}>{t('statusBar.tasksOverdue', { count: snap.tasks.overdue })}</span>
          <span>{t('statusBar.tasksRunning', { count: snap.tasks.running })}</span>
        </span>
      )}
      <span className="ml-auto flex items-center gap-4">
        {snap && <span>{t('statusBar.agents', { count: snap.agents.running })}</span>}
        <span className={online ? 'text-[var(--nav-active-color)]' : 'text-[hsl(var(--destructive))]'}>
          {online ? t('statusBar.synced') : t('statusBar.offline')}
        </span>
        {updateAvailable && (
          <a
            href="/settings"
            className="text-amber-400 hover:text-amber-300 underline-offset-2 hover:underline"
            title={latestVersion ? `→ ${latestVersion}` : undefined}
          >
            {t('statusBar.updateAvailable', {
              version: latestVersion ? ` ${latestVersion}` : '',
            })}
          </a>
        )}
        {snap && <span>{t('statusBar.version', { version: snap.version })}</span>}
        <span>{clock}</span>
      </span>
    </footer>
  )
}

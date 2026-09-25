// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { useCallback, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { ArrowUpCircle, ExternalLink, Loader2, RefreshCw, ShieldAlert } from 'lucide-react'
import { useApi } from '@/hooks/use-api'
import { api, ApiError } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { t } from './i18n'

interface UpdateCheck {
  currentVersion: string
  latestVersion: string | null
  updateAvailable: boolean
  latest: {
    tag: string
    name: string
    htmlUrl: string
    body: string
    source: string
    prerelease: boolean
  } | null
  installMethod: string
  backupReady: boolean
  backupCount: number
  canApply: boolean
  blockReasons: string[]
  checkedAt: string
  repo: string
}

export default function SystemUpdateCard() {
  const { data, isLoading, error, refetch } = useApi<UpdateCheck>('/system/update')
  const [applying, setApplying] = useState(false)
  const [applyMsg, setApplyMsg] = useState<string | null>(null)
  const [applyError, setApplyError] = useState<string | null>(null)
  const [showNotes, setShowNotes] = useState(false)

  const onApply = useCallback(async () => {
    if (!data?.updateAvailable) return
    if (!data.backupReady) {
      setApplyError(t('settings.update.backupRequired'))
      return
    }
    if (!window.confirm(t('settings.update.confirm'))) return
    setApplying(true)
    setApplyError(null)
    setApplyMsg(null)
    try {
      const res = await api.post<UpdateCheck & { ok?: boolean; message?: string; steps?: string[] }>(
        '/system/update',
        { confirm: true },
      )
      // 200 path
      const msg = (res as any).message ?? t('settings.update.success')
      setApplyMsg(msg)
      if ((res as any).steps) {
        setApplyMsg([msg, ...((res as any).steps as string[])].join('\n'))
      }
      // Server may restart — keep polling health later
      setTimeout(() => refetch(), 5000)
    } catch (e) {
      // api client throws on non-2xx; 409 body may be in message
      const msg = e instanceof ApiError ? e.message : String(e)
      setApplyError(msg)
    } finally {
      setApplying(false)
    }
  }, [data, refetch])

  return (
    <div className="glass-card p-4">
      <div className="flex items-center justify-between gap-2 mb-2">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <ArrowUpCircle className="h-4 w-4" />
          {t('settings.update.heading')}
        </h3>
        <Button
          size="sm"
          variant="ghost"
          className="h-7"
          onClick={() => refetch()}
          disabled={isLoading}
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} />
        </Button>
      </div>
      <p className="text-xs text-muted-foreground mb-3">{t('settings.update.subtitle')}</p>

      {error && (
        <p className="text-xs text-destructive mb-2">
          {t('settings.update.checkFailed')}: {error.message}
        </p>
      )}

      {isLoading && !data && (
        <p className="text-xs text-muted-foreground">{t('common.loading')}</p>
      )}

      {data && (
        <div className="flex flex-col gap-2 text-sm">
          <div className="flex justify-between gap-2">
            <span className="text-muted-foreground">{t('settings.update.current')}</span>
            <span className="font-mono text-xs">{data.currentVersion}</span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="text-muted-foreground">{t('settings.update.latest')}</span>
            <span className="font-mono text-xs">
              {data.latestVersion ?? '—'}
              {data.updateAvailable && (
                <span className="ml-2 text-amber-500 font-sans text-[10px] uppercase">
                  {t('settings.update.available')}
                </span>
              )}
            </span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="text-muted-foreground">{t('settings.update.installMethod')}</span>
            <span className="text-xs">{data.installMethod}</span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="text-muted-foreground">{t('settings.update.backup')}</span>
            <span className="text-xs">
              {data.backupReady
                ? t('settings.update.backupReady', { count: data.backupCount })
                : t('settings.update.backupMissing')}
            </span>
          </div>

          {data.blockReasons.length > 0 && (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-[11px] text-amber-200/90 space-y-1">
              <div className="flex items-center gap-1 font-medium">
                <ShieldAlert className="h-3.5 w-3.5" />
                {t('settings.update.blockers')}
              </div>
              <ul className="list-disc pl-4 space-y-0.5">
                {data.blockReasons.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            </div>
          )}

          {data.latest?.body && (
            <div>
              <button
                type="button"
                className="text-xs text-primary hover:underline"
                onClick={() => setShowNotes((v) => !v)}
              >
                {showNotes ? t('settings.update.hideNotes') : t('settings.update.showNotes')}
              </button>
              {showNotes && (
                <pre className="mt-2 max-h-48 overflow-auto rounded-md bg-accent/40 p-2 text-[11px] whitespace-pre-wrap font-mono text-muted-foreground">
                  {data.latest.body}
                </pre>
              )}
            </div>
          )}

          <div className="flex flex-wrap gap-2 mt-2">
            {data.latest?.htmlUrl && (
              <a
                href={data.latest.htmlUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex"
              >
                <Button size="sm" variant="outline" className="h-8 text-xs">
                  <ExternalLink className="h-3.5 w-3.5 mr-1" />
                  {t('settings.update.openRelease')}
                </Button>
              </a>
            )}
            {!data.backupReady && (
              <Link to="/backup">
                <Button size="sm" variant="outline" className="h-8 text-xs">
                  {t('settings.update.goBackup')}
                </Button>
              </Link>
            )}
            <Button
              size="sm"
              className="h-8 text-xs"
              disabled={!data.updateAvailable || !data.canApply || applying}
              onClick={() => void onApply()}
            >
              {applying ? (
                <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
              ) : (
                <ArrowUpCircle className="h-3.5 w-3.5 mr-1" />
              )}
              {applying ? t('settings.update.applying') : t('settings.update.apply')}
            </Button>
          </div>

          {applyMsg && (
            <pre className="text-[11px] text-emerald-400/90 whitespace-pre-wrap mt-1">{applyMsg}</pre>
          )}
          {applyError && (
            <p className="text-xs text-destructive mt-1">{applyError}</p>
          )}

          <p className="text-[10px] text-muted-foreground mt-1">
            {t('settings.update.repo', { repo: data.repo })} · {data.checkedAt}
          </p>
        </div>
      )}
    </div>
  )
}

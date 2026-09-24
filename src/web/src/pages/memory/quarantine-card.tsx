// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// B10 — the owner's quarantine of memory one provider wrote (a CLI that ran
// without EYAS's isolation may have answered from memory outside EYAS). Pick
// providers and an optional date range, preview what would be hidden, confirm
// inline, and release any past quarantine from the history. Owner only: the
// routes answer 403 to everyone else, so the card only says so.

import { useCallback, useEffect, useState } from 'react'
import { ShieldAlert } from 'lucide-react'
import { api, ApiError } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'
import { t } from './i18n'

export interface QuarantineCounts {
  raw: number
  facts: number
  gists: number
  notes: number
  conversations: number
}

export interface QuarantineEntry {
  id: string
  providers: string[]
  from: number | null
  to: number | null
  counts: QuarantineCounts
  createdAt: number
  createdBy: string
  releasedAt: number | null
  releasedBy: string | null
}

export interface QuarantineProvider {
  provider: string
  rows: number
}

export interface QuarantineSelectionBody {
  providers: string[]
  from?: number
  to?: number
}

/**
 * The request body for the chosen providers and `YYYY-MM-DD` dates (local
 * time): `from` is the start of its day, `to` the end of its day. An empty or
 * unreadable date leaves that side open.
 */
export function selectionBody(providers: string[], from: string, to: string): QuarantineSelectionBody {
  const body: QuarantineSelectionBody = { providers: [...providers].sort() }
  const start = from ? new Date(`${from}T00:00:00`).getTime() : Number.NaN
  const end = to ? new Date(`${to}T23:59:59.999`).getTime() : Number.NaN
  if (Number.isFinite(start)) body.from = start
  if (Number.isFinite(end)) body.to = end
  return body
}

function hasChanges(c: QuarantineCounts): boolean {
  return c.raw + c.facts + c.gists + c.notes > 0
}

const BUTTON = 'text-xs px-3 py-1.5 rounded border border-border hover:bg-accent transition-colors disabled:opacity-50 disabled:cursor-not-allowed'

export default function QuarantineCard() {
  const role = useAuthStore((s) => s.user?.role)
  const isOwner = role === 'owner'
  const [providers, setProviders] = useState<QuarantineProvider[]>([])
  const [entries, setEntries] = useState<QuarantineEntry[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [preview, setPreview] = useState<QuarantineCounts | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const data = await api.get<{ entries: QuarantineEntry[]; providers: QuarantineProvider[] }>('/memory/quarantine')
      setProviders(data.providers ?? [])
      setEntries(data.entries ?? [])
    } catch {
      setError(t('memory.quarantine.error'))
    }
  }, [])

  useEffect(() => {
    if (isOwner) void load()
  }, [isOwner, load])

  // Any change to the selection invalidates the preview and the pending confirm.
  const resetPreview = () => {
    setPreview(null)
    setConfirming(false)
    setNotice(null)
    setError(null)
  }

  const toggle = (provider: string) => {
    resetPreview()
    setSelected((cur) => (cur.includes(provider) ? cur.filter((p) => p !== provider) : [...cur, provider]))
  }

  const run = async (action: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await action()
    } catch (err) {
      setError(err instanceof ApiError && err.status === 403 ? t('memory.quarantine.ownerOnly') : t('memory.quarantine.error'))
    } finally {
      setBusy(false)
    }
  }

  const doPreview = () => run(async () => {
    setNotice(null)
    const res = await api.post<{ counts: QuarantineCounts }>('/memory/quarantine/preview', selectionBody(selected, from, to))
    setPreview(res.counts)
  })

  const doApply = () => run(async () => {
    const res = await api.post<{ id: string | null; counts: QuarantineCounts }>('/memory/quarantine', selectionBody(selected, from, to))
    setConfirming(false)
    setPreview(null)
    setNotice(res.id ? t('memory.quarantine.applied', { ...res.counts }) : t('memory.quarantine.nothing'))
    await load()
  })

  const doRelease = (id: string) => run(async () => {
    await api.post(`/memory/quarantine/${encodeURIComponent(id)}/release`, {})
    setNotice(t('memory.quarantine.released'))
    await load()
  })

  return (
    <section className="p-4 bg-card border border-border rounded-lg" aria-labelledby="memory-quarantine-title">
      <div className="flex items-center gap-2 mb-1">
        <ShieldAlert className="h-4 w-4 text-muted-foreground" aria-hidden />
        <h2 id="memory-quarantine-title" className="text-sm font-medium">{t('memory.quarantine.title')}</h2>
      </div>
      {!isOwner ? (
        <p className="text-xs text-muted-foreground">{t('memory.quarantine.ownerOnly')}</p>
      ) : (
        <>
          <p className="text-xs text-muted-foreground mb-4">{t('memory.quarantine.hint')}</p>

          <fieldset className="mb-3">
            <legend className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium mb-2">
              {t('memory.quarantine.providers')}
            </legend>
            {providers.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">{t('memory.quarantine.noProviders')}</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {providers.map((p) => (
                  <label key={p.provider} className="flex items-center gap-2 text-xs px-2 py-1 rounded border border-border cursor-pointer hover:bg-accent/50">
                    <input
                      type="checkbox"
                      checked={selected.includes(p.provider)}
                      onChange={() => toggle(p.provider)}
                    />
                    <span className="font-mono">{p.provider}</span>
                    <span className="text-muted-foreground">{t('memory.quarantine.rows', { count: p.rows })}</span>
                  </label>
                ))}
              </div>
            )}
          </fieldset>

          <div className="flex flex-wrap items-end gap-3 mb-3">
            <label className="flex flex-col gap-1 text-[10px] text-muted-foreground uppercase tracking-wider">
              {t('memory.quarantine.from')}
              <input
                type="date"
                value={from}
                onChange={(e) => { resetPreview(); setFrom(e.target.value) }}
                className="text-xs normal-case tracking-normal bg-background text-foreground border border-border rounded px-2 py-1"
              />
            </label>
            <label className="flex flex-col gap-1 text-[10px] text-muted-foreground uppercase tracking-wider">
              {t('memory.quarantine.to')}
              <input
                type="date"
                value={to}
                onChange={(e) => { resetPreview(); setTo(e.target.value) }}
                className="text-xs normal-case tracking-normal bg-background text-foreground border border-border rounded px-2 py-1"
              />
            </label>
            <button type="button" className={BUTTON} disabled={busy || selected.length === 0} onClick={doPreview}>
              {t('memory.quarantine.preview')}
            </button>
          </div>

          {preview && (
            <div className="mb-3 p-3 rounded-md bg-accent/30 text-xs" role="status">
              {hasChanges(preview) ? (
                <>
                  <p>{t('memory.quarantine.previewResult', { ...preview })}</p>
                  {!confirming ? (
                    <button type="button" className={`${BUTTON} mt-2`} disabled={busy} onClick={() => setConfirming(true)}>
                      {t('memory.quarantine.apply')}
                    </button>
                  ) : (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <span className="text-foreground">{t('memory.quarantine.confirm')}</span>
                      <button
                        type="button"
                        className="text-xs px-3 py-1.5 rounded bg-destructive text-destructive-foreground hover:opacity-90 transition-opacity disabled:opacity-50"
                        disabled={busy}
                        onClick={doApply}
                      >
                        {t('memory.quarantine.apply')}
                      </button>
                      <button type="button" className={BUTTON} disabled={busy} onClick={() => setConfirming(false)}>
                        {t('common.cancel')}
                      </button>
                    </div>
                  )}
                </>
              ) : (
                <p className="text-muted-foreground">{t('memory.quarantine.nothing')}</p>
              )}
            </div>
          )}

          {notice && <p className="mb-3 text-xs text-foreground" role="status">{notice}</p>}
          {error && <p className="mb-3 text-xs text-destructive" role="alert">{error}</p>}

          <div className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium mb-2">
            {t('memory.quarantine.history')}
          </div>
          {entries.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">{t('memory.quarantine.empty')}</p>
          ) : (
            <ul className="space-y-2">
              {entries.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-2 border-b border-border last:border-0">
                  <div className="min-w-0">
                    <div className="text-xs">
                      <span className="font-mono">{e.providers.join(', ')}</span>
                      <span className="text-muted-foreground"> · {new Date(e.createdAt).toLocaleString()}</span>
                    </div>
                    <div className="text-[10px] text-muted-foreground">{t('memory.quarantine.entryCounts', { ...e.counts })}</div>
                  </div>
                  {e.releasedAt ? (
                    <span className="text-[10px] text-muted-foreground">
                      {t('memory.quarantine.releasedOn', { date: new Date(e.releasedAt).toLocaleString() })}
                    </span>
                  ) : (
                    <button type="button" className={BUTTON} disabled={busy} onClick={() => doRelease(e.id)}>
                      {t('memory.quarantine.release')}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  )
}

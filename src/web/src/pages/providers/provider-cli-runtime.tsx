// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// The Runtime line and the isolation status of a CLI provider panel
// (GET /api/v1/model/providers/:id/isolation, model/cli-isolation-view.ts):
// which binary EYAS runs and how it was found, its version and sign-in, the
// last isolation check EYAS recorded with its failed checks, what EYAS's
// isolation release check proved for the installed version, the one risk it
// does not cover, and Verify now where the provider can check itself
// without a turn (POST …/isolation/verify).

import { useCallback, useEffect, useState } from 'react'
import { Loader2, ShieldAlert, ShieldCheck, ShieldQuestion } from 'lucide-react'
import { api, ApiError } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useLanguageStore } from '@/stores/language-store'
import { t, tOr } from './i18n'
import {
  HOW_KEY,
  PROOF_KEY,
  RESIDUAL_KEY,
  RUNTIME_SOURCE_KEY,
  isolationCheckKey,
  isolationStatusKey,
  type IsolationDrift,
  type IsolationProviderId,
  type IsolationState,
  type RuntimeSource,
} from './provider-isolation-labels'

export interface CliIsolationView {
  providerId: IsolationProviderId
  status: IsolationState
  checks: Array<{ check: string; detail: string }>
  checkedAt: string | null
  runtime:
    | { available: true; path: string; version: string | null; source: RuntimeSource; expectedVersion: string | null; skew: boolean }
    | { available: false; error: 'no-policy' | 'override-invalid' | 'not-found' }
  hostCli: { path: string; version: string | null } | null
  signedIn: boolean | null
  proof: { version: string | null; verifiedAt: string | null; paidCanary: boolean; drift: IsolationDrift | null }
  canVerify: boolean
}

/**
 * The server's answer is used only when it has the shape this panel reads;
 * anything else (an older server, a proxy error page) reads as not loaded
 * rather than as a status.
 */
export function isCliIsolationView(value: unknown): value is CliIsolationView {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  const runtime = v.runtime as Record<string, unknown> | null | undefined
  const proof = v.proof as Record<string, unknown> | null | undefined
  return typeof v.providerId === 'string'
    && typeof v.status === 'string'
    && Array.isArray(v.checks)
    && !!runtime && typeof runtime === 'object' && typeof runtime.available === 'boolean'
    && (runtime.available === false || typeof runtime.path === 'string')
    && !!proof && typeof proof === 'object'
    && typeof v.canVerify === 'boolean'
}

/** Dates follow the language chosen in EYAS; `tlh` has no date data and borrows English. */
function formatTime(value: string, lang: string): string {
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString(lang === 'tlh' ? 'en' : lang)
}

const STATUS_TONE: Record<IsolationState, string> = {
  'verified': 'text-success border-success/40',
  'violation': 'text-destructive border-destructive/40',
  'unverified': 'text-warning border-warning/40',
  'auth-required': 'text-destructive border-destructive/40',
}

interface CliRuntimeIsolationProps {
  providerId: IsolationProviderId
  /** Changes when something that affects the view happened elsewhere (a sign-in): reload. */
  refreshKey?: number
}

export function CliRuntimeIsolation({ providerId, refreshKey = 0 }: CliRuntimeIsolationProps) {
  const lang = useLanguageStore((s) => s.lang)
  const [view, setView] = useState<CliIsolationView | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [verifyError, setVerifyError] = useState<string | null>(null)

  const path = `/model/providers/${providerId}/isolation`

  const load = useCallback(async () => {
    try {
      const next = await api.get<unknown>(path)
      if (!isCliIsolationView(next)) throw new Error('unexpected isolation response')
      setView(next)
      setLoadFailed(false)
    } catch {
      setLoadFailed(true)
    }
  }, [path])

  useEffect(() => {
    void load()
  }, [load, refreshKey])

  const verifyNow = async () => {
    setVerifying(true)
    setVerifyError(null)
    try {
      const next = await api.post<unknown>(`${path}/verify`)
      if (!isCliIsolationView(next)) throw new Error('unexpected isolation response')
      setView(next)
    } catch (e) {
      setVerifyError(e instanceof ApiError && e.code === 'verifyUnavailable'
        ? t('providers.panel.isolation.verifyUnavailable')
        : t('providers.panel.isolation.verifyFailed', { error: e instanceof Error ? e.message : String(e) }))
    } finally {
      setVerifying(false)
    }
  }

  if (!view) {
    return loadFailed
      ? <p className="text-xs text-destructive" data-testid="cli-runtime-load-failed">{t('providers.panel.isolation.loadFailed')}</p>
      : null
  }

  const runtime = view.runtime
  const versionText = (v: string | null) => v ?? t('providers.panel.runtime.versionUnknown')
  const status = view.status
  const StatusIcon = status === 'verified' ? ShieldCheck : status === 'unverified' ? ShieldQuestion : ShieldAlert
  const drift = view.proof.drift
  const proofVars = { version: view.proof.version ?? '', date: view.proof.verifiedAt ?? '' }
  const proofTone = drift === 'match' ? 'text-muted-foreground' : 'text-warning'

  return (
    <div className="space-y-4">
      <div className="space-y-1" data-testid="cli-runtime">
        <span className="text-sm font-medium">{t('providers.panel.runtime.label')}</span>
        {runtime.available ? (
          <>
            <p className="text-xs">
              {t(RUNTIME_SOURCE_KEY[runtime.source])}
              {' · '}
              {versionText(runtime.version)}
            </p>
            <p className="text-[11px] text-muted-foreground break-all"><code>{runtime.path}</code></p>
            {runtime.skew && runtime.version && runtime.expectedVersion && (
              <p className="text-xs text-warning">
                {t('providers.panel.runtime.mismatch', { version: runtime.version, expected: runtime.expectedVersion })}
              </p>
            )}
            {view.hostCli && (
              <p className="text-xs text-muted-foreground">
                {t('providers.panel.runtime.hostShadowed', { version: versionText(view.hostCli.version) })}
              </p>
            )}
            {/* Grok / Kimi show their sign-in on the EYAS sign-in card above. */}
            {providerId === 'claude-code' && view.signedIn === false && (
              <p className="text-xs text-destructive">{t('providers.panel.runtime.notSignedIn')}</p>
            )}
          </>
        ) : (
          <p className="text-xs text-destructive">
            {runtime.error === 'override-invalid'
              ? t('providers.panel.runtime.overrideInvalid')
              : t('providers.panel.runtime.unavailable')}
          </p>
        )}
      </div>

      <div className="space-y-2" data-testid="cli-isolation">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{t('providers.panel.isolation.title')}</span>
            <Badge variant="outline" className={`text-[10px] gap-1 ${STATUS_TONE[status] ?? STATUS_TONE.unverified}`} data-testid="cli-isolation-status">
              <StatusIcon className="h-3 w-3" />
              {t(isolationStatusKey(status))}
            </Badge>
          </div>
          {view.canVerify && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs shrink-0"
              disabled={verifying}
              title={t('providers.panel.isolation.verifyHint')}
              onClick={verifyNow}
            >
              {verifying && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {t('providers.panel.isolation.verifyNow')}
            </Button>
          )}
        </div>

        <p className="text-xs text-muted-foreground">{t(HOW_KEY[providerId])}</p>

        <p className="text-[11px] text-muted-foreground">
          {view.checkedAt
            ? t('providers.panel.isolation.lastChecked', { time: formatTime(view.checkedAt, lang) })
            : t('providers.panel.isolation.neverChecked')}
        </p>

        {view.checks.length > 0 && (
          <div className="space-y-1" data-testid="cli-isolation-checks">
            <span className="text-xs font-medium text-destructive">{t('providers.panel.isolation.failedChecks')}</span>
            <ul className="list-disc pl-4 space-y-0.5">
              {view.checks.map((c, i) => {
                const key = isolationCheckKey(c.check)
                return (
                  <li key={`${c.check}-${i}`} className="text-xs text-destructive">
                    {key ? tOr(key, c.check) : c.check}
                    {c.detail && <span className="block text-[11px] text-muted-foreground break-all">{c.detail}</span>}
                  </li>
                )
              })}
            </ul>
          </div>
        )}

        {drift && (
          <p className={`text-xs ${proofTone}`} data-testid="cli-isolation-proof">
            {t(PROOF_KEY[drift], proofVars)}
          </p>
        )}

        <p className="text-xs text-muted-foreground" data-testid="cli-isolation-residual">{t(RESIDUAL_KEY[providerId])}</p>

        {verifyError && <p className="text-xs text-destructive">{verifyError}</p>}
      </div>
    </div>
  )
}

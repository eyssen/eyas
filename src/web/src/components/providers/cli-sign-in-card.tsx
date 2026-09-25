// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Sign-in into the EYAS-owned home of the Grok / Kimi CLI. EYAS runs these
// CLIs in its own folder, so the operator's login on the host is never used:
// this card starts the CLI's device-code login (link + code, confirmed in any
// browser), polls until it ends, offers an EYAS-stored API key as the
// alternative where the CLI supports one, and signs out. Shared by the
// provider panel, the setup wizard and the Home banner.

import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, Copy, ExternalLink, KeyRound, Loader2 } from 'lucide-react'
import { api } from '@/lib/api'
import { useProviderDisplay } from '@/lib/provider-display'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { t } from './i18n'

export type CliSignInProviderId = 'grok-cli' | 'kimi-cli'

export const CLI_SIGN_IN_PROVIDER_IDS: readonly CliSignInProviderId[] = ['grok-cli', 'kimi-cli']

export function isCliSignInProvider(id: string): id is CliSignInProviderId {
  return (CLI_SIGN_IN_PROVIDER_IDS as readonly string[]).includes(id)
}

/** GET/POST/DELETE /api/v1/model/providers/:id/sign-in (cli-runtime/sign-in.ts). */
export interface CliSignInSession {
  id: string
  state: 'pending' | 'succeeded' | 'failed' | 'expired' | 'cancelled'
  verificationUrl: string | null
  userCode: string | null
  rawPrompt: string | null
  error: string | null
}

export interface CliSignInStatus {
  providerId: CliSignInProviderId
  signedIn: boolean
  method: 'device' | 'apiKey' | null
  apiKeySupported: boolean
  apiKeyStored: boolean
  session: CliSignInSession | null
}

const POLL_MS = 2000

interface CliSignInCardProps {
  providerId: CliSignInProviderId
  /** Called when the provider becomes signed in or signed out. */
  onChange?: (status: CliSignInStatus) => void
  className?: string
}

export function CliSignInCard({ providerId, onChange, className }: CliSignInCardProps) {
  const [status, setStatus] = useState<CliSignInStatus | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [apiKeyOpen, setApiKeyOpen] = useState(false)
  const [apiKey, setApiKey] = useState('')
  const [copied, setCopied] = useState(false)
  const lastSignedIn = useRef<boolean | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  const path = `/model/providers/${providerId}/sign-in`
  const provider = useProviderDisplay().name(providerId)

  const apply = useCallback((next: CliSignInStatus) => {
    setStatus(next)
    if (lastSignedIn.current !== null && lastSignedIn.current !== next.signedIn) onChangeRef.current?.(next)
    lastSignedIn.current = next.signedIn
  }, [])

  const load = useCallback(async () => {
    try {
      apply(await api.get<CliSignInStatus>(path))
      setLoadFailed(false)
    } catch {
      setLoadFailed(true)
    }
  }, [path, apply])

  useEffect(() => {
    lastSignedIn.current = null
    void load()
  }, [load])

  const session = status?.session ?? null
  const pending = session?.state === 'pending'

  // A device sign-in finishes in the background: poll until it ends.
  useEffect(() => {
    if (!pending) return
    const timer = setInterval(() => { void load() }, POLL_MS)
    return () => clearInterval(timer)
  }, [pending, load])

  const act = async (request: () => Promise<CliSignInStatus>) => {
    setBusy(true)
    setActionError(null)
    try {
      apply(await request())
    } catch (e) {
      setActionError(t('providers.signIn.actionFailed', { error: e instanceof Error ? e.message : String(e) }))
    } finally {
      setBusy(false)
    }
  }

  const start = () => act(() => api.post<CliSignInStatus>(path, { method: 'device' }))
  const cancel = () => act(() => api.delete<CliSignInStatus>(`${path}?target=session`))
  const signOut = () => act(() => api.delete<CliSignInStatus>(path))
  const saveKey = () => act(async () => {
    const next = await api.post<CliSignInStatus>(path, { method: 'apiKey', apiKey: apiKey.trim() })
    setApiKey('')
    setApiKeyOpen(false)
    return next
  })

  const copyCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard unavailable (insecure context): the code stays visible.
    }
  }

  const finished = session && !pending ? session.state : null
  const showStart = !!status && !status.signedIn && !pending

  return (
    <div className={`rounded-lg border border-border/60 p-3 space-y-3 ${className ?? ''}`} data-testid={`cli-sign-in-${providerId}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{t('providers.signIn.title')}</span>
        {status && (status.signedIn ? (
          <Badge variant="secondary" className="text-[10px]">{t('providers.signIn.success')}</Badge>
        ) : (
          <Badge variant="outline" className="text-[10px] text-destructive border-destructive/40">{t('providers.signIn.required')}</Badge>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">{t('providers.signIn.desc', { provider })}</p>

      {loadFailed && !status && <p className="text-xs text-destructive">{t('providers.signIn.loadFailed')}</p>}

      {status?.signedIn && !pending && (
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs">
            {status.method === 'apiKey'
              ? t('providers.signIn.signedInApiKey', { provider })
              : t('providers.signIn.signedInDevice', { provider })}
          </p>
          <Button size="sm" variant="outline" className="h-7 text-xs shrink-0" disabled={busy} onClick={signOut}>
            {t('providers.signIn.signOut')}
          </Button>
        </div>
      )}

      {pending && session && (
        <div className="space-y-2 rounded-md bg-muted/40 p-3">
          {session.verificationUrl ? (
            <>
              <a
                href={session.verificationUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm text-primary underline-offset-4 hover:underline"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                {t('providers.signIn.openLink')}
              </a>
              {session.userCode && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">{t('providers.signIn.code')}</span>
                  <code className="rounded bg-background px-2 py-1 font-mono text-base tracking-widest">{session.userCode}</code>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={copied ? t('providers.signIn.copied') : t('providers.signIn.copy')}
                    title={copied ? t('providers.signIn.copied') : t('providers.signIn.copy')}
                    onClick={() => copyCode(session.userCode!)}
                  >
                    {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  </Button>
                </div>
              )}
              <p className="text-[11px] text-muted-foreground">{t('providers.signIn.codeHint')}</p>
            </>
          ) : session.rawPrompt ? (
            <>
              <p className="text-[11px] text-muted-foreground">{t('providers.signIn.rawPrompt')}</p>
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-background/60 p-2 text-[11px]">{session.rawPrompt}</pre>
            </>
          ) : null}
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              {t('providers.signIn.waiting')}
            </span>
            <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={busy} onClick={cancel}>
              {t('providers.signIn.cancel')}
            </Button>
          </div>
        </div>
      )}

      {!status?.signedIn && (finished === 'failed' || finished === 'expired') && session && (
        <div className="space-y-1">
          <p className="text-xs text-destructive">
            {finished === 'expired' ? t('providers.signIn.expired') : t('providers.signIn.failed')}
            {session.error ? ` ${session.error}` : ''}
          </p>
          {session.rawPrompt && (
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-muted/40 p-2 text-[11px]">{session.rawPrompt}</pre>
          )}
        </div>
      )}

      {showStart && (
        <Button size="sm" className="h-8 text-xs" disabled={busy} onClick={start}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          {finished === 'failed' || finished === 'expired' ? t('providers.signIn.retry') : t('providers.signIn.start')}
        </Button>
      )}

      {status?.apiKeySupported && !pending && !status.signedIn && (
        apiKeyOpen ? (
          <div className="space-y-2">
            <div className="flex gap-2">
              <Input
                type="password"
                autoFocus
                autoComplete="off"
                placeholder={t('providers.signIn.apiKeyPlaceholder')}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && apiKey.trim()) void saveKey() }}
                className="h-8 flex-1"
              />
              <Button size="sm" className="h-8 text-xs" disabled={busy || !apiKey.trim()} onClick={saveKey}>
                {t('providers.signIn.apiKeySave')}
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">{t('providers.signIn.apiKeyHint', { provider })}</p>
          </div>
        ) : (
          <Button
            size="sm"
            variant="link"
            className="h-auto p-0 text-xs"
            onClick={() => setApiKeyOpen(true)}
          >
            <KeyRound className="h-3.5 w-3.5" />
            {t('providers.signIn.apiKey')}
          </Button>
        )
      )}

      {actionError && <p className="text-xs text-destructive">{actionError}</p>}
    </div>
  )
}

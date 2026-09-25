// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Reauth healer — when a provider call fails with an auth error, reload that
// provider's credentials (re-read env / secrets / config) once per cooldown,
// and surface a health badge. Reload is only an ATTEMPT: health stays in
// 'auth_error' until a later call actually succeeds (recordSuccess), so the
// badge stays honest for cases a reload can't fix (e.g. a logged-out host CLI).
// A CLI whose EYAS home is not signed in is reported as 'auth_error' before
// any call fails (signInRequired), since no reload can sign it in.

import type { AuthErrorClassification } from '@shared/classify-auth-error.js'

export interface ProviderHealth {
  status: 'healthy' | 'auth_error'
  lastError?: string
  lastErrorAt?: string
  reloadAttemptedAt?: string
  /** Honest operator hint — set when a reload cannot resolve the failure. */
  message?: string
  /**
   * Stable, localizable reason ('cliSignIn': the CLI's EYAS home is not
   * signed in); the UI prefers it over the English `message`.
   */
  code?: 'cliSignIn'
}

export interface ReauthHealerDeps {
  classify: (err: unknown) => AuthErrorClassification
  reload: (providerId: string) => Promise<void>
  /**
   * True while a provider cannot authenticate at all (a CLI whose EYAS home
   * is not signed in). Read on every health query, so the badge appears
   * before the first failed call and clears the moment the sign-in lands.
   */
  signInRequired?: (providerId: string) => boolean
  now?: () => Date
  cooldownMs?: number
}

export interface ReauthHealer {
  onProviderError(providerId: string, err: unknown): Promise<void>
  recordSuccess(providerId: string): void
  getHealth(providerId: string): ProviderHealth
  listHealth(): Record<string, ProviderHealth>
}

const HEALTHY: ProviderHealth = { status: 'healthy' }

// Providers whose auth is session-based and cannot be fixed by a reload.
const HOST_LOGIN_PROVIDERS: Record<string, string> = {
  'claude-code':
    'Claude Code uses the host CLI session — a reload cannot fix this; log in on the host (e.g. `claude login`).',
  'grok-cli':
    'Grok CLI runs in its own EYAS home and does not use the host login — sign in for EYAS under Providers → Grok CLI (device code or API key).',
  'kimi-cli':
    'Kimi Code CLI runs in its own EYAS home and does not use the host login — sign in for EYAS under Providers → Kimi Code CLI (device code).',
}

// Providers whose sign-in EYAS owns (cli-runtime/sign-in.ts): their auth
// failures carry the localizable 'cliSignIn' code.
const EYAS_SIGN_IN_PROVIDERS = new Set(['grok-cli', 'kimi-cli'])

export function createReauthHealer(deps: ReauthHealerDeps): ReauthHealer {
  const now = deps.now ?? (() => new Date())
  const cooldownMs = deps.cooldownMs ?? 60_000
  const health = new Map<string, ProviderHealth>()
  const lastReloadAt = new Map<string, number>()

  async function onProviderError(providerId: string, err: unknown): Promise<void> {
    const c = deps.classify(err)
    if (!c.isAuth) return // rate-limit / overload / other → not the healer's job

    const at = now()
    const entry: ProviderHealth = {
      status: 'auth_error',
      lastError: err instanceof Error ? err.message : `auth error (status ${c.status ?? '?'})`,
      lastErrorAt: at.toISOString(),
      message: HOST_LOGIN_PROVIDERS[providerId],
      ...(EYAS_SIGN_IN_PROVIDERS.has(providerId) ? { code: 'cliSignIn' as const } : {}),
    }
    health.set(providerId, entry)

    // Reload at most once per cooldown — an auth-error storm must not hammer reload.
    const last = lastReloadAt.get(providerId) ?? -Infinity
    if (at.getTime() - last < cooldownMs) return
    lastReloadAt.set(providerId, at.getTime())
    entry.reloadAttemptedAt = at.toISOString()
    try {
      await deps.reload(providerId)
    } catch (reloadErr: any) {
      entry.message = `${entry.message ? entry.message + ' ' : ''}reload failed: ${reloadErr?.message ?? reloadErr}`
    }
  }

  function recordSuccess(providerId: string): void {
    if (health.has(providerId)) health.set(providerId, { status: 'healthy' })
  }

  /** The standing 'not signed in' state, or null when the provider can authenticate. */
  function signInHealth(providerId: string): ProviderHealth | null {
    let required = false
    try {
      required = deps.signInRequired?.(providerId) ?? false
    } catch {
      required = false
    }
    if (!required) return null
    return { ...(health.get(providerId) ?? {}), status: 'auth_error', message: HOST_LOGIN_PROVIDERS[providerId], code: 'cliSignIn' }
  }

  function getHealth(providerId: string): ProviderHealth {
    return signInHealth(providerId) ?? health.get(providerId) ?? HEALTHY
  }

  function listHealth(): Record<string, ProviderHealth> {
    const all = Object.fromEntries(health.entries())
    for (const id of EYAS_SIGN_IN_PROVIDERS) {
      const standing = signInHealth(id)
      if (standing) all[id] = standing
    }
    return all
  }

  return { onProviderError, recordSuccess, getHealth, listHealth }
}

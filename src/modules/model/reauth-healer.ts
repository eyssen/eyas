// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Reauth healer — when a provider call fails with an auth error, reload that
// provider's credentials (re-read env / secrets / config) once per cooldown,
// and surface a health badge. Reload is only an ATTEMPT: health stays in
// 'auth_error' until a later call actually succeeds (recordSuccess), so the
// badge stays honest for cases a reload can't fix (e.g. a logged-out host CLI).

import type { AuthErrorClassification } from '@shared/classify-auth-error.js'

export interface ProviderHealth {
  status: 'healthy' | 'auth_error'
  lastError?: string
  lastErrorAt?: string
  reloadAttemptedAt?: string
  /** Honest operator hint — set when a reload cannot resolve the failure. */
  message?: string
}

export interface ReauthHealerDeps {
  classify: (err: unknown) => AuthErrorClassification
  reload: (providerId: string) => Promise<void>
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

// Providers whose auth is host/session-based and cannot be fixed by a reload.
const HOST_LOGIN_PROVIDERS: Record<string, string> = {
  'claude-code':
    'Claude Code uses the host CLI session — a reload cannot fix this; log in on the host (e.g. `claude login`).',
  'grok-cli':
    'Grok CLI uses the host CLI session — a reload cannot fix this; log in on the host (e.g. `grok login`).',
  'kimi-cli':
    'Kimi Code CLI uses the host CLI session — a reload cannot fix this; log in on the host (e.g. `kimi login`).',
}

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

  function getHealth(providerId: string): ProviderHealth {
    return health.get(providerId) ?? HEALTHY
  }

  function listHealth(): Record<string, ProviderHealth> {
    return Object.fromEntries(health.entries())
  }

  return { onProviderError, recordSuccess, getHealth, listHealth }
}

// Part of eYssen. See LICENSE file for full copyright and licensing details.

import {
  DeviceCodePollOptions,
  DeviceCodeResponse,
  LoggerLike,
  OAUTH_DEVICE_CODE_ENDPOINT,
  OAUTH_TOKEN_ENDPOINT,
  REQUIRED_SCOPES,
  SECRETS_KEY_TOKEN_BUNDLE,
  SecretsLike,
  TokenBundle,
  TokenResponse,
} from './types.js'

export interface OAuth2FlowOptions {
  clientId: string
  tenantId: string
  secrets: SecretsLike
  logger?: LoggerLike
  fetch?: typeof fetch
}

/**
 * Small clock-skew safety margin (60s): refresh a token if it will expire
 * within this window.
 */
const TOKEN_SKEW_MS = 60_000

/**
 * OAuth2 flow manager for Microsoft Graph:
 *  - device-code bootstrap
 *  - refresh-token rotation
 *  - concurrent-refresh protection via mutex
 *  - token bundle persisted via SecretsLike
 */
export class OAuth2Flow {
  private readonly clientId: string
  private readonly tenantId: string
  private readonly secrets: SecretsLike
  private readonly logger: LoggerLike | undefined
  private readonly fetchImpl: typeof fetch
  private cachedBundle: TokenBundle | null = null
  private refreshInFlight: Promise<TokenBundle> | null = null

  constructor(opts: OAuth2FlowOptions) {
    this.clientId = opts.clientId
    this.tenantId = opts.tenantId
    this.secrets = opts.secrets
    this.logger = opts.logger
    this.fetchImpl = opts.fetch ?? globalThis.fetch
  }

  /** Resolves the device-code endpoint for the configured tenant. */
  private deviceCodeUrl(): string {
    return OAUTH_DEVICE_CODE_ENDPOINT.replace('{tenant}', encodeURIComponent(this.tenantId))
  }

  /** Resolves the token endpoint for the configured tenant. */
  private tokenUrl(): string {
    return OAUTH_TOKEN_ENDPOINT.replace('{tenant}', encodeURIComponent(this.tenantId))
  }

  /**
   * Start the OAuth2 device-code flow.
   * Returns the device code info the caller can display to the user.
   */
  async startDeviceCode(): Promise<DeviceCodeResponse> {
    const body = new URLSearchParams({
      client_id: this.clientId,
      scope: REQUIRED_SCOPES.join(' '),
    })
    const res = await this.fetchImpl(this.deviceCodeUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    })
    if (!res.ok) {
      const text = await safeText(res)
      throw new Error(`Device code request failed: ${res.status} ${text}`)
    }
    return (await res.json()) as DeviceCodeResponse
  }

  /**
   * Poll the token endpoint until the user completes auth or the timeout
   * elapses. Persists the resulting TokenBundle via SecretsLike.
   */
  async pollDeviceCode(
    deviceCode: DeviceCodeResponse,
    opts: DeviceCodePollOptions = {},
  ): Promise<TokenBundle> {
    opts.onPrompt?.({
      userCode: deviceCode.user_code,
      verificationUri: deviceCode.verification_uri,
      message: deviceCode.message,
    })

    const pollIntervalSeconds = opts.intervalSecondsOverride ?? deviceCode.interval ?? 5
    const timeoutMs = opts.timeoutMs ?? deviceCode.expires_in * 1000
    const startedAt = Date.now()

    while (Date.now() - startedAt < timeoutMs) {
      const body = new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        client_id: this.clientId,
        device_code: deviceCode.device_code,
      })
      const res = await this.fetchImpl(this.tokenUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      })

      if (res.ok) {
        const tr = (await res.json()) as TokenResponse
        const bundle = this.toBundle(tr)
        await this.persist(bundle)
        return bundle
      }

      const errBody = (await safeJson(res)) as { error?: string } | null
      const err = errBody?.error ?? ''
      if (err === 'authorization_pending' || err === 'slow_down') {
        // Graph may request a slow_down; back off an extra 5s.
        const extra = err === 'slow_down' ? 5 : 0
        await sleep((pollIntervalSeconds + extra) * 1000)
        continue
      }
      throw new Error(`Device code polling failed: ${res.status} ${err}`)
    }
    throw new Error('Device code polling timed out')
  }

  /**
   * Get a valid access token, refreshing if needed. Concurrent calls during a
   * refresh share the same in-flight promise (mutex).
   */
  async getAccessToken(): Promise<string> {
    const bundle = await this.loadBundle()
    if (!bundle) {
      throw new Error('No OAuth2 token bundle; device-code flow must be completed first')
    }
    if (bundle.expiresAt - Date.now() > TOKEN_SKEW_MS) {
      return bundle.accessToken
    }
    const refreshed = await this.refreshBundle(bundle)
    return refreshed.accessToken
  }

  /**
   * Force a refresh using the current refresh token. Mutex-protected so that
   * parallel callers share a single network request.
   */
  async refreshBundle(current?: TokenBundle | null): Promise<TokenBundle> {
    if (this.refreshInFlight) return this.refreshInFlight
    this.refreshInFlight = (async () => {
      try {
        const base = current ?? (await this.loadBundle())
        if (!base) throw new Error('No refresh token available')
        const body = new URLSearchParams({
          client_id: this.clientId,
          grant_type: 'refresh_token',
          refresh_token: base.refreshToken,
          scope: REQUIRED_SCOPES.join(' '),
        })
        const res = await this.fetchImpl(this.tokenUrl(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: body.toString(),
        })
        if (!res.ok) {
          const text = await safeText(res)
          throw new Error(`Token refresh failed: ${res.status} ${text}`)
        }
        const tr = (await res.json()) as TokenResponse
        // Preserve the old refresh token if Azure AD did not rotate it.
        const refreshToken = tr.refresh_token ?? base.refreshToken
        const bundle: TokenBundle = {
          accessToken: tr.access_token,
          refreshToken,
          expiresAt: Date.now() + tr.expires_in * 1000,
          scope: tr.scope,
          tokenType: tr.token_type,
        }
        await this.persist(bundle)
        return bundle
      } finally {
        this.refreshInFlight = null
      }
    })()
    return this.refreshInFlight
  }

  /** Clear persisted credentials. */
  async logout(): Promise<void> {
    this.cachedBundle = null
    await this.secrets.delete(SECRETS_KEY_TOKEN_BUNDLE)
  }

  /** Load the current bundle from secrets (cached in memory). */
  async loadBundle(): Promise<TokenBundle | null> {
    if (this.cachedBundle) return this.cachedBundle
    const raw = await this.secrets.get(SECRETS_KEY_TOKEN_BUNDLE)
    if (!raw) return null
    try {
      const parsed = JSON.parse(raw) as TokenBundle
      this.cachedBundle = parsed
      return parsed
    } catch (e) {
      this.logger?.warn({ err: (e as Error).message }, 'Failed to parse stored token bundle')
      return null
    }
  }

  private async persist(bundle: TokenBundle): Promise<void> {
    this.cachedBundle = bundle
    await this.secrets.set(SECRETS_KEY_TOKEN_BUNDLE, JSON.stringify(bundle))
  }

  private toBundle(tr: TokenResponse): TokenBundle {
    if (!tr.refresh_token) {
      throw new Error('Token response missing refresh_token; was offline_access requested?')
    }
    return {
      accessToken: tr.access_token,
      refreshToken: tr.refresh_token,
      expiresAt: Date.now() + tr.expires_in * 1000,
      scope: tr.scope,
      tokenType: tr.token_type,
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text()
  } catch {
    return ''
  }
}

async function safeJson(res: Response): Promise<unknown> {
  try {
    return await res.json()
  } catch {
    return null
  }
}

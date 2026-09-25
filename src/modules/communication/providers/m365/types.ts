// Part of eYssen. See LICENSE file for full copyright and licensing details.

/**
 * Microsoft Graph email provider — internal types.
 *
 * External surface is re-exported via ./index.ts; prefer importing the unified
 * EmailProvider / InboundEmail / OutboundEmail from ../email-common/types.
 */

/**
 * Graph API base URL. Hardcoded to prevent SSRF via config.
 */
export const GRAPH_BASE_URL = 'https://graph.microsoft.com/v1.0' as const

/**
 * OAuth2 token endpoint (tenant id is interpolated).
 */
export const OAUTH_TOKEN_ENDPOINT =
  'https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token' as const

/**
 * OAuth2 device-code endpoint.
 */
export const OAUTH_DEVICE_CODE_ENDPOINT =
  'https://login.microsoftonline.com/{tenant}/oauth2/v2.0/devicecode' as const

/**
 * Required OAuth2 scopes for mail access. offline_access is required to obtain
 * a refresh token for long-lived, unattended operation.
 */
export const REQUIRED_SCOPES = [
  'Mail.Read',
  'Mail.ReadWrite',
  'Mail.Send',
  'offline_access',
] as const

/**
 * Default attachment size cap (25 MB). Larger attachments are skipped.
 */
export const DEFAULT_MAX_ATTACHMENT_SIZE_BYTES = 25 * 1024 * 1024

/**
 * Default HTTP timeout in milliseconds.
 */
export const DEFAULT_HTTP_TIMEOUT_MS = 30_000

/**
 * Default listener polling interval in milliseconds.
 */
export const DEFAULT_POLL_INTERVAL_MS = 60_000

export interface M365ProviderConfig {
  /** Azure AD application (client) id */
  clientId: string
  /** Azure AD tenant id or 'common' */
  tenantId: string
  /** Listener polling interval (ms). Default: 60000. */
  pollIntervalMs?: number
  /** Attachment size cap (bytes). Default: 25 MB. */
  maxAttachmentSizeBytes?: number
  /** HTTP timeout (ms). Default: 30000. */
  httpTimeoutMs?: number
  /** Explicit base URL override — strictly validated (must be graph.microsoft.com) */
  baseUrl?: string
}

/**
 * Minimal async secrets interface consumed by the provider.
 * Implementations in the EYAS secrets module provide this surface.
 */
export interface SecretsLike {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<void>
  delete(key: string): Promise<void>
}

/**
 * Minimal logger surface (pino-compatible subset).
 */
export interface LoggerLike {
  info(obj: unknown, msg?: string): void
  warn(obj: unknown, msg?: string): void
  error(obj: unknown, msg?: string): void
  debug(obj: unknown, msg?: string): void
}

/**
 * OAuth2 token bundle stored/retrieved via secrets.
 */
export interface TokenBundle {
  accessToken: string
  refreshToken: string
  /** ms since epoch when the access token expires */
  expiresAt: number
  scope: string
  tokenType: string
}

export interface DeviceCodeResponse {
  user_code: string
  device_code: string
  verification_uri: string
  expires_in: number
  interval: number
  message: string
}

export interface TokenResponse {
  access_token: string
  refresh_token?: string
  expires_in: number
  scope: string
  token_type: string
}

export interface DeviceCodePollOptions {
  /** Maximum time to poll, in ms. Defaults to device_code expires_in * 1000. */
  timeoutMs?: number
  /** Override poll interval (seconds). */
  intervalSecondsOverride?: number
  /** Callback invoked with user_code + verification_uri so UI can prompt. */
  onPrompt?: (info: { userCode: string; verificationUri: string; message: string }) => void
}

/**
 * Secrets keys. Namespaced under 'email-m365:' to avoid collision.
 */
export const SECRETS_KEY_TOKEN_BUNDLE = 'email-m365:token-bundle'
export const SECRETS_KEY_DELTA_LINK = 'email-m365:delta-link'

/**
 * Provider dependencies injected by the host (communication module).
 */
export interface M365ProviderDeps {
  config: M365ProviderConfig
  secrets: SecretsLike
  logger?: LoggerLike
  /**
   * Optional fetch injection for testing. Defaults to globalThis.fetch.
   */
  fetch?: typeof fetch
}

/**
 * Graph API message schema (subset used by the provider).
 * Only the fields we actually consume are typed; anything else is ignored.
 */
export interface GraphEmailAddress {
  name?: string
  address?: string
}

export interface GraphRecipient {
  emailAddress?: GraphEmailAddress
}

export interface GraphBody {
  contentType?: 'text' | 'html' | string
  content?: string
}

export interface GraphInternetMessageHeader {
  name: string
  value: string
}

export interface GraphAttachment {
  id?: string
  name?: string
  contentType?: string
  size?: number
  isInline?: boolean
  '@odata.type'?: string
}

export interface GraphMessage {
  id: string
  internetMessageId?: string
  conversationId?: string
  subject?: string
  from?: GraphRecipient
  sender?: GraphRecipient
  toRecipients?: GraphRecipient[]
  ccRecipients?: GraphRecipient[]
  body?: GraphBody
  bodyPreview?: string
  receivedDateTime?: string
  internetMessageHeaders?: GraphInternetMessageHeader[]
  hasAttachments?: boolean
  attachments?: GraphAttachment[]
  parentFolderId?: string
}

export interface GraphDeltaResponse {
  value: GraphMessage[]
  '@odata.nextLink'?: string
  '@odata.deltaLink'?: string
}

export interface GraphSendMailPayload {
  message: {
    subject: string
    body: GraphBody
    toRecipients: GraphRecipient[]
    ccRecipients?: GraphRecipient[]
    bccRecipients?: GraphRecipient[]
    attachments?: Array<{
      '@odata.type': '#microsoft.graph.fileAttachment'
      name: string
      contentType: string
      contentBytes: string
    }>
    internetMessageHeaders?: GraphInternetMessageHeader[]
  }
  saveToSentItems: boolean
}

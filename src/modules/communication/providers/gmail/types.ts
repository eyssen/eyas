// Part of eYssen. See LICENSE file for full copyright and licensing details.

/**
 * Gmail provider-specific types.
 *
 * Gmail API reference: https://developers.google.com/gmail/api/reference/rest
 * MIME messages returned by Gmail are exposed as a parsed JSON tree
 * (headers + multipart payload tree) OR as base64url-encoded raw bytes when
 * format=raw is requested. This provider uses format=full.
 */

import type { Logger } from 'pino'

export const GMAIL_BASE_URL = 'https://gmail.googleapis.com/gmail/v1/users/me'
export const GMAIL_OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token'
export const GMAIL_OAUTH_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'

export const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.labels',
] as const

export const ATTACHMENT_SIZE_CAP_BYTES = 25 * 1024 * 1024
export const HTTP_TIMEOUT_MS = 30_000

/**
 * Narrow fetch signature — avoids the `preconnect` method requirement on
 * `typeof fetch` which makes vi.fn() mocks non-assignable.
 */
export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>

/**
 * Minimal abstraction over secret storage (aligns with ctx.secrets contract).
 * Values must be redacted in logs by the caller.
 */
export interface SecretsStore {
  get(key: string): Promise<string | undefined>
  set(key: string, value: string): Promise<void>
  delete(key: string): Promise<void>
}

export interface GmailTokens {
  accessToken: string
  refreshToken: string
  /** ms since epoch */
  expiresAt: number
  scope: string
  tokenType: string
}

export interface GmailOAuthConfig {
  clientId: string
  /** Optional for installed apps using PKCE. Required for confidential clients. */
  clientSecret?: string
  redirectUri: string
  scopes?: readonly string[]
}

export interface GmailProviderConfig {
  oauth: GmailOAuthConfig
  secrets: SecretsStore
  /** Secret key used for persisted tokens */
  tokenSecretKey?: string
  /** Secret key used for persisted historyId */
  historyIdSecretKey?: string
  pollIntervalMs?: number
  /** Injected fetch for testability — narrow shape (no preconnect requirement) */
  fetchImpl?: FetchLike
  /** Injected PKCE primitives for deterministic tests */
  pkce?: PkceGenerator
  logger: Logger
}

export interface PkceGenerator {
  generateVerifier(): string
  deriveChallenge(verifier: string): Promise<string>
}

/**
 * Gmail "Message" payload shape — narrow subset used by this provider.
 * See https://developers.google.com/gmail/api/reference/rest/v1/users.messages#Message
 */
export interface GmailHeader {
  name: string
  value: string
}

export interface GmailPayloadBody {
  size?: number
  data?: string
  attachmentId?: string
}

export interface GmailPayloadPart {
  partId?: string
  mimeType?: string
  filename?: string
  headers?: GmailHeader[]
  body?: GmailPayloadBody
  parts?: GmailPayloadPart[]
}

export interface GmailMessageResource {
  id: string
  threadId?: string
  labelIds?: string[]
  snippet?: string
  historyId?: string
  internalDate?: string
  payload?: GmailPayloadPart
  sizeEstimate?: number
}

export interface GmailHistoryEntry {
  id: string
  messages?: { id: string; threadId?: string }[]
  messagesAdded?: { message: { id: string; threadId?: string; labelIds?: string[] } }[]
}

export interface GmailHistoryListResponse {
  history?: GmailHistoryEntry[]
  nextPageToken?: string
  historyId?: string
}

export interface GmailMessagesListResponse {
  messages?: { id: string; threadId?: string }[]
  nextPageToken?: string
  resultSizeEstimate?: number
}

export interface GmailAttachmentResponse {
  size?: number
  data?: string
}

export interface GmailSendResponse {
  id: string
  threadId?: string
  labelIds?: string[]
}

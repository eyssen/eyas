// Part of eYssen. See LICENSE file for full copyright and licensing details.

/**
 * Microsoft 365 email provider.
 *
 * Self-contained, MIT-compatible. Uses only built-in fetch/crypto.
 * Integration with the communication router will be wired in a later session.
 */

import type {
  EmailProvider,
  FetchedAttachment,
  InboundEmail,
  OutboundEmail,
  SendResult,
} from '../email-common/types.js'
import { GraphClient } from './graph-client.js'
import { DeltaListener } from './listener.js'
import { mimeToInbound } from './mime-to-inbound.js'
import { OAuth2Flow } from './oauth2-flow.js'
import { outboundToMime } from './outbound-to-mime.js'
import {
  DEFAULT_MAX_ATTACHMENT_SIZE_BYTES,
  DEFAULT_POLL_INTERVAL_MS,
  GraphMessage,
  M365ProviderDeps,
} from './types.js'

export { GraphClient, validateBaseUrl } from './graph-client.js'
export { OAuth2Flow } from './oauth2-flow.js'
export { DeltaListener } from './listener.js'
export { mimeToInbound } from './mime-to-inbound.js'
export { outboundToMime } from './outbound-to-mime.js'
export { m365ProviderManifest } from './manifest.js'
export type {
  DeviceCodePollOptions,
  DeviceCodeResponse,
  M365ProviderConfig,
  M365ProviderDeps,
  SecretsLike,
  TokenBundle,
  TokenResponse,
} from './types.js'
export {
  DEFAULT_HTTP_TIMEOUT_MS,
  DEFAULT_MAX_ATTACHMENT_SIZE_BYTES,
  DEFAULT_POLL_INTERVAL_MS,
  GRAPH_BASE_URL,
  REQUIRED_SCOPES,
  SECRETS_KEY_DELTA_LINK,
  SECRETS_KEY_TOKEN_BUNDLE,
} from './types.js'

/**
 * Factory that wires OAuth2 + GraphClient + DeltaListener into an EmailProvider.
 */
export function createM365EmailProvider(deps: M365ProviderDeps): EmailProvider {
  const { config, secrets, logger, fetch: fetchImpl } = deps

  const oauth = new OAuth2Flow({
    clientId: config.clientId,
    tenantId: config.tenantId,
    secrets,
    ...(logger ? { logger } : {}),
    ...(fetchImpl ? { fetch: fetchImpl } : {}),
  })

  const graph = new GraphClient({
    oauth,
    ...(config.baseUrl ? { baseUrl: config.baseUrl } : {}),
    ...(config.httpTimeoutMs ? { timeoutMs: config.httpTimeoutMs } : {}),
    ...(logger ? { logger } : {}),
    ...(fetchImpl ? { fetch: fetchImpl } : {}),
  })

  const maxSize = config.maxAttachmentSizeBytes ?? DEFAULT_MAX_ATTACHMENT_SIZE_BYTES
  const pollIntervalMs = config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
  let stopListener: (() => Promise<void>) | null = null

  const provider: EmailProvider = {
    id: 'email-m365',

    async init(): Promise<void> {
      // No-op here; device-code flow is expected to have completed in the
      // setup wizard. Touch the token (will throw if not yet authorized).
      try {
        await oauth.getAccessToken()
      } catch (e) {
        logger?.warn(
          { err: (e as Error).message },
          'M365 provider init: no access token available — setup wizard must run first',
        )
      }
    },

    async listUnread(since?: number): Promise<InboundEmail[]> {
      const filters: string[] = ['isRead eq false']
      if (since && since > 0) {
        const iso = new Date(since).toISOString()
        filters.push(`receivedDateTime ge ${iso}`)
      }
      const res = await graph.request<{ value: GraphMessage[] }>({
        method: 'GET',
        path: '/me/mailFolders/Inbox/messages',
        query: {
          $filter: filters.join(' and '),
          $top: '50',
        },
      })
      return (res.value ?? []).map((m) => mimeToInbound(m, { maxAttachmentSizeBytes: maxSize }))
    },

    async startListener(
      onMessage: (m: InboundEmail) => void | Promise<void>,
    ): Promise<() => Promise<void>> {
      if (stopListener) {
        logger?.warn({}, 'Listener already running; stopping previous instance')
        await stopListener()
      }
      const listener = new DeltaListener({
        graph,
        secrets,
        pollIntervalMs,
        maxAttachmentSizeBytes: maxSize,
        ...(logger ? { logger } : {}),
      })
      stopListener = await listener.start(onMessage)
      return stopListener
    },

    async send(message: OutboundEmail): Promise<SendResult> {
      const payload = outboundToMime(message)
      await graph.request<void>({
        method: 'POST',
        path: '/me/sendMail',
        body: payload,
      })
      // Graph sendMail returns 202 with no message id; surface a generated one.
      return { providerMessageId: `m365:${Date.now()}-${Math.random().toString(36).slice(2, 10)}` }
    },

    async fetchAttachment(
      messageId: string,
      attachmentId: string,
    ): Promise<FetchedAttachment> {
      const att = await graph.request<{
        name?: string
        contentType?: string
        contentBytes?: string
        size?: number
      }>({
        method: 'GET',
        path: `/me/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`,
      })
      if (typeof att.size === 'number' && att.size > maxSize) {
        throw new Error(`Attachment exceeds size cap: ${att.size} > ${maxSize}`)
      }
      const contentType = att.contentType ?? 'application/octet-stream'
      const data = decodeBase64(att.contentBytes ?? '')
      return {
        filename: att.name ?? 'attachment',
        contentType,
        data,
      }
    },

    async markAsRead(messageId: string): Promise<void> {
      await graph.request<void>({
        method: 'PATCH',
        path: `/me/messages/${encodeURIComponent(messageId)}`,
        body: { isRead: true },
      })
    },

    async archive(messageId: string): Promise<void> {
      // Move to Archive folder via well-known name.
      await graph.request<void>({
        method: 'POST',
        path: `/me/messages/${encodeURIComponent(messageId)}/move`,
        body: { destinationId: 'archive' },
      })
    },
  }

  return provider
}

function decodeBase64(b64: string): Uint8Array {
  const g = globalThis as {
    Buffer?: { from: (s: string, enc: string) => Uint8Array }
  }
  if (g.Buffer) {
    return new Uint8Array(g.Buffer.from(b64, 'base64'))
  }
  // eslint-disable-next-line no-undef
  const binary = atob(b64)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

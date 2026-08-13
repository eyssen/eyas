// Part of eYssen. See LICENSE file for full copyright and licensing details.

/**
 * Factory entry point for the Gmail email provider.
 *
 * The communication router calls createGmailProvider(deps) once per configured
 * account. The returned EmailProvider exposes a uniform surface (listUnread,
 * startListener, send, fetchAttachment, markAsRead, archive).
 */

import type {
  EmailProvider,
  FetchedAttachment,
  InboundEmail,
  OutboundEmail,
  SendResult,
} from '../email-common/types.js'
import { GmailClient } from './gmail-client.js'
import { GmailListener } from './listener.js'
import { gmailMessageToInbound, base64UrlDecode } from './mime-to-inbound.js'
import { outboundToGmailRaw } from './outbound-to-mime.js'
import { TokenManager } from './oauth2-flow.js'
import { ATTACHMENT_SIZE_CAP_BYTES, type GmailProviderConfig } from './types.js'

export interface GmailProviderDeps extends GmailProviderConfig {}

export function createGmailProvider(deps: GmailProviderDeps): EmailProvider {
  const tokenKey = deps.tokenSecretKey ?? 'gmail:tokens'
  const historyKey = deps.historyIdSecretKey ?? 'gmail:historyId'
  const tokens = new TokenManager({
    secrets: deps.secrets,
    secretKey: tokenKey,
    oauth: deps.oauth,
    fetchImpl: deps.fetchImpl,
    logger: deps.logger,
  })
  const client = new GmailClient({
    tokens,
    fetchImpl: deps.fetchImpl,
    logger: deps.logger,
  })

  let listener: GmailListener | null = null

  return {
    id: 'gmail',

    async init(): Promise<void> {
      // No-op placeholder — surface for future warmup (e.g. prefetching profile).
      const existing = await tokens.load()
      if (!existing) {
        deps.logger.warn('Gmail provider: no stored tokens — run OAuth flow before use')
      }
    },

    async listUnread(): Promise<InboundEmail[]> {
      const list = await client.listUnread({ maxResults: 50 })
      const out: InboundEmail[] = []
      for (const ref of list.messages ?? []) {
        try {
          const full = await client.getMessage(ref.id, 'full')
          out.push(gmailMessageToInbound(full))
        } catch (err) {
          deps.logger.warn({ err, id: ref.id }, 'Gmail: listUnread skipped message')
        }
      }
      return out
    },

    async startListener(onMessage): Promise<() => Promise<void>> {
      if (listener) throw new Error('Gmail provider: listener already started')
      listener = new GmailListener({
        client,
        secrets: deps.secrets,
        historyIdSecretKey: historyKey,
        onMessage,
        pollIntervalMs: deps.pollIntervalMs,
        logger: deps.logger,
      })
      return listener.start()
    },

    async send(message: OutboundEmail): Promise<SendResult> {
      const raw = outboundToGmailRaw(message)
      const res = await client.sendRaw(raw)
      return { providerMessageId: res.id }
    },

    async fetchAttachment(messageId: string, attachmentId: string): Promise<FetchedAttachment> {
      const res = await client.getAttachment(messageId, attachmentId)
      if (!res.data) throw new Error(`Gmail: attachment ${attachmentId} returned no data`)
      const data = base64UrlDecode(res.data)
      if (data.byteLength > ATTACHMENT_SIZE_CAP_BYTES) {
        throw new Error(`Gmail: decoded attachment exceeds ${ATTACHMENT_SIZE_CAP_BYTES} byte cap`)
      }
      // Fetch message metadata lazily to resolve filename/contentType from the payload.
      // We do a best-effort lookup; if it fails, fall back to octet-stream.
      let contentType = 'application/octet-stream'
      let filename = attachmentId
      try {
        const full = await client.getMessage(messageId, 'full')
        const match = findAttachmentMeta(full.payload, attachmentId)
        if (match) {
          contentType = match.contentType
          filename = match.filename
        }
      } catch {
        // best-effort only
      }
      return { contentType, data, filename }
    },

    async markAsRead(messageId: string): Promise<void> {
      await client.modifyLabels(messageId, { removeLabelIds: ['UNREAD'] })
    },

    async archive(messageId: string): Promise<void> {
      await client.modifyLabels(messageId, { removeLabelIds: ['INBOX'] })
    },
  }
}

function findAttachmentMeta(
  part: { mimeType?: string; filename?: string; body?: { attachmentId?: string }; parts?: unknown[] } | undefined,
  attachmentId: string,
): { contentType: string; filename: string } | null {
  if (!part) return null
  if (part.body?.attachmentId === attachmentId) {
    return {
      contentType: part.mimeType ?? 'application/octet-stream',
      filename: part.filename ?? attachmentId,
    }
  }
  for (const sub of (part.parts ?? []) as typeof part[]) {
    const found = findAttachmentMeta(sub, attachmentId)
    if (found) return found
  }
  return null
}

export { createGmailProvider as default }

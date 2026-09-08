// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Google Chat channel via HTTP webhook (Chat API event subscription).
// Outbound uses the Chat API with a service-account access token when provided.

import type { Logger } from 'pino'
import type { Channel, ChannelContent, ChannelMessage } from '../../types.js'

export function createGoogleChatBot(config: {
  /** Google Chat project / space config presence = configured. */
  projectId?: string
  /** Optional bearer token for Chat API outbound. */
  accessToken?: string
  /** Default space name (spaces/XXXX). */
  defaultSpace?: string
  logger: Logger
  onActivity?: () => void
  onError?: (err: unknown) => void
}): Channel & {
  isConfigured: boolean
  /** Ingest a Chat event JSON body (from HTTP webhook). */
  ingestEvent(event: any): Promise<void>
} {
  const { logger, projectId, accessToken, defaultSpace, onActivity, onError } = config
  const handlers: ((msg: ChannelMessage) => Promise<void>)[] = []
  let connected = false

  return {
    id: 'googlechat',
    type: 'googlechat' as any,
    name: 'Google Chat',
    get connected() { return connected },
    isConfigured: !!projectId,

    async connect() {
      if (!projectId) {
        logger.debug('Google Chat: not configured (no project id)')
        return
      }
      connected = true
      logger.info('Google Chat channel ready (webhook ingest)')
    },

    async disconnect() {
      connected = false
    },

    async send(target: string, content: ChannelContent) {
      if (!accessToken) {
        logger.warn('Google Chat: send skipped (no access token)')
        return
      }
      const space = target || defaultSpace
      if (!space) {
        logger.warn('Google Chat: send skipped (no space)')
        return
      }
      try {
        const res = await fetch(`https://chat.googleapis.com/v1/${space}/messages`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ text: content.text ?? '' }),
        })
        if (!res.ok) {
          throw new Error(`Chat API ${res.status}: ${(await res.text()).slice(0, 200)}`)
        }
      } catch (err) {
        logger.error({ err, space }, 'Google Chat: send failed')
        onError?.(err)
      }
    },

    async reply(originalMsg: ChannelMessage, content: ChannelContent) {
      await this.send(originalMsg.channelId, content)
    },

    onMessage(handler) {
      handlers.push(handler)
    },

    async ingestEvent(event: any) {
      onActivity?.()
      // Chat API MESSAGE event
      const message = event?.message ?? event?.chat?.message
      if (!message?.text && !message?.argumentText) return
      const spaceName = message.space?.name ?? event.space?.name ?? 'unknown'
      const sender = message.sender?.name ?? message.sender?.displayName ?? 'unknown'
      const channelMsg: ChannelMessage = {
        id: String(message.name ?? message.createTime ?? Date.now()),
        channelType: 'googlechat' as any,
        channelId: spaceName,
        senderId: sender,
        senderName: message.sender?.displayName ?? sender,
        content: String(message.argumentText ?? message.text ?? ''),
        timestamp: new Date().toISOString(),
      }
      for (const h of handlers) {
        try { await h(channelMsg) }
        catch (err) { logger.error({ err }, 'Google Chat: handler error'); onError?.(err) }
      }
    },
  }
}

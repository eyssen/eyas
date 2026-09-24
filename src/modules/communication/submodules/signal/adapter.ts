// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { Logger } from 'pino'
import type { Channel, ChannelContent, ChannelMessage } from '../../types.js'

/**
 * Signal adapter via signal-cli HTTP bridge.
 * Receives messages via SSE at /api/v1/receive/{number},
 * sends messages via POST /api/v2/send.
 */
export function createSignalAdapter(config: {
  signalCliUrl?: string
  accountNumber?: string
  logger: Logger
}): Channel & { isConfigured: boolean } {
  const { signalCliUrl, accountNumber, logger } = config
  const handlers: ((msg: ChannelMessage) => Promise<void>)[] = []
  let sseController: AbortController | undefined
  let connected = false

  const isConfigured = !!(signalCliUrl && accountNumber)

  async function startSseReceiver() {
    if (!signalCliUrl || !accountNumber) return
    sseController = new AbortController()
    const url = `${signalCliUrl}/api/v1/receive/${encodeURIComponent(accountNumber)}`
    try {
      const res = await fetch(url, {
        signal: sseController.signal,
        headers: { Accept: 'text/event-stream' },
      })
      if (!res.ok || !res.body) {
        logger.warn({ status: res.status }, 'Signal: SSE stream failed to open')
        return
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith('data:')) continue
          const raw = line.slice(5).trim()
          if (!raw) continue
          try {
            const event = JSON.parse(raw)
            const envelope = event?.envelope
            if (!envelope?.dataMessage?.message) continue
            const channelMsg: ChannelMessage = {
              id: `signal-${envelope.timestamp}`,
              channelType: 'signal',
              channelId: accountNumber,
              senderId: envelope.source ?? envelope.sourceNumber ?? 'unknown',
              senderName: envelope.sourceName ?? undefined,
              content: envelope.dataMessage.message,
              timestamp: new Date(envelope.timestamp).toISOString(),
            }
            for (const handler of handlers) {
              try { await handler(channelMsg) }
              catch (err) { logger.error({ err }, 'Signal: handler error') }
            }
          } catch (parseErr) {
            logger.debug({ parseErr, line }, 'Signal: failed to parse SSE event')
          }
        }
      }
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        logger.warn({ err }, 'Signal: SSE receiver error')
      }
    }
  }

  return {
    id: 'signal',
    type: 'signal',
    name: 'Signal (signal-cli)',
    get connected() { return connected },
    isConfigured,

    async connect() {
      if (!isConfigured) {
        logger.debug('Signal: not configured (missing signalCliUrl or accountNumber)')
        return
      }
      connected = true
      logger.info({ signalCliUrl, accountNumber }, 'Signal adapter connected')
      // Start SSE receiver in background — do not await
      startSseReceiver().catch((err) => logger.error({ err }, 'Signal: SSE receiver crashed'))
    },

    async disconnect() {
      sseController?.abort()
      sseController = undefined
      connected = false
      logger.info('Signal adapter disconnected')
    },

    async send(recipient: string, content: ChannelContent) {
      if (!connected || !signalCliUrl || !accountNumber) return
      try {
        const res = await fetch(`${signalCliUrl}/api/v2/send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            number: accountNumber,
            recipients: [recipient],
            message: content.text ?? '',
          }),
        })
        if (!res.ok) {
          const err = await res.text()
          logger.error({ status: res.status, err, recipient }, 'Signal: send failed')
        }
      } catch (err) {
        logger.error({ err, recipient }, 'Signal: send error')
      }
    },

    async reply(originalMsg: ChannelMessage, content: ChannelContent) {
      await this.send(originalMsg.senderId, content)
    },

    onMessage(handler) {
      handlers.push(handler)
    },
  }
}

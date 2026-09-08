// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { Logger } from 'pino'
import type { Channel, ChannelContent, ChannelMessage } from '../../types.js'

/**
 * Slack bot channel using @slack/bolt with Socket Mode.
 * Uses dynamic import so the adapter gracefully degrades if @slack/bolt is not installed.
 */
export function createSlackBot(config: {
  botToken?: string
  appToken?: string
  logger: Logger
}): Channel & { isConfigured: boolean } {
  const { botToken, appToken, logger } = config
  const handlers: ((msg: ChannelMessage) => Promise<void>)[] = []
  let app: any
  let webClient: any
  let connected = false

  const isConfigured = !!botToken && !!appToken

  return {
    id: 'slack',
    type: 'slack',
    name: 'Slack Bot',
    get connected() { return connected },
    isConfigured,

    async connect() {
      if (!isConfigured) {
        logger.debug('Slack: not configured (missing BOT_TOKEN or APP_TOKEN)')
        return
      }
      try {
        const { App } = await import('@slack/bolt')
        app = new App({
          token: botToken,
          appToken: appToken,
          socketMode: true,
          logLevel: 'error',
        })

        app.message(async ({ message, client }: any) => {
          if (message.subtype) return // skip bot/system messages
          webClient = client
          const channelMsg: ChannelMessage = {
            id: message.ts,
            channelType: 'slack',
            channelId: message.channel,
            senderId: message.user ?? 'unknown',
            content: message.text ?? '',
            timestamp: new Date(Number(message.ts) * 1000).toISOString(),
          }
          for (const handler of handlers) {
            try { await handler(channelMsg) }
            catch (err) { logger.error({ err }, 'Slack: handler error') }
          }
        })

        await app.start()
        connected = true
        logger.info('Slack bot connected via Socket Mode')
      } catch (err) {
        logger.warn({ err }, 'Slack: failed to connect (@slack/bolt may not be installed)')
      }
    },

    async disconnect() {
      if (app) {
        await app.stop().catch(() => {})
        app = undefined
      }
      connected = false
      logger.info('Slack bot disconnected')
    },

    async send(channelId: string, content: ChannelContent) {
      if (!app || !connected) return
      try {
        await app.client.chat.postMessage({
          channel: channelId,
          text: content.text ?? '',
        })
      } catch (err) {
        logger.error({ err, channelId }, 'Slack: send failed')
      }
    },

    async reply(originalMsg: ChannelMessage, content: ChannelContent) {
      if (!app || !connected) return
      try {
        await app.client.chat.postMessage({
          channel: originalMsg.channelId,
          thread_ts: originalMsg.id,
          text: content.text ?? '',
        })
      } catch (err) {
        logger.error({ err }, 'Slack: reply failed')
      }
    },

    onMessage(handler) {
      handlers.push(handler)
    },
  }
}

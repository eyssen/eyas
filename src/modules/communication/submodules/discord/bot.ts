// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { Logger } from 'pino'
import type { Channel, ChannelContent, ChannelMessage } from '../../types.js'

/**
 * Discord bot channel using discord.js.
 * Uses dynamic import so the adapter gracefully degrades if discord.js is not installed.
 */
export function createDiscordBot(config: {
  botToken?: string
  logger: Logger
}): Channel & { isConfigured: boolean } {
  const { botToken, logger } = config
  const handlers: ((msg: ChannelMessage) => Promise<void>)[] = []
  let client: any
  let connected = false

  return {
    id: 'discord',
    type: 'discord',
    name: 'Discord Bot',
    get connected() { return connected },
    isConfigured: !!botToken,

    async connect() {
      if (!botToken) {
        logger.debug('Discord: not configured (no BOT_TOKEN)')
        return
      }
      try {
        const { Client, GatewayIntentBits } = await import('discord.js')
        client = new Client({
          intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMessages,
            GatewayIntentBits.MessageContent,
            GatewayIntentBits.DirectMessages,
          ],
        })

        client.on('messageCreate', async (message: any) => {
          if (message.author.bot) return
          const channelMsg: ChannelMessage = {
            id: message.id,
            channelType: 'discord',
            channelId: message.channelId,
            senderId: message.author.id,
            senderName: message.author.username,
            content: message.content,
            timestamp: message.createdAt.toISOString(),
          }
          for (const handler of handlers) {
            try { await handler(channelMsg) }
            catch (err) { logger.error({ err }, 'Discord: handler error') }
          }
        })

        client.once('ready', () => {
          connected = true
          logger.info({ tag: client.user?.tag }, 'Discord bot connected')
        })

        await client.login(botToken)
      } catch (err) {
        logger.warn({ err }, 'Discord: failed to connect (discord.js may not be installed)')
      }
    },

    async disconnect() {
      if (client) {
        client.destroy()
        client = undefined
      }
      connected = false
      logger.info('Discord bot disconnected')
    },

    async send(channelId: string, content: ChannelContent) {
      if (!client || !connected) return
      try {
        const channel = await client.channels.fetch(channelId)
        if (channel?.isTextBased()) {
          await channel.send(content.text ?? '')
        }
      } catch (err) {
        logger.error({ err, channelId }, 'Discord: send failed')
      }
    },

    async reply(originalMsg: ChannelMessage, content: ChannelContent) {
      if (!client || !connected) return
      try {
        const channel = await client.channels.fetch(originalMsg.channelId)
        if (channel?.isTextBased()) {
          const fetched = await channel.messages.fetch(originalMsg.id)
          await fetched.reply(content.text ?? '')
        }
      } catch (err) {
        logger.error({ err }, 'Discord: reply failed')
      }
    },

    onMessage(handler) {
      handlers.push(handler)
    },
  }
}

// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { Logger } from 'pino'
import type { Channel, ChannelContent, ChannelMessage, ChannelRouter } from './types.js'

export function createChannelRouter(
  logger: Logger,
  channelConfigService?: { getByChannelId(id: string): { agentId: string | null } | null },
): ChannelRouter {
  const channels = new Map<string, Channel>()
  const messageHandlers: ((msg: ChannelMessage) => Promise<void>)[] = []

  return {
    register(channel: Channel) {
      channels.set(channel.id, channel)
      channel.onMessage(async (msg) => {
        // Stamp the connector so multi-instance setups bind by EYAS channel id,
        // not by the provider peer id (chat/phone/email).
        msg.connectorId = channel.id

        // Prefer connector binding; fall back to per-peer override rows.
        if (channelConfigService) {
          const config =
            channelConfigService.getByChannelId(channel.id) ??
            channelConfigService.getByChannelId(msg.channelId)
          if (config?.agentId) {
            msg.resolvedAgentId = config.agentId
          }
        }

        for (const handler of messageHandlers) {
          try {
            await handler(msg)
          } catch (err) {
            logger.error({ err, channelId: channel.id }, 'Channel message handler error')
          }
        }
      })
      logger.info({ channelId: channel.id, type: channel.type }, 'Channel registered')
    },

    unregister(channelId: string) {
      const channel = channels.get(channelId)
      if (channel) {
        channel.disconnect().catch(() => {})
        channels.delete(channelId)
        logger.info({ channelId }, 'Channel unregistered')
      }
    },

    getChannel(id: string) {
      return channels.get(id)
    },

    listChannels() {
      return Array.from(channels.values())
    },

    async broadcast(content: ChannelContent, exclude?: string[]) {
      const promises = Array.from(channels.values())
        .filter((c) => c.connected && !exclude?.includes(c.id))
        .map((c) =>
          c.send('broadcast', content).catch((err) => logger.error({ err, channelId: c.id }, 'Broadcast failed')),
        )
      await Promise.allSettled(promises)
    },

    async route(message: ChannelMessage) {
      for (const handler of messageHandlers) {
        try {
          await handler(message)
        } catch (err) {
          logger.error({ err }, 'Route handler error')
        }
      }
    },

    onMessage(handler: (msg: ChannelMessage) => Promise<void>) {
      messageHandlers.push(handler)
    },
  }
}

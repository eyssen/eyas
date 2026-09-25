// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Outbound messaging tools for agents. Delivery goes through the communication
// channel router — never directly to a vendor SDK — so security-gate policy
// and channel health stay centralized.

import { z } from 'zod'
import type { ToolImplementation } from '../types.js'

export interface ChannelToolsWiring {
  /** Lazy: communication module may start after tools. */
  getRouter: () => {
    getChannel(id: string): { connected: boolean; send(target: string, content: { text?: string }): Promise<void> } | undefined
    listChannels(): { id: string; type: string; name: string; connected: boolean }[]
  } | null | undefined
}

export function createChannelTools(wiring: ChannelToolsWiring): ToolImplementation[] {
  return [
    {
      name: 'list_channels',
      description:
        'List communication channels available on this EYAS instance (Telegram, Slack, email, …) and whether each is connected. Use before channel_send to pick a valid channel id.',
      category: 'communication',
      riskTier: 'green',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
      async execute() {
        const router = wiring.getRouter()
        if (!router) return { error: 'Communication module unavailable' }
        const channels = router.listChannels().map((c) => ({
          id: c.id,
          type: c.type,
          name: c.name,
          connected: c.connected,
        }))
        return { channels }
      },
    },
    {
      name: 'channel_send',
      description:
        'Send a text message on a connected communication channel (Telegram chat id, Slack channel, email address, etc.). Prefer replying in the active inbound conversation when the user already messaged on a channel; use this for proactive outbound messages the user requested.',
      category: 'communication',
      riskTier: 'red',
      inputSchema: {
        type: 'object',
        properties: {
          channelId: {
            type: 'string',
            description: 'Router channel id (e.g. "telegram", "slack", "discord", "whatsapp"). Use list_channels first.',
          },
          target: {
            type: 'string',
            description: 'Destination on that channel: Telegram chat id, Slack channel id, email address, phone number, etc.',
          },
          text: {
            type: 'string',
            description: 'Message body to send.',
          },
        },
        required: ['channelId', 'target', 'text'],
        additionalProperties: false,
      },
      async execute(input: unknown) {
        const parsed = z
          .object({
            channelId: z.string().min(1),
            target: z.string().min(1),
            text: z.string().min(1),
          })
          .safeParse(input)
        if (!parsed.success) return { error: parsed.error.message }

        const router = wiring.getRouter()
        if (!router) return { error: 'Communication module unavailable' }

        const channel = router.getChannel(parsed.data.channelId)
        if (!channel) {
          const available = router.listChannels().map((c) => c.id)
          return { error: `Channel not found: ${parsed.data.channelId}`, available }
        }
        if (!channel.connected) {
          return { error: `Channel not connected: ${parsed.data.channelId}` }
        }

        try {
          await channel.send(parsed.data.target, { text: parsed.data.text })
          return {
            ok: true,
            channelId: parsed.data.channelId,
            target: parsed.data.target,
          }
        } catch (err: any) {
          return { error: err?.message ?? String(err) }
        }
      },
    },
  ]
}

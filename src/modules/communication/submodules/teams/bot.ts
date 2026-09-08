// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Microsoft Teams via Bot Framework activity webhook.
// Outbound uses the Bot Framework connector with a client-credentials token.

import type { Logger } from 'pino'
import type { Channel, ChannelContent, ChannelMessage } from '../../types.js'

export function createTeamsBot(config: {
  appId?: string
  appPassword?: string
  tenantId?: string
  logger: Logger
  onActivity?: () => void
  onError?: (err: unknown) => void
}): Channel & {
  isConfigured: boolean
  ingestActivity(activity: any): Promise<void>
} {
  const { logger, appId, appPassword, tenantId, onActivity, onError } = config
  const handlers: ((msg: ChannelMessage) => Promise<void>)[] = []
  let connected = false
  let cachedToken: { value: string; exp: number } | null = null

  async function getToken(): Promise<string | null> {
    if (!appId || !appPassword) return null
    if (cachedToken && cachedToken.exp > Date.now() + 60_000) return cachedToken.value
    const scope = 'https://api.botframework.com/.default'
    const tokenUrl = tenantId
      ? `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`
      : 'https://login.microsoftonline.com/botframework.com/oauth2/v2.0/token'
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: appId,
      client_secret: appPassword,
      scope,
    })
    const res = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    })
    if (!res.ok) throw new Error(`Teams token ${res.status}`)
    const json = await res.json() as { access_token: string; expires_in: number }
    cachedToken = { value: json.access_token, exp: Date.now() + (json.expires_in ?? 3600) * 1000 }
    return cachedToken.value
  }

  return {
    id: 'teams',
    type: 'teams' as any,
    name: 'Microsoft Teams',
    get connected() { return connected },
    isConfigured: !!(appId && appPassword),

    async connect() {
      if (!appId || !appPassword) {
        logger.debug('Teams: not configured (missing app id/password)')
        return
      }
      connected = true
      logger.info('Teams channel ready (activity webhook)')
    },

    async disconnect() {
      connected = false
      cachedToken = null
    },

    async send(target: string, content: ChannelContent) {
      // target format: serviceUrl|conversationId
      const [serviceUrl, conversationId] = target.split('|')
      if (!serviceUrl || !conversationId) {
        logger.warn({ target }, 'Teams: send requires serviceUrl|conversationId')
        return
      }
      try {
        const token = await getToken()
        if (!token) return
        const url = `${serviceUrl.replace(/\/+$/, '')}/v3/conversations/${encodeURIComponent(conversationId)}/activities`
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ type: 'message', text: content.text ?? '' }),
        })
        if (!res.ok) throw new Error(`Teams send ${res.status}: ${(await res.text()).slice(0, 200)}`)
      } catch (err) {
        logger.error({ err }, 'Teams: send failed')
        onError?.(err)
      }
    },

    async reply(originalMsg: ChannelMessage, content: ChannelContent) {
      await this.send(originalMsg.channelId, content)
    },

    onMessage(handler) {
      handlers.push(handler)
    },

    async ingestActivity(activity: any) {
      onActivity?.()
      if (activity?.type !== 'message' || !activity.text) return
      const serviceUrl = activity.serviceUrl ?? ''
      const conversationId = activity.conversation?.id ?? ''
      const channelMsg: ChannelMessage = {
        id: String(activity.id ?? Date.now()),
        channelType: 'teams' as any,
        channelId: `${serviceUrl}|${conversationId}`,
        senderId: activity.from?.id ?? 'unknown',
        senderName: activity.from?.name ?? 'Unknown',
        content: String(activity.text),
        timestamp: activity.timestamp ?? new Date().toISOString(),
      }
      for (const h of handlers) {
        try { await h(channelMsg) }
        catch (err) { logger.error({ err }, 'Teams: handler error'); onError?.(err) }
      }
    },
  }
}

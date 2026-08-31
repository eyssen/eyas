// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Connect / reconnect a channel *instance* (default catalog id or extra
// multi-agent instance). Secrets are resolved by the caller via getSecret so
// namespacing (legacy global vs channel.<id>.*) stays outside this file.

import type { Logger } from 'pino'
import type { Channel, ChannelRouter, ChannelType } from './types.js'
import { createTelegramBot } from './submodules/telegram/bot.js'
import { createDiscordBot } from './submodules/discord/bot.js'
import { createSlackBot } from './submodules/slack/bot.js'
import { createEmailAdapter } from './submodules/email/adapter.js'
import { createEmailChannelFromProvider } from './submodules/email/provider-bridge.js'
import { createWhatsAppAdapter } from './submodules/whatsapp/adapter.js'
import { createSignalAdapter } from './submodules/signal/adapter.js'
import { createGoogleChatBot } from './submodules/googlechat/bot.js'
import { createTeamsBot } from './submodules/teams/bot.js'
import { getCatalogEntry } from './channel-catalog.js'
import { templateIdFromConfig } from './channel-secret-keys.js'

export interface ChannelReconnectDeps {
  router: ChannelRouter
  logger: Logger
  /** Field name → vault value (already instance-scoped by the caller). */
  getSecret: (field: string) => Promise<string | undefined>
  store: Record<string, unknown>
  shouldPoll?: () => boolean
  onError?: (channelId: string, err: unknown) => void
  onActivity?: (channelId: string) => void
  /**
   * Pairing store for Telegram. When multi-instance, source is still 'telegram'
   * and peer chat ids are shared across bots (same owner).
   */
  pairing?: {
    isApproved: (id: string) => boolean
    requestPairing: (input: { channelId: string; senderName: string }) => { code: string | null; status: 'pending' | 'approved' }
    approveByChannel: (id: string) => boolean
    getPending: () => { chatId: string; code: string; senderName: string }[]
  }
  transcribeVoice?: (path: string) => Promise<string>
  voiceWorkDir?: string
  http?: any
  onCallbackQuery?: (input: {
    chatId: string
    senderId: string
    data: string
  }) => Promise<{ ok?: boolean; text?: string } | void>
}

export interface ReconnectInstanceInput {
  instanceId: string
  type: string
  name?: string
  /** channel_configs.config JSON (templateId etc.) */
  config?: Record<string, unknown>
}

async function replaceChannel(deps: ChannelReconnectDeps, id: string, channel: Channel): Promise<boolean> {
  try {
    deps.router.unregister(id)
  } catch {
    /* not registered */
  }
  await channel.connect()
  if (channel.connected) {
    deps.router.register(channel)
  }
  return channel.connected
}

function withId(channel: Channel, id: string, name?: string): Channel {
  return {
    get id() { return id },
    get type() { return channel.type },
    get name() { return name ?? channel.name },
    get connected() { return channel.connected },
    connect: () => channel.connect(),
    disconnect: () => channel.disconnect(),
    send: (t, c) => channel.send(t, c),
    reply: (m, c) => channel.reply(m, c),
    onMessage: (h) => channel.onMessage(h),
  }
}

/**
 * Connect one instance. `type` is the ChannelType; `templateId` (from config
 * or catalog) selects Gmail vs M365 vs generic email, etc.
 */
export async function reconnectChannelInstance(
  input: ReconnectInstanceInput,
  deps: ChannelReconnectDeps,
): Promise<{ connected: boolean; error?: string }> {
  const { instanceId, type, name, config } = input
  const templateId = templateIdFromConfig(config, instanceId, type)
  const template = getCatalogEntry(templateId)

  try {
    // Prefer template type when present (email-gmail → type email)
    const effectiveType = (template?.type ?? type) as ChannelType

    switch (templateId) {
      case 'email-gmail': {
        const clientId = await deps.getSecret('email-gmail-client-id')
        const clientSecret = await deps.getSecret('email-gmail-client-secret')
        const refreshToken = await deps.getSecret('email-gmail-refresh-token')
        const mailbox = await deps.getSecret('email-gmail-mailbox')
        if (!clientId || !clientSecret || !refreshToken || !mailbox) {
          return { connected: false, error: 'Missing Gmail OAuth secrets' }
        }
        const { createGmailProvider } = await import('./providers/gmail/index.js')
        const provider = createGmailProvider({ clientId, clientSecret, refreshToken, mailbox } as any)
        const channel = createEmailChannelFromProvider(provider, {
          channelId: mailbox,
          displayName: name ?? `Gmail (${mailbox})`,
          logger: deps.logger,
        })
        const wrapped = withId(channel, instanceId, name)
        const connected = await replaceChannel(deps, instanceId, wrapped)
        deps.store[`channel:${instanceId}`] = wrapped
        return connected ? { connected: true } : { connected: false, error: 'Gmail provider failed to connect' }
      }

      case 'email-m365': {
        const tenantId = await deps.getSecret('email-m365-tenant-id')
        const clientId = await deps.getSecret('email-m365-client-id')
        const clientSecret = await deps.getSecret('email-m365-client-secret')
        const mailbox = await deps.getSecret('email-m365-mailbox')
        if (!tenantId || !clientId || !clientSecret || !mailbox) {
          return { connected: false, error: 'Missing Microsoft 365 secrets' }
        }
        const { createM365EmailProvider } = await import('./providers/m365/index.js')
        const provider = createM365EmailProvider({ tenantId, clientId, clientSecret, mailbox } as any)
        const channel = createEmailChannelFromProvider(provider, {
          channelId: mailbox,
          displayName: name ?? `M365 (${mailbox})`,
          logger: deps.logger,
        })
        const wrapped = withId(channel, instanceId, name)
        const connected = await replaceChannel(deps, instanceId, wrapped)
        deps.store[`channel:${instanceId}`] = wrapped
        return connected ? { connected: true } : { connected: false, error: 'M365 provider failed to connect' }
      }

      default:
        break
    }

    switch (effectiveType) {
      case 'telegram': {
        const botToken = await deps.getSecret('telegram-bot-token')
        if (!botToken) return { connected: false, error: 'Missing telegram-bot-token' }
        const telegram = createTelegramBot({
          botToken,
          logger: deps.logger,
          shouldPoll: deps.shouldPoll,
          onError: (err) => deps.onError?.(instanceId, err),
          onActivity: () => deps.onActivity?.(instanceId),
          voiceWorkDir: deps.voiceWorkDir ?? 'data/voice',
          transcribeVoice: deps.transcribeVoice,
          pairing: deps.pairing,
          onCallbackQuery: deps.onCallbackQuery,
        })
        const wrapped = withId(telegram, instanceId, name ?? 'Telegram')
        // Preserve postProgress / clearProgress / sendVoice on the live object
        const connected = await replaceChannel(deps, instanceId, Object.assign(wrapped, {
          postProgress: (telegram as any).postProgress?.bind(telegram),
          clearProgress: (telegram as any).clearProgress?.bind(telegram),
          sendVoice: (telegram as any).sendVoice?.bind(telegram),
          get bot() { return (telegram as any).bot },
          get isConfigured() { return (telegram as any).isConfigured },
        }) as any)
        deps.store[`channel:${instanceId}`] = telegram
        if (instanceId === 'telegram') deps.store.telegram = telegram
        return connected
          ? { connected: true }
          : { connected: false, error: 'Telegram failed to connect (check token / poller leadership)' }
      }

      case 'discord': {
        const botToken = await deps.getSecret('discord-bot-token')
        if (!botToken) return { connected: false, error: 'Missing discord-bot-token' }
        const discord = createDiscordBot({ botToken, logger: deps.logger })
        const wrapped = withId(discord, instanceId, name)
        const connected = await replaceChannel(deps, instanceId, wrapped)
        deps.store[`channel:${instanceId}`] = discord
        if (instanceId === 'discord') deps.store.discord = discord
        return connected ? { connected: true } : { connected: false, error: 'Discord failed to connect' }
      }

      case 'slack': {
        const botToken = await deps.getSecret('slack-bot-token')
        const appToken = await deps.getSecret('slack-app-token')
        if (!botToken || !appToken) return { connected: false, error: 'Missing slack-bot-token or slack-app-token' }
        const slack = createSlackBot({ botToken, appToken, logger: deps.logger })
        const wrapped = withId(slack, instanceId, name)
        const connected = await replaceChannel(deps, instanceId, wrapped)
        deps.store[`channel:${instanceId}`] = slack
        if (instanceId === 'slack') deps.store.slack = slack
        return connected ? { connected: true } : { connected: false, error: 'Slack failed to connect' }
      }

      case 'email': {
        const smtpHost = await deps.getSecret('email-smtp-host')
        const smtpUser = await deps.getSecret('email-smtp-user')
        const smtpPass = await deps.getSecret('email-smtp-pass')
        const imapHost = await deps.getSecret('email-imap-host')
        const imapUser = await deps.getSecret('email-imap-user')
        const imapPass = await deps.getSecret('email-imap-pass')
        if (!smtpHost && !imapHost) return { connected: false, error: 'Missing email SMTP/IMAP secrets' }
        const email = createEmailAdapter({
          smtpHost: smtpHost ?? undefined,
          smtpUser: smtpUser ?? undefined,
          smtpPass: smtpPass ?? undefined,
          imapHost: imapHost ?? undefined,
          imapUser: imapUser ?? undefined,
          imapPass: imapPass ?? undefined,
          logger: deps.logger,
        })
        const wrapped = withId(email, instanceId, name)
        const connected = await replaceChannel(deps, instanceId, wrapped)
        deps.store[`channel:${instanceId}`] = email
        if (instanceId === 'email') deps.store.email = email
        return connected ? { connected: true } : { connected: false, error: 'Email adapter failed to connect' }
      }

      case 'whatsapp': {
        const phoneNumberId = await deps.getSecret('whatsapp-phone-number-id')
        const accessToken = await deps.getSecret('whatsapp-access-token')
        const verifyToken = await deps.getSecret('whatsapp-verify-token')
        const appSecret = await deps.getSecret('whatsapp-app-secret')
        if (!phoneNumberId || !accessToken || !verifyToken) {
          return { connected: false, error: 'Missing WhatsApp secrets' }
        }
        const whatsapp = createWhatsAppAdapter({
          phoneNumberId,
          accessToken,
          verifyToken,
          appSecret: appSecret ?? undefined,
          logger: deps.logger,
          http: deps.http,
        })
        const wrapped = withId(whatsapp, instanceId, name)
        const connected = await replaceChannel(deps, instanceId, wrapped)
        deps.store[`channel:${instanceId}`] = whatsapp
        if (instanceId === 'whatsapp') deps.store.whatsapp = whatsapp
        return connected ? { connected: true } : { connected: false, error: 'WhatsApp failed to connect' }
      }

      case 'signal': {
        const signalCliUrl = await deps.getSecret('signal-cli-url')
        const accountNumber = await deps.getSecret('signal-account-number')
        if (!signalCliUrl || !accountNumber) {
          return { connected: false, error: 'Missing Signal secrets' }
        }
        const signal = createSignalAdapter({
          signalCliUrl,
          accountNumber,
          logger: deps.logger,
        })
        const wrapped = withId(signal, instanceId, name)
        const connected = await replaceChannel(deps, instanceId, wrapped)
        deps.store[`channel:${instanceId}`] = signal
        if (instanceId === 'signal') deps.store.signal = signal
        return connected ? { connected: true } : { connected: false, error: 'Signal failed to connect' }
      }

      case 'googlechat': {
        const projectId = await deps.getSecret('googlechat-project-id')
        const accessToken = await deps.getSecret('googlechat-access-token')
        const defaultSpace = await deps.getSecret('googlechat-default-space')
        if (!projectId) return { connected: false, error: 'Missing googlechat-project-id' }
        const googlechat = createGoogleChatBot({
          projectId,
          accessToken: accessToken ?? undefined,
          defaultSpace: defaultSpace ?? undefined,
          logger: deps.logger,
          onError: (err) => deps.onError?.(instanceId, err),
          onActivity: () => deps.onActivity?.(instanceId),
        })
        const wrapped = withId(googlechat, instanceId, name)
        const connected = await replaceChannel(deps, instanceId, Object.assign(wrapped, {
          ingestEvent: (googlechat as any).ingestEvent?.bind(googlechat),
        }) as any)
        deps.store[`channel:${instanceId}`] = googlechat
        if (instanceId === 'googlechat') deps.store.googlechat = googlechat
        return connected ? { connected: true } : { connected: false, error: 'Google Chat failed to connect' }
      }

      case 'teams': {
        const appId = await deps.getSecret('teams-bot-app-id')
        const appPassword = await deps.getSecret('teams-bot-app-password')
        const tenantId = await deps.getSecret('teams-bot-tenant-id')
        if (!appId || !appPassword) return { connected: false, error: 'Missing Teams bot credentials' }
        const teams = createTeamsBot({
          appId,
          appPassword,
          tenantId: tenantId ?? undefined,
          logger: deps.logger,
          onError: (err) => deps.onError?.(instanceId, err),
          onActivity: () => deps.onActivity?.(instanceId),
        })
        const wrapped = withId(teams, instanceId, name)
        const connected = await replaceChannel(deps, instanceId, Object.assign(wrapped, {
          ingestActivity: (teams as any).ingestActivity?.bind(teams),
        }) as any)
        deps.store[`channel:${instanceId}`] = teams
        if (instanceId === 'teams') deps.store.teams = teams
        return connected ? { connected: true } : { connected: false, error: 'Teams failed to connect' }
      }

      default:
        return { connected: false, error: `Reconnect not supported for type ${effectiveType}` }
    }
  } catch (err: any) {
    deps.logger.warn({ err, instanceId, type }, 'Channel reconnect failed')
    return { connected: false, error: err?.message ?? String(err) }
  }
}

/** @deprecated Use reconnectChannelInstance — kept for older call sites. */
export async function reconnectCatalogChannel(
  catalogId: string,
  deps: ChannelReconnectDeps,
): Promise<{ connected: boolean; error?: string }> {
  const entry = getCatalogEntry(catalogId)
  return reconnectChannelInstance(
    { instanceId: catalogId, type: entry?.type ?? catalogId, name: entry?.name },
    deps,
  )
}

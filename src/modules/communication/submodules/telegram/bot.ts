// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { Bot, type Context, InlineKeyboard } from 'grammy'
import type { Logger } from 'pino'
import type { Channel, ChannelContent, ChannelMessage } from '../../types.js'
import { isA2UIMessage } from '../../../../shared/a2ui-types.js'
import type { A2UIMessage, A2UIButtons } from '../../../../shared/a2ui-types.js'

/**
 * Telegram bot channel using Grammy.
 * Handles incoming messages, routes to conversation system, sends responses.
 * DM pairing: unknown senders get a pairing code, must be approved before messages are processed.
 */
/**
 * Pairing store the bot consults to gate unknown senders. Production wiring
 * injects a DB-backed implementation (survives restarts); the default below is
 * the legacy in-memory store, kept so the bot still works standalone.
 */
export interface PairingStore {
  isApproved(channelId: string): boolean
  requestPairing(input: { channelId: string; senderName: string }): { code: string | null; status: 'pending' | 'approved' }
  approveByChannel(channelId: string): boolean
  getPending(): { chatId: string; code: string; senderName: string }[]
}

function generatePairingCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = 'EYAS-'
  const bytes = crypto.getRandomValues(new Uint8Array(4))
  for (let i = 0; i < 4; i++) code += chars[bytes[i] % chars.length]
  return code
}

function createInMemoryPairingStore(allowedChatIds: string[]): PairingStore {
  const approved = new Set<string>(allowedChatIds)
  const pending = new Map<string, { code: string; senderName: string; timestamp: number }>()
  return {
    isApproved: (id) => approved.has(id),
    requestPairing: ({ channelId, senderName }) => {
      const existing = pending.get(channelId)
      if (existing && Date.now() - existing.timestamp < 3_600_000) return { code: existing.code, status: 'pending' }
      const code = generatePairingCode()
      pending.set(channelId, { code, senderName, timestamp: Date.now() })
      return { code, status: 'pending' }
    },
    approveByChannel: (id) => {
      if (!pending.has(id)) return false
      approved.add(id)
      pending.delete(id)
      return true
    },
    getPending: () =>
      Array.from(pending.entries()).map(([chatId, p]) => ({ chatId, code: p.code, senderName: p.senderName })),
  }
}

export function createTelegramBot(config: {
  botToken?: string
  logger: Logger
  allowedChatIds?: string[]  // Pre-approved chat IDs (used only by the in-memory default store)
  pairing?: PairingStore
  /**
   * Gate for the long-polling loop. Returns false on non-leader instances so
   * only ONE poller runs cluster-wide — a Telegram 409 (getUpdates conflict)
   * then becomes structurally impossible. Default: always poll (single process).
   */
  shouldPoll?: () => boolean
  /** Called from bot.catch — feeds the channel-health watchdog (Cap 2). */
  onError?: (err: unknown) => void
  /** Called when an inbound update is received — a healthy-poller signal. */
  onActivity?: () => void
  /**
   * Optional local STT for voice messages. Receives a downloaded file path and
   * returns transcript text. When absent, voice messages are ignored.
   */
  transcribeVoice?: (audioPath: string) => Promise<string>
  /** Working directory for temporary voice downloads. */
  voiceWorkDir?: string
  /**
   * Inline-keyboard taps (Approve/Deny on an approval ping). Pairing still
   * gates the chat; the handler decides what the callback_data means.
   */
  onCallbackQuery?: (input: {
    chatId: string
    senderId: string
    data: string
  }) => Promise<{ ok?: boolean; text?: string } | void>
}): Channel & {
  isConfigured: boolean
  bot?: Bot
  /** Post a "working…" placeholder; returns its message_id. */
  postProgress?(chatId: string, text?: string): Promise<string | null>
  /** Delete or edit a progress placeholder. */
  clearProgress?(chatId: string, messageId: string, asError?: string): Promise<void>
  sendVoice?(chatId: string, voicePath: string, caption?: string): Promise<void>
} {
  const { botToken, logger, allowedChatIds = [], shouldPoll, onError, onActivity, transcribeVoice, voiceWorkDir, onCallbackQuery } = config
  const handlers: ((msg: ChannelMessage) => Promise<void>)[] = []
  const pairing = config.pairing ?? createInMemoryPairingStore(allowedChatIds)
  let bot: Bot | undefined
  let connected = false

  function toChannelMessage(ctx: Context): ChannelMessage | null {
    const msg = ctx.message
    if (!msg || !msg.text) return null
    return {
      id: String(msg.message_id),
      channelType: 'telegram',
      channelId: String(msg.chat.id),
      senderId: String(msg.from?.id ?? msg.chat.id),
      senderName: msg.from?.first_name ?? msg.from?.username ?? 'Unknown',
      content: msg.text,
      timestamp: new Date(msg.date * 1000).toISOString(),
    }
  }

  async function downloadTelegramFile(fileId: string, destPath: string): Promise<string> {
    if (!bot || !botToken) throw new Error('Telegram bot not ready')
    const file = await bot.api.getFile(fileId)
    if (!file.file_path) throw new Error('Telegram file_path missing')
    const url = `https://api.telegram.org/file/bot${botToken}/${file.file_path}`
    const res = await fetch(url)
    if (!res.ok) throw new Error(`Telegram file download ${res.status}`)
    const buf = Buffer.from(await res.arrayBuffer())
    const { writeFileSync, mkdirSync } = await import('node:fs')
    const { dirname } = await import('node:path')
    mkdirSync(dirname(destPath), { recursive: true })
    writeFileSync(destPath, buf)
    return destPath
  }

  return {
    id: 'telegram',
    type: 'telegram',
    name: 'Telegram Bot',
    get connected() { return connected },
    isConfigured: !!botToken,
    get bot() { return bot },

    async connect() {
      if (!botToken) {
        logger.debug('Telegram: not configured (no BOT_TOKEN)')
        return
      }
      // Leader-gated poller — only one instance runs getUpdates (no 409 conflict).
      if (shouldPoll && !shouldPoll()) {
        logger.debug('Telegram: poller deferred (this instance is not the leader)')
        return
      }
      // Idempotent — safe to call again from the reconcile tick once leadership
      // is acquired; if the bot is already built/polling this is a no-op.
      if (bot) return

      bot = new Bot(botToken)

      // Handle text messages
      bot.on('message:text', async (ctx) => {
        onActivity?.()
        const chatId = String(ctx.chat.id)
        const channelMsg = toChannelMessage(ctx)
        if (!channelMsg) return

        // DM pairing check
        if (!pairing.isApproved(chatId)) {
          // Approval is performed by an administrator (Pairing UI / API), not in-chat.
          if (channelMsg.content.startsWith('/approve ')) {
            await ctx.reply('Pairing codes are approved by the system administrator.')
            return
          }

          const { code } = pairing.requestPairing({ channelId: chatId, senderName: channelMsg.senderName ?? 'Unknown' })
          logger.info({ chatId, code, sender: channelMsg.senderName }, 'Telegram: pairing requested')

          await ctx.reply(
            `👋 Hi! I'm EYAS, but I don't recognize you yet.\n\n` +
            `Your pairing code: **${code}**\n\n` +
            `Ask the administrator to approve this code to start chatting.`,
            { parse_mode: 'Markdown' },
          )
          return
        }

        // Send typing indicator
        await ctx.replyWithChatAction('typing')

        // Route to handlers
        for (const handler of handlers) {
          try {
            await handler(channelMsg)
          } catch (err) {
            logger.error({ err, chatId }, 'Telegram: handler error')
          }
        }
      })

      // Handle photos (with optional caption)
      bot.on('message:photo', async (ctx) => {
        const chatId = String(ctx.chat.id)
        if (!pairing.isApproved(chatId)) return

        const photo = ctx.message.photo?.at(-1)  // Largest size
        if (!photo) return

        const file = await ctx.api.getFile(photo.file_id)
        const channelMsg: ChannelMessage = {
          id: String(ctx.message.message_id),
          channelType: 'telegram',
          channelId: chatId,
          senderId: String(ctx.from?.id ?? chatId),
          senderName: ctx.from?.first_name ?? 'Unknown',
          content: ctx.message.caption ?? '[Photo]',
          attachments: [{
            filename: `photo_${photo.file_id}.jpg`,
            mimeType: 'image/jpeg',
            url: file.file_path ? `https://api.telegram.org/file/bot${botToken}/${file.file_path}` : undefined,
          }],
          timestamp: new Date(ctx.message.date * 1000).toISOString(),
        }

        for (const handler of handlers) {
          try { await handler(channelMsg) }
          catch (err) { logger.error({ err }, 'Telegram: photo handler error') }
        }
      })

      // Voice / audio messages → STT → text inbound (with voice flag in content prefix)
      bot.on(['message:voice', 'message:audio'], async (ctx) => {
        onActivity?.()
        const chatId = String(ctx.chat.id)
        if (!pairing.isApproved(chatId)) return
        if (!transcribeVoice) {
          await ctx.reply('Voice messages are not enabled on this instance.')
          return
        }
        const voice = ctx.message.voice ?? ctx.message.audio
        if (!voice) return
        try {
          const { join } = await import('node:path')
          const dest = join(voiceWorkDir ?? 'data/voice', `tg_${voice.file_id}.ogg`)
          await downloadTelegramFile(voice.file_id, dest)
          const transcript = await transcribeVoice(dest)
          const channelMsg: ChannelMessage = {
            id: String(ctx.message.message_id),
            channelType: 'telegram',
            channelId: chatId,
            senderId: String(ctx.from?.id ?? chatId),
            senderName: ctx.from?.first_name ?? 'Unknown',
            content: transcript || '[empty voice transcript]',
            attachments: [{
              filename: `voice_${voice.file_id}.ogg`,
              mimeType: 'audio/ogg',
              // Marker so reply path can prefer TTS when mode=auto
              url: 'voice://inbound',
            }],
            timestamp: new Date(ctx.message.date * 1000).toISOString(),
          }
          await ctx.replyWithChatAction('typing')
          for (const handler of handlers) {
            try { await handler(channelMsg) }
            catch (err) { logger.error({ err }, 'Telegram: voice handler error') }
          }
        } catch (err) {
          logger.error({ err }, 'Telegram: voice STT failed')
          await ctx.reply('Sorry — I could not transcribe that voice message.')
          onError?.(err)
        }
      })

      bot.on('callback_query:data', async (ctx) => {
        onActivity?.()
        const chatId = String(ctx.callbackQuery.message?.chat.id ?? ctx.chat?.id ?? '')
        if (!chatId) return
        if (!pairing.isApproved(chatId)) {
          await ctx.answerCallbackQuery({ text: 'Not paired' })
          return
        }
        try {
          const result = await onCallbackQuery?.({
            chatId,
            senderId: String(ctx.from?.id ?? chatId),
            data: ctx.callbackQuery.data ?? '',
          })
          await ctx.answerCallbackQuery({ text: result?.text ?? 'OK' })
        } catch (err) {
          logger.error({ err, chatId }, 'Telegram: callback handler error')
          await ctx.answerCallbackQuery({ text: 'Failed' }).catch(() => {})
          onError?.(err)
        }
      })

      // Start bot (long polling)
      bot.start({
        onStart: () => {
          connected = true
          logger.info('Telegram bot connected and listening')
        },
      })

      // Handle errors — feed the channel-health watchdog so fatal failures
      // (bad token / 409 conflict) surface as an alert + a /channels health flag.
      bot.catch((err) => {
        logger.error({ err: err.message }, 'Telegram bot error')
        onError?.((err as any).error ?? err)
      })
    },

    async disconnect() {
      if (bot) {
        await bot.stop()
        bot = undefined
      }
      connected = false
      logger.info('Telegram bot disconnected')
    },

    async send(chatId: string, content: ChannelContent) {
      if (!bot || !connected) return
      try {
        if (content.voicePath && content.preferVoice !== false) {
          try {
            const { InputFile } = await import('grammy')
            await bot.api.sendVoice(Number(chatId), new InputFile(content.voicePath), {
              caption: content.text?.slice(0, 1024),
            })
            return
          } catch (err) {
            logger.warn({ err }, 'Telegram: sendVoice failed, falling back to text')
          }
        }
        // Check if text content is a structured A2UI message
        if (content.text) {
          let a2ui: A2UIMessage | null = null
          try {
            const parsed = JSON.parse(content.text)
            if (isA2UIMessage(parsed)) a2ui = parsed
          } catch { /* not JSON, send as plain text */ }

          if (a2ui && a2ui.type === 'buttons') {
            // Render A2UI buttons as Telegram InlineKeyboard
            const buttonsContent = a2ui.content as A2UIButtons
            const keyboard = new InlineKeyboard()
            for (const btn of buttonsContent.buttons) {
              keyboard.text(btn.label, JSON.stringify({ a: btn.action, p: btn.params })).row()
            }
            await bot.api.sendMessage(Number(chatId), buttonsContent.prompt || a2ui.fallback_text, {
              parse_mode: 'Markdown',
              reply_markup: keyboard,
            })
          } else if (a2ui) {
            // Other A2UI types: send fallback text
            await bot.api.sendMessage(Number(chatId), a2ui.fallback_text, { parse_mode: 'Markdown' })
          } else if (!(content.actions && content.actions.length > 0)) {
            await bot.api.sendMessage(Number(chatId), content.text, { parse_mode: 'Markdown' })
          }
        }
        if (content.actions && content.actions.length > 0) {
          const keyboard = new InlineKeyboard()
          for (const a of content.actions) {
            keyboard.text(a.label, a.action).row()
          }
          await bot.api.sendMessage(Number(chatId), content.text ?? 'Choose an action:', {
            reply_markup: keyboard,
          })
        }
      } catch (err) {
        logger.error({ err, chatId }, 'Telegram: send failed')
      }
    },

    async reply(originalMsg: ChannelMessage, content: ChannelContent) {
      if (!bot || !connected) return
      try {
        if (content.voicePath) {
          try {
            const { InputFile } = await import('grammy')
            await bot.api.sendVoice(Number(originalMsg.channelId), new InputFile(content.voicePath), {
              caption: content.text?.slice(0, 1024),
              reply_to_message_id: Number(originalMsg.id),
            })
            return
          } catch (err) {
            logger.warn({ err }, 'Telegram: reply voice failed, text fallback')
          }
        }
        await bot.api.sendMessage(
          Number(originalMsg.channelId),
          content.text ?? '',
          { reply_to_message_id: Number(originalMsg.id), parse_mode: 'Markdown' },
        )
      } catch (err) {
        logger.error({ err }, 'Telegram: reply failed')
      }
    },

    async postProgress(chatId: string, text = '✍️ Working on it…') {
      if (!bot || !connected) return null
      try {
        const msg = await bot.api.sendMessage(Number(chatId), text)
        return String(msg.message_id)
      } catch (err) {
        logger.warn({ err }, 'Telegram: postProgress failed')
        return null
      }
    },

    async clearProgress(chatId: string, messageId: string, asError?: string) {
      if (!bot || !connected) return
      try {
        if (asError) {
          await bot.api.editMessageText(Number(chatId), Number(messageId), `⚠️ ${asError}`)
        } else {
          await bot.api.deleteMessage(Number(chatId), Number(messageId))
        }
      } catch (err) {
        logger.debug({ err }, 'Telegram: clearProgress failed')
      }
    },

    async sendVoice(chatId: string, voicePath: string, caption?: string) {
      if (!bot || !connected) return
      const { InputFile } = await import('grammy')
      await bot.api.sendVoice(Number(chatId), new InputFile(voicePath), { caption })
    },

    onMessage(handler: (typeof handlers)[number]) {
      handlers.push(handler)
    },

    // Admin methods
    approvePairing(chatId: string): boolean {
      const ok = pairing.approveByChannel(chatId)
      if (ok) logger.info({ chatId }, 'Telegram: pairing approved')
      return ok
    },

    getPendingPairings(): { chatId: string; code: string; senderName: string }[] {
      return pairing.getPending()
    },
  } as any
}

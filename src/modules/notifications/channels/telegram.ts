// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { Logger } from 'pino'
import type { NotificationChannel, NotificationPayload } from '../router.js'

/**
 * Telegram notification channel — sends messages via Grammy bot instance.
 * Requires a paired Telegram chat ID for the user. Skips silently if not configured.
 */
export function createTelegramChannel(deps: {
  /** Returns the Grammy bot's sendMessage function, or null if bot is not connected */
  getTelegramBot: () => { api: { sendMessage(chatId: number, text: string, opts?: any): Promise<any> } } | null
  /** Resolve user ID → Telegram chat ID. Returns null if user has no paired chat */
  resolveChatId: (userId: string) => string | null
  logger: Logger
}): NotificationChannel {
  const { getTelegramBot, resolveChatId, logger } = deps

  return {
    id: 'telegram',

    async send(userId: string, payload: NotificationPayload): Promise<boolean> {
      const bot = getTelegramBot()
      if (!bot) return false

      const chatId = resolveChatId(userId)
      if (!chatId) return false

      const severityIcon = {
        info: '\u2139\ufe0f',
        warning: '\u26a0\ufe0f',
        error: '\u274c',
        critical: '\ud83d\udea8',
      }[payload.severity] ?? '\u2139\ufe0f'

      const text = `${severityIcon} *${payload.title}*${payload.body ? `\n${payload.body}` : ''}`

      try {
        await bot.api.sendMessage(Number(chatId), text, { parse_mode: 'Markdown' })
        return true
      } catch (err) {
        logger.error({ err, userId, chatId }, 'Telegram notification send failed')
        return false
      }
    },
  }
}

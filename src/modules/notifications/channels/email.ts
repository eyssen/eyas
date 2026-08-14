// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { Logger } from 'pino'
import type { NotificationChannel, NotificationPayload } from '../router.js'

export interface SmtpConfig {
  host: string
  port: number
  secure: boolean
  auth: { user: string; pass: string }
  from: string
}

/**
 * Email notification channel via nodemailer.
 * Skips silently if SMTP is not configured or user has no email.
 */
export function createEmailChannel(deps: {
  getSmtpConfig: () => SmtpConfig | null
  resolveEmail: (userId: string) => string | null
  logger: Logger
}): NotificationChannel {
  const { getSmtpConfig, resolveEmail, logger } = deps
  let transporter: any = null

  async function getTransporter() {
    if (transporter) return transporter
    const config = getSmtpConfig()
    if (!config) return null

    try {
      const nodemailer = await import('nodemailer')
      transporter = nodemailer.createTransport({
        host: config.host,
        port: config.port,
        secure: config.secure,
        auth: config.auth,
      })
      return transporter
    } catch (err) {
      logger.error({ err }, 'Failed to create email transporter')
      return null
    }
  }

  return {
    id: 'email',

    async send(userId: string, payload: NotificationPayload): Promise<boolean> {
      const email = resolveEmail(userId)
      if (!email) return false

      const t = await getTransporter()
      if (!t) return false

      const config = getSmtpConfig()
      if (!config) return false

      try {
        await t.sendMail({
          from: config.from,
          to: email,
          subject: `[EYAS] ${payload.title}`,
          text: payload.body ?? payload.title,
          html: `<h3>${payload.title}</h3>${payload.body ? `<p>${payload.body}</p>` : ''}`,
        })
        return true
      } catch (err) {
        logger.error({ err, userId, email }, 'Email notification send failed')
        return false
      }
    },
  }
}

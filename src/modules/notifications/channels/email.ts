// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { Logger } from 'pino'
import type { NotificationChannel, NotificationPayload } from '../router.js'
import type { TemplateEngine } from '../templates.js'

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
  /**
   * The shared template engine. Before F3 this channel built its own inline
   * HTML — unescaped, and bypassing every registered template, which meant
   * `render()` and `registerTemplate()` had zero callers. Optional so existing
   * construction sites keep working; absent falls back to escaped plain text
   * rather than to the old unescaped interpolation.
   */
  templates?: TemplateEngine
  /**
   * Transport factory. Defaults to nodemailer; injectable so the send path is
   * testable without a real SMTP server or a module mock.
   */
  createTransport?: (config: SmtpConfig) => { sendMail(mail: Record<string, unknown>): Promise<unknown> } | null
  logger: Logger
}): NotificationChannel {
  const { getSmtpConfig, resolveEmail, templates, createTransport, logger } = deps
  let transporter: any = null

  async function getTransporter() {
    if (transporter) return transporter
    const config = getSmtpConfig()
    if (!config) return null

    try {
      if (createTransport) {
        transporter = createTransport(config)
        return transporter
      }
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
        const rendered = templates?.render('email', payload)
        await t.sendMail({
          from: config.from,
          to: email,
          subject: rendered?.subject ?? `[EYAS] ${payload.title}`,
          // The text alternative is always set: a multipart message without one
          // lands in spam filters.
          text: rendered?.text ?? [payload.title, payload.body].filter(Boolean).join('\n'),
          ...(rendered?.html ? { html: rendered.html } : {}),
        })
        return true
      } catch (err) {
        logger.error({ err, userId, email }, 'Email notification send failed')
        return false
      }
    },
  }
}

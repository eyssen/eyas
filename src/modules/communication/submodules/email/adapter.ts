// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { Logger } from 'pino'
import type { Channel, ChannelContent, ChannelMessage } from '../../types.js'

/**
 * Email channel adapter using nodemailer (SMTP send) + imapflow (IMAP receive).
 * Uses dynamic import so the adapter gracefully degrades if packages are not installed.
 */
export function createEmailAdapter(config: {
  smtpHost?: string
  smtpPort?: number
  smtpUser?: string
  smtpPass?: string
  imapHost?: string
  imapPort?: number
  imapUser?: string
  imapPass?: string
  pollIntervalMs?: number
  logger: Logger
}): Channel & { isConfigured: boolean } {
  const {
    smtpHost, smtpPort = 587, smtpUser, smtpPass,
    imapHost, imapPort = 993, imapUser, imapPass,
    pollIntervalMs = 30_000,
    logger,
  } = config

  const handlers: ((msg: ChannelMessage) => Promise<void>)[] = []
  let transporter: any
  let pollTimer: ReturnType<typeof setInterval> | undefined
  let connected = false

  const isConfigured = !!(smtpHost && smtpUser && smtpPass)

  async function pollImap() {
    if (!imapHost || !imapUser || !imapPass) return
    try {
      const { ImapFlow } = await import('imapflow')
      const client = new ImapFlow({
        host: imapHost,
        port: imapPort,
        secure: imapPort === 993,
        auth: { user: imapUser, pass: imapPass },
        logger: false,
      })
      await client.connect()
      const lock = await client.getMailboxLock('INBOX')
      try {
        for await (const message of client.fetch('1:*', { envelope: true, source: true })) {
          const env = message.envelope
          const channelMsg: ChannelMessage = {
            id: `email-${env?.messageId ?? message.uid}`,
            channelType: 'email',
            channelId: imapUser,
            senderId: env?.from?.[0]?.address ?? 'unknown',
            senderName: env?.from?.[0]?.name ?? undefined,
            content: `Subject: ${env?.subject ?? '(no subject)'}`,
            timestamp: (env?.date ?? new Date()).toISOString(),
          }
          for (const handler of handlers) {
            try { await handler(channelMsg) }
            catch (err) { logger.error({ err }, 'Email: IMAP handler error') }
          }
        }
      } finally {
        lock.release()
      }
      await client.logout()
    } catch (err) {
      logger.warn({ err }, 'Email: IMAP poll failed (imapflow may not be installed)')
    }
  }

  return {
    id: 'email',
    type: 'email',
    name: 'Email (SMTP/IMAP)',
    get connected() { return connected },
    isConfigured,

    async connect() {
      if (!isConfigured) {
        logger.debug('Email: not configured (missing SMTP credentials)')
        return
      }
      try {
        const nodemailer = await import('nodemailer')
        transporter = nodemailer.createTransport({
          host: smtpHost,
          port: smtpPort,
          secure: smtpPort === 465,
          auth: { user: smtpUser, pass: smtpPass },
        })
        await transporter.verify()
        connected = true
        logger.info({ smtpHost, smtpUser }, 'Email adapter connected via SMTP')

        // Start IMAP polling
        if (imapHost && imapUser && imapPass) {
          pollTimer = setInterval(pollImap, pollIntervalMs)
          logger.info({ imapHost, pollIntervalMs }, 'Email: IMAP polling started')
        }
      } catch (err) {
        logger.warn({ err }, 'Email: failed to connect (nodemailer may not be installed)')
      }
    },

    async disconnect() {
      if (pollTimer) {
        clearInterval(pollTimer)
        pollTimer = undefined
      }
      if (transporter) {
        transporter.close?.()
        transporter = undefined
      }
      connected = false
      logger.info('Email adapter disconnected')
    },

    async send(to: string, content: ChannelContent) {
      if (!transporter || !connected) return
      try {
        await transporter.sendMail({
          from: smtpUser,
          to,
          subject: 'EYAS message',
          text: content.text ?? '',
          html: content.html ?? undefined,
        })
      } catch (err) {
        logger.error({ err, to }, 'Email: send failed')
      }
    },

    async reply(originalMsg: ChannelMessage, content: ChannelContent) {
      await this.send(originalMsg.senderId, content)
    },

    onMessage(handler) {
      handlers.push(handler)
    },
  }
}

// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { SubmoduleManifest } from '@core/types'

/**
 * Generic IMAP/SMTP email provider manifest.
 * Hardened MIME parsing, threading, signature stripping on top of
 * the existing `submodules/email/adapter.ts` polling implementation.
 */
export const imapSmtpProviderManifest: SubmoduleManifest = {
  id: 'email-imap-smtp',
  name: 'Generic IMAP/SMTP Email',
  parentModule: 'communication',
  enabled: false,
}

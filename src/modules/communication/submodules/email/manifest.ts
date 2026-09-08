// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { SubmoduleManifest } from '@core/types'

export const emailManifest: SubmoduleManifest = {
  id: 'communication.email',
  name: 'Email (SMTP/IMAP)',
  parentModule: 'communication',
  enabled: true,
}

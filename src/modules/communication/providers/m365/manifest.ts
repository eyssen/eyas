// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { SubmoduleManifest } from '@core/types'

/**
 * Microsoft 365 email provider manifest.
 * Uses Microsoft Graph API with OAuth2 device-code flow.
 */
export const m365ProviderManifest: SubmoduleManifest = {
  id: 'email-m365',
  name: 'Microsoft 365 Email (Graph API)',
  parentModule: 'communication',
  enabled: false,
}

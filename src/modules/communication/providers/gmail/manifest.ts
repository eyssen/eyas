// Part of eYssen. See LICENSE file for full copyright and licensing details.

/**
 * Manifest for the Gmail email provider submodule.
 *
 * The communication router discovers email providers via these manifests and
 * instantiates them through createGmailProvider(). Config keys expected:
 *
 *   gmail.clientId:     OAuth2 client id (installed app)
 *   gmail.clientSecret: OAuth2 client secret (OPTIONAL for PKCE desktop clients)
 *   gmail.redirectUri:  OAuth redirect, e.g. http://localhost:53682/callback
 *   gmail.pollIntervalMs: history.list polling interval, default 60000
 */

export const gmailProviderManifest = {
  id: 'gmail',
  name: 'Gmail',
  version: '0.1.0',
  description: 'Gmail email provider (OAuth2 PKCE, history.list polling)',
  kind: 'email-provider' as const,
  scopes: [
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/gmail.send',
    'https://www.googleapis.com/auth/gmail.modify',
    'https://www.googleapis.com/auth/gmail.labels',
  ],
  configSchema: {
    clientId: { type: 'string', required: true },
    clientSecret: { type: 'string', required: false },
    redirectUri: { type: 'string', required: true },
    pollIntervalMs: { type: 'number', required: false, default: 60_000 },
  },
} as const

export type GmailProviderManifest = typeof gmailProviderManifest

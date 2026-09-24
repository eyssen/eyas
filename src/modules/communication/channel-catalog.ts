// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Static catalog of every communication channel EYAS supports. Used by the
// setup API and Communication UI so operators see disconnected channels with
// the exact secrets they need — not only live router entries.

import type { ChannelType } from './types.js'

export interface ChannelSecretField {
  /** Secrets vault key (scope: system). */
  name: string
  /** True when the channel cannot connect without this value. */
  required: boolean
  /** Short English label (UI localizes via type + name keys). */
  label: string
  /** Mask in forms (tokens/passwords). */
  sensitive?: boolean
  /** Hint for operators (English; UI may use i18n keys instead). */
  hint?: string
  /** Example value shown as input placeholder (never a secret key name). */
  placeholder?: string
}

export interface ChannelCatalogEntry {
  type: ChannelType
  /** Stable router / channel_configs channelId for the default instance. */
  id: string
  name: string
  /** One-line English description. */
  description: string
  secrets: ChannelSecretField[]
  /** True when unknown DMs must be paired before the agent runs. */
  supportsPairing: boolean
  /** Optional public webhook path(s) the operator must expose. */
  webhookPaths?: string[]
  /** Optional dependency note (npm package, external bridge). */
  dependencyNote?: string
  /**
   * Numbered setup steps shown in the UI before the credential form.
   * English source; UI also has i18n under communication.setup.<id>.stepN.
   */
  setupSteps?: string[]
  /** One-line "what you need before you start" (English). */
  setupIntro?: string
}

/**
 * Full set of user-facing messaging channels.
 * MCP / A2A are integrations of a different shape (tools / federation) and
 * live under their own settings pages — not listed here as chat channels.
 */
export const CHANNEL_CATALOG: ChannelCatalogEntry[] = [
  {
    type: 'telegram',
    id: 'telegram',
    name: 'Telegram',
    description: 'Chat with EYAS on Telegram via a BotFather bot.',
    setupIntro: 'You need a free bot from Telegram’s @BotFather (about 1 minute).',
    setupSteps: [
      'Open Telegram and search for @BotFather.',
      'Send /newbot, pick a display name and a username ending in “bot”.',
      'Copy the HTTP API token BotFather gives you (looks like 123456:ABC-DEF…).',
      'Paste the token below, choose which EYAS agent should answer, then Save & connect.',
      'Message your bot on Telegram. Approve the pairing code under Communication → Pairing.',
    ],
    secrets: [
      {
        name: 'telegram-bot-token',
        required: true,
        label: 'Bot token from @BotFather',
        sensitive: true,
        placeholder: '123456789:AA-your-bot-token',
        hint: 'Telegram → @BotFather → /newbot → “Use this token to access the HTTP API”',
      },
    ],
    supportsPairing: true,
  },
  {
    type: 'discord',
    id: 'discord',
    name: 'Discord',
    description: 'Guild and DM messages via a Discord application bot.',
    setupIntro: 'Create a Discord application bot, then paste its token here.',
    setupSteps: [
      'Open https://discord.com/developers/applications → New Application.',
      'Bot → Add Bot → Reset Token → copy the token.',
      'Enable Privileged Gateway Intents: Message Content (and Server Members if needed).',
      'OAuth2 → URL Generator: bot + applications.commands, invite the bot to your server.',
      'Paste the token below, pick an agent, Save & connect.',
    ],
    secrets: [
      {
        name: 'discord-bot-token',
        required: true,
        label: 'Bot token',
        sensitive: true,
        placeholder: 'MTQx….GXYZ',
        hint: 'Discord Developer Portal → your app → Bot → Token',
      },
    ],
    supportsPairing: false,
    dependencyNote: 'Requires the discord.js package at runtime.',
  },
  {
    type: 'slack',
    id: 'slack',
    name: 'Slack',
    description: 'Workspace messaging via Slack Socket Mode (no public webhook required).',
    setupIntro: 'Create a Slack app with Socket Mode; you need two tokens.',
    setupSteps: [
      'Create an app at https://api.slack.com/apps (From scratch).',
      'Socket Mode → Enable → generate an App-Level Token with connections:write (starts with xapp-).',
      'OAuth & Permissions → Bot Token Scopes: chat:write, channels:history, im:history, app_mentions:read (adjust as needed).',
      'Install to workspace → copy Bot User OAuth Token (starts with xoxb-).',
      'Paste both tokens below, pick an agent, Save & connect.',
    ],
    secrets: [
      {
        name: 'slack-bot-token',
        required: true,
        label: 'Bot token (xoxb-…)',
        sensitive: true,
        placeholder: 'xoxb-…',
      },
      {
        name: 'slack-app-token',
        required: true,
        label: 'App-level token (xapp-…)',
        sensitive: true,
        placeholder: 'xapp-…',
        hint: 'Required for Socket Mode',
      },
    ],
    supportsPairing: false,
    dependencyNote: 'Requires the @slack/bolt package at runtime.',
  },
  {
    type: 'email',
    id: 'email',
    name: 'Email (SMTP/IMAP)',
    description: 'Send and receive mail via a normal mailbox (SMTP + IMAP).',
    setupIntro: 'Use any mailbox that supports SMTP (send) and preferably IMAP (receive).',
    setupSteps: [
      'Get SMTP host, username, and password (or app password) from your mail provider.',
      'Optionally add IMAP so EYAS can read the inbox (same account is fine).',
      'Fill the fields below and Save & connect.',
    ],
    secrets: [
      { name: 'email-smtp-host', required: true, label: 'SMTP host', placeholder: 'smtp.example.com' },
      { name: 'email-smtp-user', required: true, label: 'SMTP username', placeholder: 'bot@example.com' },
      { name: 'email-smtp-pass', required: true, label: 'SMTP password', sensitive: true, placeholder: '••••••••' },
      { name: 'email-imap-host', required: false, label: 'IMAP host (optional)', placeholder: 'imap.example.com' },
      { name: 'email-imap-user', required: false, label: 'IMAP username', placeholder: 'bot@example.com' },
      { name: 'email-imap-pass', required: false, label: 'IMAP password', sensitive: true },
    ],
    supportsPairing: false,
  },
  {
    type: 'email',
    id: 'email-gmail',
    name: 'Gmail (API)',
    description: 'Gmail inbox via OAuth2 + Gmail API.',
    setupIntro: 'Google Cloud OAuth client + a refresh token for the mailbox.',
    setupSteps: [
      'In Google Cloud Console create an OAuth client (Desktop or Web).',
      'Enable the Gmail API for the project.',
      'Obtain a refresh token for the mailbox (OAuth playground or your own flow).',
      'Paste client ID, secret, refresh token, and the Gmail address below.',
    ],
    secrets: [
      { name: 'email-gmail-client-id', required: true, label: 'OAuth client ID', placeholder: '….apps.googleusercontent.com' },
      { name: 'email-gmail-client-secret', required: true, label: 'OAuth client secret', sensitive: true },
      { name: 'email-gmail-refresh-token', required: true, label: 'Refresh token', sensitive: true },
      { name: 'email-gmail-mailbox', required: true, label: 'Gmail address', placeholder: 'you@gmail.com' },
    ],
    supportsPairing: false,
  },
  {
    type: 'email',
    id: 'email-m365',
    name: 'Microsoft 365 (Graph)',
    description: 'Microsoft 365 mailbox via Graph API app credentials.',
    setupIntro: 'Azure AD app registration with Mail.ReadWrite (application) for the mailbox.',
    setupSteps: [
      'Azure Portal → App registrations → New registration.',
      'Certificates & secrets → new client secret.',
      'API permissions → Microsoft Graph application: Mail.ReadWrite, User.Read.All (or app-only mail as you prefer) → admin consent.',
      'Paste tenant ID, client ID, secret, and the mailbox UPN below.',
    ],
    secrets: [
      { name: 'email-m365-tenant-id', required: true, label: 'Directory (tenant) ID', placeholder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx' },
      { name: 'email-m365-client-id', required: true, label: 'Application (client) ID' },
      { name: 'email-m365-client-secret', required: true, label: 'Client secret value', sensitive: true },
      { name: 'email-m365-mailbox', required: true, label: 'Mailbox address', placeholder: 'bot@contoso.com' },
    ],
    supportsPairing: false,
  },
  {
    type: 'whatsapp',
    id: 'whatsapp',
    name: 'WhatsApp Business',
    description: 'Meta Cloud API — webhook in, Graph API out.',
    setupIntro: 'Meta Developer app with WhatsApp product + a public HTTPS URL for the webhook.',
    setupSteps: [
      'Create a Meta app with the WhatsApp product and a test (or business) number.',
      'Copy Phone number ID and a permanent access token.',
      'Choose a random Verify token (you invent it) and the App Secret from App settings.',
      'Point Meta’s webhook to your EYAS URL path shown below; use the same verify token.',
      'Paste all four values, pick an agent, Save & connect.',
    ],
    secrets: [
      { name: 'whatsapp-phone-number-id', required: true, label: 'Phone number ID', placeholder: '123456789012345' },
      { name: 'whatsapp-access-token', required: true, label: 'Access token', sensitive: true },
      {
        name: 'whatsapp-verify-token',
        required: true,
        label: 'Webhook verify token (you choose this)',
        sensitive: true,
        placeholder: 'my-random-verify-string',
        hint: 'Must match what you enter in the Meta webhook UI',
      },
      {
        name: 'whatsapp-app-secret',
        required: true,
        label: 'App secret',
        sensitive: true,
        hint: 'Meta App → Settings → Basic → App secret (HMAC verification)',
      },
    ],
    supportsPairing: false,
    webhookPaths: ['/api/v1/webhooks/whatsapp'],
  },
  {
    type: 'signal',
    id: 'signal',
    name: 'Signal',
    description: 'Message EYAS on Signal through a signal-cli HTTP bridge.',
    setupIntro:
      'EYAS does not embed Signal. You run signal-cli (or a small REST container) once; then paste only two values here.',
    setupSteps: [
      'Install signal-cli (e.g. brew install signal-cli) OR run the bbernhard/signal-cli-rest-api Docker image with MODE=json-rpc.',
      'Register or link a bot number (prefer a separate number, not your personal Signal): signal-cli link -n "EYAS" and scan the QR, or register + SMS verify.',
      'Start the HTTP API so it listens locally, e.g. http://127.0.0.1:8080 (native daemon or container port publish).',
      'Below: enter the bot phone number in international form (+36…) and the bridge base URL (no path).',
      'Choose the EYAS agent that should answer, then Save & connect. Message the bot number from your phone.',
    ],
    secrets: [
      {
        name: 'signal-account-number',
        required: true,
        label: 'Bot phone number (E.164)',
        placeholder: '+36301234567',
        hint: 'The Signal number linked to signal-cli — not your personal chat partner’s number',
      },
      {
        name: 'signal-cli-url',
        required: true,
        label: 'Bridge base URL',
        placeholder: 'http://127.0.0.1:8080',
        hint: 'Where signal-cli REST / JSON-RPC HTTP is listening (no /api/… path)',
      },
    ],
    supportsPairing: false,
    dependencyNote: 'Needs a running signal-cli HTTP bridge (REST API or compatible daemon).',
  },
  {
    type: 'googlechat',
    id: 'googlechat',
    name: 'Google Chat',
    description: 'Google Chat app via webhook events (+ optional API send).',
    setupIntro: 'Google Cloud Chat app + HTTP endpoint on EYAS.',
    setupSteps: [
      'Create a Google Cloud project and enable the Chat API.',
      'Configure a Chat app with an HTTP endpoint pointing at the webhook path below.',
      'Paste the project/app id; add an access token if you want EYAS to send messages out.',
    ],
    secrets: [
      { name: 'googlechat-project-id', required: true, label: 'Project / app ID' },
      { name: 'googlechat-access-token', required: false, label: 'Access token (for sending)', sensitive: true },
      { name: 'googlechat-default-space', required: false, label: 'Default space (spaces/…)', placeholder: 'spaces/AAAA…' },
    ],
    supportsPairing: false,
    webhookPaths: ['/api/v1/channels/googlechat/webhook'],
  },
  {
    type: 'teams',
    id: 'teams',
    name: 'Microsoft Teams',
    description: 'Teams bot via Bot Framework activity webhook.',
    setupIntro: 'Azure Bot resource + messaging endpoint on EYAS.',
    setupSteps: [
      'Create an Azure Bot (Bot Channels Registration) and enable the Teams channel.',
      'Copy the Microsoft App ID and create a client secret (password).',
      'Set the bot messaging endpoint to your EYAS Teams webhook path (below).',
      'Paste App ID, password, and optional tenant ID; Save & connect.',
    ],
    secrets: [
      { name: 'teams-bot-app-id', required: true, label: 'Microsoft App ID', placeholder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx' },
      { name: 'teams-bot-app-password', required: true, label: 'App password / client secret', sensitive: true },
      { name: 'teams-bot-tenant-id', required: false, label: 'Tenant ID (optional)' },
    ],
    supportsPairing: false,
    webhookPaths: ['/api/v1/channels/teams/webhook'],
  },
]

export function getCatalogEntry(id: string): ChannelCatalogEntry | undefined {
  return CHANNEL_CATALOG.find((e) => e.id === id)
}

export function catalogEntryByType(type: string): ChannelCatalogEntry | undefined {
  return CHANNEL_CATALOG.find((e) => e.type === type)
}

/** All distinct messaging types that can host multiple instances. */
export function listCatalogTypes(): ChannelType[] {
  return [...new Set(CHANNEL_CATALOG.map((e) => e.type))]
}

/** Templates available when adding a new instance (one card per catalog row). */
export function listAddableTemplates(): ChannelCatalogEntry[] {
  return CHANNEL_CATALOG
}

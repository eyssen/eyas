// Part of eYssen. See LICENSE file for full copyright and licensing details.

export type ChannelType =
  | 'telegram'
  | 'slack'
  | 'discord'
  | 'email'
  | 'webchat'
  | 'mcp'
  | 'whatsapp'
  | 'signal'
  | 'googlechat'
  | 'teams'

export interface ChannelMessage {
  id: string
  channelType: ChannelType
  /**
   * Peer / conversation address on the provider (Telegram chat id, Slack
   * channel, Signal number, email address, …). NOT the EYAS connector id.
   */
  channelId: string
  senderId: string
  senderName?: string
  content: string
  attachments?: { filename: string; mimeType: string; url?: string; data?: string }[]
  replyToId?: string
  timestamp: string
  resolvedAgentId?: string
  /**
   * EYAS connector / channel_configs.channel_id that received this message
   * (e.g. `signal`, `signal-a1b2c3d4`). Stamped by the channel router so
   * multi-instance bindings resolve to the correct agent.
   */
  connectorId?: string
}

export interface ChannelContent {
  text?: string
  html?: string
  attachments?: { filename: string; mimeType: string; data: string }[]
  actions?: { label: string; action: string; data?: string }[] // Buttons/actions for A2UI
  /** Absolute path to a local audio file for voice replies (Telegram sendVoice). */
  voicePath?: string
  /** When true, prefer voice over text if the channel supports it. */
  preferVoice?: boolean
}

export interface Channel {
  readonly id: string
  readonly type: ChannelType
  readonly name: string
  readonly connected: boolean

  connect(): Promise<void>
  disconnect(): Promise<void>
  send(target: string, content: ChannelContent): Promise<void>
  reply(originalMsg: ChannelMessage, content: ChannelContent): Promise<void>
  onMessage(handler: (msg: ChannelMessage) => Promise<void>): void
}

export interface ChannelRouter {
  register(channel: Channel): void
  unregister(channelId: string): void
  getChannel(id: string): Channel | undefined
  listChannels(): Channel[]
  broadcast(content: ChannelContent, exclude?: string[]): Promise<void>
  route(message: ChannelMessage): Promise<void>
  onMessage(handler: (msg: ChannelMessage) => Promise<void>): void
}

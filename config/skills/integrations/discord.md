---
name: discord-integration
description: Discord API integration for messaging, channels, and guild management
type: integration
trigger_patterns:
  - "discord"
  - "discord message"
  - "discord channel"
  - "discord bot"
capabilities:
  - api-access
version: "1.0.0"
sources:
  - name: Discord API
    url: https://discord.com/developers/docs
    license: MIT
integration_config:
  baseUrl: https://discord.com/api/v10
  auth: bearer
  secretName: discord-bot-token
  rateLimit: 50
  operations:
    - name: send_message
      method: POST
      path: /channels/{channel_id}/messages
      description: Send a message to a channel
      parameters:
        channel_id: { type: string, required: true, description: "Channel snowflake ID" }
        content: { type: string, required: true, description: "Message text (max 2000 chars)" }
        embeds: { type: array, description: "Rich embed objects" }
        message_reference: { type: object, description: "Reply to a message" }
    - name: list_channels
      method: GET
      path: /guilds/{guild_id}/channels
      description: List channels in a guild
      parameters:
        guild_id: { type: string, required: true, description: "Guild snowflake ID" }
    - name: create_channel
      method: POST
      path: /guilds/{guild_id}/channels
      description: Create a new channel in a guild
      parameters:
        guild_id: { type: string, required: true, description: "Guild snowflake ID" }
        name: { type: string, required: true, description: "Channel name" }
        type: { type: number, description: "Channel type: 0=text, 2=voice, 4=category" }
        parent_id: { type: string, description: "Category channel ID" }
    - name: add_reaction
      method: PUT
      path: /channels/{channel_id}/messages/{message_id}/reactions/{emoji}/@me
      description: Add a reaction to a message
      parameters:
        channel_id: { type: string, required: true, description: "Channel ID" }
        message_id: { type: string, required: true, description: "Message ID" }
        emoji: { type: string, required: true, description: "URL-encoded emoji" }
    - name: list_guild_members
      method: GET
      path: /guilds/{guild_id}/members
      description: List members of a guild
      parameters:
        guild_id: { type: string, required: true, description: "Guild snowflake ID" }
        limit: { type: number, description: "Max members to return (1-1000)" }
    - name: create_webhook
      method: POST
      path: /channels/{channel_id}/webhooks
      description: Create a webhook for a channel
      parameters:
        channel_id: { type: string, required: true, description: "Channel ID" }
        name: { type: string, required: true, description: "Webhook name" }
    - name: edit_message
      method: PATCH
      path: /channels/{channel_id}/messages/{message_id}
      description: Edit a previously sent message
      parameters:
        channel_id: { type: string, required: true, description: "Channel ID" }
        message_id: { type: string, required: true, description: "Message ID" }
        content: { type: string, description: "New message content" }
        embeds: { type: array, description: "New embed objects" }
---
# Discord Integration

Authentication uses a Bot Token stored as `discord-bot-token`. Create a bot at https://discord.com/developers/applications. The token is prefixed with `Bot ` in the Authorization header.

Rate limits are per-route and returned in response headers (`X-RateLimit-Remaining`, `X-RateLimit-Reset`). Global rate limit is 50 requests per second. Handle 429 responses with `Retry-After` header.

Discord uses snowflake IDs (64-bit integers as strings). Messages support rich embeds with titles, descriptions, fields, colors, and images.

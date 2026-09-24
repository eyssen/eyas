---
name: slack-integration
description: Slack Web API integration for messaging, channels, and file uploads
type: integration
trigger_patterns:
  - "slack"
  - "slack message"
  - "slack channel"
  - "slack notification"
capabilities:
  - api-access
version: "1.0.0"
sources:
  - name: Slack Web API
    url: https://api.slack.com/web
    license: MIT
  - name: "@slack/bolt"
    url: https://github.com/slackapi/bolt-js
    license: MIT
integration_config:
  baseUrl: https://slack.com/api
  auth: bearer
  secretName: slack-bot-token
  rateLimit: 50
  operations:
    - name: send_message
      method: POST
      path: /chat.postMessage
      description: Send a message to a channel
      parameters:
        channel: { type: string, required: true, description: "Channel ID" }
        text: { type: string, required: true, description: "Message text (fallback for blocks)" }
        blocks: { type: array, description: "Block Kit blocks for rich formatting" }
        thread_ts: { type: string, description: "Thread timestamp for replies" }
    - name: list_channels
      method: GET
      path: /conversations.list
      description: List channels the bot has access to
      parameters:
        types: { type: string, description: "Channel types: public_channel, private_channel, im, mpim" }
        limit: { type: number, description: "Max results (default 100, max 1000)" }
    - name: upload_file
      method: POST
      path: /files.uploadV2
      description: Upload a file to a channel
      parameters:
        channel_id: { type: string, required: true, description: "Channel to share in" }
        filename: { type: string, required: true, description: "File name" }
        content: { type: string, description: "File content as string" }
        title: { type: string, description: "File title" }
    - name: add_reaction
      method: POST
      path: /reactions.add
      description: Add an emoji reaction to a message
      parameters:
        channel: { type: string, required: true, description: "Channel ID" }
        timestamp: { type: string, required: true, description: "Message timestamp" }
        name: { type: string, required: true, description: "Emoji name without colons" }
    - name: list_users
      method: GET
      path: /users.list
      description: List workspace users
      parameters:
        limit: { type: number, description: "Max results per page" }
    - name: create_channel
      method: POST
      path: /conversations.create
      description: Create a new channel
      parameters:
        name: { type: string, required: true, description: "Channel name (lowercase, no spaces)" }
        is_private: { type: boolean, description: "Create as private channel" }
    - name: set_topic
      method: POST
      path: /conversations.setTopic
      description: Set channel topic
      parameters:
        channel: { type: string, required: true, description: "Channel ID" }
        topic: { type: string, required: true, description: "New topic text" }
    - name: pin_message
      method: POST
      path: /pins.add
      description: Pin a message in a channel
      parameters:
        channel: { type: string, required: true, description: "Channel ID" }
        timestamp: { type: string, required: true, description: "Message timestamp to pin" }
---
# Slack Integration

Authentication uses a Bot User OAuth Token stored as `slack-bot-token` (starts with `xoxb-`). The bot needs appropriate scopes: `chat:write`, `channels:read`, `files:write`, `reactions:write`, `users:read`.

Rate limits vary by method tier (Tier 1: 1/min, Tier 2: 20/min, Tier 3: 50/min, Tier 4: 100/min). Most common methods are Tier 3. Use `cursor` parameter for pagination with `response_metadata.next_cursor`.

Messages support Block Kit for rich formatting. Always include a `text` fallback for notifications and accessibility.

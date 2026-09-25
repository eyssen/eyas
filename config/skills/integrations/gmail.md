---
name: gmail-integration
description: Gmail API integration for reading, sending, and managing email
type: integration
trigger_patterns:
  - "gmail"
  - "send email"
  - "read email"
  - "email draft"
capabilities:
  - api-access
version: "1.0.0"
sources:
  - name: Gmail API
    url: https://developers.google.com/gmail/api
    license: Apache-2.0
integration_config:
  baseUrl: https://gmail.googleapis.com/gmail/v1
  auth: oauth2
  secretName: google-oauth
  rateLimit: 250
  operations:
    - name: list_messages
      method: GET
      path: /users/me/messages
      description: List messages in the mailbox
      parameters:
        q: { type: string, description: "Gmail search query (same as web UI)" }
        maxResults: { type: number, description: "Max messages (default 100, max 500)" }
        labelIds: { type: array, description: "Filter by label IDs" }
    - name: get_message
      method: GET
      path: /users/me/messages/{id}
      description: Get a specific message
      parameters:
        id: { type: string, required: true, description: "Message ID" }
        format: { type: string, description: "Format: full, metadata, minimal, raw" }
    - name: send_message
      method: POST
      path: /users/me/messages/send
      description: Send an email message
      parameters:
        raw: { type: string, required: true, description: "Base64url-encoded RFC 2822 message" }
    - name: create_draft
      method: POST
      path: /users/me/drafts
      description: Create a draft email
      parameters:
        raw: { type: string, required: true, description: "Base64url-encoded RFC 2822 message" }
    - name: list_labels
      method: GET
      path: /users/me/labels
      description: List all labels in the mailbox
      parameters: {}
    - name: add_label
      method: POST
      path: /users/me/messages/{id}/modify
      description: Add or remove labels from a message
      parameters:
        id: { type: string, required: true, description: "Message ID" }
        addLabelIds: { type: array, description: "Label IDs to add" }
        removeLabelIds: { type: array, description: "Label IDs to remove" }
    - name: search_messages
      method: GET
      path: /users/me/messages
      description: Search messages using Gmail query syntax
      parameters:
        q: { type: string, required: true, description: "Search query (e.g., 'from:alice subject:report')" }
        maxResults: { type: number, description: "Max results" }
---
# Gmail Integration

Authentication uses OAuth 2.0 with `google-oauth` credentials. Required scopes: `https://www.googleapis.com/auth/gmail.modify` (read/write) or `https://www.googleapis.com/auth/gmail.readonly` (read only).

Messages are sent as base64url-encoded RFC 2822 strings. Use the `q` parameter with Gmail search syntax for filtering (e.g., `from:alice after:2026/04/01 has:attachment`).

Rate limit is 250 quota units per second per user. List operations cost 5 units, get costs 5, send costs 100. Use `pageToken` for pagination through large result sets.

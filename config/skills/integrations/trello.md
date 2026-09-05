---
name: trello-integration
description: Trello API integration for boards, lists, cards, and member management
type: integration
trigger_patterns:
  - "trello"
  - "trello board"
  - "trello card"
  - "trello list"
capabilities:
  - api-access
version: "1.0.0"
sources:
  - name: Trello API
    url: https://developer.atlassian.com/cloud/trello/rest/
    license: Apache-2.0
integration_config:
  baseUrl: https://api.trello.com/1
  auth: api_key
  secretName: trello-credentials
  rateLimit: 100
  operations:
    - name: create_card
      method: POST
      path: /cards
      description: Create a new card
      parameters:
        idList: { type: string, required: true, description: "List ID to add card to" }
        name: { type: string, required: true, description: "Card title" }
        desc: { type: string, description: "Card description in markdown" }
        pos: { type: string, description: "Position: top, bottom, or a positive number" }
        due: { type: string, description: "Due date (ISO 8601)" }
        idLabels: { type: string, description: "Comma-separated label IDs" }
    - name: list_cards
      method: GET
      path: /lists/{id}/cards
      description: List cards in a list
      parameters:
        id: { type: string, required: true, description: "List ID" }
        fields: { type: string, description: "Comma-separated field names" }
    - name: update_card
      method: PUT
      path: /cards/{id}
      description: Update a card
      parameters:
        id: { type: string, required: true, description: "Card ID" }
        name: { type: string, description: "Updated title" }
        desc: { type: string, description: "Updated description" }
        idList: { type: string, description: "Move to different list" }
        closed: { type: boolean, description: "Archive the card" }
    - name: list_boards
      method: GET
      path: /members/me/boards
      description: List boards for the authenticated user
      parameters:
        fields: { type: string, description: "Comma-separated field names" }
        filter: { type: string, description: "Filter: open, closed, all" }
    - name: create_board
      method: POST
      path: /boards
      description: Create a new board
      parameters:
        name: { type: string, required: true, description: "Board name" }
        desc: { type: string, description: "Board description" }
        defaultLists: { type: boolean, description: "Create default lists (To Do, Doing, Done)" }
    - name: list_lists
      method: GET
      path: /boards/{id}/lists
      description: List all lists on a board
      parameters:
        id: { type: string, required: true, description: "Board ID" }
        filter: { type: string, description: "Filter: open, closed, all" }
    - name: add_comment
      method: POST
      path: /cards/{id}/actions/comments
      description: Add a comment to a card
      parameters:
        id: { type: string, required: true, description: "Card ID" }
        text: { type: string, required: true, description: "Comment text" }
    - name: add_member
      method: PUT
      path: /boards/{id}/members/{idMember}
      description: Add a member to a board
      parameters:
        id: { type: string, required: true, description: "Board ID" }
        idMember: { type: string, required: true, description: "Member ID" }
        type: { type: string, required: true, description: "Permission: admin, normal, observer" }
---
# Trello Integration

Authentication uses API Key + Token pair stored as `trello-credentials`. Get your key at https://trello.com/power-ups/admin. Append `key` and `token` as query parameters to all requests.

Rate limit is 100 requests per 10-second window per API key, and 300 requests per 10 seconds per token. Use `fields` parameter to request only needed data and reduce response size.

Trello uses short IDs (displayed on cards) and long IDs (24-char hex, used in API). Webhooks are available for real-time board/card change notifications via callback URLs.

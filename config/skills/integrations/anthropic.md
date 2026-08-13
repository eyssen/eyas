---
name: anthropic-integration
description: Anthropic API integration for Claude messages, token counting, and batches
type: integration
trigger_patterns:
  - "anthropic"
  - "claude"
  - "claude api"
  - "anthropic api"
capabilities:
  - api-access
version: "1.0.0"
sources:
  - name: Anthropic API
    url: https://docs.anthropic.com
    license: MIT
  - name: "@anthropic-ai/sdk"
    url: https://github.com/anthropics/anthropic-sdk-typescript
    license: MIT
integration_config:
  baseUrl: https://api.anthropic.com/v1
  auth: api_key
  secretName: anthropic-api-key
  rateLimit: 1000
  operations:
    - name: create_message
      method: POST
      path: /messages
      description: Create a message with Claude
      parameters:
        model: { type: string, required: true, description: "Model ID (e.g., claude-sonnet-4-20250514)" }
        messages: { type: array, required: true, description: "Array of {role, content} messages" }
        max_tokens: { type: number, required: true, description: "Max tokens in response" }
        system: { type: string, description: "System prompt" }
        temperature: { type: number, description: "Sampling temperature (0-1)" }
        tools: { type: array, description: "Tool definitions for tool use" }
        stream: { type: boolean, description: "Stream response via SSE" }
    - name: count_tokens
      method: POST
      path: /messages/count_tokens
      description: Count tokens for a message request
      parameters:
        model: { type: string, required: true, description: "Model ID" }
        messages: { type: array, required: true, description: "Messages to count" }
        system: { type: string, description: "System prompt to count" }
    - name: list_models
      method: GET
      path: /models
      description: List available Claude models
      parameters: {}
    - name: create_batch
      method: POST
      path: /messages/batches
      description: Create a batch of message requests (async, 50% cheaper)
      parameters:
        requests: { type: array, required: true, description: "Array of message request objects" }
    - name: get_batch
      method: GET
      path: /messages/batches/{batch_id}
      description: Check batch processing status
      parameters:
        batch_id: { type: string, required: true, description: "Batch ID" }
---
# Anthropic Integration

Authentication uses an API key stored as `anthropic-api-key`. Pass as `x-api-key` header (not Bearer). Also requires `anthropic-version` header (e.g., `2023-06-01`).

Rate limits depend on usage tier: Tier 1 starts at 1,000 RPM and 80,000 input tokens per minute. Use `usage` in the response to track input/output tokens for cost control.

Key differences from OpenAI: system prompt is a separate top-level field (not a message), `max_tokens` is required, tool use returns `tool_use` content blocks. Batches process within 24 hours at 50% cost discount.

For streaming, set `stream: true` and process SSE events: `message_start`, `content_block_delta`, `message_stop`.

---
name: openai-integration
description: OpenAI API integration for chat completions, embeddings, images, and audio
type: integration
trigger_patterns:
  - "openai"
  - "gpt"
  - "chatgpt"
  - "dall-e"
  - "whisper"
capabilities:
  - api-access
version: "1.0.0"
sources:
  - name: OpenAI API
    url: https://platform.openai.com/docs
    license: MIT
  - name: openai-node
    url: https://github.com/openai/openai-node
    license: Apache-2.0
integration_config:
  baseUrl: https://api.openai.com/v1
  auth: bearer
  secretName: openai-api-key
  rateLimit: 500
  operations:
    - name: create_chat_completion
      method: POST
      path: /chat/completions
      description: Generate a chat completion
      parameters:
        model: { type: string, required: true, description: "Model ID (e.g., gpt-4o, gpt-4o-mini)" }
        messages: { type: array, required: true, description: "Array of {role, content} messages" }
        temperature: { type: number, description: "Sampling temperature (0-2)" }
        max_tokens: { type: number, description: "Max tokens in response" }
        tools: { type: array, description: "Function/tool definitions" }
        stream: { type: boolean, description: "Stream response tokens" }
    - name: create_embedding
      method: POST
      path: /embeddings
      description: Create vector embeddings for text
      parameters:
        model: { type: string, required: true, description: "Model (e.g., text-embedding-3-small)" }
        input: { type: string, required: true, description: "Text to embed (or array of texts)" }
        dimensions: { type: number, description: "Output dimensions (for text-embedding-3-*)" }
    - name: create_image
      method: POST
      path: /images/generations
      description: Generate images from text prompts
      parameters:
        model: { type: string, description: "Model (dall-e-3 or dall-e-2)" }
        prompt: { type: string, required: true, description: "Image description" }
        size: { type: string, description: "Size: 1024x1024, 1792x1024, 1024x1792" }
        quality: { type: string, description: "Quality: standard, hd" }
        n: { type: number, description: "Number of images (1 for dall-e-3)" }
    - name: create_transcription
      method: POST
      path: /audio/transcriptions
      description: Transcribe audio to text (Whisper)
      parameters:
        file: { type: string, required: true, description: "Audio file (mp3, wav, etc.)" }
        model: { type: string, required: true, description: "Model (whisper-1)" }
        language: { type: string, description: "ISO 639-1 language code" }
    - name: list_models
      method: GET
      path: /models
      description: List available models
      parameters: {}
---
# OpenAI Integration

Authentication uses an API key stored as `openai-api-key`. Pass as `Authorization: Bearer sk-...` header.

Rate limits depend on the usage tier and model. Tier 1 starts at 500 RPM for GPT-4o. Use `usage` in the response to track token consumption for cost control.

For streaming responses, set `stream: true` and process Server-Sent Events. Embeddings return float arrays — store in a vector database for similarity search. Image generation with DALL-E 3 only supports n=1 per request.

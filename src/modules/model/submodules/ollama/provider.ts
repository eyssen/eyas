// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { AIProvider, ModelRequest, EmbedRequest, EmbedResponse } from '../../types.js'
import { createOllamaAdapter } from './adapter.js'

/** Known embedding model dimensions */
const OLLAMA_EMBED_DIMENSIONS: Record<string, number> = {
  'nomic-embed-text': 768,
  'nomic-embed-text:latest': 768,
  'mxbai-embed-large': 1024,
  'mxbai-embed-large:latest': 1024,
  'all-minilm': 384,
  'all-minilm:latest': 384,
  'snowflake-arctic-embed': 1024,
  'snowflake-arctic-embed:latest': 1024,
}

const DEFAULT_OLLAMA_EMBED_MODEL = 'nomic-embed-text'
const DEFAULT_OLLAMA_EMBED_DIMENSIONS = 768

export interface OllamaProviderOptions {
  baseUrl?: string
}

export function createOllamaProvider(options: OllamaProviderOptions = {}): AIProvider {
  const baseUrl = options.baseUrl || process.env.OLLAMA_HOST || 'http://localhost:11434'
  const adapter = createOllamaAdapter(baseUrl)

  return {
    id: 'ollama',
    name: 'Ollama',

    async listModels() {
      return adapter.listModels()
    },

    async fetchModels() {
      return adapter.listModels()
    },

    async complete(request: ModelRequest) {
      return adapter.complete(request)
    },

    async *stream(request: ModelRequest) {
      yield* adapter.stream(request)
    },

    async embed(request: EmbedRequest): Promise<EmbedResponse> {
      const model = request.model || DEFAULT_OLLAMA_EMBED_MODEL
      const embeddings: number[][] = []
      for (const text of request.texts) {
        const vec = await adapter.embed(model, text)
        embeddings.push(vec)
      }
      const dimensions = embeddings[0]?.length
        ?? OLLAMA_EMBED_DIMENSIONS[model]
        ?? DEFAULT_OLLAMA_EMBED_DIMENSIONS
      return { provider: 'ollama', model, embeddings, dimensions }
    },
  }
}

/** Ping Ollama and return true if available */
export async function isOllamaAvailable(baseUrl?: string): Promise<boolean> {
  const url = baseUrl || process.env.OLLAMA_HOST || 'http://localhost:11434'
  const adapter = createOllamaAdapter(url)
  return adapter.ping()
}

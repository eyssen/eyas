// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { EmbeddingProvider } from '../embedding-bridge.js'

interface OpenAIEmbeddingConfig {
  apiKey: string
  model?: string      // Default: text-embedding-3-small
  baseUrl?: string    // Default: https://api.openai.com/v1
}

export function createOpenAIEmbeddingProvider(config: OpenAIEmbeddingConfig): EmbeddingProvider {
  const model = config.model ?? 'text-embedding-3-small'
  const baseUrl = config.baseUrl ?? 'https://api.openai.com/v1'
  const dimensions = model === 'text-embedding-3-small' ? 1536 : model === 'text-embedding-3-large' ? 3072 : 1536

  return {
    model,
    dimensions,

    async embed(texts: string[]): Promise<Float32Array[]> {
      const res = await fetch(`${baseUrl}/embeddings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({ model, input: texts }),
      })
      if (!res.ok) throw new Error(`OpenAI embedding failed: ${res.statusText}`)
      const data = await res.json() as { data: { embedding: number[] }[] }
      return data.data.map(d => new Float32Array(d.embedding))
    },
  }
}

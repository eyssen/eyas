// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { EmbeddingProvider } from '../embedding-bridge.js'

interface OllamaEmbeddingConfig {
  baseUrl?: string    // Default: http://localhost:11434
  model?: string      // Default: nomic-embed-text
}

export function createOllamaEmbeddingProvider(config: OllamaEmbeddingConfig = {}): EmbeddingProvider {
  const baseUrl = config.baseUrl ?? 'http://localhost:11434'
  const model = config.model ?? 'nomic-embed-text'
  const dimensions = model === 'nomic-embed-text' ? 768 : 384

  return {
    model,
    dimensions,

    async embed(texts: string[]): Promise<Float32Array[]> {
      const results: Float32Array[] = []
      for (const text of texts) {
        const res = await fetch(`${baseUrl}/api/embed`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model, input: text }),
        })
        if (!res.ok) throw new Error(`Ollama embedding failed: ${res.statusText}`)
        const data = await res.json() as { embeddings: number[][] }
        results.push(new Float32Array(data.embeddings[0]))
      }
      return results
    },
  }
}

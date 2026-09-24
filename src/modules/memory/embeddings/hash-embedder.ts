// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Degraded-mode local embeddings (spec §3): a deterministic hashed bag of
// prefix-5 stems. No model, no network, 384-d so sqlite-vec can index it.
// The Phase 2 multilingual-e5-small path replaces this when the ONNX model
// is present; until then this is the vector channel on a CLI-only install.

import { stem5, tokenize } from '../v2/extract/tokenize.js'
import type { EmbeddingProvider } from './types.js'

export const HASH_EMBED_DIM = 384
export const HASH_EMBED_MODEL_ID = 'stem5-fnv-384'

function fnv1a(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

export function hashEmbed(text: string, dim = HASH_EMBED_DIM): number[] {
  const vec = new Float64Array(dim)
  for (const tok of tokenize(text)) {
    const stem = stem5(tok)
    if (!stem) continue
    const h = fnv1a(stem)
    const i = h % dim
    vec[i] += (h & 1) === 0 ? 1 : -1
  }
  let n = 0
  for (let i = 0; i < dim; i++) n += vec[i] * vec[i]
  const norm = Math.sqrt(n) || 1
  const out = new Array<number>(dim)
  for (let i = 0; i < dim; i++) out[i] = vec[i] / norm
  return out
}

export function cosine(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length)
  let dot = 0
  for (let i = 0; i < n; i++) dot += a[i]! * b[i]!
  return dot
}

export function createHashEmbedder(): EmbeddingProvider {
  return {
    canEmbed: () => true,
    dimensions: () => HASH_EMBED_DIM,
    modelId: () => HASH_EMBED_MODEL_ID,
    async embed(texts: string[]): Promise<number[][]> {
      return texts.map((t) => hashEmbed(t))
    },
  }
}

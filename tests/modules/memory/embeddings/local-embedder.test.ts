// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, it, expect } from 'vitest'
import { createBestLocalEmbedder, tryCreateE5Embedder } from '@modules/memory/embeddings/local-embedder'
import { HASH_EMBED_MODEL_ID } from '@modules/memory/embeddings/hash-embedder'

describe('createBestLocalEmbedder', () => {
  it('falls back to the hash embedder when e5 is not installed', async () => {
    const e5 = await tryCreateE5Embedder()
    const local = await createBestLocalEmbedder()
    expect(local.canEmbed()).toBe(true)
    expect(local.dimensions()).toBe(384)
    if (!e5) expect(local.modelId?.()).toBe(HASH_EMBED_MODEL_ID)
  }, 30_000)
})

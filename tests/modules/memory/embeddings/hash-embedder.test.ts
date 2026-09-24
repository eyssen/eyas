// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, it, expect } from 'vitest'
import { createHashEmbedder, cosine } from '@modules/memory/embeddings/hash-embedder'

describe('hash embedder', () => {
  it('is always available and 384-d', () => {
    const e = createHashEmbedder()
    expect(e.canEmbed()).toBe(true)
    expect(e.dimensions()).toBe(384)
    expect(e.modelId?.()).toBe('stem5-fnv-384')
  })

  it('places the same sentence nearer to a paraphrase than to an unrelated note', async () => {
    const e = createHashEmbedder()
    const [a, b, c] = await e.embed([
      'Never commit or push automatically. Always wait for an explicit request.',
      'Do not commit changes unless the owner asked.',
      'The Photos Library spotlight cache is not owner memory.',
    ])
    expect(cosine(a, b)).toBeGreaterThan(cosine(a, c))
    expect(cosine(a, a)).toBeCloseTo(1, 5)
  })
})

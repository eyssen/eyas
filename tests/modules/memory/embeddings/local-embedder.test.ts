// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, it, expect } from 'vitest'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  createBestLocalEmbedder, tryCreateE5Embedder, findE5Weights, isTransformersInstalled,
} from '@modules/memory/embeddings/local-embedder'
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

describe('e5 weight discovery (eyas doctor reads the same cache)', () => {
  function dir(): string {
    const d = join(tmpdir(), `eyas-e5-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(d, { recursive: true })
    return d
  }

  it('finds weights in the intfloat or the Xenova layout', () => {
    const a = dir()
    mkdirSync(join(a, 'Xenova', 'multilingual-e5-small', 'onnx'), { recursive: true })
    writeFileSync(join(a, 'Xenova', 'multilingual-e5-small', 'onnx', 'model_quantized.onnx'), 'x')
    expect(findE5Weights(a)).toBe(join(a, 'Xenova', 'multilingual-e5-small', 'onnx'))
    rmSync(a, { recursive: true })
  })

  it('an empty cache or an onnx folder without a model is not weights', () => {
    const a = dir()
    expect(findE5Weights(a)).toBeNull()
    mkdirSync(join(a, 'intfloat', 'multilingual-e5-small', 'onnx'), { recursive: true })
    writeFileSync(join(a, 'intfloat', 'multilingual-e5-small', 'onnx', 'README.md'), 'x')
    expect(findE5Weights(a)).toBeNull()
    rmSync(a, { recursive: true })
  })

  it('resolves @huggingface/transformers without loading it (it is a dependency here)', () => {
    expect(isTransformersInstalled()).toBe(true)
  })
})

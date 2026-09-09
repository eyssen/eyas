// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Local CPU embedder (spec §13 / §16-2). Tries multilingual-e5-small via
// @huggingface/transformers (Apache-2.0) with the mandatory `query: ` /
// `passage: ` prefixes. Falls back to the hashed stem embedder when the
// package, the ONNX runtime or the weights are missing — CLI-only installs
// still have a 384-d vector channel.

import { createHashEmbedder, HASH_EMBED_MODEL_ID } from './hash-embedder.js'
import type { EmbeddingProvider } from './types.js'

export const E5_MODEL_ID = 'multilingual-e5-small@q8/e5-prefix'
export const E5_HF_ID = 'intfloat/multilingual-e5-small'

type FeaturePipeline = (
  text: string,
  opts: { pooling: 'mean'; normalize: boolean },
) => Promise<{ data: Float32Array | number[] }>

export async function tryCreateE5Embedder(opts?: {
  cacheDir?: string
  logger?: { info: (obj: unknown, msg?: string) => void; warn: (obj: unknown, msg?: string) => void }
}): Promise<EmbeddingProvider | null> {
  let pipelineFn: ((task: string, model: string, options?: Record<string, unknown>) => Promise<FeaturePipeline>) | undefined
  try {
    const mod = await import('@huggingface/transformers')
    pipelineFn = mod.pipeline as typeof pipelineFn
    if (opts?.cacheDir && mod.env) {
      mod.env.cacheDir = opts.cacheDir
      mod.env.allowLocalModels = true
    }
  } catch {
    return null
  }
  if (!pipelineFn) return null

  const session = { intraOpNumThreads: 2 }
  const attempts: Array<{ id: string; options: Record<string, unknown> }> = [
    // intfloat MIT weights, qint8 ONNX named unlike transformers.js default.
    { id: E5_HF_ID, options: { dtype: 'q8', model_file_name: 'model_qint8_avx512_vnni', session_options: session } },
    { id: E5_HF_ID, options: { model_file_name: 'model_qint8_avx512_vnni', session_options: session } },
    // Same MIT checkpoint, transformers.js-layout filenames.
    { id: 'Xenova/multilingual-e5-small', options: { dtype: 'q8', session_options: session } },
  ]
  let extractor: FeaturePipeline | undefined
  let lastErr: unknown
  for (const attempt of attempts) {
    try {
      extractor = await pipelineFn('feature-extraction', attempt.id, attempt.options)
      break
    } catch (err) {
      lastErr = err
    }
  }
  if (!extractor) {
    opts?.logger?.warn?.({ err: String(lastErr) }, 'multilingual-e5-small could not be loaded; using hash embedder')
    return null
  }

  const embedPrefixed = async (texts: string[], prefix: 'query: ' | 'passage: '): Promise<number[][]> => {
    if (texts.length === 0) return []
    const prefixed = texts.map((t) => `${prefix}${t}`)
    const result = await extractor(prefixed as unknown as string, { pooling: 'mean', normalize: true }) as
      { data?: Float32Array | number[]; dims?: number[] } | Array<{ data: Float32Array | number[] }>
    // A batch returns a stacked tensor (n, 384) or a list of tensors.
    if (Array.isArray(result)) {
      return result.map((r) => Array.from(r.data ?? []))
    }
    const data = result?.data
    if (!data) return texts.map(() => [])
    const arr = Array.from(data)
    const dim = 384
    if (arr.length === dim) return [arr]
    const out: number[][] = []
    for (let i = 0; i < texts.length; i++) out.push(arr.slice(i * dim, (i + 1) * dim))
    return out
  }

  opts?.logger?.info?.({ model: E5_MODEL_ID }, 'Local multilingual-e5-small embedder ready')
  return {
    canEmbed: () => true,
    dimensions: () => 384,
    modelId: () => E5_MODEL_ID,
    embed: (texts) => embedPrefixed(texts, 'passage: '),
    embedQuery: (texts) => embedPrefixed(texts, 'query: '),
  }
}

export async function createBestLocalEmbedder(opts?: {
  cacheDir?: string
  logger?: { info: (obj: unknown, msg?: string) => void; warn: (obj: unknown, msg?: string) => void }
}): Promise<EmbeddingProvider> {
  const e5 = await tryCreateE5Embedder(opts)
  if (e5) return e5
  opts?.logger?.info?.({ model: HASH_EMBED_MODEL_ID }, 'Local embedder: hashed stem5-fnv-384 (e5 not installed)')
  return createHashEmbedder()
}

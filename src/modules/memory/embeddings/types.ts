// Part of eYssen. See LICENSE file for full copyright and licensing details.

export interface EmbeddingProvider {
  canEmbed(): boolean
  embed(texts: string[]): Promise<number[][]>
  dimensions(): number
  /** Stable id written onto `memory_embedding.model_id` / `vec_meta.model`. */
  modelId?: () => string
  /**
   * Query-side embedding (e5 `query: ` prefix). Falls back to `embed()` when
   * the provider does not distinguish queries from passages.
   */
  embedQuery?: (texts: string[]) => Promise<number[][]>
}

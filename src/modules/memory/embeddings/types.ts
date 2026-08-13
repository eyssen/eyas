// Part of eYssen. See LICENSE file for full copyright and licensing details.

export interface EmbeddingProvider {
  canEmbed(): boolean
  embed(texts: string[]): Promise<number[][]>
  dimensions(): number
}

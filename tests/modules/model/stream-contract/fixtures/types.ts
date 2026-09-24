// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { ModelUsage, StopReason } from '@modules/model/types.js'

/** One backend stream as its API sends it, and what the normalized stream must end with. */
export interface ApiStreamFixture<Chunk> {
  name: string
  chunks: Chunk[]
  expected: {
    /** How many tool rows the stream opens. */
    toolCalls: number
    /** Their ids, in order, when the backend names its calls. */
    toolUseIds?: string[]
    stopReason: StopReason
    usage: ModelUsage
  }
}

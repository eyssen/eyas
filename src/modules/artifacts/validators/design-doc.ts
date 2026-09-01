// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { z } from 'zod'

/**
 * Design Document — produced by Architect.
 * Consumed by Developer to generate a TaskList.
 */
export const DesignDocSchema = z.object({
  summary: z.string().min(20),
  context: z.string().optional(),
  architecture: z.object({
    components: z
      .array(
        z.object({
          name: z.string().min(1),
          responsibility: z.string().min(1),
        }),
      )
      .min(1),
    dataFlow: z.array(z.string()).default([]),
  }),
  interfaces: z
    .array(
      z.object({
        name: z.string().min(1),
        kind: z.enum(['http', 'event', 'function', 'rpc']),
        contract: z.string().min(1),
      }),
    )
    .default([]),
  dataModel: z
    .array(
      z.object({
        entity: z.string().min(1),
        fields: z.array(z.string().min(1)).min(1),
      }),
    )
    .default([]),
  risks: z.array(z.string()).default([]),
  alternatives: z.array(z.string()).default([]),
})

export type DesignDoc = z.infer<typeof DesignDocSchema>

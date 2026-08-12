// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { z } from 'zod'

/**
 * PRD (Product Requirements Document) — produced by PM/Product Owner.
 * Consumed by Architect to write the DesignDoc.
 */
export const PrdSchema = z.object({
  problem: z.string().min(20, 'problem must describe the user need in at least 20 chars'),
  personas: z
    .array(
      z.object({
        name: z.string().min(1),
        goals: z.array(z.string().min(1)).min(1),
      }),
    )
    .min(1),
  successMetrics: z.array(z.string().min(1)).min(1),
  requirements: z.object({
    functional: z.array(z.string().min(1)).min(1),
    nonFunctional: z.array(z.string().min(1)).optional(),
  }),
  outOfScope: z.array(z.string()).default([]),
  openQuestions: z.array(z.string()).default([]),
})

export type Prd = z.infer<typeof PrdSchema>

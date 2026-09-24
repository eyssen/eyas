// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { z } from 'zod'

/**
 * TaskList — produced by Developer or Tech Lead.
 * Consumed by implementation agents (Dev/Codegen).
 */
export const TaskListSchema = z.object({
  description: z.string().min(5),
  tasks: z
    .array(
      z.object({
        id: z.string().min(1),
        title: z.string().min(1),
        details: z.string().optional(),
        status: z
          .enum(['todo', 'in_progress', 'blocked', 'done'])
          .default('todo'),
        dependsOn: z.array(z.string()).default([]),
        estimateHours: z.number().nonnegative().optional(),
        ownerRole: z.string().optional(),
      }),
    )
    .min(1),
  milestones: z.array(z.string()).default([]),
})

export type TaskList = z.infer<typeof TaskListSchema>

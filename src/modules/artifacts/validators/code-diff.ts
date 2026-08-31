// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { z } from 'zod'

/**
 * CodeDiff — produced by Developer (or codegen agent).
 * Consumed by QA and Reviewer.
 *
 * Files carry either a unified-diff patch or a full-file rewrite.
 */
export const CodeDiffFileSchema = z
  .object({
    path: z.string().min(1),
    action: z.enum(['add', 'modify', 'delete', 'rename']),
    patch: z.string().optional(),
    newContent: z.string().optional(),
    renamedFrom: z.string().optional(),
  })
  .refine(
    (f) =>
      f.action === 'delete' ||
      f.action === 'rename' ||
      f.patch !== undefined ||
      f.newContent !== undefined,
    { message: 'add/modify files require a patch or newContent' },
  )

export const CodeDiffSchema = z.object({
  summary: z.string().min(5),
  branch: z.string().optional(),
  baseCommit: z.string().optional(),
  files: z.array(CodeDiffFileSchema).min(1),
  testCoverage: z
    .object({
      added: z.number().int().nonnegative().default(0),
      updated: z.number().int().nonnegative().default(0),
    })
    .optional(),
})

export type CodeDiff = z.infer<typeof CodeDiffSchema>

// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { z } from 'zod'

/**
 * TestPlan — produced by QA engineer.
 * Consumed by QA runners and regression pipelines.
 */
export const TestCaseSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  kind: z.enum(['unit', 'integration', 'e2e', 'load', 'manual']).default('unit'),
  preconditions: z.array(z.string()).default([]),
  steps: z.array(z.string().min(1)).min(1),
  expected: z.string().min(1),
  severity: z.enum(['smoke', 'critical', 'major', 'minor']).default('major'),
})

export const TestPlanSchema = z.object({
  scope: z.string().min(5),
  environments: z.array(z.string().min(1)).min(1),
  cases: z.array(TestCaseSchema).min(1),
  exitCriteria: z.array(z.string()).default([]),
})

export type TestPlan = z.infer<typeof TestPlanSchema>

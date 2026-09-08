// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { z } from 'zod'

/**
 * DeployManifest — produced by DevOps/Release agent.
 * Consumed by deployment pipeline.
 */
export const DeployManifestSchema = z.object({
  service: z.string().min(1),
  version: z.string().min(1),
  environment: z.enum(['dev', 'staging', 'production']),
  strategy: z.enum(['rolling', 'blue-green', 'canary', 'recreate']).default('rolling'),
  image: z.object({
    registry: z.string().min(1),
    repository: z.string().min(1),
    tag: z.string().min(1),
  }),
  replicas: z.number().int().positive().default(1),
  resources: z
    .object({
      cpu: z.string().optional(),
      memory: z.string().optional(),
    })
    .optional(),
  envVars: z.record(z.string(), z.string()).default({}),
  secrets: z.array(z.string()).default([]),
  rollback: z
    .object({
      onFailure: z.boolean().default(true),
      previousVersion: z.string().optional(),
    })
    .optional(),
})

export type DeployManifest = z.infer<typeof DeployManifestSchema>

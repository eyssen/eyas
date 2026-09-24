// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { z } from 'zod'
import { PrdSchema } from './prd.js'
import { DesignDocSchema } from './design-doc.js'
import { TaskListSchema } from './task-list.js'
import { CodeDiffSchema } from './code-diff.js'
import { TestPlanSchema } from './test-plan.js'
import { DeployManifestSchema } from './deploy-manifest.js'
import { ARTIFACT_KINDS, type ArtifactKind } from '../types.js'

export { PrdSchema } from './prd.js'
export { DesignDocSchema } from './design-doc.js'
export { TaskListSchema } from './task-list.js'
export { CodeDiffSchema } from './code-diff.js'
export { TestPlanSchema } from './test-plan.js'
export { DeployManifestSchema } from './deploy-manifest.js'

/**
 * Registry of Zod validators keyed by `ArtifactKind`.
 * The service uses this to validate payloads on every write.
 */
export const VALIDATORS: Record<ArtifactKind, z.ZodTypeAny> = {
  'prd': PrdSchema,
  'design-doc': DesignDocSchema,
  'task-list': TaskListSchema,
  'code-diff': CodeDiffSchema,
  'test-plan': TestPlanSchema,
  'deploy-manifest': DeployManifestSchema,
}

export function isKnownKind(kind: string): kind is ArtifactKind {
  return (ARTIFACT_KINDS as readonly string[]).includes(kind)
}

export function validatePayload(kind: ArtifactKind, payload: unknown) {
  const schema = VALIDATORS[kind]
  return schema.safeParse(payload)
}

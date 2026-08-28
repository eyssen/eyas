// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { z } from 'zod'
import type { PrdSchema } from './validators/prd.js'
import type { DesignDocSchema } from './validators/design-doc.js'
import type { TaskListSchema } from './validators/task-list.js'
import type { CodeDiffSchema } from './validators/code-diff.js'
import type { TestPlanSchema } from './validators/test-plan.js'
import type { DeployManifestSchema } from './validators/deploy-manifest.js'

/**
 * Supported artifact kinds.
 * Each kind has a Zod validator registered in `validators/index.ts`.
 */
export const ARTIFACT_KINDS = [
  'prd',
  'design-doc',
  'task-list',
  'code-diff',
  'test-plan',
  'deploy-manifest',
] as const

export type ArtifactKind = (typeof ARTIFACT_KINDS)[number]

export const REF_TYPES = ['derives_from', 'implements', 'tests'] as const
export type ArtifactRefType = (typeof REF_TYPES)[number]

// ─── Payload type map (ties each kind to its Zod-inferred payload type) ───

export interface ArtifactPayloadMap {
  'prd': z.infer<typeof PrdSchema>
  'design-doc': z.infer<typeof DesignDocSchema>
  'task-list': z.infer<typeof TaskListSchema>
  'code-diff': z.infer<typeof CodeDiffSchema>
  'test-plan': z.infer<typeof TestPlanSchema>
  'deploy-manifest': z.infer<typeof DeployManifestSchema>
}

// ─── Database row shapes ───

export interface Artifact<K extends ArtifactKind = ArtifactKind> {
  id: string
  sessionId: string | null
  kind: K
  title: string
  currentVersion: number
  producedBy: string | null
  consumedBy: string[]
  createdAt: number
  updatedAt: number
  // Latest payload is attached when the service returns a typed artifact
  payload?: ArtifactPayloadMap[K]
}

export interface ArtifactVersion {
  id: number
  artifactId: string
  version: number
  payload: unknown
  createdAt: number
  createdBy: string | null
  changeNote: string | null
}

export interface ArtifactRef {
  fromArtifact: string
  toArtifact: string
  refType: ArtifactRefType
}

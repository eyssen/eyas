// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { EyasModule } from '@core/types'

/**
 * Artifacts module manifest.
 *
 * Stores Zod-validated structured artifacts that flow between agents in a
 * multi-role team session (PM → Architect → Dev → QA). Each artifact kind
 * (PRD, DesignDoc, TaskList, CodeDiff, TestPlan, DeployManifest) has a
 * schema registered in `validators/index.ts`.
 */
export const artifactsManifest: Pick<
  EyasModule,
  'id' | 'name' | 'version' | 'type' | 'required' | 'description' | 'dependencies' | 'optional' | 'capabilities'
> = {
  id: 'artifacts',
  name: 'Artifacts',
  version: '0.1.0',
  type: 'core',
  required: false,
  description:
    'Typed, Zod-validated artifacts (PRD, DesignDoc, TaskList, CodeDiff, TestPlan, DeployManifest) that act as structured handoff payloads between agents in a team session. Inspired by the MetaGPT pattern.',
  dependencies: [],
  optional: ['agent', 'conversations'],
  capabilities: ['artifact-handoff', 'zod-validation', 'versioned-payloads'],
}

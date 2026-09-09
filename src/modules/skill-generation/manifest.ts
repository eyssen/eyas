// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { EyasModule } from '@core/types'

/**
 * Skill-Generation module manifest (Phase 3J — Hermes self-improvement).
 *
 * Consumes skill-candidate proposals produced by the sleep-time consolidator
 * (Phase 3C), generates SKILL.md artifacts, runs A/B validation against the
 * Phase 4F benchmark runner, and auto-adopts accepted skills — with rollback
 * hooks if they later regress.
 *
 * This module does NOT replace the deprecated `skill-evolution` module; it
 * is a clean rebuild. Existing skills/skill-evolution modules are not touched.
 */
export const skillGenerationManifest: Pick<
  EyasModule,
  | 'id'
  | 'name'
  | 'version'
  | 'type'
  | 'required'
  | 'description'
  | 'dependencies'
  | 'optional'
  | 'capabilities'
> = {
  id: 'skill-generation',
  name: 'Skill Generation',
  version: '0.1.0',
  type: 'core',
  required: false,
  description:
    'Auto-generation of skill artifacts from agent traces, A/B validated against a benchmark baseline with statistical significance testing. Hermes Phase 3J.',
  dependencies: [],
  // Soft deps — we read proposals from the consolidator and run benchmarks, but
  // the module loads standalone so tests can exercise it in isolation.
  // 'scheduler' backs the live onStart's skillGeneration.scan job (Task 3).
  optional: ['memory', 'event-store', 'scheduler'],
  capabilities: [
    'skill-candidate-extraction',
    'skill-artifact-generation',
    'ab-validation',
    'statistical-testing',
    'auto-adoption',
    'regression-rollback',
  ],
}

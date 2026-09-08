// Part of eYssen. See LICENSE file for full copyright and licensing details.

/**
 * Consolidator submodule manifest.
 *
 * Decision (Phase 3C): the consolidator is a SUBMODULE of the memory module,
 * not a standalone top-level module. Rationale:
 *   - It runs inside the memory module's process / DB scope.
 *   - It needs tight coupling to the tiered memory services (working,
 *     episodic, vault) — exposing them through the module bus just to feed
 *     them back through a separate module would be a ceremony tax.
 *   - Operational unit (scheduler job, lock key, metrics) is tied to memory.
 *
 * If we later want to make it independently toggleable without touching
 * memory, promoting this to a top-level `consolidator` module is a mechanical
 * refactor — all dependencies are expressed via ports in `types.ts`.
 */

export const CONSOLIDATOR_MANIFEST = {
  id: 'memory.consolidator',
  parentModule: 'memory',
  name: 'Sleep-time Consolidator',
  description:
    'Nightly background agent: promotes memories across tiers, proposes skill candidates and wiki edits, garbage-collects orphans.',
  version: '0.1.0',
  enabledByDefault: true,
  phase: '3C',
  cronDefault: '0 2 * * *',
} as const

export type ConsolidatorManifest = typeof CONSOLIDATOR_MANIFEST

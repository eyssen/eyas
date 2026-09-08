// Part of eYssen. See LICENSE file for full copyright and licensing details.

export type OrchestrationMenuPick = 'solo' | 'auto' | 'deep' | 'god'

/**
 * Next conversation fields after an Orchestration menu pick.
 * God Mode is a separate boolean — it never overwrites solo/auto/deep.
 */
export function nextFieldsOnMenuPick(
  pick: OrchestrationMenuPick,
  current: { orchestration: string; godMode: boolean },
): { orchestration: string; godMode: boolean } {
  if (pick === 'god') return { orchestration: current.orchestration, godMode: true }
  return { orchestration: pick, godMode: false }
}

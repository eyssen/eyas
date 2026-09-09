// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { BoardStage } from '@/stores/board-store'

/**
 * The contract every Board view renders against. `stages` is always the
 * *filtered* set (`filteredStages()`), so a view never re-applies filters —
 * that keeps the filter row authoritative and view switching lossless.
 */
export interface BoardViewProps {
  stages: BoardStage[]
  projectName?: string
  projectColor?: string
}

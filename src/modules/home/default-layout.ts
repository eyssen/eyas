// Part of eYssen. See LICENSE file for full copyright and licensing details.
import type { LayoutItem } from './layout-service.js'

/**
 * Bump whenever a widget is ADDED to the factory layout. Customised users are
 * then offered the new tiles (spec D2); un-customised users get them for free
 * because they follow this constant directly (spec D1).
 */
export const DEFAULT_LAYOUT_VERSION = 1

/**
 * 12-column grid, row height 40px. Nine tiles — see spec §4.1.
 *
 * Every `h` here is also a height the tile has to SURVIVE, not just the one it
 * prefers: this layout only applies where no row is stored (D1), so an
 * existing owner keeps whatever they saved, and anyone can drag a tile down to
 * its `minH` at any moment. Growing an `h` here therefore fixes nothing on its
 * own — a tile that only works when it is given enough rows is broken. See
 * pulse-widget.tsx's Chip for the shape of the fix that does work.
 */
export const DEFAULT_LAYOUT: LayoutItem[] = [
  { i: 'home.pulse#1', x: 0, y: 0, w: 12, h: 2 },
  { i: 'security-gate.attention#1', x: 0, y: 2, w: 6, h: 5 },
  { i: 'mission-control.running#1', x: 6, y: 2, w: 6, h: 5 },
  { i: 'scheduler.upcoming#1', x: 0, y: 7, w: 4, h: 5 },
  { i: 'conversations.recent#1', x: 4, y: 7, w: 4, h: 5 },
  { i: 'board.summary#1', x: 8, y: 7, w: 4, h: 5 },
  { i: 'memory.briefing#1', x: 0, y: 12, w: 5, h: 5 },
  { i: 'costops.summary#1', x: 5, y: 12, w: 3, h: 5 },
  { i: 'observability.system#1', x: 8, y: 12, w: 4, h: 5 },
]

/** Widget ids (without the `#n` instance suffix) present in the factory layout. */
export function factoryWidgetIds(): string[] {
  return DEFAULT_LAYOUT.map((item) => item.i.split('#')[0])
}

// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// The message an A2A peer's task becomes. The peer is not the owner and its
// text is not EYAS's: it is fenced like an inbound channel message
// (inbound-coordinator.ts), so a description that opens with a look-alike
// EYAS frame (<turn-context>, <eyas-memory>) or any other control tag reaches
// the model defanged, inside an <untrusted-input source="a2a"> block.

import { wrapUntrusted } from '@shared/untrusted.js'

export function a2aTaskPrompt(description: string): string {
  return wrapUntrusted(description, { source: 'a2a' })
}

// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// The effort a reply ran with, next to "Provider · model" under it: the
// effective level, or "requested → effective" when the model did not offer
// the requested one; the tooltip says who set it (TurnMeta.effort). Nothing
// when the turn asked for no effort and none was sent.

import { turnEffortCaption, turnEffortOf } from '@/lib/effort-options'

export function TurnEffortChip({ turnMeta }: { turnMeta: unknown }) {
  const caption = turnEffortCaption(turnEffortOf(turnMeta))
  if (!caption) return null
  return (
    <span
      className="mt-1.5 inline-flex flex-shrink-0 items-center rounded border border-border/50 px-1.5 text-[10px] text-muted-foreground"
      title={caption.title}
      data-testid="turn-effort"
    >
      {caption.text}
    </span>
  )
}

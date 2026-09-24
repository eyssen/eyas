// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// The notices of one turn, as one quiet line each under it (turn-notices.ts):
// while the turn streams, and under the stored reply afterwards.

import { ImageOff, Info, Minimize2, ShieldOff } from 'lucide-react'
import { noticeText, type TurnNotice } from '../turn-notices'

const ICONS: Record<string, typeof Info> = {
  imagesNotVisible: ImageOff,
  contextCompacted: Minimize2,
  cliSandboxUnavailable: ShieldOff,
}

/** `separated`: inside a reply bubble, set off from the answer by a rule. */
export function TurnNotices({ notices, separated = false }: { notices: readonly TurnNotice[]; separated?: boolean }) {
  const shown = notices
    .map((notice) => ({ notice, text: noticeText(notice) }))
    .filter((n): n is { notice: TurnNotice; text: string } => n.text !== null)
  if (shown.length === 0) return null
  return (
    <div className={`space-y-1 ${separated ? 'mt-2 border-t border-border/50 pt-1.5' : 'mt-1.5'}`} data-testid="turn-notices">
      {shown.map(({ notice, text }, i) => {
        const Icon = ICONS[notice.code] ?? Info
        return (
          <div key={`${notice.code}-${i}`} role="note" className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <Icon className="h-3.5 w-3.5 mt-px shrink-0" aria-hidden />
            <span>{text}</span>
          </div>
        )
      })}
    </div>
  )
}

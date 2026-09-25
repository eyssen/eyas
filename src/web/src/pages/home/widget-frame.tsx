// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// WidgetFrame started as dashboard-section.tsx's DashboardSection, copied and
// extended for the widget grid: a drag handle (`data-grid-handle`, picked up
// by the grid library's dragHandleClass) and an edit-mode remove button. The
// original title / icon / badge+tone / href / loading / empty behaviour is
// unchanged. dashboard-section.tsx is now deleted — the fixed dashboard it
// backed is gone and this file was its only ever importer.

import type { ReactNode, ComponentType } from 'react'
import { Link } from '@tanstack/react-router'
import { ChevronRight, GripVertical, X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface WidgetFrameProps {
  title: string
  icon?: ComponentType<{ className?: string }>
  href?: string
  hrefLabel?: string
  badge?: number | string | null
  badgeTone?: 'default' | 'warn' | 'danger' | 'ok'
  children: ReactNode
  className?: string
  empty?: boolean
  emptyLabel?: string
  loading?: boolean
  loadingLabel?: string
  /** Edit mode only: renders the × button that removes this widget from the layout. */
  onRemove?: () => void
  removeLabel?: string
  /** `data-testid` on the remove button, e.g. `remove-${item.i}` — lets a grid-page test target one tile's control among many identical ones. */
  removeTestId?: string
}

const BADGE_TONE: Record<NonNullable<WidgetFrameProps['badgeTone']>, string> = {
  default: 'bg-muted text-muted-foreground',
  warn: 'bg-amber-500/15 text-amber-600 dark:text-amber-300',
  danger: 'bg-red-500/15 text-red-600 dark:text-red-300',
  ok: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300',
}

export function WidgetFrame({
  title,
  icon: Icon,
  href,
  hrefLabel,
  badge,
  badgeTone = 'default',
  children,
  className,
  empty,
  emptyLabel,
  loading,
  loadingLabel,
  onRemove,
  removeLabel,
  removeTestId,
}: WidgetFrameProps) {
  return (
    // `h-full` + `overflow-hidden`: the frame fills the grid cell exactly and
    // never lets anything out of it (see home-page.tsx's item wrapper for what
    // used to escape). The header is `shrink-0` so it is never squeezed, and
    // everything below it lives in a `min-h-0 flex-1 overflow-y-auto` region —
    // `min-h-0` is the part that is easy to miss: a flex child defaults to
    // `min-height: auto` and refuses to shrink below its content, so without
    // it the region grows to fit and the overflow just moves up to the frame.
    //
    // `mb-2` rather than `mb-3` on the header: this frame's chrome is charged
    // against the SHORTEST cell any of these tiles can occupy, which is 90px
    // (h:2, the Pulse tile's minH). 32px of `p-4` plus a 20px header line plus
    // this margin is 60 of those 90 — the 4px saved here is a seventh of what
    // is left over for content, which is not a rounding error at that size.
    <section className={cn('glass-card p-4 flex flex-col min-h-0 h-full overflow-hidden', className)}>
      <header className="flex shrink-0 items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          {onRemove && (
            <span
              data-grid-handle
              className="cursor-grab active:cursor-grabbing text-muted-foreground shrink-0"
            >
              <GripVertical className="h-4 w-4" />
            </span>
          )}
          {Icon && <Icon className="h-4 w-4 text-muted-foreground shrink-0" />}
          <h2 className="text-sm font-semibold truncate">{title}</h2>
          {badge != null && badge !== 0 && badge !== '0' && (
            <span
              className={cn(
                'text-[10px] font-medium px-1.5 py-0.5 rounded-full tabular-nums',
                BADGE_TONE[badgeTone],
              )}
            >
              {badge}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {href && (
            <Link
              to={href}
              className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-0.5"
            >
              {hrefLabel}
              <ChevronRight className="h-3 w-3" />
            </Link>
          )}
          {onRemove && (
            <button
              type="button"
              onClick={onRemove}
              aria-label={removeLabel}
              data-testid={removeTestId}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </header>
      {/* `widget-scroll` (home-grid.css) is the affordance, not decoration:
          macOS overlay scrollbars are invisible until something is already
          being scrolled, so a clipped tile and a scrollable one looked
          identical — "it scrolls" was indistinguishable from "it is broken".
          That rule gives this region a permanently visible thin scrollbar
          whenever, and only whenever, its content actually overflows. */}
      <div
        data-testid="widget-content"
        className="widget-scroll min-h-0 flex-1 overflow-y-auto overflow-x-hidden"
      >
        {loading ? (
          <p className="text-xs text-muted-foreground py-2">{loadingLabel}</p>
        ) : empty ? (
          <p className="text-xs text-muted-foreground py-2">{emptyLabel}</p>
        ) : (
          children
        )}
      </div>
    </section>
  )
}

export function DashboardRow({
  onClick,
  children,
  className,
}: {
  onClick?: () => void
  children: ReactNode
  className?: string
}) {
  const Comp = onClick ? 'button' : 'div'
  return (
    <Comp
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={cn(
        'flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors',
        onClick && 'hover:bg-accent/40 cursor-pointer',
        className,
      )}
    >
      {children}
    </Comp>
  )
}

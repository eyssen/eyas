// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { ReactNode, ComponentType } from 'react'
import { Link } from '@tanstack/react-router'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

interface DashboardSectionProps {
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
}

const BADGE_TONE: Record<NonNullable<DashboardSectionProps['badgeTone']>, string> = {
  default: 'bg-muted text-muted-foreground',
  warn: 'bg-amber-500/15 text-amber-600 dark:text-amber-300',
  danger: 'bg-red-500/15 text-red-600 dark:text-red-300',
  ok: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300',
}

export function DashboardSection({
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
}: DashboardSectionProps) {
  return (
    <section className={cn('glass-card p-4 flex flex-col min-h-0', className)}>
      <header className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 min-w-0">
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
        {href && (
          <Link
            to={href}
            className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-0.5 shrink-0"
          >
            {hrefLabel}
            <ChevronRight className="h-3 w-3" />
          </Link>
        )}
      </header>
      {loading ? (
        <p className="text-xs text-muted-foreground py-2">{loadingLabel}</p>
      ) : empty ? (
        <p className="text-xs text-muted-foreground py-2">{emptyLabel}</p>
      ) : (
        children
      )}
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

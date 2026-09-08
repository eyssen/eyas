// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { cn } from '@/lib/utils'

const STATUS_DOT: Record<string, string> = {
  running: 'bg-blue-400 motion-safe:animate-pulse',
  working: 'bg-blue-400 motion-safe:animate-pulse',
  completed: 'bg-emerald-400',
  failed: 'bg-red-400',
  error: 'bg-red-400',
  cancelled: 'bg-zinc-400',
  idle: 'bg-zinc-400',
  paused: 'bg-amber-400',
  waiting: 'bg-amber-400',
  waiting_approval: 'bg-amber-400',
}

export function StatusDot({ status, className }: { status: string; className?: string }) {
  return (
    <span
      className={cn(
        'mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full',
        STATUS_DOT[status] ?? 'bg-zinc-400',
        className,
      )}
    />
  )
}

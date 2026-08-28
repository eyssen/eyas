// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useNavigate } from '@tanstack/react-router'
import { Bot, Calendar, MessageSquare, Pin } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { t } from './i18n'

export interface BoardCardProps {
  id: string
  taskId: string
  title: string | null
  priority: string
  tags: string[]
  status: string
  pinned: boolean
  dueDate?: string | null
  tokensUsed?: number
  messageCount?: number
  assignees?: string[]
  agentName?: string | null
  mode?: string | null
  childCount?: number
  childrenDone?: number
  totalCostUsd?: number
  updatedAt?: string | null
  projectName?: string
  projectColor?: string
}

const PRIORITY_BORDER: Record<string, string> = {
  urgent: 'border-l-red-500',
  high: 'border-l-orange-500',
  normal: 'border-l-transparent',
  low: 'border-l-zinc-500',
}

const STATUS_INDICATOR: Record<string, { labelKey: string; className: string } | null> = {
  working: { labelKey: 'board.card.status.working', className: 'text-blue-400 animate-pulse' },
  waiting: { labelKey: 'board.card.status.waiting', className: 'text-amber-400' },
  waiting_approval: { labelKey: 'board.card.status.waitingApproval', className: 'text-amber-400' },
  error: { labelKey: 'board.card.status.error', className: 'text-red-400' },
  idle: null,
  archived: null,
}

const TAG_COLORS: Record<string, string> = {
  bug: '#f85149',
  feature: '#3fb950',
  improvement: '#58a6ff',
  docs: '#d2a8ff',
  security: '#f0883e',
  performance: '#79c0ff',
  refactor: '#8b949e',
}

/** Approximate context window when model config is not on the card. */
const DEFAULT_CONTEXT_WINDOW = 128_000

function getTagColor(tag: string): string {
  return TAG_COLORS[tag.toLowerCase()] ?? '#8b949e'
}

function tokenBarColor(pct: number): string {
  if (pct < 50) return 'bg-emerald-500'
  if (pct < 75) return 'bg-amber-500'
  return 'bg-red-500'
}

function formatDueDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function isOverdue(iso: string): boolean {
  const day = iso.slice(0, 10)
  const today = new Date().toISOString().slice(0, 10)
  return day < today
}

function agingLabel(updatedAt: string | null | undefined): { text: string; className: string } | null {
  if (!updatedAt) return null
  const ageH = (Date.now() - new Date(updatedAt).getTime()) / 3_600_000
  if (!Number.isFinite(ageH) || ageH < 24) return null
  if (ageH >= 168) {
    return { text: t('board.card.aging.stuck', { days: Math.floor(ageH / 24) }), className: 'text-red-400' }
  }
  if (ageH >= 72) {
    return { text: t('board.card.aging.stale', { days: Math.floor(ageH / 24) }), className: 'text-amber-400' }
  }
  return { text: t('board.card.aging.aging', { hours: Math.floor(ageH) }), className: 'text-muted-foreground' }
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[1][0]).toUpperCase()
}

export function BoardCard({
  id,
  taskId,
  title,
  priority,
  tags,
  status,
  pinned,
  dueDate = null,
  tokensUsed = 0,
  messageCount = 0,
  assignees = [],
  agentName = null,
  mode = null,
  childCount = 0,
  childrenDone = 0,
  totalCostUsd = 0,
  updatedAt = null,
  projectName,
  projectColor,
}: BoardCardProps) {
  const navigate = useNavigate()
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    ...(isDragging && { opacity: 0.3 }),
  }

  const tokenPct = Math.min(100, Math.round((tokensUsed / DEFAULT_CONTEXT_WINDOW) * 100))
  const statusInfo = STATUS_INDICATOR[status] ?? null
  const overdue = dueDate ? isOverdue(dueDate) : false
  const aging = agingLabel(updatedAt)
  const subtaskPct = childCount > 0 ? Math.round((childrenDone / childCount) * 100) : 0
  const showMode = mode && mode !== 'simple'

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={() => navigate({ to: '/conversations/$conversationId', params: { conversationId: id } })}
      className={cn(
        'glass-card p-3 cursor-grab active:cursor-grabbing hover:shadow-md transition-shadow group',
        'border-l-[3px]',
        PRIORITY_BORDER[priority] ?? PRIORITY_BORDER.normal,
        isDragging && 'pointer-events-none',
        overdue && 'ring-1 ring-red-500/40',
      )}
    >
      {/* Row 1: project + pin + task id */}
      <div className="flex items-center justify-between gap-1.5 mb-1">
        <div className="flex items-center gap-1 min-w-0">
          {projectName && (
            <span
              className="text-[9px] font-semibold px-1.5 py-0.5 rounded-sm leading-none truncate max-w-[100px]"
              style={{ backgroundColor: projectColor ?? '#6366f1', color: '#fff' }}
            >
              {projectName}
            </span>
          )}
          {pinned && <Pin className="h-3 w-3 text-primary flex-shrink-0" aria-label={t('board.card.pinned')} />}
        </div>
        <span className="text-[10px] text-muted-foreground font-mono flex-shrink-0">#{taskId}</span>
      </div>

      {/* Row 2: title + status */}
      <div className="flex items-start gap-1.5 mb-1">
        <div className="text-sm font-medium truncate flex-1 min-w-0">
          {title || t('board.card.untitled')}
        </div>
        {statusInfo && (
          <span
            className={cn('text-[9px] font-medium flex-shrink-0 leading-5', statusInfo.className)}
            title={t(statusInfo.labelKey)}
          >
            {t(statusInfo.labelKey)}
          </span>
        )}
      </div>

      {/* Row 3: tags + mode */}
      {(tags.length > 0 || showMode) && (
        <div className="flex items-center gap-1 flex-wrap mb-1.5">
          {tags.map((tag) => {
            const color = getTagColor(tag)
            return (
              <span
                key={tag}
                className="text-[10px] px-1.5 py-0.5 rounded-sm font-medium"
                style={{ backgroundColor: color + '26', color }}
              >
                {tag}
              </span>
            )
          })}
          {showMode && (
            <span className="text-[9px] px-1.5 py-0.5 rounded-sm border border-border/50 text-muted-foreground">
              {mode}
            </span>
          )}
        </div>
      )}

      {/* Subtask progress */}
      {childCount > 0 && (
        <div className="flex items-center gap-1.5 mb-1.5">
          <span className="text-[9px] text-muted-foreground flex-shrink-0">
            {t('board.card.subtasks', { done: childrenDone, total: childCount })}
          </span>
          <div className="flex-1 h-[3px] rounded-full bg-muted overflow-hidden">
            <div
              className={cn('h-full rounded-full', childrenDone === childCount ? 'bg-emerald-500' : 'bg-primary/70')}
              style={{ width: `${subtaskPct}%` }}
            />
          </div>
        </div>
      )}

      {/* Token / context bar */}
      {tokensUsed > 0 && (
        <div className="group/bar relative mb-1.5">
          <div className="h-[3px] rounded-full bg-muted overflow-hidden">
            <div
              className={cn('h-full rounded-full transition-all', tokenBarColor(tokenPct))}
              style={{ width: `${Math.max(tokenPct, 2)}%` }}
            />
          </div>
          <span className="absolute -top-4 right-0 text-[9px] text-muted-foreground opacity-0 group-hover/bar:opacity-100 transition-opacity">
            {t('board.card.contextPct', { pct: tokenPct })}
          </span>
        </div>
      )}

      {/* Footer meta */}
      <div className="flex items-center gap-1.5 flex-wrap text-[10px] text-muted-foreground mt-0.5">
        {dueDate && (
          <span className={cn('inline-flex items-center gap-0.5', overdue && 'text-red-400 font-medium')}>
            <Calendar className="h-3 w-3" />
            {overdue ? t('board.card.overdue', { date: formatDueDate(dueDate) }) : formatDueDate(dueDate)}
          </span>
        )}
        {messageCount > 0 && (
          <span className="inline-flex items-center gap-0.5">
            <MessageSquare className="h-3 w-3" />
            {messageCount}
          </span>
        )}
        {agentName && (
          <span className="inline-flex items-center gap-0.5 truncate max-w-[90px]" title={agentName}>
            <Bot className="h-3 w-3 flex-shrink-0" />
            <span className="truncate">{agentName}</span>
          </span>
        )}
        {aging && <span className={cn('ml-auto', aging.className)}>{aging.text}</span>}
        {!aging && totalCostUsd > 0 && (
          <span className="ml-auto tabular-nums">{t('board.card.cost', { cost: totalCostUsd.toFixed(2) })}</span>
        )}
        {aging && totalCostUsd > 0 && (
          <span className="tabular-nums">{t('board.card.cost', { cost: totalCostUsd.toFixed(2) })}</span>
        )}
        {assignees.length > 0 && (
          <span className={cn('inline-flex items-center -space-x-1', !aging && totalCostUsd <= 0 && 'ml-auto')}>
            {assignees.slice(0, 2).map((a) => (
              <Avatar key={a} className="size-4 ring-1 ring-background" title={a}>
                <AvatarFallback className="text-[7px] leading-none">{initials(a)}</AvatarFallback>
              </Avatar>
            ))}
            {assignees.length > 2 && (
              <span className="pl-1.5 text-[8px] text-muted-foreground/60">+{assignees.length - 2}</span>
            )}
          </span>
        )}
      </div>
    </div>
  )
}

// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Command } from 'cmdk'
import { toast } from 'sonner'
import {
  ArrowRight, LayoutGrid, LayoutDashboard, Pin, PinOff, Plus, SquareGanttChart, User, Workflow,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { api } from '@/lib/api'
import { useBoardStore, type BoardStage, type BoardViewMode } from '@/stores/board-store'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { rankByText, rankConversations, type ListRow } from './board-list-utils'
import { t } from './i18n'

/** Sub-pages the palette can drill into. `root` is the command list itself. */
type Page = 'root' | 'move' | 'priority' | 'assign' | 'newIn'

const PRIORITIES = ['urgent', 'high', 'normal', 'low'] as const

const PRIORITY_DOT: Record<string, string> = {
  urgent: 'bg-red-500',
  high: 'bg-orange-500',
  normal: 'bg-blue-500',
  low: 'bg-zinc-600',
}

const JUMP_VIEWS: { mode: Exclude<BoardViewMode, 'list'>; Icon: typeof LayoutGrid }[] = [
  { mode: 'kanban', Icon: LayoutGrid },
  { mode: 'timeline', Icon: SquareGanttChart },
  { mode: 'graph', Icon: Workflow },
  { mode: 'dashboard', Icon: LayoutDashboard },
]

interface UserOption {
  id: string
  displayName: string
}

interface BoardCommandPaletteProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  stages: BoardStage[]
  rows: ListRow[]
  /** The row the list has highlighted — the target of the row-scoped commands. */
  activeRow: ListRow | null
  onChanged: () => void
}

const itemClass = cn(
  'flex items-center gap-2 rounded-md px-2 py-1.5 text-[11px] text-foreground cursor-pointer select-none',
  'data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground',
)
const groupClass = '[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-[9px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-muted-foreground/60'

export function BoardCommandPalette({
  open, onOpenChange, stages, rows, activeRow, onChanged,
}: BoardCommandPaletteProps) {
  const navigate = useNavigate()
  const setViewMode = useBoardStore((s) => s.setViewMode)
  const moveConversation = useBoardStore((s) => s.moveConversation)
  const addConversationToStage = useBoardStore((s) => s.addConversationToStage)

  const [page, setPage] = useState<Page>('root')
  const [query, setQuery] = useState('')
  const [users, setUsers] = useState<UserOption[]>([])

  // Every open starts from a clean root page — a palette that remembers where
  // you left off is a palette you have to read before you can use it.
  useEffect(() => {
    if (open) {
      setPage('root')
      setQuery('')
    }
  }, [open])

  useEffect(() => {
    setQuery('')
  }, [page])

  // The user list is only needed once someone actually reaches the assign page.
  useEffect(() => {
    if (page !== 'assign' || users.length > 0) return
    api.get<{ users: UserOption[] }>('/users')
      .then((d) => setUsers(d.users))
      .catch(() => setUsers([]))
  }, [page, users.length])

  const close = useCallback(() => onOpenChange(false), [onOpenChange])

  const patchActive = useCallback(async (body: Record<string, unknown>) => {
    if (!activeRow) return
    try {
      await api.patch(`/conversations/${activeRow.id}`, body)
      onChanged()
    } catch {
      toast.error(t('common.unknownError'))
    }
  }, [activeRow, onChanged])

  const openConversation = useCallback((id: string) => {
    close()
    navigate({ to: '/conversations/$conversationId', params: { conversationId: id } })
  }, [close, navigate])

  const conversationItems = useMemo(
    () => rankConversations(query, rows).slice(0, 20),
    [query, rows],
  )

  const commands = useMemo(() => {
    const list: { id: string; label: string; Icon: typeof Pin; run: () => void }[] = [
      { id: 'newIn', label: t('board.cmd.newIn'), Icon: Plus, run: () => setPage('newIn') },
    ]
    if (activeRow) {
      list.unshift({ id: 'open', label: t('board.cmd.open'), Icon: ArrowRight, run: () => openConversation(activeRow.id) })
      list.push(
        { id: 'move', label: t('board.cmd.moveTo'), Icon: ArrowRight, run: () => setPage('move') },
        { id: 'priority', label: t('board.cmd.setPriority'), Icon: ArrowRight, run: () => setPage('priority') },
        { id: 'assign', label: t('board.cmd.assign'), Icon: User, run: () => setPage('assign') },
        {
          id: 'pin',
          label: activeRow.pinned ? t('board.cmd.unpin') : t('board.cmd.pin'),
          Icon: activeRow.pinned ? PinOff : Pin,
          run: () => {
            close()
            void patchActive({ pinned: !activeRow.pinned })
          },
        },
      )
    }
    return list
  }, [activeRow, close, openConversation, patchActive])

  const commandItems = useMemo(
    () => rankByText(query, commands, (c) => [c.label]),
    [query, commands],
  )

  const viewItems = useMemo(
    () => rankByText(query, JUMP_VIEWS, (v) => [t(`board.view.${v.mode}`)]),
    [query],
  )

  const stageItems = useMemo(
    () => (page === 'newIn' ? stages : rankByText(query, stages, (s) => [s.name])),
    [page, query, stages],
  )

  const priorityItems = useMemo(
    () => rankByText(query, [...PRIORITIES], (p) => [t(`board.priority.${p}`)]),
    [query],
  )

  const userItems = useMemo(
    () => rankByText(query, users, (u) => [u.displayName]),
    [query, users],
  )

  const rootCount = conversationItems.length + commandItems.length + viewItems.length
  const pageCount =
    page === 'root' ? rootCount
      : page === 'move' ? stageItems.length
        : page === 'newIn' ? stageItems.length
          : page === 'priority' ? priorityItems.length
            : userItems.length

  const placeholder = page === 'newIn'
    ? t('board.newConversationPlaceholder')
    : t('board.cmd.placeholder')

  const createIn = (stage: BoardStage) => {
    close()
    void addConversationToStage(query.trim() || t('board.card.untitled'), stage.id)
  }

  const moveTo = (stage: BoardStage) => {
    if (!activeRow) return
    close()
    moveConversation(activeRow.id, stage.id, stage.conversations.length)
  }

  const toggleAssignee = (user: UserOption) => {
    if (!activeRow) return
    const next = activeRow.assignees.includes(user.displayName)
      ? activeRow.assignees.filter((a) => a !== user.displayName)
      : [...activeRow.assignees, user.displayName]
    close()
    void patchActive({ assignees: next })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        // The search input labels itself; there is no prose to describe. Passing
        // undefined explicitly is Radix's opt-out — omitting it logs a missing
        // `Description`/`aria-describedby` warning instead.
        aria-describedby={undefined}
        className="p-0 gap-0 overflow-hidden sm:max-w-xl"
        // On a sub-page Escape steps back to the command list instead of
        // throwing away the whole palette.
        onEscapeKeyDown={(e) => {
          if (page !== 'root') {
            e.preventDefault()
            setPage('root')
          }
        }}
      >
        <DialogTitle className="sr-only">{t('board.cmd.title')}</DialogTitle>
        <Command
          // Ranking is ours (board-list-utils), so cmdk's own filter stays off.
          shouldFilter={false}
          label={t('board.cmd.title')}
          onKeyDown={(e) => {
            if (page !== 'root' && e.key === 'Backspace' && query === '') {
              e.preventDefault()
              setPage('root')
            }
          }}
        >
          <div className="border-b border-border/40 px-3">
            <Command.Input
              value={query}
              onValueChange={setQuery}
              placeholder={placeholder}
              className="h-10 w-full bg-transparent text-[12px] text-foreground placeholder:text-muted-foreground/50 focus:outline-none"
            />
          </div>

          <Command.List className="max-h-[320px] overflow-y-auto p-1.5">
            {pageCount === 0 && (
              <div className="py-6 text-center text-[11px] text-muted-foreground">
                {t('board.cmd.noResults')}
              </div>
            )}

            {page === 'root' && (
              <>
                {commandItems.length > 0 && (
                  <Command.Group heading={t('board.cmd.group.actions')} className={groupClass}>
                    {commandItems.map(({ id, label, Icon, run }) => (
                      <Command.Item key={id} value={`action:${id}`} onSelect={run} className={itemClass}>
                        <Icon className="h-3 w-3 shrink-0 text-muted-foreground" />
                        <span className="truncate">{label}</span>
                        {activeRow && id !== 'newIn' && (
                          <span className="ml-auto truncate pl-2 font-mono text-[9px] text-muted-foreground/50">
                            #{activeRow.taskId}
                          </span>
                        )}
                      </Command.Item>
                    ))}
                  </Command.Group>
                )}

                {conversationItems.length > 0 && (
                  <Command.Group heading={t('board.cmd.group.conversations')} className={groupClass}>
                    {conversationItems.map((row) => (
                      <Command.Item
                        key={row.id}
                        value={`conv:${row.id}`}
                        onSelect={() => openConversation(row.id)}
                        className={itemClass}
                      >
                        <span className="w-10 shrink-0 truncate font-mono text-[9px] text-muted-foreground/60">
                          #{row.taskId}
                        </span>
                        <span className="truncate">{row.title || t('board.card.untitled')}</span>
                        <span className="ml-auto truncate pl-2 text-[9px] text-muted-foreground/50">
                          {row.stageName}
                        </span>
                      </Command.Item>
                    ))}
                  </Command.Group>
                )}

                {viewItems.length > 0 && (
                  <Command.Group heading={t('board.cmd.group.views')} className={groupClass}>
                    {viewItems.map(({ mode, Icon }) => (
                      <Command.Item
                        key={mode}
                        value={`view:${mode}`}
                        onSelect={() => {
                          close()
                          setViewMode(mode)
                        }}
                        className={itemClass}
                      >
                        <Icon className="h-3 w-3 shrink-0 text-muted-foreground" />
                        <span className="truncate">{t(`board.view.${mode}`)}</span>
                      </Command.Item>
                    ))}
                  </Command.Group>
                )}
              </>
            )}

            {(page === 'move' || page === 'newIn') && stageItems.map((stage) => (
              <Command.Item
                key={stage.id}
                value={`stage:${stage.id}`}
                onSelect={() => (page === 'newIn' ? createIn(stage) : moveTo(stage))}
                className={itemClass}
              >
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ backgroundColor: stage.color ?? 'var(--muted-foreground)' }}
                />
                <span className="truncate">{stage.name}</span>
              </Command.Item>
            ))}

            {page === 'priority' && priorityItems.map((priority) => (
              <Command.Item
                key={priority}
                value={`priority:${priority}`}
                onSelect={() => {
                  close()
                  void patchActive({ priority })
                }}
                className={itemClass}
              >
                <span className={cn('h-2 w-2 shrink-0 rounded-sm', PRIORITY_DOT[priority])} />
                <span className="truncate">{t(`board.priority.${priority}`)}</span>
              </Command.Item>
            ))}

            {page === 'assign' && userItems.map((user) => (
              <Command.Item
                key={user.id}
                value={`user:${user.id}`}
                onSelect={() => toggleAssignee(user)}
                className={itemClass}
              >
                <User className="h-3 w-3 shrink-0 text-muted-foreground" />
                <span className="truncate">{user.displayName}</span>
                {activeRow?.assignees.includes(user.displayName) && (
                  <span className="ml-auto text-[9px] text-muted-foreground/60">✓</span>
                )}
              </Command.Item>
            ))}
          </Command.List>
        </Command>
      </DialogContent>
    </Dialog>
  )
}

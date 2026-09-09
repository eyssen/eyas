// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Pin, Archive, Trash2, ChevronDown, ChevronRight } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { api } from '@/lib/api'
import { useBoardStore } from '@/stores/board-store'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import type { BoardViewProps } from './board-view-props'
import { BoardCommandPalette } from './board-command-palette'
import { groupRows, initials, GROUP_BY_OPTIONS, type GroupBy, type ListRow, type RowGroup } from './board-list-utils'
import { t } from './i18n'

const PRIORITY_DOT: Record<string, string> = {
  urgent: 'bg-red-500',
  high: 'bg-orange-500',
  normal: 'bg-blue-500',
  low: 'bg-zinc-600',
}

// Run status colors, matching the run tree. `working`/`waiting`/`error` are the
// board's own wording for the same three states.
const STATUS_DOT: Record<string, string> = {
  running: 'bg-blue-400 animate-pulse motion-reduce:animate-none',
  working: 'bg-blue-400 animate-pulse motion-reduce:animate-none',
  completed: 'bg-emerald-400',
  done: 'bg-emerald-400',
  failed: 'bg-red-400',
  error: 'bg-red-400',
  cancelled: 'bg-zinc-400',
  paused: 'bg-amber-400',
  waiting: 'bg-amber-400',
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

function getTagColor(tag: string): string {
  return TAG_COLORS[tag.toLowerCase()] ?? '#8b949e'
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return t('board.list.time.justNow')
  if (mins < 60) return t('board.list.time.minutes', { count: mins })
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return t('board.list.time.hours', { count: hrs })
  const days = Math.floor(hrs / 24)
  return t('board.list.time.days', { count: days })
}

/** Rows are a fixed height so the virtualizer can measure without a layout pass. */
const ROW_HEIGHT = 26
/** Below this a group renders in full — virtualizing costs more than it saves. */
const VIRTUALIZE_THRESHOLD = 150
const UNDO_WINDOW_MS = 5000

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable
}

interface FlatEntry {
  groupKey: string
  row: ListRow
}

export function BoardList({ stages, projectName, projectColor }: BoardViewProps) {
  const navigate = useNavigate()
  const fetchBoard = useBoardStore((s) => s.fetchBoard)
  const currentProjectId = useBoardStore((s) => s.currentProjectId)

  const [groupBy, setGroupBy] = useState<GroupBy>('stage')
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set())
  const [pendingDelete, setPendingDelete] = useState<ReadonlySet<string>>(() => new Set())
  const [activeIdx, setActiveIdx] = useState(0)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [focusTick, setFocusTick] = useState(0)

  const rowRefs = useRef(new Map<string, HTMLDivElement>())
  const timersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>())

  const groups = useMemo(() => {
    const grouped = groupRows(stages, groupBy)
    // A row inside its undo window is already gone as far as the user is
    // concerned — the API call only follows once the window closes.
    if (pendingDelete.size === 0) return grouped
    return grouped.map((g) => ({ ...g, rows: g.rows.filter((r) => !pendingDelete.has(r.id)) }))
  }, [stages, groupBy, pendingDelete])

  // Keyboard navigation walks what is actually on screen, so a collapsed group
  // is skipped rather than silently moving the highlight somewhere invisible.
  const flat = useMemo<FlatEntry[]>(
    () => groups
      .filter((g) => !collapsed.has(g.key))
      .flatMap((g) => g.rows.map((row) => ({ groupKey: g.key, row }))),
    [groups, collapsed],
  )

  const totalRows = useMemo(() => groups.reduce((sum, g) => sum + g.rows.length, 0), [groups])

  // The palette searches the whole board, including collapsed groups. Grouping
  // by assignee lists a shared conversation under each owner, so dedupe by id.
  const paletteRows = useMemo(() => {
    const seen = new Set<string>()
    const unique: ListRow[] = []
    for (const group of groups) {
      for (const row of group.rows) {
        if (seen.has(row.id)) continue
        seen.add(row.id)
        unique.push(row)
      }
    }
    return unique
  }, [groups])

  const stateRef = useRef({ flat, activeIdx })
  useEffect(() => {
    stateRef.current = { flat, activeIdx }
  })

  useEffect(() => {
    setActiveIdx((i) => (i >= flat.length ? Math.max(0, flat.length - 1) : i))
  }, [flat.length])

  // Deleting is deferred: the row hides instantly and the DELETE only fires once
  // the undo window closes, which is what makes Undo free (no restore endpoint).
  // Leaving before the window elapses therefore has to mean something, and the
  // deliberate choice is CANCEL: an unmount drops the pending timers and the
  // conversation survives. Deleting is unrecoverable and merely leaving the view
  // is not a confirmation, so the failure mode is biased toward keeping data —
  // the cost being that a "Deleted" toast can be followed by the row still being
  // there when you come back. Do not "fix" that by flushing here without asking:
  // it is the trade-off, not an oversight. (A tab close cancels either way,
  // short of navigator.sendBeacon.)
  useEffect(() => () => {
    for (const timer of timersRef.current.values()) clearTimeout(timer)
  }, [])

  const refresh = useCallback(async () => {
    if (currentProjectId) await fetchBoard(currentProjectId)
  }, [currentProjectId, fetchBoard])

  const openRow = useCallback((id: string) => {
    navigate({ to: '/conversations/$conversationId', params: { conversationId: id } })
  }, [navigate])

  const togglePin = useCallback(async (row: ListRow) => {
    try {
      await api.patch(`/conversations/${row.id}`, { pinned: !row.pinned })
      await refresh()
    } catch {
      toast.error(t('common.unknownError'))
    }
  }, [refresh])

  const archiveRow = useCallback(async (row: ListRow) => {
    try {
      await api.patch(`/conversations/${row.id}`, { archived: true })
      await refresh()
    } catch {
      toast.error(t('common.unknownError'))
    }
  }, [refresh])

  // Delete is deferred, not undone: the row disappears immediately but the API
  // call only fires when the undo window closes, so "undo" needs no restore
  // endpoint.
  const scheduleDelete = useCallback((row: ListRow) => {
    const { id } = row
    if (timersRef.current.has(id)) return

    const forget = () => setPendingDelete((prev) => {
      const next = new Set(prev)
      next.delete(id)
      return next
    })

    setPendingDelete((prev) => new Set(prev).add(id))

    const timer = setTimeout(async () => {
      timersRef.current.delete(id)
      try {
        await api.delete(`/conversations/${id}`)
        await refresh()
        forget()
      } catch {
        forget()
        toast.error(t('common.unknownError'))
      }
    }, UNDO_WINDOW_MS)
    timersRef.current.set(id, timer)

    toast(t('board.list.deleted', { title: row.title || t('board.card.untitled') }), {
      duration: UNDO_WINDOW_MS,
      action: {
        label: t('board.list.undo'),
        onClick: () => {
          const pending = timersRef.current.get(id)
          if (pending) {
            clearTimeout(pending)
            timersRef.current.delete(id)
          }
          forget()
        },
      },
    })
  }, [refresh])

  // ⌘K is already claimed app-wide by the header's global search, which listens
  // on `window` in the bubble phase (components/layout/search-bar.tsx). Both
  // listeners would fire and both palettes would open, stacked — preventDefault
  // does not stop a sibling listener. So claim the chord in the *capture* phase,
  // which runs first, and stopImmediatePropagation() there to cut the event off
  // before it ever reaches the global search's listener. This is deliberately
  // scoped: this component only mounts in the list view, so ⌘K keeps opening the
  // global search everywhere else in the app.
  useEffect(() => {
    const onPaletteChord = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'k') return
      e.preventDefault()
      e.stopImmediatePropagation()
      setPaletteOpen(true)
    }
    window.addEventListener('keydown', onPaletteChord, true)
    return () => window.removeEventListener('keydown', onPaletteChord, true)
  }, [])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // While the palette is open it owns the keyboard; while the user types,
      // nobody else does.
      if (paletteOpen || isTypingTarget(e.target)) return
      if (e.metaKey || e.ctrlKey || e.altKey) return

      const { flat: entries, activeIdx: idx } = stateRef.current
      if (entries.length === 0) return

      const move = (delta: number) => {
        e.preventDefault()
        setActiveIdx((i) => Math.min(Math.max(i + delta, 0), entries.length - 1))
        setFocusTick((n) => n + 1)
      }

      if (e.key === 'ArrowDown' || e.key === 'j') return move(1)
      if (e.key === 'ArrowUp' || e.key === 'k') return move(-1)

      const row = entries[idx]?.row
      if (!row) return

      if (e.key === 'Enter') {
        e.preventDefault()
        openRow(row.id)
      } else if (e.key === 'p') {
        e.preventDefault()
        void togglePin(row)
      } else if (e.key === 'e') {
        e.preventDefault()
        void archiveRow(row)
      } else if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault()
        scheduleDelete(row)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [paletteOpen, openRow, togglePin, archiveRow, scheduleDelete])

  const activeEntry = flat[activeIdx] ?? null
  const activeKey = activeEntry ? `${activeEntry.groupKey}:${activeEntry.row.id}` : null

  // Only chase focus after a keyboard move, so mounting the view never steals
  // focus from wherever the user actually is.
  useEffect(() => {
    if (focusTick === 0 || !activeKey) return
    rowRefs.current.get(activeKey)?.focus({ preventScroll: false })
  }, [focusTick, activeKey])

  const toggleGroup = (key: string) => setCollapsed((prev) => {
    const next = new Set(prev)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  })

  const renderRow = useCallback((entry: FlatEntry, flatIdx: number): ReactNode => {
    const { row, groupKey } = entry
    const rowKey = `${groupKey}:${row.id}`
    const isActive = flatIdx === activeIdx

    return (
      <div
        key={rowKey}
        ref={(el) => {
          if (el) rowRefs.current.set(rowKey, el)
          else rowRefs.current.delete(rowKey)
        }}
        role="option"
        aria-selected={isActive}
        tabIndex={isActive ? 0 : -1}
        onClick={() => {
          setActiveIdx(flatIdx)
          openRow(row.id)
        }}
        onFocus={() => setActiveIdx(flatIdx)}
        className={cn(
          'group/row flex items-center gap-1.5 border-b border-border/10 px-2 cursor-pointer',
          'hover:bg-accent/10 focus:outline-none',
          isActive && 'bg-accent/20 ring-1 ring-inset ring-ring',
          row.stageIsClosed && 'opacity-60',
        )}
        style={{ height: ROW_HEIGHT }}
      >
        <span
          aria-hidden
          className={cn('h-2 w-2 shrink-0 rounded-sm', PRIORITY_DOT[row.priority] ?? PRIORITY_DOT.normal)}
        />
        <span
          aria-hidden
          className={cn(
            'h-1.5 w-1.5 shrink-0 rounded-full',
            STATUS_DOT[row.status] ?? 'border border-border/60',
          )}
        />
        <span className="w-12 shrink-0 truncate font-mono text-[9px] text-muted-foreground/60">
          #{row.taskId}
        </span>
        <span className="truncate text-[11px] font-medium text-foreground">
          {row.title || t('board.card.untitled')}
        </span>

        {row.tags.length > 0 && (
          <span className="hidden shrink-0 items-center gap-0.5 sm:flex">
            {row.tags.slice(0, 3).map((tag) => {
              const color = getTagColor(tag)
              return (
                <span
                  key={tag}
                  className="rounded-sm px-1 py-px text-[7px] font-medium leading-none"
                  style={{ backgroundColor: `${color}26`, color }}
                >
                  {tag}
                </span>
              )
            })}
            {row.tags.length > 3 && (
              <span className="text-[8px] text-muted-foreground/40">+{row.tags.length - 3}</span>
            )}
          </span>
        )}

        <span className="flex-1" />

        {projectName && groupBy !== 'stage' && (
          <span
            className="hidden shrink-0 rounded-sm px-1 py-px text-[8px] font-semibold leading-none lg:inline"
            style={{ backgroundColor: projectColor ?? '#6366f1', color: '#fff' }}
          >
            {projectName}
          </span>
        )}

        {row.assignees.length > 0 && (
          <span className="flex shrink-0 items-center -space-x-1">
            {row.assignees.slice(0, 2).map((assignee) => (
              <Avatar key={assignee} className="size-4 ring-1 ring-background" title={assignee}>
                <AvatarFallback className="text-[7px] leading-none">{initials(assignee)}</AvatarFallback>
              </Avatar>
            ))}
            {row.assignees.length > 2 && (
              <span className="pl-1.5 text-[8px] text-muted-foreground/50">+{row.assignees.length - 2}</span>
            )}
          </span>
        )}

        <span className="w-12 shrink-0 text-right text-[9px] text-muted-foreground/50">
          {relativeTime(row.updatedAt ?? row.dueDate ?? new Date().toISOString())}
        </span>

        <span
          className={cn(
            'flex shrink-0 items-center gap-0.5 transition-opacity',
            row.pinned ? 'opacity-100' : 'opacity-0 group-hover/row:opacity-100 focus-within:opacity-100',
          )}
        >
          <button
            type="button"
            tabIndex={-1}
            onClick={(e) => {
              e.stopPropagation()
              void togglePin(row)
            }}
            title={t('board.list.pin')}
            aria-label={t('board.list.pin')}
            className={cn(
              'rounded p-0.5 transition-colors hover:bg-accent/30',
              row.pinned ? 'text-primary' : 'text-muted-foreground/40',
            )}
          >
            <Pin className="h-3 w-3" />
          </button>
          <button
            type="button"
            tabIndex={-1}
            onClick={(e) => {
              e.stopPropagation()
              void archiveRow(row)
            }}
            title={t('board.list.archive')}
            aria-label={t('board.list.archive')}
            className="rounded p-0.5 text-muted-foreground/40 transition-colors hover:bg-accent/30"
          >
            <Archive className="h-3 w-3" />
          </button>
          <button
            type="button"
            tabIndex={-1}
            onClick={(e) => {
              e.stopPropagation()
              scheduleDelete(row)
            }}
            title={t('common.delete')}
            aria-label={t('common.delete')}
            className="rounded p-0.5 text-muted-foreground/40 transition-colors hover:bg-destructive/20 hover:text-destructive"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </span>
      </div>
    )
  }, [activeIdx, openRow, togglePin, archiveRow, scheduleDelete, projectName, projectColor, groupBy])

  // Offset of each group's first row in `flat`, so a row knows its keyboard index.
  const groupOffsets = useMemo(() => {
    const offsets = new Map<string, number>()
    let cursor = 0
    for (const group of groups) {
      if (collapsed.has(group.key)) continue
      offsets.set(group.key, cursor)
      cursor += group.rows.length
    }
    return offsets
  }, [groups, collapsed])

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex items-center gap-1.5 border-b border-border/30 px-2 py-1">
        <span className="text-[9px] uppercase tracking-wider text-muted-foreground/60">
          {t('board.groupBy.label')}
        </span>
        <div
          role="group"
          aria-label={t('board.groupBy.label')}
          className="flex items-center overflow-hidden rounded-md border border-border/40"
        >
          {GROUP_BY_OPTIONS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setGroupBy(option)}
              aria-pressed={groupBy === option}
              className={cn(
                'h-6 px-2 text-[9px] transition-colors',
                groupBy === option
                  ? 'bg-accent/40 text-foreground'
                  : 'text-muted-foreground/60 hover:text-foreground',
              )}
            >
              {t(`board.groupBy.${option}`)}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => setPaletteOpen(true)}
          className="rounded border border-border/40 px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground/50 transition-colors hover:text-foreground"
          aria-label={t('board.cmd.title')}
        >
          ⌘K
        </button>
      </div>

      {totalRows === 0 ? (
        <div className="flex flex-1 items-center justify-center text-[11px] text-muted-foreground">
          {t('board.list.noMatch')}
        </div>
      ) : (
        <div className="flex-1 overflow-auto">
          {groups.map((group) => (
            <BoardListGroup
              key={group.key}
              group={group}
              collapsed={collapsed.has(group.key)}
              offset={groupOffsets.get(group.key) ?? 0}
              onToggle={() => toggleGroup(group.key)}
              renderRow={renderRow}
            />
          ))}
        </div>
      )}

      <BoardCommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        stages={stages}
        rows={paletteRows}
        activeRow={activeEntry?.row ?? null}
        onChanged={() => void refresh()}
      />
    </div>
  )
}

interface BoardListGroupProps {
  group: RowGroup
  collapsed: boolean
  offset: number
  onToggle: () => void
  renderRow: (entry: FlatEntry, flatIdx: number) => ReactNode
}

function BoardListGroup({ group, collapsed, offset, onToggle, renderRow }: BoardListGroupProps) {
  const label = group.labelKey ? t(group.labelKey) : group.label
  const Chevron = collapsed ? ChevronRight : ChevronDown

  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!collapsed}
        className="sticky top-0 z-10 flex w-full items-center gap-1.5 border-b border-border/30 bg-background/95 px-2 py-1 text-left backdrop-blur transition-colors hover:bg-accent/10"
      >
        <Chevron className="h-3 w-3 shrink-0 text-muted-foreground/50" />
        {group.color && (
          <span
            className="h-1.5 w-1.5 shrink-0 rounded-full"
            style={{ backgroundColor: group.color }}
            aria-hidden
          />
        )}
        <span className="truncate text-[10px] font-semibold text-foreground">{label}</span>
        <span className="text-[9px] text-muted-foreground/50">{group.rows.length}</span>
      </button>

      {!collapsed && (
        // `listbox`/`option` rather than `list`/`listitem`: the rows carry a
        // single-select highlight, and `aria-selected` is only meaningful on an
        // option. Each group is its own listbox so the sticky headers stay
        // outside the selectable set.
        <div role="listbox" aria-label={label}>
          {group.rows.length > VIRTUALIZE_THRESHOLD ? (
            <VirtualRows group={group} offset={offset} renderRow={renderRow} />
          ) : (
            group.rows.map((row, i) => renderRow({ groupKey: group.key, row }, offset + i))
          )}
        </div>
      )}
    </div>
  )
}

/** Long groups scroll in their own window so only the visible rows are mounted. */
function VirtualRows({ group, offset, renderRow }: Omit<BoardListGroupProps, 'collapsed' | 'onToggle'>) {
  const parentRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: group.rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  })

  return (
    // The scroll and offset wrappers are presentational so the rows stay owned
    // by the group's role="listbox" in the accessibility tree.
    <div ref={parentRef} role="presentation" className="max-h-[60vh] overflow-auto">
      <div role="presentation" className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((item) => (
          <div
            key={item.key}
            role="presentation"
            className="absolute left-0 top-0 w-full"
            style={{ height: item.size, transform: `translateY(${item.start}px)` }}
          >
            {renderRow({ groupKey: group.key, row: group.rows[item.index] }, offset + item.index)}
          </div>
        ))}
      </div>
    </div>
  )
}

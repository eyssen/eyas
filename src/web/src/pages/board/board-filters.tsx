// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { useEffect, useState } from 'react'
import { Search, LayoutGrid, List, SquareGanttChart, Workflow, LayoutDashboard } from 'lucide-react'
import { useBoardStore, type BoardViewMode } from '@/stores/board-store'
import { api } from '@/lib/api'
import { t } from './i18n'

interface Tag {
  id: string
  name: string
  color: string
}

const PRIORITIES = ['urgent', 'high', 'normal', 'low'] as const
const STATES = [
  { value: 'active', labelKey: 'board.filters.state.active' },
  { value: 'done', labelKey: 'board.filters.state.done' },
  { value: 'all', labelKey: 'board.filters.state.all' },
] as const

// The view toggle group. Order is the progression from most concrete (cards you
// drag) to most aggregated (project-wide numbers), which is also the order the
// arrow keys walk.
const VIEWS: { mode: BoardViewMode; Icon: typeof LayoutGrid }[] = [
  { mode: 'kanban', Icon: LayoutGrid },
  { mode: 'list', Icon: List },
  { mode: 'timeline', Icon: SquareGanttChart },
  { mode: 'graph', Icon: Workflow },
  { mode: 'dashboard', Icon: LayoutDashboard },
]

const selectClass = 'h-7 px-2 text-[10px] bg-transparent border border-border/40 rounded-md text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring cursor-pointer'
const searchClass = 'h-7 w-full pl-6 pr-2 text-[10px] bg-transparent border border-border/40 rounded-md text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring'

export function BoardFilters() {
  const { filters, viewMode, stages, setFilter, setViewMode } = useBoardStore()
  const [tags, setTags] = useState<Tag[]>([])

  useEffect(() => {
    api.get<{ tags: Tag[] }>('/tags').then(d => setTags(d.tags)).catch(() => {})
  }, [])

  return (
    <div className="flex items-center gap-1.5 py-2 border-b border-border/30 flex-wrap">
      {/* Project filter — placeholder, project is selected in header */}

      {/* Stage filter */}
      <select
        value={filters.stageId ?? ''}
        onChange={(e) => setFilter('stageId', e.target.value || null)}
        className={selectClass}
      >
        <option value="">{t('board.filters.stage')} ▾</option>
        {stages.map(s => (
          <option key={s.id} value={s.id}>{s.name}</option>
        ))}
      </select>

      {/* State filter */}
      <select
        value={filters.state ?? 'active'}
        onChange={(e) => setFilter('state', e.target.value)}
        className={selectClass}
      >
        {STATES.map(s => (
          <option key={s.value} value={s.value}>{t(s.labelKey)} ▾</option>
        ))}
      </select>

      {/* Priority filter */}
      <select
        value={filters.priority ?? ''}
        onChange={(e) => setFilter('priority', e.target.value || null)}
        className={selectClass}
      >
        <option value="">{t('board.filters.priority')} ▾</option>
        {PRIORITIES.map(p => (
          <option key={p} value={p}>{t(`board.priority.${p}`)}</option>
        ))}
      </select>

      {/* Tags filter */}
      <select
        value={filters.tagId ?? ''}
        onChange={(e) => setFilter('tagId', e.target.value || null)}
        className={selectClass}
      >
        <option value="">{t('board.filters.tags')} ▾</option>
        {tags.map(t => (
          <option key={t.id} value={t.id}>{t.name}</option>
        ))}
      </select>

      {/* Name search */}
      <div className="relative min-w-[120px] max-w-[180px]">
        <Search className="absolute left-1.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground/50" />
        <input
          type="text"
          value={filters.search}
          onChange={(e) => setFilter('search', e.target.value)}
          placeholder={t('board.filters.searchName')}
          className={searchClass}
        />
      </div>

      {/* Content search */}
      <div className="relative min-w-[120px] max-w-[180px]">
        <Search className="absolute left-1.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground/50" />
        <input
          type="text"
          value={filters.contentSearch}
          onChange={(e) => setFilter('contentSearch', e.target.value)}
          placeholder={t('board.filters.searchContent')}
          className={searchClass}
        />
      </div>

      <div className="flex-1" />

      {/* View toggle */}
      <div className="flex items-center border border-border/40 rounded-md overflow-hidden" role="group" aria-label={t('board.page.title')}>
        {VIEWS.map(({ mode, Icon }) => {
          const active = viewMode === mode
          return (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              title={t(`board.view.${mode}`)}
              aria-label={t(`board.view.${mode}`)}
              aria-pressed={active}
              className={`h-7 px-2 flex items-center transition-colors ${active ? 'bg-accent/40 text-foreground' : 'text-muted-foreground/50 hover:text-foreground'}`}
            >
              <Icon className="h-3 w-3" />
            </button>
          )
        })}
      </div>
    </div>
  )
}

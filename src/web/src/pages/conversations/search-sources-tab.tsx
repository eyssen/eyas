// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useApi } from '@/hooks/use-api'
import { Badge } from '@/components/ui/badge'
import { t } from './i18n'

interface SearchSourceItem {
  id: string
  name: string
  status: string
  chunkCount?: number
  config?: {
    label?: string
    version?: string
    edition?: string
    family?: string
    paths?: string[]
  }
}

export interface SearchContextSpec {
  sourceIds?: string[]
  labels?: string[]
  version?: string
  edition?: string
}

interface SearchSourcesTabProps {
  conversationId: string
  searchContext: SearchContextSpec | null
  onUpdate: (fields: Record<string, unknown>) => void | Promise<void>
}

export function SearchSourcesTab({
  conversationId,
  searchContext,
  onUpdate,
}: SearchSourcesTabProps) {
  void conversationId

  const {
    data: sourcesData,
    error: sourcesError,
    isLoading: sourcesLoading,
    refetch,
  } = useApi<SearchSourceItem[] | { sources: SearchSourceItem[] }>('/search/sources')

  const sources = useMemo(() => {
    if (!sourcesData) return [] as SearchSourceItem[]
    if (Array.isArray(sourcesData)) return sourcesData
    return sourcesData.sources ?? []
  }, [sourcesData])

  // Local selection mirrors searchContext.sourceIds; empty = Auto (no pin)
  const [selected, setSelected] = useState<Set<string>>(() => new Set(searchContext?.sourceIds ?? []))
  const [saving, setSaving] = useState(false)

  // Sync from parent when conversation searchContext changes
  useEffect(() => {
    setSelected(new Set(searchContext?.sourceIds ?? []))
  }, [searchContext?.sourceIds?.join(',')])

  const persist = useCallback(
    async (next: Set<string>) => {
      setSaving(true)
      try {
        if (next.size === 0) {
          await onUpdate({ searchContext: null })
        } else {
          await onUpdate({ searchContext: { sourceIds: Array.from(next) } })
        }
      } finally {
        setSaving(false)
      }
    },
    [onUpdate],
  )

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      void persist(next)
      return next
    })
  }

  const selectAll = () => {
    const next = new Set(sources.map((s) => s.id))
    setSelected(next)
    void persist(next)
  }

  const clearAll = () => {
    const next = new Set<string>()
    setSelected(next)
    void persist(next)
  }

  if (sourcesLoading) {
    return (
      <div className="p-4 text-xs text-muted-foreground italic">
        {t('common.loading')}
      </div>
    )
  }

  if (sourcesError) {
    return (
      <div className="p-4 text-xs text-destructive">
        {t('conversations.chatter.sourcesError')}
        <button
          type="button"
          onClick={() => refetch()}
          className="ml-2 underline text-primary"
        >
          {t('common.refresh')}
        </button>
      </div>
    )
  }

  if (sources.length === 0) {
    return (
      <div className="p-4 space-y-2">
        <p className="text-xs text-muted-foreground">
          {t('conversations.chatter.sourcesEmpty')}
        </p>
        <Link
          to="/search-sources"
          className="inline-flex text-xs text-primary hover:underline"
        >
          {t('conversations.chatter.sourcesAddLink')}
        </Link>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-3 py-2 border-b border-border/30 flex-shrink-0 space-y-1.5">
        <p className="text-[11px] text-muted-foreground leading-snug">
          {t('conversations.chatter.sourcesHint')}
        </p>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={selectAll}
            className="text-[10px] text-primary hover:underline"
          >
            {t('conversations.chatter.sourcesSelectAll')}
          </button>
          <span className="text-[10px] text-muted-foreground">·</span>
          <button
            type="button"
            onClick={clearAll}
            className="text-[10px] text-primary hover:underline"
          >
            {t('conversations.chatter.sourcesClear')}
          </button>
          {saving && (
            <span className="text-[10px] text-muted-foreground italic">
              {t('conversations.chatter.sourcesSaving')}
            </span>
          )}
          {selected.size === 0 && (
            <Badge variant="outline" className="text-[10px]">
              {t('conversations.chatter.sourcesAuto')}
            </Badge>
          )}
          {selected.size > 0 && (
            <Badge variant="outline" className="text-[10px]">
              {t('conversations.chatter.sourcesPinned', { count: selected.size })}
            </Badge>
          )}
        </div>
      </div>

      <ul className="flex-1 overflow-y-auto min-h-0 divide-y divide-border/30">
        {sources.map((s) => {
          const checked = selected.has(s.id)
          const label = s.config?.label
          const ver = s.config?.version
          const edition = s.config?.edition
          const path = s.config?.paths?.[0]
          return (
            <li key={s.id}>
              <label
                className={`flex items-start gap-2.5 px-3 py-2.5 cursor-pointer transition-colors hover:bg-accent/30 ${
                  checked ? 'bg-primary/5' : ''
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(s.id)}
                  className="mt-0.5 h-3.5 w-3.5 rounded border-border accent-primary"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-xs font-medium truncate">{s.name}</span>
                    {label && (
                      <span className="text-[10px] font-mono text-primary bg-primary/10 px-1.5 py-0.5 rounded">
                        {label}
                      </span>
                    )}
                    {ver && (
                      <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                        v{ver}
                      </span>
                    )}
                    {edition && (
                      <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                        {edition}
                      </span>
                    )}
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded ${
                        s.status === 'ready'
                          ? 'bg-green-500/15 text-green-600 dark:text-green-400'
                          : 'bg-muted text-muted-foreground'
                      }`}
                    >
                      {s.status}
                    </span>
                  </div>
                  {path && (
                    <div className="text-[10px] text-muted-foreground font-mono truncate mt-0.5" title={path}>
                      {path}
                    </div>
                  )}
                  {typeof s.chunkCount === 'number' && s.chunkCount > 0 && (
                    <div className="text-[10px] text-muted-foreground mt-0.5">
                      {t('conversations.chatter.sourcesChunks', { count: s.chunkCount })}
                    </div>
                  )}
                </div>
              </label>
            </li>
          )
        })}
      </ul>

      <div className="px-3 py-2 border-t border-border/30 flex-shrink-0">
        <Link
          to="/search-sources"
          className="text-[11px] text-primary hover:underline"
        >
          {t('conversations.chatter.sourcesManage')}
        </Link>
      </div>
    </div>
  )
}

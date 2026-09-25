import { useEffect, useRef } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useSearchStore } from '@/stores/search-store'
import { cn } from '@/lib/utils'
import { Search, FileCode, FileText, File, X, ArrowRight } from 'lucide-react'
import { SearchFilters } from '@/components/search/search-filters'
import { t } from './i18n'

function collectionIcon(collection: string) {
  if (collection === 'code') return FileCode
  if (collection === 'docs') return FileText
  return File
}

function groupByCollection(results: ReturnType<typeof useSearchStore.getState>['results']) {
  const groups: Record<string, typeof results> = {}
  for (const r of results) {
    const col = r.chunk.collection ?? 'other'
    if (!groups[col]) groups[col] = []
    groups[col].push(r)
  }
  return groups
}

export function SearchBar() {
  const { open, setOpen, toggleOpen, query, results, searching, setQuery, search } = useSearchStore()
  const inputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const navigate = useNavigate()

  function goToResults(q: string) {
    setOpen(false)
    navigate({ to: '/search-results', search: { query: q } as any })
  }

  // Cmd+K / Ctrl+K to open
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        toggleOpen()
      }
      if (e.key === 'Escape') {
        setOpen(false)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  // Focus input when opened
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

  const handleInput = (value: string) => {
    setQuery(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => search(value), 300)
  }

  if (!open) return null

  const groups = groupByCollection(results)
  const hasResults = results.length > 0

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] bg-black/40 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) setOpen(false) }}
    >
      <div className="w-full max-w-2xl mx-4 rounded-xl border border-border/60 bg-background shadow-2xl overflow-hidden">
        {/* Input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border/40">
          <Search className="h-4 w-4 text-muted-foreground flex-shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={e => handleInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && query.trim()) goToResults(query) }}
            placeholder={t('searchBar.placeholder')}
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/60"
          />
          {query && (
            <button
              type="button"
              onClick={() => { setQuery(''); search('') }}
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
          {searching && (
            <div className="h-3.5 w-3.5 rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground animate-spin flex-shrink-0" />
          )}
        </div>

        {/* Collection filters */}
        <div className="border-b border-border/40">
          <SearchFilters compact />
        </div>

        {/* Results */}
        <div className="max-h-[50vh] overflow-y-auto">
          {!hasResults && query && !searching && (
            <div className="py-10 text-center text-sm text-muted-foreground">{t('searchBar.noResultsFor', { query })}</div>
          )}

          {!hasResults && !query && (
            <div className="py-10 text-center text-sm text-muted-foreground">
              {t('searchBar.emptyHint')}
            </div>
          )}

          {hasResults && (
            <div className="py-2">
              {Object.entries(groups).map(([collection, items]) => {
                const Icon = collectionIcon(collection)
                return (
                  <div key={collection}>
                    <div className="px-4 py-1.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                      <Icon className="h-3 w-3" />
                      {collection}
                      <span className="ml-1 opacity-60">({items.length})</span>
                    </div>
                    {items.map(result => {
                      const filePath = String(result.chunk.metadata?.filePath ?? result.chunk.sourceId ?? '')
                      const lineStart = Number(result.chunk.metadata?.lineStart ?? 1)
                      return (
                        <button
                          key={result.chunk.id}
                          type="button"
                          className="w-full px-4 py-2.5 hover:bg-accent/40 transition-colors cursor-pointer text-left"
                          onClick={() => {
                            setOpen(false)
                            navigate({
                              to: '/search-results',
                              search: { query, file: filePath, line: String(lineStart) } as any,
                            })
                          }}
                        >
                          <div className="flex items-start justify-between gap-2 mb-1">
                            <span className="text-xs font-mono text-muted-foreground truncate flex-1">
                              {filePath}
                            </span>
                            <div className="flex items-center gap-1.5 flex-shrink-0">
                              <span className={cn(
                                'text-[10px] px-1.5 py-0.5 rounded font-medium',
                                result.matchType === 'both' ? 'bg-purple-500/15 text-purple-500' :
                                result.matchType === 'vector' ? 'bg-blue-500/15 text-blue-500' :
                                'bg-accent text-muted-foreground'
                              )}>
                                {result.matchType}
                              </span>
                              <span className="text-[10px] text-muted-foreground">
                                {Math.round(result.score * 100)}%
                              </span>
                            </div>
                          </div>
                          <p className="text-xs text-foreground/80 line-clamp-2 leading-relaxed">
                            {result.chunk.content}
                          </p>
                        </button>
                      )
                    })}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Show all results link */}
        {hasResults && query && (
          <div className="border-t border-border/40 px-4 py-2">
            <button
              type="button"
              className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-accent/40 hover:text-foreground transition-colors"
              onClick={() => goToResults(query)}
            >
              <span>{t('searchBar.showAll', { count: results.length, query })}</span>
              <ArrowRight className="h-3 w-3" />
            </button>
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center gap-4 px-4 py-2 border-t border-border/40 bg-muted/30">
          <span className="text-[11px] text-muted-foreground flex items-center gap-1">
            <kbd className="px-1.5 py-0.5 rounded bg-muted border border-border/60 font-mono text-[10px]">⌘K</kbd>
            {t('searchBar.toOpenClose')}
          </span>
          <span className="text-[11px] text-muted-foreground flex items-center gap-1">
            <kbd className="px-1.5 py-0.5 rounded bg-muted border border-border/60 font-mono text-[10px]">Esc</kbd>
            {t('searchBar.toDismiss')}
          </span>
          {hasResults && (
            <span className="text-[11px] text-muted-foreground ml-auto">
              {results.length !== 1 ? t('searchBar.results', { count: results.length }) : t('searchBar.result', { count: results.length })}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

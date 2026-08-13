// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { useEffect, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useSearchStore } from '@/stores/search-store'
import { cn } from '@/lib/utils'
import { Search, FileCode, FileText, File, X, ChevronRight } from 'lucide-react'
import { SearchFilters } from '@/components/search/search-filters'
import { t } from './i18n'

interface FileContent {
  content: string
  path: string
  language: string
  totalLines: number
}

interface ActiveFile {
  fileContent: FileContent
  highlightStart: number
  highlightEnd: number
}

function collectionIcon(collection: string) {
  if (collection === 'code') return FileCode
  if (collection === 'docs') return FileText
  return File
}

function relativePath(absPath: string): string {
  // Show last 3 path segments to keep it readable
  const parts = absPath.replace(/\\/g, '/').split('/')
  return parts.slice(-3).join('/')
}

function scoreColor(score: number): string {
  if (score >= 0.8) return 'bg-green-500/15 text-green-500'
  if (score >= 0.5) return 'bg-yellow-500/15 text-yellow-600 dark:text-yellow-400'
  return 'bg-muted text-muted-foreground'
}

function groupByFile(results: ReturnType<typeof useSearchStore.getState>['results']) {
  const groups: Record<string, typeof results> = {}
  for (const r of results) {
    const filePath = String(r.chunk.metadata?.filePath ?? r.chunk.sourceId ?? 'unknown')
    if (!groups[filePath]) groups[filePath] = []
    groups[filePath].push(r)
  }
  return groups
}

export default function SearchResultsPage() {
  const navigate = useNavigate()
  const { query, results, searching, setQuery, search, fetchFileContent } = useSearchStore()
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [activeFile, setActiveFile] = useState<ActiveFile | null>(null)
  const [loadingFile, setLoadingFile] = useState(false)
  const highlightRef = useRef<HTMLDivElement>(null)

  // Read query from URL on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const urlQuery = params.get('query')
    const urlFile = params.get('file')
    const urlLine = params.get('line')

    if (urlQuery && urlQuery !== query) {
      setQuery(urlQuery)
      search(urlQuery)
    }

    if (urlFile) {
      openFile(urlFile, urlLine ? parseInt(urlLine, 10) : 1, 0)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Scroll to highlighted line when activeFile changes
  useEffect(() => {
    if (highlightRef.current) {
      highlightRef.current.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }
  }, [activeFile])

  const handleInput = (value: string) => {
    setQuery(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      search(value)
      const url = new URL(window.location.href)
      url.searchParams.set('query', value)
      window.history.replaceState(null, '', url.toString())
    }, 300)
  }

  async function openFile(filePath: string, lineStart: number, lineEnd: number) {
    setLoadingFile(true)
    try {
      const fileContent = await fetchFileContent(filePath)
      setActiveFile({ fileContent, highlightStart: lineStart, highlightEnd: lineEnd })
    } catch {
      // ignore fetch errors
    } finally {
      setLoadingFile(false)
    }
  }

  function handleResultClick(filePath: string, lineStart: number, lineEnd: number) {
    openFile(filePath, lineStart, lineEnd)
    const url = new URL(window.location.href)
    url.searchParams.set('file', filePath)
    url.searchParams.set('line', String(lineStart))
    window.history.replaceState(null, '', url.toString())
  }

  const groups = groupByFile(results)
  const hasResults = results.length > 0

  const lines = activeFile?.fileContent.content.split('\n') ?? []

  return (
    <div className="flex h-full overflow-hidden bg-background text-foreground">
      {/* ── Left panel ── */}
      <div className="flex w-[40%] min-w-[320px] flex-col border-r border-border/50">
        {/* Header */}
        <div className="flex items-center gap-2 border-b border-border/40 px-3 py-2">
          <button
            type="button"
            onClick={() => navigate({ to: '/' })}
            className="text-muted-foreground hover:text-foreground transition-colors"
            aria-label={t('common.back')}
          >
            <ChevronRight className="h-4 w-4 rotate-180" />
          </button>
          <span className="text-sm font-medium text-muted-foreground">{t('search.results')}</span>
        </div>

        {/* Search input */}
        <div className="flex items-center gap-3 border-b border-border/40 px-4 py-3">
          <Search className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
          <input
            autoFocus
            value={query}
            onChange={(e) => handleInput(e.target.value)}
            placeholder={t('search.placeholder')}
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
            <div className="h-3.5 w-3.5 flex-shrink-0 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground" />
          )}
        </div>

        {/* Collection filters */}
        <div className="border-b border-border/40">
          <SearchFilters />
        </div>

        {/* Results list */}
        <div className="flex-1 overflow-y-auto">
          {!hasResults && !searching && query && (
            <div className="py-12 text-center text-sm text-muted-foreground">
              {t('search.noResultsFor', { query })}
            </div>
          )}
          {!hasResults && !query && (
            <div className="py-12 text-center text-sm text-muted-foreground">
              {t('search.typeToSearch')}
            </div>
          )}

          {hasResults && (
            <div className="py-2">
              {Object.entries(groups).map(([filePath, items]) => {
                const firstItem = items[0]
                const collection = firstItem.chunk.collection ?? 'other'
                const Icon = collectionIcon(collection)
                const language = String(firstItem.chunk.metadata?.language ?? '')

                return (
                  <div key={filePath} className="mb-1">
                    {/* File header */}
                    <div className="flex items-center gap-1.5 px-4 py-1.5">
                      <Icon className="h-3 w-3 flex-shrink-0 text-muted-foreground" />
                      <span
                        className="flex-1 truncate text-[11px] font-medium text-muted-foreground"
                        title={filePath}
                      >
                        {relativePath(filePath)}
                      </span>
                      {language && (
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">
                          {language}
                        </span>
                      )}
                    </div>

                    {/* Chunks within the file */}
                    {items.map((result) => {
                      const lineStart = Number(result.chunk.metadata?.lineStart ?? 1)
                      const lineEnd = Number(result.chunk.metadata?.lineEnd ?? lineStart)
                      const snippet = result.chunk.content.split('\n').slice(0, 2).join('\n')

                      return (
                        <button
                          key={result.chunk.id}
                          type="button"
                          className="w-full px-6 py-2 text-left hover:bg-accent/40 transition-colors cursor-pointer"
                          onClick={() => handleResultClick(filePath, lineStart, lineEnd)}
                        >
                          <div className="mb-1 flex items-center justify-between gap-2">
                            <span className="text-[10px] text-muted-foreground">
                              L{lineStart}–L{lineEnd}
                            </span>
                            <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-medium', scoreColor(result.score))}>
                              {Math.round(result.score * 100)}%
                            </span>
                          </div>
                          <pre className="truncate whitespace-pre text-[11px] text-foreground/70 font-mono leading-relaxed">
                            {snippet}
                          </pre>
                        </button>
                      )
                    })}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-3 border-t border-border/40 bg-muted/20 px-4 py-2">
          {hasResults && (
            <span className="text-[11px] text-muted-foreground">
              {t('search.footer', { results: results.length, files: Object.keys(groups).length })}
            </span>
          )}
        </div>
      </div>

      {/* ── Right panel ── */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {!activeFile && !loadingFile && (
          <div className="flex flex-1 items-center justify-center">
            <div className="text-center text-sm text-muted-foreground">
              <FileCode className="mx-auto mb-2 h-8 w-8 opacity-30" />
              {t('search.selectResult')}
            </div>
          </div>
        )}

        {loadingFile && (
          <div className="flex flex-1 items-center justify-center">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground" />
          </div>
        )}

        {activeFile && !loadingFile && (
          <>
            {/* File path header */}
            <div className="flex items-center gap-2 border-b border-border/40 bg-muted/20 px-4 py-2">
              <FileCode className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
              <span className="flex-1 truncate font-mono text-xs text-muted-foreground" title={activeFile.fileContent.path}>
                {activeFile.fileContent.path}
              </span>
              <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">
                {activeFile.fileContent.language}
              </span>
              <span className="text-[10px] text-muted-foreground">
                {t('search.linesCount', { count: activeFile.fileContent.totalLines })}
              </span>
            </div>

            {/* File content */}
            <div className="flex-1 overflow-auto">
              <table className="w-full border-collapse font-mono text-xs leading-5">
                <tbody>
                  {lines.map((line, idx) => {
                    const lineNum = idx + 1
                    const isHighlighted =
                      lineNum >= activeFile.highlightStart &&
                      (activeFile.highlightEnd === 0 || lineNum <= activeFile.highlightEnd)
                    return (
                      <tr
                        key={lineNum}
                        ref={isHighlighted && lineNum === activeFile.highlightStart ? (el) => { if (el) (highlightRef as React.MutableRefObject<HTMLElement | null>).current = el } : undefined}
                        className={cn(
                          'group',
                          isHighlighted ? 'bg-yellow-500/10' : 'hover:bg-muted/30',
                        )}
                      >
                        <td className="w-12 select-none border-r border-border/30 pr-3 text-right text-muted-foreground/40 pl-2">
                          {lineNum}
                        </td>
                        <td className="pl-4 pr-4 whitespace-pre">
                          {line || ' '}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

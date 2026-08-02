// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { useState, useEffect, useCallback } from 'react'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Search, FileText, Loader2, AlertCircle, ChevronRight } from 'lucide-react'
import { t } from './i18n'

interface ReportSummary {
  id: string
  query: string
  depth: string
  status: string
  sections: Array<{ title: string; content: string }>
  sources: Array<{ title: string; url: string; relevance: number }>
  error?: string
  createdAt: string
  completedAt?: string
}

export default function ResearchPage() {
  const [query, setQuery] = useState('')
  const [depth, setDepth] = useState<'shallow' | 'deep'>('shallow')
  const [reports, setReports] = useState<ReportSummary[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedReport, setSelectedReport] = useState<ReportSummary | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isLoading, setIsLoading] = useState(true)

  const loadReports = useCallback(async () => {
    try {
      const data = await api.get<{ reports: ReportSummary[] }>('/research')
      setReports(data.reports)
    } catch (err) {
      console.error('Failed to load reports:', err)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    loadReports()
  }, [loadReports])

  // Poll for active reports
  useEffect(() => {
    const active = reports.filter((r) => r.status !== 'complete' && r.status !== 'error')
    if (active.length === 0) return

    const interval = setInterval(async () => {
      await loadReports()
      if (selectedId) {
        try {
          const report = await api.get<ReportSummary>(`/research/${selectedId}`)
          setSelectedReport(report)
        } catch { /* ignore */ }
      }
    }, 2000)
    return () => clearInterval(interval)
  }, [reports, selectedId, loadReports])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!query.trim() || isSubmitting) return

    setIsSubmitting(true)
    try {
      const result = await api.post<{ id: string }>('/research', { query: query.trim(), depth })
      setQuery('')
      setSelectedId(result.id)
      await loadReports()
      // Load the new report
      const report = await api.get<ReportSummary>(`/research/${result.id}`)
      setSelectedReport(report)
    } catch (err) {
      console.error('Failed to start research:', err)
    } finally {
      setIsSubmitting(false)
    }
  }

  const selectReport = async (id: string) => {
    setSelectedId(id)
    try {
      const report = await api.get<ReportSummary>(`/research/${id}`)
      setSelectedReport(report)
    } catch (err) {
      console.error('Failed to load report:', err)
    }
  }

  const statusBadge = (status: string) => {
    const colors: Record<string, string> = {
      pending: 'bg-yellow-500/15 text-yellow-600 dark:text-yellow-400',
      searching: 'bg-blue-500/15 text-blue-600 dark:text-blue-400',
      evaluating: 'bg-purple-500/15 text-purple-600 dark:text-purple-400',
      synthesizing: 'bg-indigo-500/15 text-indigo-600 dark:text-indigo-400',
      complete: 'bg-green-500/15 text-green-600 dark:text-green-400',
      error: 'bg-red-500/15 text-red-600 dark:text-red-400',
    }
    return (
      <span className={cn('px-2 py-0.5 rounded-full text-[11px] font-medium', colors[status] ?? 'bg-muted text-muted-foreground')}>
        {t(`research.status.${status}`)}
      </span>
    )
  }

  return (
    <div className="flex h-full">
      {/* Left panel — form + list */}
      <div className="w-[340px] border-r border-[var(--vibrancy-border)] flex flex-col">
        {/* New research form */}
        <form onSubmit={handleSubmit} className="p-4 border-b border-[var(--vibrancy-border)]">
          <div className="text-sm font-medium mb-3">{t('research.newResearch')}</div>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('research.topicPlaceholder')}
            className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <div className="flex items-center gap-2 mt-2">
            <select
              value={depth}
              onChange={(e) => setDepth(e.target.value as 'shallow' | 'deep')}
              className="flex-1 px-3 py-1.5 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="shallow">{t('research.depth.shallow')}</option>
              <option value="deep">{t('research.depth.deep')}</option>
            </select>
            <button
              type="submit"
              disabled={!query.trim() || isSubmitting}
              className="px-4 py-1.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
            >
              {isSubmitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
              {t('research.submit')}
            </button>
          </div>
        </form>

        {/* Report list */}
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
            </div>
          ) : reports.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground text-sm">
              <FileText className="h-8 w-8 mb-2 opacity-50" />
              {t('research.empty')}
            </div>
          ) : (
            <div className="flex flex-col">
              {reports.map((report) => (
                <button
                  key={report.id}
                  type="button"
                  onClick={() => selectReport(report.id)}
                  className={cn(
                    'flex items-center gap-2 px-4 py-3 text-left border-b border-border/50 transition-colors cursor-pointer',
                    selectedId === report.id
                      ? 'bg-accent/50'
                      : 'hover:bg-accent/30'
                  )}
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{report.query}</div>
                    <div className="flex items-center gap-2 mt-1">
                      {statusBadge(report.status)}
                      <span className="text-[11px] text-muted-foreground">
                        {new Date(report.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Right panel — report viewer */}
      <div className="flex-1 overflow-y-auto">
        {!selectedReport ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground text-sm">
            <Search className="h-12 w-12 mb-3 opacity-30" />
            <div>{t('research.selectPrompt')}</div>
          </div>
        ) : selectedReport.status === 'error' ? (
          <div className="p-8">
            <div className="flex items-center gap-2 text-red-500 mb-2">
              <AlertCircle className="h-5 w-5" />
              <span className="font-medium">{t('research.failedTitle')}</span>
            </div>
            <p className="text-sm text-muted-foreground">{selectedReport.error}</p>
          </div>
        ) : selectedReport.status !== 'complete' ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
            <Loader2 className="h-8 w-8 animate-spin mb-3" />
            <div className="text-sm font-medium">{t('research.researching')}</div>
            <div className="text-xs mt-1">{statusBadge(selectedReport.status)}</div>
          </div>
        ) : (
          <div className="p-8 max-w-3xl mx-auto">
            <h1 className="text-xl font-semibold mb-1">{selectedReport.query}</h1>
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-6">
              {statusBadge(selectedReport.status)}
              <span>{t('research.reportDepth', { depth: t(`research.depthShort.${selectedReport.depth}`) })}</span>
              <span>{t('research.sourcesCount', { count: selectedReport.sources.length })}</span>
              {selectedReport.completedAt && (
                <span>{new Date(selectedReport.completedAt).toLocaleString()}</span>
              )}
            </div>

            {/* Sections */}
            {selectedReport.sections.map((section, i) => (
              <div key={i} className="mb-6">
                <h2 className="text-lg font-medium mb-2">{section.title}</h2>
                <div className="text-sm leading-relaxed text-foreground/90 whitespace-pre-wrap">
                  {section.content}
                </div>
              </div>
            ))}

            {/* Sources */}
            {selectedReport.sources.length > 0 && (
              <div className="mt-8 pt-6 border-t border-border">
                <h2 className="text-lg font-medium mb-3">{t('research.sourcesHeading')}</h2>
                <div className="space-y-2">
                  {selectedReport.sources.map((source, i) => (
                    <div key={i} className="flex items-start gap-2 text-sm">
                      <span className="text-muted-foreground font-mono text-xs mt-0.5">[{i + 1}]</span>
                      <div>
                        <a
                          href={source.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary hover:underline"
                        >
                          {source.title}
                        </a>
                        <span className="text-muted-foreground ml-2 text-xs">
                          {t('research.relevant', { percent: (source.relevance * 100).toFixed(0) })}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

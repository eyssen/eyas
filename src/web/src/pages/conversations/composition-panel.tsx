// Part of eYssen. See LICENSE file for full copyright and licensing details.
// Drill-down panel for the ContextBar (Task 23). Fetches the latest
// composition for a conversation, then its sections, and renders them in
// `ord` order — the order they were actually assembled into the prompt.

import { useState } from 'react'
import { useApi } from '@/hooks/use-api'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { t } from './i18n'

interface CompositionListItem {
  id: string
  createdAt: string
}

interface CompositionSection {
  ord: number
  zone: string
  key: string
  sourceRef: string | null
  chars: number
  estimatedTokens: number
  budgetTokens: number | null
  truncated: boolean
  droppedChars: number
  content: string | null
}

interface CompositionDetail {
  id: string
  createdAt: string
  provider: string | null
  model: string | null
  contextWindow: number
  budgetTotalTokens: number
  estimatedTokens: number
  sectionCount: number
  assemblerError: string | null
}

interface CompositionPanelProps {
  conversationId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

function formatDate(ts: string): string {
  try {
    const d = new Date(ts.includes('Z') ? ts : `${ts}Z`)
    return d.toLocaleString()
  } catch {
    return ts
  }
}

export function CompositionPanel({ conversationId, open, onOpenChange }: CompositionPanelProps) {
  const [expandedOrd, setExpandedOrd] = useState<number | null>(null)

  const { data: listData, isLoading: listLoading } = useApi<{ items: CompositionListItem[] }>(
    open && conversationId ? `/observability/compositions?conversationId=${conversationId}&limit=1` : '',
  )
  const latestId = listData?.items?.[0]?.id ?? null

  const { data: detailData, isLoading: detailLoading } = useApi<{
    composition: CompositionDetail
    sections: CompositionSection[]
  }>(latestId ? `/observability/compositions/${latestId}` : '')

  const loading = listLoading || (latestId != null && detailLoading)
  const composition = detailData?.composition
  const sections = detailData?.sections ?? []

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v)
        if (!v) setExpandedOrd(null)
      }}
    >
      <DialogContent className="!max-w-[min(96vw,56rem)] w-[min(96vw,56rem)] max-h-[85vh] flex flex-col gap-3 overflow-hidden p-5">
        <DialogHeader>
          <DialogTitle>{t('conversations.compositionPanel.title')}</DialogTitle>
        </DialogHeader>

        {loading && (
          <p className="text-sm text-muted-foreground">{t('conversations.compositionPanel.loading')}</p>
        )}

        {!loading && !composition && (
          <p className="text-sm text-muted-foreground">{t('conversations.compositionPanel.empty')}</p>
        )}

        {composition && (
          <div className="flex flex-col gap-3 overflow-y-auto">
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span>{formatDate(composition.createdAt)}</span>
              {composition.provider && (
                <span>
                  {composition.provider}
                  {composition.model ? `/${composition.model}` : ''}
                </span>
              )}
              <span>
                {t('conversations.compositionPanel.estimatedTotal', {
                  estimated: composition.estimatedTokens.toLocaleString(),
                  window: composition.contextWindow.toLocaleString(),
                })}
              </span>
              {composition.assemblerError && (
                <span className="text-destructive">{composition.assemblerError}</span>
              )}
            </div>

            <div className="rounded-lg border divide-y">
              {sections.map((s) => {
                const expanded = expandedOrd === s.ord
                return (
                  <div key={s.ord} className="p-2.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[10px] text-muted-foreground font-mono w-6 flex-shrink-0">#{s.ord}</span>
                      <Badge variant="outline" className="text-[10px]">{s.zone}</Badge>
                      <span className="text-sm font-medium truncate">{s.key}</span>
                      <span className="text-xs text-muted-foreground ml-auto flex-shrink-0">
                        {t('conversations.compositionPanel.tokens', { count: s.estimatedTokens })}
                      </span>
                      {s.truncated && (
                        <Badge className="text-[10px] bg-amber-500/15 text-amber-700 dark:text-amber-400 flex-shrink-0">
                          {t('conversations.compositionPanel.truncated', { chars: s.droppedChars })}
                        </Badge>
                      )}
                    </div>
                    <button
                      type="button"
                      className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground mt-1"
                      onClick={() => setExpandedOrd(expanded ? null : s.ord)}
                    >
                      {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                      {expanded
                        ? t('conversations.compositionPanel.hideContent')
                        : t('conversations.compositionPanel.showContent')}
                    </button>
                    {expanded && (
                      <pre className="text-[11px] text-muted-foreground bg-accent/30 rounded-md p-3 mt-1 overflow-x-auto whitespace-pre-wrap max-h-[240px] overflow-y-auto">
                        {s.content ?? t('conversations.compositionPanel.noContent')}
                      </pre>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

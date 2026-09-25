// Part of eYssen. See LICENSE file for full copyright and licensing details.
// Drill-down panel for the ContextBar (Task 23). Fetches the latest
// composition for a conversation, then its sections, and renders them in
// `ord` order — the order they were actually assembled into the prompt.
// D7: each section also shows what the privacy egress did on the way to the
// model (masked / not scanned / local destination), and the content can be
// read as assembled or as sent (masks applied).
// I12: a 'Memory delivered' row says, the same way on every provider, who the
// prompt was sized for, what recall delivered (or why it was withheld), the
// turn's memory drill-down calls out of the cap, and how an ACP CLI got the
// system prompt.

import { useState } from 'react'
import { useApi } from '@/hooks/use-api'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Brain, ChevronDown, ChevronRight, ShieldCheck } from 'lucide-react'
import { t, tOr } from './i18n'
// Registers the privacy bundle: the localized PII type labels (privacy.type.*).
import '../privacy/i18n'
import {
  applyEgressSpans,
  hasEgressSpans,
  maskedToolResults,
  sectionEgressBadge,
  type CompositionEgress,
  type EgressBadge,
  type SectionEgress,
} from './composition-egress'
import {
  memoryDeliveryView,
  type CompositionDelivery,
  type DrillDownSummary,
  type MemoryDeliveryView,
} from './composition-delivery'

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
  /** Null when nothing was recorded for the section (see composition-egress.ts). */
  egress?: SectionEgress | null
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
  /** What the privacy egress did on the last model call; null before any call was recorded. */
  egress?: CompositionEgress | null
  /** What memory reached the model and how; null when no delivery was recorded. */
  delivery?: CompositionDelivery | null
  /** The turn's memory drill-down calls; null when no delivery was recorded. */
  drillDown?: DrillDownSummary | null
}

interface CompositionPanelProps {
  conversationId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** A PII type's localized label; a custom pattern's type falls back to its slug. */
function typeLabel(type: string): string {
  return tOr(`privacy.type.${type}`, type)
}

function EgressBadgeView({ badge }: { badge: EgressBadge }) {
  switch (badge.kind) {
    case 'masked':
      return (
        <Badge className="text-[10px] bg-primary/10 text-primary flex-shrink-0">
          {t('conversations.composition.egress.masked', { count: badge.count })}
          {badge.types.length > 0 ? ` · ${badge.types.map(typeLabel).join(', ')}` : ''}
        </Badge>
      )
    case 'notScanned':
      return (
        <Badge variant="outline" className="text-[10px] text-muted-foreground flex-shrink-0">
          {t('conversations.composition.egress.notScanned')}
        </Badge>
      )
    case 'local':
      return (
        <Badge variant="secondary" className="text-[10px] flex-shrink-0">
          {t('conversations.composition.egress.localDestination')}
        </Badge>
      )
    case 'none':
      return (
        <Badge variant="outline" className="text-[10px] text-muted-foreground flex-shrink-0">
          {t('conversations.composition.egress.none')}
        </Badge>
      )
  }
}

/** The 'Memory delivered' row: one line per fact the delivery record holds. */
function MemoryDeliveryRow({ view }: { view: MemoryDeliveryView }) {
  const lines: string[] = []
  if (view.window) {
    lines.push(view.window.kind === 'known'
      ? t('conversations.compositionPanel.memory.window', { model: view.window.model, window: view.window.window.toLocaleString() })
      : t('conversations.compositionPanel.memory.windowUnknown', { model: view.window.model }))
  }
  if (view.recall) {
    if (view.recall.kind === 'delivered') {
      lines.push(t('conversations.compositionPanel.memory.summary', {
        hits: view.recall.hits,
        expanded: view.recall.expanded,
        tokens: view.recall.tokens.toLocaleString(),
        budget: view.recall.budgetTokens.toLocaleString(),
      }))
    } else if (view.recall.kind === 'withheld') {
      lines.push(t('conversations.compositionPanel.memory.withheld', { reason: t(view.recall.reasonKey) }))
    } else {
      lines.push(t('conversations.compositionPanel.memory.none'))
    }
  }
  if (view.drill) {
    if (view.drill.kind === 'unavailable') lines.push(t('conversations.compositionPanel.memory.drillUnavailable'))
    else if (view.drill.kind === 'used') {
      lines.push(t('conversations.compositionPanel.memory.drillDown', { calls: view.drill.calls, limit: view.drill.limit, reads: view.drill.reads }))
    } else {
      lines.push(t('conversations.compositionPanel.memory.drillDownReads', { reads: view.drill.reads, limit: view.drill.limit }))
    }
  }
  if (view.channelKey) {
    lines.push(t('conversations.compositionPanel.memory.promptChannel', { channel: t(view.channelKey) }))
  }
  if (lines.length === 0) return null
  return (
    <div className="rounded-lg border px-3 py-2 text-xs" data-testid="memory-delivery">
      <div className="flex items-center gap-1.5 font-medium text-foreground mb-1">
        <Brain className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
        {t('conversations.compositionPanel.memory.heading')}
      </div>
      <ul className="flex flex-col gap-0.5 text-muted-foreground">
        {lines.map((line) => <li key={line}>{line}</li>)}
      </ul>
    </div>
  )
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
  const [asSent, setAsSent] = useState(false)

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
  const egress = composition?.egress ?? null
  const showAsSentToggle = egress?.locality === 'remote' && hasEgressSpans(sections)
  const toolResults = maskedToolResults(egress)
  const memory = memoryDeliveryView(composition?.delivery, composition?.drillDown, composition?.model)

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v)
        if (!v) {
          setExpandedOrd(null)
          setAsSent(false)
        }
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

            {memory && <MemoryDeliveryRow view={memory} />}

            {egress && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <ShieldCheck className="h-3.5 w-3.5 flex-shrink-0" />
                  {egress.locality === 'local'
                    ? t('conversations.composition.egress.localDestination')
                    : t('conversations.composition.egress.policyVersion', { version: egress.rulesetVersion })}
                </span>
                {toolResults.length > 0 && (
                  <span>
                    {t('conversations.composition.egress.toolResults', {
                      tools: toolResults.map((r) => `${r.toolName} (${r.masked})`).join(', '),
                    })}
                  </span>
                )}
                {showAsSentToggle && (
                  <div className="ml-auto flex rounded-md border overflow-hidden" role="group">
                    <button
                      type="button"
                      aria-pressed={!asSent}
                      className={`px-2 py-0.5 ${!asSent ? 'bg-accent text-foreground' : 'hover:text-foreground'}`}
                      onClick={() => setAsSent(false)}
                    >
                      {t('conversations.composition.egress.asAssembled')}
                    </button>
                    <button
                      type="button"
                      aria-pressed={asSent}
                      className={`px-2 py-0.5 border-l ${asSent ? 'bg-accent text-foreground' : 'hover:text-foreground'}`}
                      onClick={() => setAsSent(true)}
                    >
                      {t('conversations.composition.egress.asSent')}
                    </button>
                  </div>
                )}
              </div>
            )}

            <div className="rounded-lg border divide-y">
              {sections.map((s) => {
                const expanded = expandedOrd === s.ord
                const badge = sectionEgressBadge(s.egress, egress)
                const content = s.content != null && asSent ? applyEgressSpans(s.content, s.egress?.spans) : s.content
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
                        <Badge className="text-[10px] bg-warning/15 text-warning flex-shrink-0">
                          {t('conversations.compositionPanel.truncated', { chars: s.droppedChars })}
                        </Badge>
                      )}
                      {badge && <EgressBadgeView badge={badge} />}
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
                        {content ?? t('conversations.compositionPanel.noContent')}
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

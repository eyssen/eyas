// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// J13 — the "Recall engine" card on the Memory page's Overview tab. Read-only:
// the local embedder recall runs on (the same for every model), how many
// summaries and facts already have a vector, when the vector worker last ran,
// the project partitions holding vectors, what the raw capture records, and
// the recall settings. Everything comes from GET /memory/engine.

import { Cpu } from 'lucide-react'
import { useApi } from '@/hooks/use-api'
import { t } from './i18n'

export interface EngineCoverage {
  embedded: number
  total: number
}

export interface MemoryEngineStatus {
  embedder: { modelId: string; kind: 'e5' | 'hash' } | null
  l3: { gists: EngineCoverage; facts: EngineCoverage; lastRunAt: number | null }
  partitions: { projects: number; projectTypes: number }
  capture: { l0Enabled: boolean; toolResults: boolean; thinking: boolean }
  recall: { includeSecrets: boolean; indexBudgetChars: number }
}

function Row({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="text-right min-w-0">
        <span className="text-sm font-medium">{value}</span>
        {sub && <span className="block text-[10px] text-muted-foreground font-mono truncate">{sub}</span>}
      </div>
    </div>
  )
}

const onOff = (on: boolean) => (on ? t('memory.engine.on') : t('memory.engine.off'))

const coverageOf = (c: EngineCoverage) => t('memory.engine.coverage', { embedded: c.embedded, total: c.total })

export default function RecallEngineCard() {
  const { data, error, isLoading } = useApi<MemoryEngineStatus>('/memory/engine')

  return (
    <section className="p-4 bg-card border border-border rounded-lg" aria-labelledby="memory-engine-title">
      <div className="flex items-center gap-2 mb-3">
        <Cpu className="h-4 w-4 text-muted-foreground" />
        <h2 id="memory-engine-title" className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium m-0">
          {t('memory.engine.heading')}
        </h2>
      </div>
      {error ? (
        <div role="alert" className="text-xs text-destructive">{t('memory.engine.loadFailed')}</div>
      ) : isLoading || !data ? null : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6">
          <div>
            <Row
              label={t('memory.engine.embedder')}
              value={data.embedder
                ? (data.embedder.kind === 'e5' ? t('memory.engine.embedderE5') : t('memory.engine.embedderHash'))
                : t('memory.engine.off')}
              sub={data.embedder?.modelId}
            />
            <Row label={t('memory.engine.gists')} value={coverageOf(data.l3.gists)} />
            <Row label={t('memory.engine.facts')} value={coverageOf(data.l3.facts)} />
            <Row
              label={t('memory.engine.lastRun')}
              value={data.l3.lastRunAt ? new Date(data.l3.lastRunAt).toLocaleString() : t('memory.engine.never')}
            />
            <Row
              label={t('memory.engine.partitions')}
              value={t('memory.engine.partitionsValue', { projects: data.partitions.projects, projectTypes: data.partitions.projectTypes })}
            />
          </div>
          <div>
            <Row label={t('memory.engine.captureRaw')} value={onOff(data.capture.l0Enabled)} />
            <Row label={t('memory.engine.captureTools')} value={onOff(data.capture.toolResults)} />
            <Row label={t('memory.engine.captureThinking')} value={onOff(data.capture.thinking)} />
            <Row label={t('memory.engine.includeSecrets')} value={onOff(data.recall.includeSecrets)} />
            <Row label={t('memory.engine.indexBudget')} value={t('memory.engine.chars', { count: data.recall.indexBudgetChars })} />
          </div>
        </div>
      )}
    </section>
  )
}

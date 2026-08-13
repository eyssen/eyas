// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { t } from './i18n'

interface AgentProposal {
  id: string
  name: string
  agentType: string
  proposedTier: string
  proposedModelId: string | null
}
interface AiModelsData {
  claudeDetected: boolean
  grokDetected?: boolean
  kimiDetected?: boolean
  cliDetected?: boolean
  preferredProviderId?: string | null
  providers: { id: string; models: { id: string; name: string }[] }[]
  agents: AgentProposal[]
}

interface Props {
  onComplete: (assignments: Record<string, string>) => Promise<void>
  isLast: boolean
}

export function AiModelsStep({ onComplete, isLast }: Props) {
  const [data, setData] = useState<AiModelsData | null>(null)
  const [choices, setChoices] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.get<AiModelsData>('/setup/ai-models')
      .then((d) => {
        setData(d)
        const init: Record<string, string> = {}
        for (const a of d.agents) if (a.proposedModelId) init[a.id] = a.proposedModelId
        setChoices(init)
      })
      .catch((e: any) => setError(e?.message || t('aiModels.loadFailed')))
  }, [])

  const allModels = data?.providers.flatMap((p) => p.models) ?? []
  const anyCli = Boolean(data?.cliDetected || data?.claudeDetected || data?.grokDetected || data?.kimiDetected)

  const apply = async () => {
    setError(null)
    setLoading(true)
    try {
      await onComplete(choices)
    } catch (e: any) {
      setError(e.message || t('aiModels.error'))
    } finally {
      setLoading(false)
    }
  }

  if (!data && error) return <p className="text-sm text-destructive">{error}</p>
  if (!data) return <div className="text-sm text-muted-foreground">{t('aiModels.loading')}</div>

  if (!anyCli && allModels.length === 0) {
    return (
      <div className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">{t('aiModels.title')}</h2>
          <p className="text-sm text-muted-foreground">{t('aiModels.notDetected')}</p>
        </div>
        <p className="text-sm text-muted-foreground">{t('aiModels.notDetectedHint')}</p>
        <div className="flex justify-end">
          <Button onClick={() => onComplete({})}>{t('aiModels.goProviders')}</Button>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
    )
  }

  const detectedLabel = (() => {
    const names: string[] = []
    if (data.claudeDetected) names.push('Claude')
    if (data.grokDetected) names.push('Grok')
    if (data.kimiDetected) names.push('Kimi')
    if (names.length >= 2) {
      if (names.length === 2 && names[0] === 'Claude' && names[1] === 'Grok') {
        return t('aiModels.detected.both')
      }
      return t('aiModels.detected.multi', { names: names.join(', ') })
    }
    if (data.kimiDetected) return t('aiModels.detected.kimi')
    if (data.grokDetected) return t('aiModels.detected.grok')
    if (data.claudeDetected) return t('aiModels.detected.claude')
    return t('aiModels.detected.any')
  })()

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">{t('aiModels.title')}</h2>
        {anyCli && <Badge variant="outline" className="mt-1">{detectedLabel}</Badge>}
        <p className="text-sm text-muted-foreground mt-1">{t('aiModels.detectedHint')}</p>
      </div>

      <div className="space-y-2 max-h-[320px] overflow-y-auto pr-1">
        {data.agents.map((a) => (
          <div key={a.id} className="flex items-center justify-between gap-3 p-2.5 rounded-lg border border-border/50">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <span className="text-sm font-medium truncate">{a.name}</span>
              <Badge variant="outline" className="text-[9px] shrink-0">{a.agentType}</Badge>
            </div>
            <select
              className="text-sm bg-background border border-border rounded px-2 py-1 shrink-0 max-w-[46%]"
              value={choices[a.id] ?? ''}
              onChange={(e) => setChoices((c) => ({ ...c, [a.id]: e.target.value }))}
            >
              {allModels.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          </div>
        ))}
      </div>

      <div className="flex justify-end pt-2">
        <Button onClick={apply} disabled={loading}>
          {loading ? t('aiModels.pleaseWait') : isLast ? t('aiModels.complete') : t('aiModels.continue')}
        </Button>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  )
}

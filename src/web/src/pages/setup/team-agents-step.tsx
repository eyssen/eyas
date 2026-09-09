// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { t } from './i18n'

interface AgentOption {
  id: string
  name: string
  description: string
  agentType: string
  defaultEnabled: boolean
  category: 'recommended' | 'specialist'
}

interface TemplateResponse {
  id: string
  name: string
  description: string
  agentType: string
  defaultEnabled: boolean
  recommended: boolean
}

interface TeamAgentsStepProps {
  onSubmit: (data: Record<string, string>) => Promise<void>
  isLast: boolean
}

export function TeamAgentsStep({ onSubmit, isLast }: TeamAgentsStepProps) {
  const [options, setOptions] = useState<AgentOption[] | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadTemplates = () => {
    setError(null)
    api.get<{ templates: TemplateResponse[] }>('/agents/templates')
      .then((d) => {
        const mapped: AgentOption[] = d.templates.map((t) => ({
          id: t.id,
          name: t.name,
          description: t.description,
          agentType: t.agentType,
          defaultEnabled: t.defaultEnabled,
          category: t.recommended ? 'recommended' : 'specialist',
        }))
        setOptions(mapped)
        setSelected(new Set(mapped.filter((a) => a.defaultEnabled).map((a) => a.id)))
      })
      // A clean 401 already redirects to /login via api.ts — this only catches
      // real failures (500, network blip) so the user isn't stuck with no
      // specialists to pick from. Optional step: they can retry or skip it.
      .catch((e: any) => setError(e?.message || t('teamAgents.loadFailed')))
  }

  useEffect(loadTemplates, [])

  const toggle = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleSubmit = async () => {
    setError(null)
    setLoading(true)
    try {
      await onSubmit({ selectedAgents: Array.from(selected).join(',') })
    } catch (err: any) {
      setError(err.message || t('common.error'))
    } finally {
      setLoading(false)
    }
  }

  if (!options) {
    if (error) {
      // Optional step — a failed fetch must not be a dead end. Let the user
      // retry, or skip straight past team selection (empty selectedAgents is
      // a valid outcome: no specialists, primary agents only).
      return (
        <div className="space-y-4">
          <p className="text-sm text-destructive">{error}</p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={loadTemplates}>{t('teamAgents.retry')}</Button>
            <Button size="sm" onClick={handleSubmit} disabled={loading}>
              {loading ? t('common.pleaseWait') : isLast ? t('common.complete') : t('teamAgents.skip')}
            </Button>
          </div>
        </div>
      )
    }
    return (
      <div className="space-y-4">
        <div className="text-sm text-muted-foreground">{t('teamAgents.loading')}</div>
      </div>
    )
  }

  const recommended = options.filter((a) => a.category === 'recommended')
  const specialists = options.filter((a) => a.category === 'specialist')

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">{t('teamAgents.title')}</h2>
        <p className="text-sm text-muted-foreground">
          {t('teamAgents.subtitle')}
        </p>
      </div>

      {/* Recommended */}
      <div>
        <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">{t('teamAgents.recommended')}</h3>
        <div className="space-y-2">
          {recommended.map(agent => (
            <label
              key={agent.id}
              className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                selected.has(agent.id)
                  ? 'border-purple-500/50 bg-purple-500/10'
                  : 'border-border/50 hover:border-border'
              }`}
            >
              <input
                type="checkbox"
                checked={selected.has(agent.id)}
                onChange={() => toggle(agent.id)}
                className="mt-0.5 accent-purple-500"
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{agent.name}</span>
                  <Badge variant="outline" className="text-[10px] text-purple-400 border-purple-400/30">
                    {agent.agentType}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">{agent.description}</p>
              </div>
            </label>
          ))}
        </div>
      </div>

      {/* Specialists */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{t('teamAgents.specialists')}</h3>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-[10px] px-2"
            onClick={() => {
              const allSpecialistIds = specialists.map(s => s.id)
              const allSelected = allSpecialistIds.every(id => selected.has(id))
              setSelected(prev => {
                const next = new Set(prev)
                for (const id of allSpecialistIds) {
                  if (allSelected) next.delete(id)
                  else next.add(id)
                }
                return next
              })
            }}
          >
            {specialists.every(s => selected.has(s.id)) ? t('teamAgents.deselectAll') : t('teamAgents.selectAll')}
          </Button>
        </div>
        <div className="space-y-1.5 max-h-[280px] overflow-y-auto pr-1">
          {specialists.map(agent => (
            <label
              key={agent.id}
              className={`flex items-start gap-3 p-2.5 rounded-lg border cursor-pointer transition-colors ${
                selected.has(agent.id)
                  ? 'border-blue-500/50 bg-blue-500/10'
                  : 'border-border/50 hover:border-border'
              }`}
            >
              <input
                type="checkbox"
                checked={selected.has(agent.id)}
                onChange={() => toggle(agent.id)}
                className="mt-0.5 accent-blue-500"
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{agent.name}</span>
                  <Badge variant="outline" className="text-[9px]">{agent.agentType}</Badge>
                </div>
                <p className="text-[11px] text-muted-foreground mt-0.5">{agent.description}</p>
              </div>
            </label>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between pt-2">
        <span className="text-xs text-muted-foreground">
          {t('teamAgents.selected', { count: selected.size })}
        </span>
        <Button onClick={handleSubmit} disabled={loading}>
          {loading ? t('common.pleaseWait') : isLast ? t('common.complete') : t('common.continue')}
        </Button>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  )
}

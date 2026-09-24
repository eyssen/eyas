// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { useState, useCallback } from 'react'
import { useApi } from '@/hooks/use-api'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Plus, Trash2, GripVertical, ChevronDown, ChevronUp, Copy, Users } from 'lucide-react'
import { t } from '../i18n'

interface AgentItem {
  id: string
  name: string
  role: string
  avatar?: string
  enabled: boolean
  monthlyTokenBudget?: number
  tokensUsedThisMonth?: number
}

interface PhaseConfig {
  id: string
  name: string
  agentIds: string[]
  parallel: boolean
  checkpoint: boolean
}

export interface TeamConfig {
  phases: PhaseConfig[]
}

interface TeamConfigEditorProps {
  value?: TeamConfig
  onChange?: (config: TeamConfig) => void
}

function generateId(): string {
  return `phase-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
}

function estimateTokenCost(phases: PhaseConfig[], agents: AgentItem[]): number {
  // Rough estimate: 5K tokens per agent per phase
  const TOKENS_PER_AGENT_PHASE = 5000
  let total = 0
  for (const phase of phases) {
    total += phase.agentIds.length * TOKENS_PER_AGENT_PHASE
  }
  return total
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toLocaleString()
}

export function TeamConfigEditor({ value, onChange }: TeamConfigEditorProps) {
  const { data } = useApi<{ agents: AgentItem[] }>('/agents')
  const availableAgents = (data?.agents ?? []).filter((a) => a.enabled)

  const [phases, setPhases] = useState<PhaseConfig[]>(
    value?.phases ?? [
      { id: generateId(), name: t('agents.teamConfig.defaultPhaseName', { n: 1 }), agentIds: [], parallel: false, checkpoint: false },
    ]
  )
  const [expandedPhase, setExpandedPhase] = useState<string | null>(phases[0]?.id ?? null)

  const emit = useCallback(
    (updated: PhaseConfig[]) => {
      setPhases(updated)
      onChange?.({ phases: updated })
    },
    [onChange]
  )

  const addPhase = useCallback(() => {
    const newPhase: PhaseConfig = {
      id: generateId(),
      name: t('agents.teamConfig.defaultPhaseName', { n: phases.length + 1 }),
      agentIds: [],
      parallel: false,
      checkpoint: false,
    }
    const updated = [...phases, newPhase]
    emit(updated)
    setExpandedPhase(newPhase.id)
  }, [phases, emit])

  const removePhase = useCallback(
    (phaseId: string) => {
      emit(phases.filter((p) => p.id !== phaseId))
    },
    [phases, emit]
  )

  const updatePhase = useCallback(
    (phaseId: string, patch: Partial<PhaseConfig>) => {
      emit(phases.map((p) => (p.id === phaseId ? { ...p, ...patch } : p)))
    },
    [phases, emit]
  )

  const toggleAgent = useCallback(
    (phaseId: string, agentId: string) => {
      const phase = phases.find((p) => p.id === phaseId)
      if (!phase) return
      const agentIds = phase.agentIds.includes(agentId)
        ? phase.agentIds.filter((id) => id !== agentId)
        : [...phase.agentIds, agentId]
      updatePhase(phaseId, { agentIds })
    },
    [phases, updatePhase]
  )

  const movePhase = useCallback(
    (index: number, direction: -1 | 1) => {
      const newIndex = index + direction
      if (newIndex < 0 || newIndex >= phases.length) return
      const updated = [...phases]
      ;[updated[index], updated[newIndex]] = [updated[newIndex], updated[index]]
      emit(updated)
    },
    [phases, emit]
  )

  const copyJson = useCallback(() => {
    const config: TeamConfig = { phases }
    navigator.clipboard.writeText(JSON.stringify(config, null, 2))
  }, [phases])

  const estimatedCost = estimateTokenCost(phases, availableAgents)

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-purple-400" />
          <span className="text-xs font-medium">{t('agents.teamConfig.builder')}</span>
          <Badge variant="outline" className="text-[10px]">
            {t('agents.teamConfig.phaseCount', { count: phases.length })}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-muted-foreground">
            {t('agents.teamConfig.estTokens', { tokens: formatTokens(estimatedCost) })}
          </span>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={copyJson} title={t('agents.teamConfig.copyJsonTitle')}>
            <Copy className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Phases */}
      <div className="space-y-2">
        {phases.map((phase, index) => {
          const isExpanded = expandedPhase === phase.id
          return (
            <div key={phase.id} className="glass-card overflow-hidden">
              {/* Phase header */}
              <div
                className="flex items-center gap-2 p-3 cursor-pointer hover:bg-accent/20 transition-colors"
                onClick={() => setExpandedPhase(isExpanded ? null : phase.id)}
              >
                <GripVertical className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    className="p-0.5 hover:bg-accent/40 rounded disabled:opacity-30"
                    disabled={index === 0}
                    onClick={(e) => { e.stopPropagation(); movePhase(index, -1) }}
                  >
                    <ChevronUp className="h-3 w-3" />
                  </button>
                  <button
                    className="p-0.5 hover:bg-accent/40 rounded disabled:opacity-30"
                    disabled={index === phases.length - 1}
                    onClick={(e) => { e.stopPropagation(); movePhase(index, 1) }}
                  >
                    <ChevronDown className="h-3 w-3" />
                  </button>
                </div>
                <span className="text-xs font-medium flex-1">{phase.name}</span>
                <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                  {phase.parallel && (
                    <Badge variant="outline" className="text-[9px] text-blue-400">{t('agents.teamConfig.parallel')}</Badge>
                  )}
                  {phase.checkpoint && (
                    <Badge variant="outline" className="text-[9px] text-amber-400">{t('agents.teamConfig.checkpoint')}</Badge>
                  )}
                  <Badge variant="secondary" className="text-[9px]">
                    {t('agents.teamConfig.agentCount', { count: phase.agentIds.length })}
                  </Badge>
                </div>
                {isExpanded ? (
                  <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                )}
              </div>

              {/* Phase body */}
              {isExpanded && (
                <div className="p-3 pt-0 border-t border-border/30 space-y-3">
                  <div className="grid grid-cols-2 gap-3 pt-3">
                    <div className="space-y-1">
                      <Label className="text-[10px]">{t('agents.teamConfig.phaseName')}</Label>
                      <Input
                        value={phase.name}
                        onChange={(e) => updatePhase(phase.id, { name: e.target.value })}
                        className="h-7 text-xs"
                      />
                    </div>
                    <div className="flex items-end gap-4">
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={phase.parallel}
                          onCheckedChange={(v) => updatePhase(phase.id, { parallel: v })}
                        />
                        <Label className="text-[10px]">{t('agents.teamConfig.parallel')}</Label>
                      </div>
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={phase.checkpoint}
                          onCheckedChange={(v) => updatePhase(phase.id, { checkpoint: v })}
                        />
                        <Label className="text-[10px]">{t('agents.teamConfig.checkpoint')}</Label>
                      </div>
                    </div>
                  </div>

                  {/* Agent selection */}
                  <div>
                    <Label className="text-[10px] mb-1.5 block">{t('agents.teamConfig.assignAgents')}</Label>
                    <div className="grid grid-cols-2 gap-1.5">
                      {availableAgents.map((agent) => {
                        const isSelected = phase.agentIds.includes(agent.id)
                        return (
                          <button
                            key={agent.id}
                            className={`flex items-center gap-2 p-2 rounded-md text-left text-xs transition-colors ${
                              isSelected
                                ? 'bg-purple-500/20 text-foreground ring-1 ring-purple-500/40'
                                : 'bg-accent/20 text-muted-foreground hover:bg-accent/40'
                            }`}
                            onClick={() => toggleAgent(phase.id, agent.id)}
                          >
                            <span>{agent.avatar ?? '🤖'}</span>
                            <span className="truncate flex-1">{agent.name}</span>
                            {isSelected && (
                              <span className="text-purple-400 text-[10px] flex-shrink-0">✓</span>
                            )}
                          </button>
                        )
                      })}
                    </div>
                    {availableAgents.length === 0 && (
                      <p className="text-[10px] text-muted-foreground mt-1">
                        {t('agents.teamConfig.noAgents')}
                      </p>
                    )}
                  </div>

                  {/* Remove phase */}
                  {phases.length > 1 && (
                    <div className="flex justify-end">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-red-400 hover:text-red-300 hover:bg-red-500/10 h-7 text-xs"
                        onClick={() => removePhase(phase.id)}
                      >
                        <Trash2 className="h-3 w-3 mr-1" />
                        {t('agents.teamConfig.removePhase')}
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Add phase */}
      <Button variant="outline" size="sm" className="w-full h-8 text-xs" onClick={addPhase}>
        <Plus className="h-3.5 w-3.5 mr-1" />
        {t('agents.teamConfig.addPhase')}
      </Button>
    </div>
  )
}

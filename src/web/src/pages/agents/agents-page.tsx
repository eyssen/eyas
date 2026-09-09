// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { useState, useCallback } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useApi } from '@/hooks/use-api'
import { api } from '@/lib/api'
import { useConversationStore } from '@/stores/conversation-store'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Bot, Plus, Wrench, Shield } from 'lucide-react'
import { t } from './i18n'
import { ContextualHelp } from '@/components/docs/contextual-help'

interface AgentItem {
  id: string
  name: string
  role: string
  description: string
  capabilities: string[]
  tools: string[]
  constraints: string[]
  enabled: boolean
  source: 'seed' | 'user' | 'proposal'
  tier?: 'primary' | 'team' | 'specialist'
  agentType?: string
  goal?: string
  avatar?: string
  tags?: string[]
  monthlyTokenBudget?: number
  tokensUsedThisMonth?: number
}

export default function AgentsPage() {
  const navigate = useNavigate()
  const { data, isLoading, error, refetch } = useApi<{ agents: AgentItem[] }>('/agents')
  const [filter, setFilter] = useState<'all' | 'enabled' | 'primary' | 'team' | 'specialist'>('all')

  const agents = (data?.agents ?? []).filter((a) => {
    if (filter === 'enabled') return a.enabled
    if (filter === 'primary') return a.tier === 'primary'
    if (filter === 'team') return a.tier === 'team'
    if (filter === 'specialist') return a.tier === 'specialist'
    return true
  })

  const enabledCount = (data?.agents ?? []).filter((a) => a.enabled).length
  const totalCount = data?.agents?.length ?? 0

  const handleToggle = useCallback(async (id: string) => {
    await api.post(`/agents/${id}/toggle`)
    refetch()
  }, [refetch])

  const handleCreate = useCallback(async () => {
    const conv = await api.post<{ id: string }>('/conversations', {
      title: 'Agent Wizard',
      projectId: 'eyas-agents',
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-20250514',
    })
    useConversationStore.getState().setPendingMessage('I want to create a new agent')
    navigate({ to: '/conversations/$conversationId', params: { conversationId: conv.id } })
  }, [navigate])

  return (
    <div>
      <div className="flex items-baseline justify-between mb-5">
        <div>
          <h1 className="page-title inline-flex items-center gap-1.5">{t('agents.list.title')} <ContextualHelp helpId="agents.overview" /></h1>
          <p className="text-sm text-muted-foreground">{t('agents.list.subtitle')}</p>
        </div>
        <div className="flex items-center gap-3">
          {totalCount > 0 && (
            <span className="text-xs text-muted-foreground">
              <strong className="text-foreground">{enabledCount}/{totalCount}</strong> {t('agents.list.enabledLabel')}
            </span>
          )}
          <Button size="sm" onClick={handleCreate}>
            <Plus className="h-3.5 w-3.5 mr-1" />
            {t('agents.list.createAgent')}
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-1 text-xs mb-4">
        {(['all', 'enabled', 'primary', 'team', 'specialist'] as const).map((f) => (
          <button
            key={f}
            className={`px-3 py-1 rounded-md transition-colors ${filter === f ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            onClick={() => setFilter(f)}
          >
            {t(`agents.list.filter.${f}`)}
          </button>
        ))}
      </div>

      {/* Agent grid */}
      <div className="grid grid-cols-2 gap-3">
        {agents.map((agent) => {
          const budgetPct = agent.monthlyTokenBudget && agent.monthlyTokenBudget > 0
            ? Math.min(((agent.tokensUsedThisMonth ?? 0) / agent.monthlyTokenBudget) * 100, 100)
            : null

          return (
            <div
              key={agent.id}
              className="glass-card p-4 flex items-start gap-4 hover:bg-accent/30 transition-colors cursor-pointer"
              onClick={() => navigate({ to: '/agents/$agentId', params: { agentId: agent.id } })}
            >
              <div className="h-10 w-10 rounded-xl bg-purple-500/20 flex items-center justify-center flex-shrink-0">
                {agent.avatar ? (
                  <span className="text-lg">{agent.avatar}</span>
                ) : (
                  <Bot className="h-5 w-5 text-purple-400" />
                )}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm truncate">{agent.name}</span>
                  {agent.source === 'proposal' ? (
                    <Badge variant="outline" className="text-amber-500 border-amber-500/40 text-[10px]">{t('agents.badge.pendingApproval')}</Badge>
                  ) : agent.enabled ? (
                    <Badge variant="secondary" className="text-emerald-500 text-[10px]">{t('agents.badge.active')}</Badge>
                  ) : (
                    <Badge variant="outline" className="text-muted-foreground text-[10px]">{t('agents.badge.disabled')}</Badge>
                  )}
                  <Badge variant="outline" className="text-[10px]">
                    {agent.source === 'seed' ? t('agents.badge.builtIn') : agent.source === 'proposal' ? t('agents.badge.proposed') : t('agents.badge.custom')}
                  </Badge>
                  {agent.tier && (
                    <Badge variant="outline" className={`text-[10px] ${
                      agent.tier === 'primary' ? 'text-purple-400 border-purple-400/30' :
                      agent.tier === 'team' ? 'text-blue-400 border-blue-400/30' :
                      'text-muted-foreground'
                    }`}>
                      {t(`agents.tier.${agent.tier}`)}
                    </Badge>
                  )}
                </div>

                <p className="text-xs text-muted-foreground mt-0.5 truncate">{agent.role}</p>

                {agent.goal && (
                  <p className="text-[11px] text-muted-foreground/70 mt-1 line-clamp-2">{agent.goal}</p>
                )}

                <div className="flex items-center gap-2 mt-2 text-[10px] text-muted-foreground">
                  {agent.agentType && (
                    <Badge variant="outline" className="text-[9px]">{agent.agentType}</Badge>
                  )}
                  <span>{t('agents.list.toolsCount', { count: agent.tools.length })}</span>
                  <span>·</span>
                  <span>{t('agents.list.constraintsCount', { count: agent.constraints.length })}</span>
                </div>

                {budgetPct !== null && (
                  <div className="mt-2">
                    <div className="h-1 rounded-full bg-accent/40 overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${budgetPct > 80 ? 'bg-red-500' : budgetPct > 50 ? 'bg-amber-500' : 'bg-purple-500'}`}
                        style={{ width: `${budgetPct}%` }}
                      />
                    </div>
                    <span className="text-[9px] text-muted-foreground mt-0.5 block">
                      {t('agents.list.tokensUsage', { used: (agent.tokensUsedThisMonth ?? 0).toLocaleString(), budget: agent.monthlyTokenBudget!.toLocaleString() })}
                    </span>
                  </div>
                )}
              </div>

              <div
                className="flex-shrink-0 flex items-center gap-2"
                onClick={(e) => e.stopPropagation()}
              >
                <Switch
                  checked={agent.enabled}
                  onCheckedChange={() => handleToggle(agent.id)}
                />
              </div>
            </div>
          )
        })}
      </div>

      {isLoading && agents.length === 0 && (
        <p className="text-sm text-muted-foreground mt-4">{t('agents.list.loading')}</p>
      )}

      {error && (
        <p className="text-sm text-destructive mt-4">{t('agents.list.loadError', { message: error.message })}</p>
      )}

      {!isLoading && !error && agents.length === 0 && (
        <p className="text-sm text-muted-foreground mt-4 text-center">
          {t('agents.list.empty')}
        </p>
      )}
    </div>
  )
}

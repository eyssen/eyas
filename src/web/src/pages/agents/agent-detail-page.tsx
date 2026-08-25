// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { useState, useCallback, useEffect } from 'react'
import { useParams, useNavigate, useRouter } from '@tanstack/react-router'
import { useApi } from '@/hooks/use-api'
import { useWebSocket } from '@/hooks/use-websocket'
import { api } from '@/lib/api'
import { WS_TOPICS } from '@/lib/ws-topics'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { ArrowLeft, Bot, Trash2, Save, RotateCcw, Brain, Mic2, Radio, Sparkles } from 'lucide-react'
import { AgentVoiceTab } from './components/AgentVoiceTab'
import { AgentWorkspaceTab } from './components/AgentWorkspaceTab'
import { AgentChannelsTab } from './components/AgentChannelsTab'
import { ContextualHelp } from '@/components/docs/contextual-help'
import { ScopedPromptCoachDialog } from '@/components/prompt-coach'
import { t as coachT } from '@/components/prompt-coach/i18n'
import { t } from './i18n'

interface ModelInfo { id: string; name: string; provider: string }

interface AgentDetail {
  id: string
  name: string
  role: string
  description: string
  systemPrompt: string
  goal?: string
  backstory?: string
  tier?: 'primary' | 'team' | 'specialist'
  agentType?: 'assistant' | 'engineer' | 'developer' | 'reviewer' | 'critic' | 'researcher' | 'planner' | 'coordinator' | 'observer'
  capabilities: string[]
  tools: string[]
  constraints: string[]
  model?: string
  maxTurns?: number
  effort?: 'low' | 'medium' | 'high' | 'max' | null
  enabled: boolean
  source: 'seed' | 'user'
  avatar?: string
  tags?: string[]
  monthlyTokenBudget?: number
  tokensUsedThisMonth?: number
  createdAt?: string
  updatedAt?: string
}

export default function AgentDetailPage() {
  const { agentId } = useParams({ from: '/agents/$agentId' })
  const navigate = useNavigate()
  const router = useRouter()
  const { data, isLoading, refetch } = useApi<{ agent: AgentDetail }>(
    agentId ? `/agents/${agentId}` : ''
  )

  const { data: modelsData } = useApi<{ models: ModelInfo[] }>('/model/models')

  const agent = data?.agent ?? null
  const allModels = modelsData?.models ?? []

  const [form, setForm] = useState({
    name: '',
    role: '',
    description: '',
    systemPrompt: '',
    model: '',
    maxTurns: 10,
    effort: '',
    tools: '',
    constraints: '',
    capabilities: '',
    avatar: '',
    monthlyTokenBudget: 0,
    goal: '',
    backstory: '',
    tier: 'specialist' as string,
    agentType: 'assistant' as string,
  })

  const { subscribe } = useWebSocket()
  const [executionStatus, setExecutionStatus] = useState<string | null>(null)
  const [coachOpen, setCoachOpen] = useState(false)

  // Subscribe to real-time agent execution updates. Frames carry the concrete
  // bus subject (eyas.agent.run.started / .completed / …), so the substring
  // checks below match the run lifecycle as well as the budget alerts.
  useEffect(() => {
    if (!agentId) return
    return subscribe(WS_TOPICS.agent(agentId), (msg) => {
      const event = msg.event
      if (event.includes('completed') || event.includes('failed') || event.includes('stopped')) {
        setExecutionStatus(null)
        refetch()
      } else if (event.includes('started') || event.includes('progress')) {
        setExecutionStatus(typeof msg.data === 'object' && msg.data !== null && 'status' in (msg.data as Record<string, unknown>)
          ? String((msg.data as Record<string, unknown>).status)
          : 'running')
      }
    })
  }, [agentId, subscribe, refetch])

  // Sync form when agent loads
  useEffect(() => {
    if (!agent) return
    setForm({
      name: agent.name,
      role: agent.role,
      description: agent.description,
      systemPrompt: agent.systemPrompt,
      model: agent.model ?? '',
      maxTurns: agent.maxTurns ?? 10,
      effort: agent.effort ?? '',
      tools: agent.tools.join(', '),
      constraints: agent.constraints.join('\n'),
      capabilities: agent.capabilities.join(', '),
      avatar: agent.avatar ?? '',
      monthlyTokenBudget: agent.monthlyTokenBudget ?? 0,
      goal: agent.goal ?? '',
      backstory: agent.backstory ?? '',
      tier: agent.tier ?? 'specialist',
      agentType: agent.agentType ?? 'assistant',
    })
  }, [agent])

  const handleSave = useCallback(async () => {
    if (!agentId) return
    await api.patch(`/agents/${agentId}`, {
      name: form.name,
      role: form.role,
      description: form.description,
      systemPrompt: form.systemPrompt,
      model: form.model || undefined,
      maxTurns: form.maxTurns,
      effort: form.effort || null,
      tools: form.tools.split(',').map((s) => s.trim()).filter(Boolean),
      constraints: form.constraints.split('\n').map((s) => s.trim()).filter(Boolean),
      capabilities: form.capabilities.split(',').map((s) => s.trim()).filter(Boolean),
      avatar: form.avatar || undefined,
      monthlyTokenBudget: form.monthlyTokenBudget,
      goal: form.goal,
      backstory: form.backstory,
      tier: form.tier,
      agentType: form.agentType,
    })
    refetch()
  }, [agentId, form, refetch])

  const handleToggle = useCallback(async () => {
    if (!agentId) return
    await api.post(`/agents/${agentId}/toggle`)
    refetch()
  }, [agentId, refetch])

  const handleDelete = useCallback(async () => {
    if (!agentId || !agent) return
    if (agent.source !== 'user') return
    await api.delete(`/agents/${agentId}`)
    navigate({ to: '/agents' })
  }, [agentId, agent, navigate])

  const budgetPct = agent?.monthlyTokenBudget && agent.monthlyTokenBudget > 0
    ? Math.min(((agent.tokensUsedThisMonth ?? 0) / agent.monthlyTokenBudget) * 100, 100)
    : null

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">
        {t('agents.detail.loading')}
      </div>
    )
  }

  if (!agent) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">
        {t('agents.detail.notFound')}
      </div>
    )
  }

  return (
    <div className="max-w-3xl">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => router.history.back()}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="h-10 w-10 rounded-xl bg-purple-500/20 flex items-center justify-center flex-shrink-0">
          {agent.avatar ? (
            <span className="text-lg">{agent.avatar}</span>
          ) : (
            <Bot className="h-5 w-5 text-purple-400" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="page-title inline-flex items-center gap-1.5">
            {agent.name}
            <ContextualHelp helpId="agents.configure" />
          </h1>
          <div className="flex items-center gap-2 mt-0.5">
            <Badge variant="outline" className="text-[10px]">
              {agent.source === 'seed' ? t('agents.badge.builtIn') : t('agents.badge.custom')}
            </Badge>
            {agent.enabled ? (
              <Badge variant="secondary" className="text-emerald-500 text-[10px]">{t('agents.badge.active')}</Badge>
            ) : (
              <Badge variant="outline" className="text-muted-foreground text-[10px]">{t('agents.badge.disabled')}</Badge>
            )}
            {executionStatus && (
              <Badge variant="secondary" className="text-amber-500 text-[10px] animate-pulse">
                {executionStatus === 'running' ? t('agents.detail.executing') : executionStatus}
              </Badge>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Switch checked={agent.enabled} onCheckedChange={handleToggle} />
          {agent.source === 'user' && (
            <Button variant="ghost" size="icon" className="h-8 w-8 text-red-400 hover:text-red-300 hover:bg-red-500/10" onClick={handleDelete}>
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {/* Token budget */}
      {budgetPct !== null && (
        <div className="glass-card p-4 mb-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium">{t('agents.detail.tokenBudget')}</span>
            <span className="text-xs text-muted-foreground">
              {(agent.tokensUsedThisMonth ?? 0).toLocaleString()} / {agent.monthlyTokenBudget!.toLocaleString()}
            </span>
          </div>
          <div className="h-2 rounded-full bg-accent/40 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${budgetPct > 80 ? 'bg-red-500' : budgetPct > 50 ? 'bg-amber-500' : 'bg-purple-500'}`}
              style={{ width: `${budgetPct}%` }}
            />
          </div>
        </div>
      )}

      <Tabs defaultValue="config" className="w-full">
        <TabsList className="mb-4">
          <TabsTrigger value="config">{t('agents.detail.tab.config')}</TabsTrigger>
          <TabsTrigger value="memories">
            <Brain className="h-3.5 w-3.5 mr-1" />
            {t('agents.detail.tab.memories')}
          </TabsTrigger>
          {agent.tier !== 'specialist' && (
            <TabsTrigger value="voice">
              <Mic2 className="h-3.5 w-3.5 mr-1" />
              {t('agents.detail.tab.voice')}
            </TabsTrigger>
          )}
          {agent.tier !== 'specialist' && (
            <TabsTrigger value="workspace">{t('agents.detail.tab.workspace')}</TabsTrigger>
          )}
          <TabsTrigger value="channels">
            <Radio className="h-3.5 w-3.5 mr-1" />
            {t('agents.detail.tab.channels')}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="config">
          {/* Classification */}
          <div className="glass-card p-4 space-y-4 mb-4">
            <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{t('agents.detail.classification')}</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs">{t('agents.detail.tierLabel')}</Label>
                <select
                  value={form.tier}
                  onChange={(e) => setForm({ ...form, tier: e.target.value })}
                  className="w-full h-8 rounded-md border border-border/50 bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  <option value="primary">{t('agents.tier.primary')}</option>
                  <option value="team">{t('agents.tier.team')}</option>
                  <option value="specialist">{t('agents.tier.specialist')}</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">{t('agents.detail.agentTypeLabel')}</Label>
                <select
                  value={form.agentType}
                  onChange={(e) => setForm({ ...form, agentType: e.target.value })}
                  className="w-full h-8 rounded-md border border-border/50 bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  <option value="assistant">{t('agents.agentType.assistant')}</option>
                  <option value="engineer">{t('agents.agentType.engineer')}</option>
                  <option value="developer">{t('agents.agentType.developer')}</option>
                  <option value="reviewer">{t('agents.agentType.reviewer')}</option>
                  <option value="critic">{t('agents.agentType.critic')}</option>
                  <option value="researcher">{t('agents.agentType.researcher')}</option>
                  <option value="planner">{t('agents.agentType.planner')}</option>
                  <option value="coordinator">{t('agents.agentType.coordinator')}</option>
                  <option value="observer">{t('agents.agentType.observer')}</option>
                </select>
              </div>
            </div>
          </div>

          {/* Persona */}
          <div className="glass-card p-4 space-y-4 mb-4">
            <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{t('agents.detail.persona')}</h3>
            <div className="space-y-1.5">
              <Label className="text-xs">{t('agents.detail.goal')}</Label>
              <Input value={form.goal} onChange={(e) => setForm({ ...form, goal: e.target.value })} className="h-8 text-sm" placeholder={t('agents.detail.goalPlaceholder')} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{t('agents.detail.backstory')}</Label>
              <textarea
                value={form.backstory}
                onChange={(e) => setForm({ ...form, backstory: e.target.value })}
                className="w-full min-h-[80px] rounded-md border border-border/50 bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring resize-y"
                placeholder={t('agents.detail.backstoryPlaceholder')}
              />
            </div>
          </div>

          {/* Form */}
          <div className="glass-card p-4 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs">{t('agents.detail.name')}</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="h-8 text-sm" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">{t('agents.detail.role')}</Label>
                <Input value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className="h-8 text-sm" />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">{t('agents.detail.description')}</Label>
              <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="h-8 text-sm" />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <Label className="text-xs">{t('agents.detail.systemPrompt')}</Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs gap-1 text-blue-300 hover:text-blue-200"
                  onClick={() => setCoachOpen(true)}
                  title={coachT('promptCoach.openButtonTitle')}
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  {coachT('promptCoach.openButton')}
                </Button>
              </div>
              <textarea
                value={form.systemPrompt}
                onChange={(e) => setForm({ ...form, systemPrompt: e.target.value })}
                className="w-full min-h-[120px] rounded-md border border-border/50 bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring resize-y"
              />
            </div>
            <ScopedPromptCoachDialog
              open={coachOpen}
              onClose={() => setCoachOpen(false)}
              scope="agent-system"
              draft={form.systemPrompt}
              context={{
                name: form.name || null,
                role: form.role || null,
                goal: form.goal || null,
                backstory: form.backstory || null,
                description: form.description || null,
                tier: form.tier || null,
                agentType: form.agentType || null,
                model: form.model || null,
                tools: form.tools.split(',').map((s) => s.trim()).filter(Boolean),
                capabilities: form.capabilities.split(',').map((s) => s.trim()).filter(Boolean),
                constraints: form.constraints.split('\n').map((s) => s.trim()).filter(Boolean),
              }}
              onApply={(refined) => {
                setForm((prev) => ({ ...prev, systemPrompt: refined }))
              }}
            />

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs">{t('agents.detail.model')}</Label>
                <div className="flex gap-1.5 items-center">
                  <SearchableSelect
                    value={form.model}
                    options={[
                      { value: '', label: t('agents.detail.modelAuto') },
                      ...allModels.map(m => ({ value: m.id, label: m.name || m.id, group: m.provider })),
                      ...(form.model && !allModels.find(m => m.id === form.model) ? [{ value: form.model, label: form.model }] : []),
                    ]}
                    onChange={(v) => setForm({ ...form, model: v })}
                    placeholder={t('agents.detail.modelAuto')}
                    className="flex-1"
                  />
                  {form.model && (
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground" onClick={() => setForm({ ...form, model: '' })} title={t('agents.detail.modelResetTitle')}>
                      <RotateCcw className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">{t('agents.detail.effort')}</Label>
                <select
                  value={form.effort}
                  onChange={(e) => setForm({ ...form, effort: e.target.value })}
                  title={t('agents.detail.effortHint')}
                  className="w-full h-8 rounded-md border border-border/50 bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  <option value="">{t('agents.detail.effortAuto')}</option>
                  <option value="low">{t('agents.detail.effortLow')}</option>
                  <option value="medium">{t('agents.detail.effortMedium')}</option>
                  <option value="high">{t('agents.detail.effortHigh')}</option>
                  <option value="max">{t('agents.detail.effortMax')}</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs">{t('agents.detail.maxTurns')}</Label>
                <Input type="number" value={form.maxTurns} onChange={(e) => setForm({ ...form, maxTurns: Number(e.target.value) })} className="h-8 text-sm" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">{t('agents.detail.avatar')}</Label>
                <Input value={form.avatar} onChange={(e) => setForm({ ...form, avatar: e.target.value })} className="h-8 text-sm" placeholder={t('agents.detail.avatarPlaceholder')} />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">{t('agents.detail.tools')}</Label>
              <Input value={form.tools} onChange={(e) => setForm({ ...form, tools: e.target.value })} className="h-8 text-sm" placeholder="memory.search, knowledge.search, ..." />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">{t('agents.detail.capabilities')}</Label>
              <Input value={form.capabilities} onChange={(e) => setForm({ ...form, capabilities: e.target.value })} className="h-8 text-sm" placeholder={t('agents.detail.capabilitiesPlaceholder')} />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">{t('agents.detail.constraints')}</Label>
              <textarea
                value={form.constraints}
                onChange={(e) => setForm({ ...form, constraints: e.target.value })}
                className="w-full min-h-[60px] rounded-md border border-border/50 bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring resize-y"
                placeholder={t('agents.detail.constraintsPlaceholder')}
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">{t('agents.detail.monthlyTokenBudget')}</Label>
              <Input
                type="number"
                value={form.monthlyTokenBudget}
                onChange={(e) => setForm({ ...form, monthlyTokenBudget: Number(e.target.value) })}
                className="h-8 text-sm"
                placeholder={t('agents.detail.monthlyTokenBudgetPlaceholder')}
              />
            </div>

            <div className="flex justify-end pt-2">
              <Button size="sm" onClick={handleSave}>
                <Save className="h-3.5 w-3.5 mr-1" />
                {t('agents.detail.saveChanges')}
              </Button>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="memories">
          <AgentMemoriesPanel agentId={agentId} />
        </TabsContent>

        <TabsContent value="voice">
          {agent.tier !== 'specialist' && <AgentVoiceTab agentId={agentId} />}
        </TabsContent>

        <TabsContent value="workspace">
          {agent.tier !== 'specialist' && <AgentWorkspaceTab agentId={agentId} />}
        </TabsContent>

        <TabsContent value="channels">
          <AgentChannelsTab agentId={agentId} agentName={agent.name} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

interface MemoryItem {
  id?: string
  key?: string
  content: string
  sourceType?: string
  tags?: string[]
  salience?: number
  accessCount?: number
  createdAt?: string
  lastAccessedAt?: string
  updatedAt?: string
  expiresAt?: string
}

function AgentMemoriesPanel({ agentId }: { agentId: string }) {
  const [tier, setTier] = useState<'episodic' | 'working'>('episodic')
  const { data, isLoading } = useApi<{ memories: MemoryItem[]; tier: string; agentId: string }>(
    `/agents/${agentId}/memories?tier=${tier}&limit=50`
  )

  const memories = data?.memories ?? []

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <select
          value={tier}
          onChange={(e) => setTier(e.target.value as 'episodic' | 'working')}
          className="h-8 rounded-md border border-border/50 bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
        >
          <option value="episodic">{t('agents.detail.memoryTier.episodic')}</option>
          <option value="working">{t('agents.detail.memoryTier.working')}</option>
        </select>
        <span className="text-xs text-muted-foreground">
          {t('agents.detail.memoriesCount', { count: memories.length })}
        </span>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
          {t('agents.detail.memoriesLoading')}
        </div>
      ) : memories.length === 0 ? (
        <div className="glass-card p-8 text-center">
          <Brain className="h-8 w-8 text-muted-foreground/40 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">{t('agents.detail.memoriesEmpty')}</p>
          <p className="text-xs text-muted-foreground/60 mt-1">
            {t('agents.detail.memoriesEmptyHint')}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {memories.map((mem, idx) => (
            <div key={mem.id ?? mem.key ?? idx} className="glass-card p-3 space-y-2">
              <p className="text-sm whitespace-pre-wrap">{mem.content}</p>
              <div className="flex items-center gap-2 flex-wrap">
                {mem.sourceType && (
                  <Badge variant="outline" className="text-[10px]">{mem.sourceType}</Badge>
                )}
                {mem.tags?.map((tag) => (
                  <Badge key={tag} variant="secondary" className="text-[10px]">{tag}</Badge>
                ))}
                {mem.salience != null && (
                  <span className="text-[10px] text-muted-foreground">
                    {t('agents.detail.salience', { value: mem.salience.toFixed(2) })}
                  </span>
                )}
                {mem.accessCount != null && mem.accessCount > 0 && (
                  <span className="text-[10px] text-muted-foreground">
                    {t('agents.detail.accessed', { count: mem.accessCount })}
                  </span>
                )}
                {(mem.createdAt ?? mem.updatedAt) && (
                  <span className="text-[10px] text-muted-foreground ml-auto">
                    {new Date(mem.createdAt ?? mem.updatedAt!).toLocaleString()}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

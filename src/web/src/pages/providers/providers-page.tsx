import { useState, useCallback } from 'react'
import { useApi } from '@/hooks/use-api'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ProviderCard, type ProviderCardData } from './provider-card'
import { ProviderPanel } from './provider-panel'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { t } from './i18n'
import { ContextualHelp } from '@/components/docs/contextual-help'
import {
  Zap, MessageSquare, Wrench, Brain, Terminal, HeartPulse, Search, Wand2,
  Save, Loader2, ToggleLeft, ToggleRight, BarChart3,
} from 'lucide-react'

// ─── Types ────────────────────────────────────────

interface TierConfig {
  tier: string
  providerId: string
  modelId: string
  fallbackProviderId: string | null
  fallbackModelId: string | null
  description: string
  enabled: boolean
}

interface BudgetConfig {
  autoRoutingEnabled: boolean
  dailyLimit: number | null
  weeklyLimit: number | null
  monthlyLimit: number | null
  warnAt: number
  downgradeAt: number
  hardStopAt: number
}

interface ModelInfo { id: string; name: string; provider: string }

const PROVIDER_NAMES: Record<string, string> = {
  anthropic: 'Anthropic', openai: 'OpenAI', openrouter: 'OpenRouter',
  gemini: 'Gemini', 'claude-code': 'Claude Code', 'grok-cli': 'Grok CLI', ollama: 'Ollama', lmstudio: 'LM Studio',
}

const TIER_META: Record<string, { icon: typeof Zap; labelKey: string }> = {
  triage: { icon: Zap, labelKey: 'providers.page.tier.triage' },
  quick: { icon: MessageSquare, labelKey: 'providers.page.tier.quick' },
  standard: { icon: Wrench, labelKey: 'providers.page.tier.standard' },
  complex: { icon: Brain, labelKey: 'providers.page.tier.complex' },
  code: { icon: Terminal, labelKey: 'providers.page.tier.code' },
  heartbeat: { icon: HeartPulse, labelKey: 'providers.page.tier.heartbeat' },
  embedding: { icon: Search, labelKey: 'providers.page.tier.embedding' },
  prompt_enhancer: { icon: Wand2, labelKey: 'providers.page.tier.promptEnhancer' },
}

// ─── Tab: Routing Tiers ───────────────────────────

function RoutingTiersTab() {
  const { data: tiersData, refetch } = useApi<{ tiers: TierConfig[] }>('/routing/tiers')
  const { data: budgetData, refetch: refetchBudget } = useApi<BudgetConfig>('/routing/budget')
  const { data: providersData } = useApi<{ providers: ProviderCardData[] }>('/model/providers')
  const { data: modelsData } = useApi<{ models: ModelInfo[] }>('/model/models')
  const [saving, setSaving] = useState<string | null>(null)

  const tiers = tiersData?.tiers ?? []
  const autoRouting = budgetData?.autoRoutingEnabled ?? true
  const providers = (providersData?.providers ?? []).filter(p => p.active)
  const allModels = modelsData?.models ?? []

  // Group models by provider
  const modelsByProvider = new Map<string, ModelInfo[]>()
  for (const m of allModels) {
    const list = modelsByProvider.get(m.provider) ?? []
    list.push(m)
    modelsByProvider.set(m.provider, list)
  }

  const toggleAutoRouting = useCallback(async () => {
    await api.put('/routing/budget', { ...budgetData, autoRoutingEnabled: !autoRouting })
    refetchBudget()
  }, [autoRouting, budgetData, refetchBudget])

  const handleTierUpdate = useCallback(async (tier: string, field: string, value: string) => {
    const current = tiers.find(t => t.tier === tier)
    if (!current) return
    setSaving(tier)
    try {
      const updates: Record<string, string | null> = { [field]: value || null }
      // When provider changes, auto-select first available model for that provider
      if (field === 'providerId' && value) {
        const providerModels = modelsByProvider.get(value)
        if (providerModels?.length) {
          updates.modelId = providerModels[0].id
        }
      }
      if (field === 'fallbackProviderId' && value) {
        const providerModels = modelsByProvider.get(value)
        if (providerModels?.length) {
          updates.fallbackModelId = providerModels[0].id
        }
      }
      await api.put(`/routing/tiers/${tier}`, { ...current, ...updates })
      refetch()
    } finally {
      setSaving(null)
    }
  }, [tiers, modelsByProvider, refetch])

  return (
    <div className="space-y-4">
      {/* Auto-routing toggle */}
      <div className="glass-card p-4 flex items-center justify-between">
        <div>
          <span className="text-sm font-medium">{t('providers.page.autoRouting')}</span>
          <p className="text-xs text-muted-foreground">{t('providers.page.autoRoutingHint')}</p>
        </div>
        <Button variant="ghost" size="sm" onClick={toggleAutoRouting} className="gap-2">
          {autoRouting ? <ToggleRight className="h-5 w-5 text-emerald-500" /> : <ToggleLeft className="h-5 w-5 text-muted-foreground" />}
          {autoRouting ? t('providers.page.on') : t('providers.page.off')}
        </Button>
      </div>

      {/* Tier cards */}
      {tiers.map((tier) => {
        const meta = TIER_META[tier.tier]
        if (!meta) return null
        const Icon = meta.icon
        return (
          <div key={tier.tier} className={`glass-card p-4 ${!tier.enabled ? 'opacity-50' : ''}`}>
            <div className="flex items-center gap-2 mb-1">
              <Icon className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">{t(meta.labelKey)}</span>
              {saving === tier.tier && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
            </div>
            <p className="text-xs text-muted-foreground mb-3">{tier.description}</p>

            <div className="grid grid-cols-2 gap-3">
              {/* Primary */}
              <div className="space-y-1">
                <Label className="text-[10px] uppercase tracking-wider">{t('providers.page.primary')}</Label>
                <div className="flex gap-1.5">
                  <select
                    value={tier.providerId || ''}
                    onChange={(e) => handleTierUpdate(tier.tier, 'providerId', e.target.value)}
                    className="h-7 px-2 text-xs bg-accent/30 border border-border/50 rounded-md flex-1"
                  >
                    <option value="">{t('providers.page.selectProvider')}</option>
                    {providers.map(p => <option key={p.id} value={p.id}>{PROVIDER_NAMES[p.id] ?? p.id}</option>)}
                  </select>
                  <SearchableSelect
                    value={tier.modelId}
                    options={[
                      ...(modelsByProvider.get(tier.providerId) ?? []).map(m => ({ value: m.id, label: m.name || m.id })),
                      ...((modelsByProvider.get(tier.providerId) ?? []).find(m => m.id === tier.modelId) ? [] : tier.modelId ? [{ value: tier.modelId, label: tier.modelId }] : []),
                    ]}
                    onChange={(v) => handleTierUpdate(tier.tier, 'modelId', v)}
                    placeholder={t('providers.page.selectModel')}
                    className="flex-1"
                  />
                </div>
              </div>

              {/* Fallback */}
              <div className="space-y-1">
                <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">{t('providers.page.fallback')}</Label>
                <div className="flex gap-1.5">
                  <select
                    value={tier.fallbackProviderId ?? ''}
                    onChange={(e) => handleTierUpdate(tier.tier, 'fallbackProviderId', e.target.value)}
                    className="h-7 px-2 text-xs bg-accent/20 border border-border/30 rounded-md flex-1 text-muted-foreground"
                  >
                    <option value="">{t('providers.page.none')}</option>
                    {providers.map(p => <option key={p.id} value={p.id}>{PROVIDER_NAMES[p.id] ?? p.id}</option>)}
                  </select>
                  <SearchableSelect
                    value={tier.fallbackModelId ?? ''}
                    options={[
                      { value: '', label: t('providers.page.none') },
                      ...(tier.fallbackProviderId ? (modelsByProvider.get(tier.fallbackProviderId) ?? []).map(m => ({ value: m.id, label: m.name || m.id })) : []),
                      ...(tier.fallbackModelId && tier.fallbackProviderId && !(modelsByProvider.get(tier.fallbackProviderId) ?? []).find(m => m.id === tier.fallbackModelId) ? [{ value: tier.fallbackModelId, label: tier.fallbackModelId }] : []),
                    ]}
                    onChange={(v) => handleTierUpdate(tier.tier, 'fallbackModelId', v)}
                    placeholder={t('providers.page.selectFallback')}
                    className="flex-1"
                  />
                </div>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── Tab: Providers ───────────────────────────────

function ProvidersTab() {
  const { data, isLoading, error, refetch } = useApi<{ providers: ProviderCardData[] }>('/model/providers')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const providers = data?.providers ?? []

  const handleToggle = useCallback(async (id: string, enabled: boolean) => {
    await api.patch(`/model/providers/${id}`, { enabled })
    refetch()
  }, [refetch])

  return (
    <div>
      <div className="grid grid-cols-2 gap-3">
        {providers.map(provider => (
          <ProviderCard
            key={provider.id}
            provider={provider}
            onToggle={handleToggle}
            onClick={(id) => setSelectedId(prev => prev === id ? null : id)}
          />
        ))}
      </div>

      {isLoading && providers.length === 0 && (
        <p className="text-sm text-muted-foreground mt-4">{t('providers.page.loadingProviders')}</p>
      )}
      {error && <p className="text-sm text-destructive mt-4">{t('providers.page.loadFailed', { message: error.message })}</p>}

      <ProviderPanel
        providerId={selectedId}
        onClose={() => { setSelectedId(null); refetch() }}
        onRefresh={refetch}
      />
    </div>
  )
}

// ─── Tab: Budget ──────────────────────────────────

function BudgetTab() {
  const { data, refetch } = useApi<BudgetConfig>('/routing/budget')
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState<Partial<BudgetConfig>>({})

  const budget = data ? { ...data, ...form } : null

  const handleSave = useCallback(async () => {
    if (!budget) return
    setSaving(true)
    try {
      await api.put('/routing/budget', budget)
      refetch()
      setForm({})
    } finally {
      setSaving(false)
    }
  }, [budget, refetch])

  if (!budget) return null

  return (
    <div className="space-y-4 max-w-lg">
      <div className="glass-card p-5">
        <h2 className="text-sm font-medium mb-3">{t('providers.page.spendingLimits')}</h2>
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <Label className="text-xs w-16">{t('providers.page.daily')}</Label>
            <div className="flex items-center gap-1 flex-1">
              <span className="text-xs text-muted-foreground">$</span>
              <Input
                type="number"
                step="0.01"
                placeholder={t('providers.page.unlimited')}
                value={budget.dailyLimit ?? ''}
                onChange={(e) => setForm({ ...form, dailyLimit: e.target.value ? Number(e.target.value) : null })}
                className="h-7 text-xs"
              />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Label className="text-xs w-16">{t('providers.page.weekly')}</Label>
            <div className="flex items-center gap-1 flex-1">
              <span className="text-xs text-muted-foreground">$</span>
              <Input
                type="number"
                step="0.01"
                placeholder={t('providers.page.unlimited')}
                value={budget.weeklyLimit ?? ''}
                onChange={(e) => setForm({ ...form, weeklyLimit: e.target.value ? Number(e.target.value) : null })}
                className="h-7 text-xs"
              />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Label className="text-xs w-16">{t('providers.page.monthly')}</Label>
            <div className="flex items-center gap-1 flex-1">
              <span className="text-xs text-muted-foreground">$</span>
              <Input
                type="number"
                step="0.01"
                placeholder={t('providers.page.unlimited')}
                value={budget.monthlyLimit ?? ''}
                onChange={(e) => setForm({ ...form, monthlyLimit: e.target.value ? Number(e.target.value) : null })}
                className="h-7 text-xs"
              />
            </div>
          </div>
        </div>
      </div>

      <div className="glass-card p-5">
        <h2 className="text-sm font-medium mb-3">{t('providers.page.thresholds')}</h2>
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <Label className="text-xs w-28">{t('providers.page.warnAt')}</Label>
            <Input
              type="number"
              step="0.05"
              value={budget.warnAt}
              onChange={(e) => setForm({ ...form, warnAt: Number(e.target.value) })}
              className="h-7 text-xs w-20"
            />
            <span className="text-xs text-muted-foreground">{Math.round((budget.warnAt ?? 0.8) * 100)}%</span>
          </div>
          <div className="flex items-center gap-3">
            <Label className="text-xs w-28">{t('providers.page.downgradeAt')}</Label>
            <Input
              type="number"
              step="0.05"
              value={budget.downgradeAt}
              onChange={(e) => setForm({ ...form, downgradeAt: Number(e.target.value) })}
              className="h-7 text-xs w-20"
            />
            <span className="text-xs text-muted-foreground">{Math.round((budget.downgradeAt ?? 1.0) * 100)}%</span>
          </div>
          <div className="flex items-center gap-3">
            <Label className="text-xs w-28">{t('providers.page.hardStopAt')}</Label>
            <Input
              type="number"
              step="0.05"
              value={budget.hardStopAt}
              onChange={(e) => setForm({ ...form, hardStopAt: Number(e.target.value) })}
              className="h-7 text-xs w-20"
            />
            <span className="text-xs text-muted-foreground">{Math.round((budget.hardStopAt ?? 1.2) * 100)}%</span>
          </div>
        </div>
      </div>

      {Object.keys(form).length > 0 && (
        <Button size="sm" onClick={handleSave} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
          {t('common.save')}
        </Button>
      )}
    </div>
  )
}

// ─── Tab: AI Analysis ─────────────────────────────

function AIAnalysisTab() {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">
            {t('providers.page.analysisSource')} <a href="https://artificialanalysis.ai" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">Artificial Analysis</a> {t('providers.page.analysisBenchmarks')}
          </span>
        </div>
        <a href="https://artificialanalysis.ai" target="_blank" rel="noopener noreferrer" className="text-xs text-muted-foreground hover:text-foreground">
          {t('providers.page.openInNewTab')}
        </a>
      </div>
      <div className="glass-card overflow-hidden rounded-lg" style={{ height: 'calc(100vh - 220px)' }}>
        <iframe
          src="https://artificialanalysis.ai"
          className="w-full h-full border-0"
          title={t('providers.page.analysisIframeTitle')}
          loading="lazy"
          sandbox="allow-scripts allow-same-origin allow-popups"
        />
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────

export default function ProvidersPage() {
  const [tab, setTab] = useState<'routing' | 'providers' | 'budget' | 'analysis'>('providers')

  return (
    <div>
      <div className="flex items-baseline justify-between mb-5">
        <div>
          <h1 className="page-title inline-flex items-center gap-1.5">{t('providers.page.title')} <ContextualHelp helpId="ai.providers" /></h1>
          <p className="text-sm text-muted-foreground">{t('providers.page.subtitle')}</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-5">
        {[
          { id: 'routing' as const, labelKey: 'providers.page.tab.routing' },
          { id: 'providers' as const, labelKey: 'providers.page.tab.providers' },
          { id: 'budget' as const, labelKey: 'providers.page.tab.budget' },
          { id: 'analysis' as const, labelKey: 'providers.page.tab.analysis' },
        ].map((tabItem) => (
          <Button
            key={tabItem.id}
            variant={tab === tabItem.id ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setTab(tabItem.id)}
            className="text-xs"
          >
            {t(tabItem.labelKey)}
          </Button>
        ))}
      </div>

      {tab === 'routing' && <RoutingTiersTab />}
      {tab === 'providers' && <ProvidersTab />}
      {tab === 'budget' && <BudgetTab />}
      {tab === 'analysis' && <AIAnalysisTab />}
    </div>
  )
}

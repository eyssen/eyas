// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { useState, useCallback } from 'react'
import { useApi } from '@/hooks/use-api'
import { api } from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Sparkles, Plus, Search, ChevronDown, ChevronUp } from 'lucide-react'
import { t } from './i18n'
import { t as tc } from '@/i18n'
import { ContextualHelp } from '@/components/docs/contextual-help'
import InventoryView from './inventory-view'

interface SkillItem {
  id: string
  name: string
  description: string
  category?: string
  source: 'bundled' | 'user' | 'generated'
  enabled: boolean
  triggerPatterns: string[]
  content: string
}

type CategoryFilter = 'all' | 'own' | 'bundled'

const sourceBadge: Record<SkillItem['source'], { labelKey: string; cls: string }> = {
  bundled: { labelKey: 'skills.source.bundled', cls: 'text-blue-500 border-blue-500/30' },
  user: { labelKey: 'skills.source.user', cls: 'text-emerald-500 border-emerald-500/30' },
  generated: { labelKey: 'skills.source.generated', cls: 'text-amber-500 border-amber-500/30' },
}

function isOwnSkill(s: SkillItem): boolean {
  if (s.category === 'own') return true
  // User-created / generated without category also count as own
  return s.source === 'user' || s.source === 'generated'
}

export default function SkillsPage() {
  const { data, isLoading, error, refetch } = useApi<{ skills: SkillItem[] }>('/skills')
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState({ name: '', description: '', triggerPatterns: '', content: '' })

  const allSkills = data?.skills ?? []
  const ownCount = allSkills.filter(isOwnSkill).length
  const bundledCount = allSkills.filter((s) => s.source === 'bundled').length

  const skills = allSkills.filter((s) => {
    if (categoryFilter === 'own' && !isOwnSkill(s)) return false
    if (categoryFilter === 'bundled' && s.source !== 'bundled') return false
    if (!search) return true
    const q = search.toLowerCase()
    return (
      s.name.toLowerCase().includes(q) ||
      s.triggerPatterns.some((p) => p.toLowerCase().includes(q)) ||
      (s.category?.toLowerCase().includes(q) ?? false)
    )
  })

  const handleToggle = useCallback(
    async (id: string) => {
      await api.post(`/skills/${id}/toggle`)
      refetch()
    },
    [refetch],
  )

  const handleCreate = useCallback(async () => {
    await api.post('/skills', {
      name: form.name,
      description: form.description,
      category: 'own',
      triggerPatterns: form.triggerPatterns
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean),
      content: form.content,
    })
    setForm({ name: '', description: '', triggerPatterns: '', content: '' })
    setCreating(false)
    setCategoryFilter('own')
    refetch()
  }, [form, refetch])

  const enabledCount = (data?.skills ?? []).filter((s) => s.enabled).length
  const totalCount = data?.skills?.length ?? 0

  return (
    <div>
      <div className="flex items-baseline justify-between mb-5">
        <div>
          <h1 className="page-title inline-flex items-center gap-1.5">{t('skills.title')} <ContextualHelp helpId="automation.skills" /></h1>
          <p className="text-sm text-muted-foreground">
            {t('skills.subtitle')}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {totalCount > 0 && (
            <span className="text-xs text-muted-foreground">
              <strong className="text-foreground">
                {enabledCount}/{totalCount}
              </strong>{' '}
              {t('skills.enabledLabel')}
            </span>
          )}
          <Button size="sm" onClick={() => setCreating(!creating)}>
            <Plus className="h-3.5 w-3.5 mr-1" />
            {t('skills.createSkill')}
          </Button>
        </div>
      </div>

      <Tabs defaultValue="browse">
        <TabsList className="mb-4">
          <TabsTrigger value="browse">{t('skills.tab.browse')}</TabsTrigger>
          <TabsTrigger value="inventory">{t('skills.tab.inventory')}</TabsTrigger>
        </TabsList>

        <TabsContent value="browse">

      {/* Create form */}
      {creating && (
        <div className="glass-card p-4 mb-4 flex flex-col gap-3">
          <input
            className="bg-transparent border border-border-primary rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            placeholder={t('skills.form.namePlaceholder')}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <input
            className="bg-transparent border border-border-primary rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            placeholder={tc('common.description')}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
          <input
            className="bg-transparent border border-border-primary rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            placeholder={t('skills.form.triggerPlaceholder')}
            value={form.triggerPatterns}
            onChange={(e) => setForm({ ...form, triggerPatterns: e.target.value })}
          />
          <textarea
            className="bg-transparent border border-border-primary rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring min-h-[120px] resize-y"
            placeholder={t('skills.form.contentPlaceholder')}
            value={form.content}
            onChange={(e) => setForm({ ...form, content: e.target.value })}
          />
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" size="sm" onClick={() => setCreating(false)}>
              {tc('common.cancel')}
            </Button>
            <Button size="sm" onClick={handleCreate} disabled={!form.name}>
              {tc('common.save')}
            </Button>
          </div>
        </div>
      )}

      {/* Category filter */}
      <div className="flex flex-wrap gap-1 mb-3">
        {(
          [
            ['all', t('skills.filter.all'), allSkills.length],
            ['own', t('skills.filter.own'), ownCount],
            ['bundled', t('skills.filter.bundled'), bundledCount],
          ] as const
        ).map(([key, label, count]) => (
          <Button
            key={key}
            size="sm"
            variant={categoryFilter === key ? 'secondary' : 'ghost'}
            onClick={() => setCategoryFilter(key)}
          >
            {label}
            <span className="ml-1.5 text-[10px] text-muted-foreground">{count}</span>
          </Button>
        ))}
      </div>

      {/* Search */}
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <input
          className="w-full bg-transparent border border-border-primary rounded-md pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          placeholder={t('skills.searchPlaceholder')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* Skills grid */}
      <div className="grid grid-cols-2 gap-3">
        {skills.map((skill) => {
          const expanded = expandedId === skill.id
          const badge = sourceBadge[skill.source]
          return (
            <div key={skill.id} className="glass-card p-4 flex flex-col gap-2">
              <div className="flex items-start gap-3">
                <div className="h-9 w-9 rounded-xl bg-amber-500/20 flex items-center justify-center flex-shrink-0">
                  <Sparkles className="h-4.5 w-4.5 text-amber-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm truncate">{skill.name}</span>
                    <Badge variant="outline" className={`text-[10px] ${badge.cls}`}>
                      {t(badge.labelKey)}
                    </Badge>
                    {isOwnSkill(skill) && (
                      <Badge variant="secondary" className="text-[10px]">
                        {t('skills.category.own')}
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                    {skill.description}
                  </p>
                </div>
                <div className="flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                  <Switch
                    checked={skill.enabled}
                    onCheckedChange={() => handleToggle(skill.id)}
                  />
                </div>
              </div>

              {/* Trigger patterns */}
              {skill.triggerPatterns.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {skill.triggerPatterns.map((p) => (
                    <Badge key={p} variant="secondary" className="text-[10px]">
                      {p}
                    </Badge>
                  ))}
                </div>
              )}

              {/* Expand toggle */}
              <button
                type="button"
                className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground mt-1 self-start"
                onClick={() => setExpandedId(expanded ? null : skill.id)}
              >
                {expanded ? (
                  <ChevronUp className="h-3 w-3" />
                ) : (
                  <ChevronDown className="h-3 w-3" />
                )}
                {expanded ? t('skills.hideContent') : t('skills.showContent')}
              </button>

              {expanded && (
                <pre className="text-[11px] text-muted-foreground bg-accent/30 rounded-md p-3 mt-1 overflow-x-auto whitespace-pre-wrap max-h-[300px] overflow-y-auto">
                  {skill.content}
                </pre>
              )}
            </div>
          )
        })}
      </div>

      {isLoading && skills.length === 0 && (
        <p className="text-sm text-muted-foreground mt-4">{t('skills.loading')}</p>
      )}
      {error && (
        <p className="text-sm text-destructive mt-4">{t('skills.loadError', { error: error.message })}</p>
      )}
      {!isLoading && !error && skills.length === 0 && (
        <p className="text-sm text-muted-foreground mt-4 text-center">
          {t('skills.emptyTitle')}
        </p>
      )}

        </TabsContent>

        <TabsContent value="inventory">
          <InventoryView />
        </TabsContent>
      </Tabs>
    </div>
  )
}

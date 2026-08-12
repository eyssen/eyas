// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { useState } from 'react'
import { useApi } from '@/hooks/use-api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Wrench,
  Search,
  ChevronDown,
  ChevronUp,
  ShieldAlert,
  AlertTriangle,
} from 'lucide-react'
import { t } from './i18n'
import { ContextualHelp } from '@/components/docs/contextual-help'

interface ToolItem {
  name: string
  description: string
  category: string
  riskTier: string
  inputSchema: Record<string, unknown> | null
  requiresApproval: boolean
}

const riskColors: Record<string, string> = {
  low: 'text-emerald-500 border-emerald-500/30 bg-emerald-500/10',
  medium: 'text-amber-500 border-amber-500/30 bg-amber-500/10',
  high: 'text-red-500 border-red-500/30 bg-red-500/10',
  critical: 'text-red-600 border-red-600/30 bg-red-600/10',
}

const categoryColors: Record<string, string> = {
  system: 'text-blue-500 border-blue-500/30',
  file: 'text-cyan-500 border-cyan-500/30',
  network: 'text-purple-500 border-purple-500/30',
  compute: 'text-orange-500 border-orange-500/30',
  data: 'text-emerald-500 border-emerald-500/30',
}

export default function ToolsPage() {
  const { data, isLoading, error } = useApi<{ tools: ToolItem[] }>('/tools')
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<string>('all')
  const [riskFilter, setRiskFilter] = useState<string>('all')
  const [expandedTool, setExpandedTool] = useState<string | null>(null)

  const tools = (data?.tools ?? []).filter((t) => {
    if (categoryFilter !== 'all' && t.category !== categoryFilter) return false
    if (riskFilter !== 'all' && t.riskTier !== riskFilter) return false
    if (!search) return true
    const q = search.toLowerCase()
    return t.name.toLowerCase().includes(q) || t.description.toLowerCase().includes(q)
  })

  const categories = [...new Set((data?.tools ?? []).map((t) => t.category))].sort()
  const riskTiers = [...new Set((data?.tools ?? []).map((t) => t.riskTier))].sort()
  const totalCount = data?.tools?.length ?? 0
  const approvalCount = (data?.tools ?? []).filter((t) => t.requiresApproval).length

  return (
    <div>
      <div className="flex items-baseline justify-between mb-5">
        <div>
          <h1 className="page-title inline-flex items-center gap-1.5">{t('tools.title')} <ContextualHelp helpId="automation.tools" /></h1>
          <p className="text-sm text-muted-foreground">
            {t('tools.subtitle')}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {totalCount > 0 && (
            <span className="text-xs text-muted-foreground">
              <strong className="text-foreground">{totalCount}</strong> {t('tools.countLabel')}
              {approvalCount > 0 && (
                <span className="ml-2">
                  <strong className="text-amber-500">{approvalCount}</strong> {t('tools.requireApproval')}
                </span>
              )}
            </span>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            className="w-full bg-transparent border border-border-primary rounded-md pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            placeholder={t('tools.searchPlaceholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select
          className="bg-transparent border border-border-primary rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
        >
          <option value="all">{t('tools.allCategories')}</option>
          {categories.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <select
          className="bg-transparent border border-border-primary rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          value={riskFilter}
          onChange={(e) => setRiskFilter(e.target.value)}
        >
          <option value="all">{t('tools.allRiskTiers')}</option>
          {riskTiers.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
      </div>

      {/* Tools grid */}
      <div className="grid grid-cols-2 gap-3">
        {tools.map((tool) => {
          const expanded = expandedTool === tool.name
          return (
            <div key={tool.name} className="glass-card p-4 flex flex-col gap-2">
              <div className="flex items-start gap-3">
                <div className="h-9 w-9 rounded-xl bg-blue-500/20 flex items-center justify-center flex-shrink-0">
                  <Wrench className="h-4.5 w-4.5 text-blue-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm font-mono">{tool.name}</span>
                    {tool.requiresApproval && (
                      <span title={t('tools.requiresApproval')}>
                        <ShieldAlert className="h-3.5 w-3.5 text-amber-500" />
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                    {tool.description}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 ml-12">
                <Badge variant="outline" className={`text-[10px] ${categoryColors[tool.category] ?? ''}`}>
                  {tool.category}
                </Badge>
                <Badge variant="outline" className={`text-[10px] ${riskColors[tool.riskTier] ?? ''}`}>
                  {tool.riskTier} {t('tools.riskSuffix')}
                </Badge>
                {tool.requiresApproval && (
                  <Badge variant="outline" className="text-[10px] text-amber-500 border-amber-500/30">
                    {t('tools.approvalRequired')}
                  </Badge>
                )}
              </div>

              {/* Schema expand */}
              {tool.inputSchema && (
                <>
                  <button
                    type="button"
                    className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground mt-1 ml-12"
                    onClick={() => setExpandedTool(expanded ? null : tool.name)}
                  >
                    {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                    {expanded ? t('tools.hideSchema') : t('tools.showSchema')}
                  </button>

                  {expanded && (
                    <pre className="text-[11px] text-muted-foreground bg-accent/30 rounded-md p-3 ml-12 overflow-x-auto whitespace-pre-wrap max-h-[300px] overflow-y-auto">
                      {JSON.stringify(tool.inputSchema, null, 2)}
                    </pre>
                  )}
                </>
              )}
            </div>
          )
        })}
      </div>

      {isLoading && tools.length === 0 && (
        <p className="text-sm text-muted-foreground mt-4">{t('tools.loading')}</p>
      )}
      {error && (
        <p className="text-sm text-destructive mt-4">{t('tools.loadError', { error: error.message })}</p>
      )}
      {!isLoading && !error && tools.length === 0 && (
        <div className="glass-card p-8 text-center">
          <Wrench className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">
            {t('tools.empty')}
          </p>
        </div>
      )}
    </div>
  )
}

// Part of eYssen. See LICENSE file for full copyright and licensing details.
// Skills resolution table (Task 25): one row per skill id, showing which
// source actually won (provenance), what it shadowed, and its usage. Sorting
// by last-used ascending IS the dead-skill report — the detector's own
// proposals (GET /skills/dead-candidates) are cross-referenced and marked so
// the PATCH /skills/:id/enabled action is one click away.

import { useCallback, useMemo, useState } from 'react'
import { useApi } from '@/hooks/use-api'
import { api } from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react'
import { t } from './i18n'
import { sortSkillRows, type SortDir, type SortKey } from './inventory-sort'

interface ShadowedSource {
  path: string
  root: string
}

interface InventoryRow {
  id: string
  name: string
  category?: string
  source: string
  sourcePath?: string
  sourceRoot?: string
  enabled: boolean
  disabledReason?: string
  useCount: number
  lastUsedAt?: string
  createdAt: string
  shadowedSources: ShadowedSource[]
  isOrphan: boolean
  situational: boolean
}

type SkillLifecycleCategory = 'healthy' | 'new' | 'shadowed' | 'orphan' | 'never-used' | 'dormant'

// The backend spreads ClassifyResult over InventoryRow (`{ ...row, ...classifySkill(...) }`),
// so on the wire `category` is the detector's lifecycle classification, NOT
// InventoryRow's subject-matter category — they are different fields with
// the same name at different points in the pipeline.
interface DeadCandidateRow extends Omit<InventoryRow, 'category'> {
  category: SkillLifecycleCategory
  reason: string
  proposeDisable: boolean
}

const sourceBadge: Record<string, { labelKey: string; cls: string }> = {
  bundled: { labelKey: 'skills.source.bundled', cls: 'text-blue-500 border-blue-500/30' },
  user: { labelKey: 'skills.source.user', cls: 'text-emerald-500 border-emerald-500/30' },
  generated: { labelKey: 'skills.source.generated', cls: 'text-amber-500 border-amber-500/30' },
}

function formatDate(ts?: string): string {
  if (!ts) return t('skills.inventory.neverUsed')
  try {
    const d = new Date(ts.includes('Z') ? ts : `${ts}Z`)
    return d.toLocaleString()
  } catch {
    return ts
  }
}

export default function InventoryView() {
  const { data: inventoryData, isLoading, refetch: refetchInventory } = useApi<{ items: InventoryRow[] }>(
    '/skills/inventory',
  )
  const { data: deadData, refetch: refetchDead } = useApi<{ items: DeadCandidateRow[] }>('/skills/dead-candidates')

  const [sortKey, setSortKey] = useState<SortKey>('lastUsedAt')
  const [sortDir, setSortDir] = useState<SortDir>('asc')

  const deadById = useMemo(() => {
    const m = new Map<string, DeadCandidateRow>()
    for (const d of deadData?.items ?? []) m.set(d.id, d)
    return m
  }, [deadData])

  const rows = inventoryData?.items ?? []

  const sortedRows = useMemo(() => sortSkillRows(rows, sortKey, sortDir), [rows, sortKey, sortDir])

  const handleSort = useCallback((key: SortKey) => {
    setSortKey((prevKey) => {
      setSortDir((prevDir) => (prevKey === key ? (prevDir === 'asc' ? 'desc' : 'asc') : 'asc'))
      return key
    })
  }, [])

  const handleSetEnabled = useCallback(
    async (id: string, enabled: boolean, reason?: string) => {
      await api.patch(`/skills/${id}/enabled`, { enabled, reason })
      refetchInventory()
      refetchDead()
    },
    [refetchInventory, refetchDead],
  )

  const sortIcon = (key: SortKey) => {
    if (sortKey !== key) return <ArrowUpDown className="h-3 w-3 opacity-40" />
    return sortDir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
  }

  const headerButton = (key: SortKey, labelKey: string) => (
    <button
      type="button"
      className="inline-flex items-center gap-1 hover:text-foreground"
      onClick={() => handleSort(key)}
    >
      {t(labelKey)}
      {sortIcon(key)}
    </button>
  )

  return (
    <TooltipProvider delayDuration={150}>
      <div className="rounded-xl border bg-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/30">
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">{headerButton('name', 'skills.inventory.col.name')}</th>
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">{headerButton('category', 'skills.inventory.col.category')}</th>
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">{headerButton('source', 'skills.inventory.col.source')}</th>
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">{t('skills.inventory.col.winningPath')}</th>
                <th className="text-center px-4 py-2.5 font-medium text-muted-foreground">{t('skills.inventory.col.shadowed')}</th>
                <th className="text-center px-4 py-2.5 font-medium text-muted-foreground">{t('skills.inventory.col.enabled')}</th>
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">{t('skills.inventory.col.disabledReason')}</th>
                <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">{headerButton('useCount', 'skills.inventory.col.useCount')}</th>
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">{headerButton('lastUsedAt', 'skills.inventory.col.lastUsed')}</th>
                <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">{t('skills.inventory.col.action')}</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr>
                  <td colSpan={10} className="px-4 py-8 text-center text-muted-foreground">{t('skills.inventory.loading')}</td>
                </tr>
              )}
              {!isLoading && sortedRows.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-4 py-8 text-center text-muted-foreground">{t('skills.inventory.empty')}</td>
                </tr>
              )}
              {sortedRows.map((row) => {
                const dead = deadById.get(row.id)
                const badge = sourceBadge[row.source]
                return (
                  <tr
                    key={row.id}
                    className={`border-b last:border-0 ${dead ? 'bg-amber-500/5' : ''}`}
                  >
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-medium">{row.name}</span>
                        {dead && (
                          <Badge className="text-[10px] bg-amber-500/15 text-amber-700 dark:text-amber-400">
                            {t(`skills.inventory.classification.${dead.category}`)}
                          </Badge>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">{row.category ?? '—'}</td>
                    <td className="px-4 py-2.5">
                      {badge ? (
                        <Badge variant="outline" className={`text-[10px] ${badge.cls}`}>{t(badge.labelKey)}</Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">{row.source}</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 max-w-[18rem]">
                      <span className="font-mono text-[11px] text-muted-foreground truncate block" title={row.sourcePath}>
                        {row.sourcePath ?? '—'}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      {row.shadowedSources.length > 0 ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Badge variant="secondary" className="text-[10px] cursor-help">
                              {row.shadowedSources.length}
                            </Badge>
                          </TooltipTrigger>
                          <TooltipContent side="top">
                            <div className="flex flex-col gap-0.5 max-w-[24rem]">
                              {row.shadowedSources.map((s, i) => (
                                <span key={i} className="font-mono text-[11px]">{s.root}/{s.path}</span>
                              ))}
                            </div>
                          </TooltipContent>
                        </Tooltip>
                      ) : (
                        <span className="text-xs text-muted-foreground/40">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <Switch
                        checked={row.enabled}
                        onCheckedChange={(v) => handleSetEnabled(row.id, v)}
                      />
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">{row.disabledReason ?? '—'}</td>
                    <td className="px-4 py-2.5 text-right text-xs">{row.useCount.toLocaleString()}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap text-xs text-muted-foreground">{formatDate(row.lastUsedAt)}</td>
                    <td className="px-4 py-2.5 text-right">
                      {dead && dead.enabled && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 text-[10px] px-2"
                          onClick={() => handleSetEnabled(row.id, false, dead.reason)}
                        >
                          {t('skills.inventory.disableAction')}
                        </Button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </TooltipProvider>
  )
}

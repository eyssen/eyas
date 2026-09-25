// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Routing tab: "Background model calls". Where each group of background
// calls (memory passes, titles, learning loops, safety judges, planning,
// research, triage) goes right now, or that it runs its deterministic
// fallback with no model call — and why.

import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { ContextualHelp } from '@/components/docs/contextual-help'
import { AlertTriangle, Cpu } from 'lucide-react'
import { t, tOr } from './i18n'

// ─── Response (mirrors AuxiliaryStatusResponse in src/modules/model/auxiliary.ts) ───

export type AuxPurposeGroup = 'memory' | 'learning' | 'title' | 'safety' | 'planning' | 'research' | 'triage'
export type AuxRoute = 'tier' | 'default' | 'api' | 'isolated-cli'
export type AuxNoneReason = 'no_eligible_provider' | 'tier_not_configured' | 'budget_stop'

export interface AuxGroupStatus {
  group: AuxPurposeGroup
  purposes: string[]
  target: { provider: string; model: string | null; route: AuxRoute } | null
  reason: AuxNoneReason | null
}

export interface AuxiliaryStatusResponse {
  groups: AuxGroupStatus[]
}

const ROUTE_KEYS: Record<AuxRoute, string> = {
  tier: 'providers.aux.route.tier',
  default: 'providers.aux.route.default',
  api: 'providers.aux.route.api',
  'isolated-cli': 'providers.aux.route.isolatedCli',
}

const REASON_KEYS: Record<AuxNoneReason, string> = {
  no_eligible_provider: 'providers.aux.reason.noEligibleProvider',
  tier_not_configured: 'providers.aux.reason.tierNotConfigured',
  budget_stop: 'providers.aux.reason.budgetStop',
}

/** Unknown values from a newer server still render, as their raw id. */
function label(keys: Record<string, string>, value: string): string {
  const key = keys[value]
  return key ? t(key) : value
}

export interface BackgroundCallsCardProps {
  /**
   * The card refetches whenever this changes (e.g. the tier list after a tier
   * update). null means the owner is reloading: wait for its next value.
   * Omitted: fetch once, on mount.
   */
  refreshKey?: unknown
  /** Display names for provider ids; an unknown id shows as itself. */
  providers?: ReadonlyArray<{ id: string; name: string }>
  /** Display names for model ids; an unknown id shows as itself. */
  models?: ReadonlyArray<{ id: string; name: string; provider: string }>
}

export function BackgroundCallsCard({ refreshKey, providers, models }: BackgroundCallsCardProps) {
  const [status, setStatus] = useState<AuxiliaryStatusResponse | null>(null)

  useEffect(() => {
    if (refreshKey === null) return
    let cancelled = false
    // The previous status stays on screen while a refetch is in flight.
    api
      .get<AuxiliaryStatusResponse>('/routing/auxiliary')
      .then((body) => { if (!cancelled) setStatus(body) })
      .catch(() => { if (!cancelled) setStatus(null) })
    return () => { cancelled = true }
  }, [refreshKey])

  const groups = status && Array.isArray(status.groups) ? status.groups : []
  if (groups.length === 0) return null

  const providerName = (id: string) => providers?.find((p) => p.id === id)?.name || id
  const modelName = (provider: string, id: string) =>
    models?.find((m) => m.provider === provider && m.id === id)?.name || id
  const degraded = groups.some((g) => g.reason === 'no_eligible_provider')

  return (
    <div className="glass-card p-4 space-y-3" data-testid="background-calls-card">
      <div>
        <div className="flex items-center gap-2">
          <Cpu className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">{t('providers.aux.title')}</span>
          <ContextualHelp helpId="ai.routing" iconClassName="h-3.5 w-3.5" />
        </div>
        <p className="text-xs text-muted-foreground">{t('providers.aux.hint')}</p>
      </div>

      {degraded && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
        >
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{t('providers.aux.degradedBanner')}</span>
        </div>
      )}

      <ul className="divide-y divide-border/40">
        {groups.map((g) => (
          <li key={g.group} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-1.5 text-xs">
            <span className="font-medium">{tOr(`providers.aux.group.${g.group}`, g.group)}</span>
            {g.target ? (
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="truncate">
                  {providerName(g.target.provider)}
                  {g.target.model ? ` · ${modelName(g.target.provider, g.target.model)}` : ''}
                </span>
                <Badge variant="outline" className="text-[10px] text-muted-foreground">
                  {label(ROUTE_KEYS, g.target.route)}
                </Badge>
              </span>
            ) : (
              <span className="flex min-w-0 flex-col items-end text-right">
                <span className="text-muted-foreground">{t('providers.aux.none')}</span>
                {g.reason && (
                  <span className={g.reason === 'no_eligible_provider' ? 'text-destructive' : 'text-muted-foreground'}>
                    {label(REASON_KEYS, g.reason)}
                  </span>
                )}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

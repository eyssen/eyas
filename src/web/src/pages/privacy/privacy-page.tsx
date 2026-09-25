// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Privacy (/privacy): what the privacy layer did to real traffic since the
// server started, the policy editor, and the scan tester.

import { useCallback, useEffect, useState } from 'react'
import { BarChart3, MessageSquareOff, MessageSquareLock, RefreshCw, Send, ShieldCheck } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useApi } from '@/hooks/use-api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ContextualHelp } from '@/components/docs/contextual-help'
import { t, typeLabel } from './i18n'
import { parsePolicyResponse, parseStats, sortedCounts, type PolicyResponse } from './policy-form'
import { PolicyEditor } from './policy-editor'
import { ScanTester } from './scan-tester'

function StatCard({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: number }) {
  return (
    <div className="glass-card p-4 text-center">
      <div className="flex items-center justify-center gap-1.5 text-muted-foreground mb-1">
        <Icon className="h-3.5 w-3.5" />
        <span className="text-[10px] uppercase tracking-wider font-medium">{label}</span>
      </div>
      <div className="text-2xl font-bold">{value}</div>
    </div>
  )
}

function StatsSection() {
  const { data, isLoading, refetch } = useApi<unknown>('/privacy/stats')
  if (isLoading && !data) return <p className="text-sm text-muted-foreground mb-5">{t('privacy.loading')}</p>
  if (!data) return null
  const stats = parseStats(data)
  const byType = sortedCounts(stats.egress.byType)
  const byScanner = sortedCounts(stats.byScanner)

  return (
    <div className="mb-5">
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="text-xs text-muted-foreground">
          {stats.since ? t('privacy.stat.since', { time: new Date(stats.since).toLocaleString() }) : ''}
        </span>
        <Button size="icon-xs" variant="ghost" aria-label={t('privacy.stat.refresh')} title={t('privacy.stat.refresh')} onClick={refetch}>
          <RefreshCw className="h-3 w-3" />
        </Button>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard icon={Send} label={t('privacy.stat.calls')} value={stats.egress.calls} />
        <StatCard icon={ShieldCheck} label={t('privacy.stat.egressMasked')} value={stats.egress.maskedCalls} />
        <StatCard icon={MessageSquareOff} label={t('privacy.stat.inboundRefused')} value={stats.inbound.refused} />
        <StatCard icon={MessageSquareLock} label={t('privacy.stat.inboundMasked')} value={stats.inbound.masked} />
      </div>

      {byType.length > 0 && (
        <div className="glass-card p-4 mt-3">
          <div className="flex items-center gap-1.5 section-label mb-3">
            <BarChart3 className="h-3.5 w-3.5" />
            {t('privacy.detectedPiiTypes')}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
            {byType.map(([type, count]) => (
              <div key={type} className="flex items-center justify-between gap-2 p-2 rounded-md bg-accent/30">
                <Badge variant="outline" className="text-[10px]">{typeLabel(type)}</Badge>
                <span className="text-sm font-medium">{count}</span>
              </div>
            ))}
          </div>
          {byScanner.length > 0 && (
            <p className="text-xs text-muted-foreground mt-3">
              {t('privacy.stat.byScanner', { list: byScanner.map(([name, n]) => `${name} ${n}`).join(' · ') })}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

export default function PrivacyPage() {
  const { data, error, isLoading } = useApi<unknown>('/privacy/policy')
  const [policy, setPolicy] = useState<PolicyResponse | null>(null)
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    setPolicy(data ? parsePolicyResponse(data) : null)
  }, [data])

  const onSaved = useCallback((next: PolicyResponse) => {
    setPolicy(next)
    setDirty(false)
  }, [])

  return (
    <div>
      <div className="flex items-baseline justify-between mb-5">
        <div>
          <h1 className="page-title inline-flex items-center gap-1.5">{t('privacy.title')} <ContextualHelp helpId="admin.security" /></h1>
          <p className="text-sm text-muted-foreground">{t('privacy.subtitle')}</p>
        </div>
      </div>

      <StatsSection />

      {policy ? (
        // Re-keyed per saved version: a save starts the form afresh from the server's answer.
        <PolicyEditor key={`${policy.version}:${policy.updatedAt ?? ''}`} response={policy} onSaved={onSaved} onDirtyChange={setDirty} />
      ) : isLoading ? (
        <p className="text-sm text-muted-foreground mb-5">{t('privacy.policy.loading')}</p>
      ) : error || data ? (
        <p className="text-sm text-destructive mb-5">{t('privacy.policy.loadFailed')}</p>
      ) : null}

      {policy?.canManage && <ScanTester unsavedChanges={dirty} />}
    </div>
  )
}

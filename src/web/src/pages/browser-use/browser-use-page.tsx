// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { useApi } from '@/hooks/use-api'
import { Badge } from '@/components/ui/badge'
import { Compass, Globe } from 'lucide-react'
import { t } from './i18n'
import { PageTitle } from '@/components/docs/contextual-help'
import { useLanguageStore } from '@/stores/language-store'

type CheckStatus = 'ok' | 'missing' | 'warn'

interface Check {
  id: string
  label: string
  status: CheckStatus
  detail?: string
  remedy?: string
}

interface SidecarStatus {
  available: boolean
  enabled: boolean
  recommended?: boolean
  checks: Check[]
}

interface Status {
  available: boolean
  enabled: boolean
  checks: Check[]
  agentBrowser?: SidecarStatus
}

function checkKey(status: CheckStatus): string {
  if (status === 'ok') return 'browserUse.check.ok'
  if (status === 'missing') return 'browserUse.check.missing'
  return 'browserUse.check.warn'
}

function SidecarCard(props: {
  title: string
  icon: typeof Compass
  available: boolean | undefined
  recommended?: boolean
  emptyKey: string
  checks: Check[]
}) {
  const Icon = props.icon
  return (
    <div className="glass-card p-5 space-y-3 max-w-xl">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
          <div className="text-sm font-medium">{props.title}</div>
          {props.recommended && (
            <Badge variant="secondary" className="text-[10px] shrink-0">
              {t('browserUse.recommended')}
            </Badge>
          )}
        </div>
        <Badge variant="outline" className="text-[10px] shrink-0">
          {props.available ? t('browserUse.available') : t('browserUse.unavailable')}
        </Badge>
      </div>
      {!props.available && (
        <p className="text-xs text-muted-foreground">{t(props.emptyKey)}</p>
      )}
      <ul className="space-y-2">
        {props.checks.map((check) => (
          <li key={check.id} className="text-xs">
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-medium">{check.label}</span>
              <span className="text-muted-foreground">{t(checkKey(check.status))}</span>
            </div>
            {check.detail && <p className="text-muted-foreground mt-0.5">{check.detail}</p>}
            {check.remedy && check.status !== 'ok' && (
              <p className="text-muted-foreground mt-0.5">{check.remedy}</p>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

export default function BrowserUsePage() {
  const statusApi = useApi<Status>('/browser-use/status')
  useLanguageStore((s) => s.lang)
  const status = statusApi.data
  const agent = status?.agentBrowser

  return (
    <div>
      <PageTitle title={t('browserUse.title')} subtitle={t('browserUse.subtitle')} helpId="automation.browser-use" />
      <p className="text-sm text-muted-foreground mb-6">{t('browserUse.lanes')}</p>

      <div className="space-y-4">
        <SidecarCard
          title={t('browserUse.agentBrowser.title')}
          icon={Compass}
          available={agent?.available}
          recommended
          emptyKey="browserUse.agentBrowser.empty"
          checks={agent?.checks ?? []}
        />
        <SidecarCard
          title={t('browserUse.python.title')}
          icon={Globe}
          available={status?.available}
          emptyKey="browserUse.empty"
          checks={status?.checks ?? []}
        />
      </div>
    </div>
  )
}

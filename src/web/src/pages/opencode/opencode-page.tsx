// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { Badge } from '@/components/ui/badge'
import { PageTitle } from '@/components/docs/contextual-help'
import { useApi } from '@/hooks/use-api'
import { useLanguageStore } from '@/stores/language-store'
import { t } from './i18n'

type CheckStatus = 'ok' | 'missing' | 'warn'

interface Check {
  id: string
  label: string
  status: CheckStatus
  detail?: string
  remedy?: string
}

interface Status {
  available: boolean
  enabled: boolean
  checks: Check[]
  server: { running: boolean; url: string | null; version: string | null }
  pty: { available: boolean; platform: string }
}

function checkKey(status: CheckStatus): string {
  if (status === 'ok') return 'opencode.check.ok'
  if (status === 'missing') return 'opencode.check.missing'
  return 'opencode.check.warn'
}

export default function OpencodePage() {
  useLanguageStore((s) => s.lang)
  const { data } = useApi<Status>('/opencode/status')

  return (
    <div className="p-6 space-y-4 max-w-2xl">
      <PageTitle title={t('opencode.title')} subtitle={t('opencode.subtitle')} helpId="automation.opencode" />

      <div className="glass-card p-5 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="text-sm font-medium">{t('opencode.title')}</div>
          <Badge variant="outline" className="text-[10px] shrink-0">
            {data?.available ? t('opencode.available') : t('opencode.unavailable')}
          </Badge>
        </div>
        {!data?.available && (
          <p className="text-xs text-muted-foreground">{t('opencode.empty')}</p>
        )}
        <p className="text-xs text-muted-foreground">
          {data?.server.running && data.server.url
            ? t('opencode.server.running', { url: data.server.url, version: data.server.version ?? '?' })
            : t('opencode.server.stopped')}
        </p>
        <ul className="space-y-2">
          {(data?.checks ?? []).map((check) => (
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
        <p className="text-xs text-muted-foreground">{t('opencode.help')}</p>
      </div>
    </div>
  )
}

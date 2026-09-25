// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { useCallback, useEffect, useState } from 'react'
import { useApi } from '@/hooks/use-api'
import { useWebSocket } from '@/hooks/use-websocket'
import { api } from '@/lib/api'
import { WS_TOPICS } from '@/lib/ws-topics'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Clapperboard, Loader2 } from 'lucide-react'
import { t } from './i18n'
import { PageTitle } from '@/components/docs/contextual-help'
import { useLanguageStore } from '@/stores/language-store'

type CheckStatus = 'ok' | 'missing' | 'warn'

interface StudioCheck {
  id: string
  label: string
  status: CheckStatus
  detail?: string
  remedy?: string
}

interface EngineStatus {
  engineId: string
  name: string
  enabled: boolean
  available: boolean
  checks: StudioCheck[]
}

interface StudioProject {
  id: string
  engineId: string
  title: string
  createdAt: string
}

interface StudioJob {
  id: string
  engineId: string
  projectId: string
  status: string
  error: string | null
  createdAt: string
}

const STATUS_KEY: Record<string, string> = {
  queued: 'studio.status.queued',
  running: 'studio.status.running',
  completed: 'studio.status.completed',
  failed: 'studio.status.failed',
  cancelled: 'studio.status.cancelled',
}

function checkKey(status: CheckStatus): string {
  if (status === 'ok') return 'studio.check.ok'
  if (status === 'missing') return 'studio.check.missing'
  return 'studio.check.warn'
}

export default function StudioPage() {
  const statusApi = useApi<{ engines: EngineStatus[] }>('/studio/status')
  const projectsApi = useApi<{ projects: StudioProject[] }>('/studio/projects')
  const jobsApi = useApi<{ jobs: StudioJob[] }>('/studio/jobs')
  const { subscribe } = useWebSocket()
  const lang = useLanguageStore((s) => s.lang)
  const [busy, setBusy] = useState<string | null>(null)
  const [engineId, setEngineId] = useState<string>('')

  const engines = statusApi.data?.engines ?? []
  const projects = projectsApi.data?.projects ?? []
  const jobs = jobsApi.data?.jobs ?? []
  const anyReady = engines.some((e) => e.available)
  const readyEngines = engines.filter((e) => e.available)
  const selectedEngine = engineId || readyEngines[0]?.engineId || engines[0]?.engineId || 'hyperframes'

  const blurbKey = (id: string): string => {
    if (id === 'videouse') return 'studio.videouse.blurb'
    if (id === 'hyperframes') return 'studio.hyperframes.blurb'
    return 'studio.engine.blurb'
  }

  const refetchAll = useCallback(() => {
    statusApi.refetch()
    projectsApi.refetch()
    jobsApi.refetch()
  }, [statusApi.refetch, projectsApi.refetch, jobsApi.refetch])

  useEffect(() => {
    return subscribe(WS_TOPICS.studio, () => {
      refetchAll()
    })
  }, [subscribe, refetchAll])

  const handleNew = useCallback(async () => {
    setBusy('new')
    try {
      await api.post('/studio/projects', { engineId: selectedEngine, title: t('studio.newTitle') })
      refetchAll()
    } finally {
      setBusy(null)
    }
  }, [refetchAll, lang, selectedEngine])

  const handleRender = useCallback(async (id: string) => {
    setBusy(`render:${id}`)
    try {
      await api.post(`/studio/projects/${id}/render`)
      refetchAll()
    } finally {
      setBusy(null)
    }
  }, [refetchAll])

  return (
    <div>
      <PageTitle title={t('studio.title')} subtitle={t('studio.subtitle')} helpId="studio.overview" />

      {!anyReady && engines.length > 0 && (
        <p className="text-sm text-muted-foreground mb-6">{t('studio.empty')}</p>
      )}

      <h2 className="text-sm font-medium mb-3">{t('studio.engines')}</h2>
      <div className="grid gap-4 mb-8 md:grid-cols-2">
        {engines.map((engine) => (
          <div key={engine.engineId} className="glass-card p-5 space-y-3">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{engine.name}</div>
                <p className="text-xs text-muted-foreground mt-1">{t(blurbKey(engine.engineId))}</p>
              </div>
              <Badge variant="outline" className="text-[10px] shrink-0">
                {engine.available ? t('studio.available') : t('studio.unavailable')}
              </Badge>
            </div>
            <ul className="space-y-2">
              {engine.checks.map((check) => (
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
        ))}
      </div>

      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-medium">{t('studio.projects')}</h2>
        <div className="flex items-center gap-2">
          {readyEngines.length > 1 && (
            <select
              className="text-xs bg-transparent border border-[var(--vibrancy-border)] rounded-md px-2 py-1"
              value={selectedEngine}
              onChange={(e) => setEngineId(e.target.value)}
            >
              {readyEngines.map((e) => (
                <option key={e.engineId} value={e.engineId}>{e.name}</option>
              ))}
            </select>
          )}
          <Button size="sm" onClick={handleNew} disabled={busy === 'new' || !anyReady}>
            {busy === 'new' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : t('studio.new')}
          </Button>
        </div>
      </div>
      {projects.length === 0 ? (
        <div className="glass-card p-12 text-center mb-8">
          <Clapperboard className="h-10 w-10 mx-auto mb-3 text-muted-foreground opacity-50" />
          <p className="text-sm text-muted-foreground">
            {anyReady ? t('studio.noProjects') : t('studio.empty')}
          </p>
        </div>
      ) : (
        <div className="glass-card overflow-hidden mb-8">
          <table className="w-full text-sm">
            <tbody>
              {projects.map((p) => (
                <tr key={p.id} className="border-b border-[var(--vibrancy-border)] last:border-0">
                  <td className="p-3 font-medium">{p.title}</td>
                  <td className="p-3 text-muted-foreground text-xs">{p.engineId}</td>
                  <td className="p-3 text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy === `render:${p.id}` || !anyReady}
                      onClick={() => handleRender(p.id)}
                    >
                      {busy === `render:${p.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : t('studio.render')}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2 className="text-sm font-medium mb-3">{t('studio.jobs')}</h2>
      {jobs.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('studio.noJobs')}</p>
      ) : (
        <div className="glass-card overflow-hidden">
          <table className="w-full text-sm">
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id} className="border-b border-[var(--vibrancy-border)] last:border-0">
                  <td className="p-3 text-xs font-mono">{j.id.slice(0, 8)}</td>
                  <td className="p-3">
                    <Badge variant="outline" className="text-[10px]">
                      {t(STATUS_KEY[j.status] ?? 'studio.status.running')}
                    </Badge>
                  </td>
                  <td className="p-3 text-xs text-muted-foreground">{j.error ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

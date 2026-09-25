import { useEffect, useState } from 'react'
import { useApi } from '@/hooks/use-api'
import { useWebSocket } from '@/hooks/use-websocket'
import { api, ApiError } from '@/lib/api'
import { WS_TOPICS } from '@/lib/ws-topics'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Activity, RefreshCw, XCircle, RotateCcw, Play } from 'lucide-react'
import { t } from './i18n'
import { t as tc } from '@/i18n'
import { ContextualHelp } from '@/components/docs/contextual-help'

interface Run {
  id: string
  conversationId: string
  agentId: string
  status: 'running' | 'stuck' | 'refreshing' | 'waiting_approval' | 'completed' | 'max_turns' | 'failed' | 'cancelled'
  kind: string | null
  turnsUsed: number
  tokensUsed: number
  error: string | null
  startedAt: string
  heartbeatAt: string | null
  // F2 T7 — the completeness critic's verdict. null for a run nobody critic'd
  // (interactive/team/delegation runs, and every run from before the feature).
  verification: 'passed' | 'failed' | 'unverified' | null
  criticRounds: number
}

const ACTIVE = new Set(['running', 'stuck', 'refreshing'])
// Terminal states a run can be re-run from (re-runs the conversation through
// the supervised runner — the security gate still fires per tool call).
// 'max_turns' (D6) hit the turn budget without finishing — same shape as a
// stuck/cancelled run, worth resuming from its checkpoint or retrying fresh.
const RETRYABLE = new Set(['failed', 'stuck', 'cancelled', 'max_turns'])
// Every run lifecycle event lands on one topic, and progress fires per runner
// step — so a single busy run would otherwise drive one list refetch per frame.
// Trailing-edge throttle: the first frame schedules the refetch, everything
// inside the window folds into it.
const REFETCH_THROTTLE_MS = 400

function statusVariant(s: Run['status']): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (s === 'failed' || s === 'stuck') return 'destructive'
  if (s === 'running' || s === 'refreshing') return 'default'
  return 'secondary'
}

// 'failed' verification is NOT a failed run: the run finished, it just did not
// achieve its goal — hence outline/destructive rather than the status colours.
function verificationVariant(v: NonNullable<Run['verification']>): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (v === 'failed') return 'destructive'
  if (v === 'passed') return 'default'
  return 'outline'
}

function ago(iso: string | null): string {
  if (!iso) return '—'
  const ms = Date.now() - new Date(iso).getTime()
  if (Number.isNaN(ms)) return '—'
  const s = Math.round(ms / 1000)
  if (s < 60) return t('agentRuns.ago.seconds', { n: s })
  if (s < 3600) return t('agentRuns.ago.minutes', { n: Math.round(s / 60) })
  return t('agentRuns.ago.hours', { n: Math.round(s / 3600) })
}

export default function AgentRunsPage() {
  const runs = useApi<{ runs: Run[] }>('/agent/runs')
  const { subscribe } = useWebSocket()
  const [error, setError] = useState<string | null>(null)

  const refetchRuns = runs.refetch
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const unsubscribe = subscribe(WS_TOPICS.agentRuns, () => {
      if (timer) return
      timer = setTimeout(() => {
        timer = null
        refetchRuns()
      }, REFETCH_THROTTLE_MS)
    })
    return () => {
      if (timer) clearTimeout(timer)
      unsubscribe()
    }
  }, [subscribe, refetchRuns])

  async function cancel(id: string) {
    setError(null)
    try {
      await api.post(`/agent/runs/${id}/cancel`)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e))
    } finally {
      runs.refetch()
    }
  }

  async function retry(id: string) {
    setError(null)
    try {
      await api.post(`/agent/runs/${id}/retry`)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e))
    } finally {
      runs.refetch()
    }
  }

  // Warm-resume from the run's latest checkpoint (continue where it left off,
  // with a do-not-repeat guard) — vs retry which re-runs the task from scratch.
  async function resume(id: string) {
    setError(null)
    try {
      await api.post(`/agent/runs/${id}/refresh`)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e))
    } finally {
      runs.refetch()
    }
  }

  const list = runs.data?.runs ?? []

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground flex items-center gap-2">
            <Activity className="h-6 w-6" /> {t('agentRuns.title')}
          
            <ContextualHelp helpId="agents.runs" />
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {t('agentRuns.subtitle')}
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => runs.refetch()}>
          <RefreshCw className="h-4 w-4 mr-1" /> {tc('common.refresh')}
        </Button>
      </header>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
      )}

      {list.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('agentRuns.empty')}</p>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr className="text-left">
                <th className="px-3 py-2 font-medium">{tc('common.status')}</th>
                <th className="px-3 py-2 font-medium">{t('agentRuns.col.verification')}</th>
                <th className="px-3 py-2 font-medium">{t('agentRuns.col.agent')}</th>
                <th className="px-3 py-2 font-medium">{t('agentRuns.col.kind')}</th>
                <th className="px-3 py-2 font-medium">{t('agentRuns.col.turns')}</th>
                <th className="px-3 py-2 font-medium">{t('agentRuns.col.tokens')}</th>
                <th className="px-3 py-2 font-medium">{t('agentRuns.col.lastProgress')}</th>
                <th className="px-3 py-2 font-medium text-right">{tc('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.id} className="border-t border-border">
                  <td className="px-3 py-2"><Badge variant={statusVariant(r.status)}>{t(`agentRuns.status.${r.status}`)}</Badge></td>
                  <td className="px-3 py-2">
                    {r.verification ? (
                      <Badge variant={verificationVariant(r.verification)} title={t(`agentRuns.verification.${r.verification}Title`)}>
                        {t(`agentRuns.verification.${r.verification}`)}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-foreground">{r.agentId}</td>
                  <td className="px-3 py-2 text-muted-foreground">{r.kind ?? '—'}</td>
                  <td className="px-3 py-2 text-muted-foreground">{r.turnsUsed}</td>
                  <td className="px-3 py-2 text-muted-foreground">{r.tokensUsed}</td>
                  <td className="px-3 py-2 text-muted-foreground">{ago(r.heartbeatAt)}</td>
                  <td className="px-3 py-2 text-right">
                    {ACTIVE.has(r.status) && (
                      <Button size="sm" variant="ghost" onClick={() => cancel(r.id)}>
                        <XCircle className="h-4 w-4 mr-1" /> {tc('common.cancel')}
                      </Button>
                    )}
                    {RETRYABLE.has(r.status) && (
                      <>
                        <Button size="sm" variant="ghost" onClick={() => resume(r.id)} title={t('agentRuns.action.resumeTitle')}>
                          <Play className="h-4 w-4 mr-1" /> {t('agentRuns.action.resume')}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => retry(r.id)} title={t('agentRuns.action.retryTitle')}>
                          <RotateCcw className="h-4 w-4 mr-1" /> {t('agentRuns.action.retry')}
                        </Button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

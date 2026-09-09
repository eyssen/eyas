import { useEffect, useState } from 'react'
import { useApi } from '@/hooks/use-api'
import { useWebSocket } from '@/hooks/use-websocket'
import { api, ApiError } from '@/lib/api'
import { WS_TOPICS } from '@/lib/ws-topics'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Lock, Check, X, ShieldCheck } from 'lucide-react'
import { Link } from '@tanstack/react-router'
import { t } from './i18n'
import { ContextualHelp } from '@/components/docs/contextual-help'

interface Category {
  key: string
  label: string
  level: 1 | 2 | 3
  locked: boolean
  maxLevel: 1 | 2 | 3
  updatedBy: string | null
}

interface Approval {
  id: number
  category: string
  toolName: string | null
  reason: string | null
  requestedAt: string
  // A run parked on this approval is BLOCKED until it is decided — the single
  // most important thing an operator can know before deciding, and the only
  // way to reach the work that is waiting.
  runId: string | null
  conversationId: string | null
  // Set when a resume driven by this approval refused; the run is still
  // parked, so a decided-but-stuck approval would otherwise look identical to
  // one that resumed fine.
  resumeError: string | null
}

const LEVELS: { n: 1 | 2 | 3 }[] = [{ n: 1 }, { n: 2 }, { n: 3 }]

export default function AutonomyDashboard() {
  const cats = useApi<{ categories: Category[] }>('/autonomy')
  const approvals = useApi<{ approvals: Approval[] }>('/autonomy/approvals?status=pending')
  // A resume that refused leaves the approval APPROVED (the operator already
  // decided) while its run stays parked — invisible in a pending-only list,
  // and the one state where the operator has to act outside this page. The
  // server filters and bounds these: this refetches on every autonomy event,
  // and the approved history is append-only.
  const stuckResumes = useApi<{ approvals: Approval[] }>('/autonomy/approvals?resumeFailed=1')
  const { subscribe } = useWebSocket()
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState<string | null>(null)

  // Live-refresh as the runner enqueues, operators decide, or a ladder level
  // moves. The topic carries every autonomy:* event, and the frames are thin
  // (ids only) — so both lists refetch over REST rather than patching state.
  const refetchApprovals = approvals.refetch
  const refetchCats = cats.refetch
  const refetchStuck = stuckResumes.refetch
  useEffect(() => {
    return subscribe(WS_TOPICS.autonomy, () => {
      refetchApprovals()
      refetchCats()
      refetchStuck()
    })
  }, [subscribe, refetchApprovals, refetchCats, refetchStuck])

  async function setLevel(cat: Category, level: 1 | 2 | 3) {
    if (level === cat.level) return
    if (cat.locked && level > 1) return
    if (level > cat.maxLevel) return
    setSaving(cat.key)
    setError(null)
    try {
      await api.put(`/autonomy/${cat.key}`, { level })
      cats.refetch()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e))
      cats.refetch() // rollback optimistic UI to server truth
    } finally {
      setSaving(null)
    }
  }

  async function decide(id: number, action: 'approve' | 'reject') {
    setError(null)
    try {
      await api.post(`/autonomy/approvals/${id}/${action}`)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e))
    } finally {
      approvals.refetch()
    }
  }

  const categories = cats.data?.categories ?? []
  const reversible = categories.filter((c) => !c.locked)
  const locked = categories.filter((c) => c.locked)
  const pending = approvals.data?.approvals ?? []
  // Decided, but the run it unblocks never actually restarted. Nothing else in
  // the UI would ever show this: the row left the pending queue on approval.
  const stuck = stuckResumes.data?.approvals ?? []

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-8">
      <header>
        <h1 className="text-2xl font-semibold text-foreground flex items-center gap-2">
          <ShieldCheck className="h-6 w-6" /> {t('autonomy.title')}
        
            <ContextualHelp helpId="agents.autonomy" />
          </h1>
        <p className="text-sm text-muted-foreground mt-1">
          {t('autonomy.subtitlePre')}<strong>{t('autonomy.level.1.label')}</strong>{t('autonomy.subtitlePost')}
        </p>
      </header>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Pending approvals */}
      <section className="space-y-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
          {t('autonomy.pendingApprovals')} {pending.length > 0 && <Badge variant="secondary">{pending.length}</Badge>}
        </h2>
        {pending.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('autonomy.nothingWaiting')}</p>
        ) : (
          <ul className="space-y-2">
            {pending.map((a) => (
              <li key={a.id} className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-3">
                <ApprovalSummary approval={a} />
                <div className="flex gap-2 shrink-0">
                  <Button size="sm" variant="outline" onClick={() => decide(a.id, 'approve')}>
                    <Check className="h-4 w-4 mr-1" /> {t('autonomy.approve')}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => decide(a.id, 'reject')}>
                    <X className="h-4 w-4 mr-1" /> {t('autonomy.reject')}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {stuck.length > 0 && (
          <ul className="space-y-2">
            {stuck.map((a) => (
              <li key={a.id} className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3">
                <ApprovalSummary approval={a} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <CategoryGroup title={t('autonomy.group.reversible')} categories={reversible} saving={saving} onSet={setLevel} />
      <CategoryGroup title={t('autonomy.group.locked')} categories={locked} saving={saving} onSet={setLevel} />
    </div>
  )
}

/**
 * What the approval is, and — the F2 T6 addition — what it is holding up: the
 * parked run, linked to the conversation it belongs to, plus the reason a
 * resume refused when one did.
 */
function ApprovalSummary({ approval: a }: { approval: Approval }) {
  return (
    <div className="min-w-0">
      <div className="text-sm text-foreground">
        <span className="font-medium">{a.category}</span>
        {a.toolName && <span className="text-muted-foreground"> · {a.toolName}</span>}
      </div>
      {a.reason && <div className="text-xs text-muted-foreground truncate">{a.reason}</div>}
      {a.runId && (
        <div className="text-xs text-muted-foreground">
          {t('autonomy.parkedRun')}:{' '}
          {a.conversationId ? (
            <Link
              to="/conversations/$conversationId"
              params={{ conversationId: a.conversationId }}
              className="font-mono underline hover:text-foreground transition-colors"
            >
              {a.runId.slice(0, 8)}
            </Link>
          ) : (
            <span className="font-mono">{a.runId.slice(0, 8)}</span>
          )}
        </div>
      )}
      {a.resumeError && (
        <div className="text-xs text-destructive">{t('autonomy.resumeFailed', { reason: a.resumeError })}</div>
      )}
    </div>
  )
}

function CategoryGroup({
  title,
  categories,
  saving,
  onSet,
}: {
  title: string
  categories: Category[]
  saving: string | null
  onSet: (cat: Category, level: 1 | 2 | 3) => void
}) {
  if (categories.length === 0) return null
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">{title}</h2>
      <ul className="space-y-2">
        {categories.map((cat) => (
          <li key={cat.key} className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-3">
            <div className="flex items-center gap-2 min-w-0">
              {cat.locked && <Lock className="h-4 w-4 text-muted-foreground shrink-0" />}
              <span className="text-sm text-foreground truncate">{cat.label}</span>
            </div>
            <div className="flex rounded-md border border-border overflow-hidden shrink-0" role="group" aria-label={cat.label}>
              {LEVELS.map((lv) => {
                const disabled = saving === cat.key || (cat.locked && lv.n > 1) || lv.n > cat.maxLevel
                const active = cat.level === lv.n
                return (
                  <button
                    key={lv.n}
                    type="button"
                    title={t(`autonomy.level.${lv.n}.hint`)}
                    disabled={disabled && !active}
                    onClick={() => onSet(cat, lv.n)}
                    className={[
                      'px-3 py-1.5 text-xs transition-colors',
                      active ? 'bg-primary text-primary-foreground' : 'bg-transparent text-muted-foreground',
                      disabled && !active ? 'opacity-40 cursor-not-allowed' : 'hover:bg-muted cursor-pointer',
                    ].join(' ')}
                  >
                    L{lv.n} {t(`autonomy.level.${lv.n}.label`)}
                  </button>
                )
              })}
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

import { useState } from 'react'
import { useApi } from '@/hooks/use-api'
import { api, ApiError } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Cpu } from 'lucide-react'
import { t } from './i18n'

interface AiModelsResponse {
  providers: Array<{ id: string; models: Array<{ id: string; name: string }> }>
  agents: Array<{ id: string; name: string; agentType: string; proposedModelId: string | null }>
}

/**
 * Post-setup model-assignment editor. Replaces the first-run wizard's optional
 * 'ai-models' step, which is deliberately blocked once setup completes (the
 * public /setup/steps/* writes fail closed). Reads seed agents + available
 * models from the public /setup/ai-models endpoint and persists changes via the
 * authenticated PUT /api/v1/model/agent-assignments (requires 'manage Model').
 */
export default function ModelAssignmentsCard() {
  const { data, isLoading } = useApi<AiModelsResponse>('/setup/ai-models')
  const [overrides, setOverrides] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<{ ok: boolean; msg: string } | null>(null)

  const agents = data?.agents ?? []
  const allModels = (data?.providers ?? []).flatMap((p) => p.models)
  const modelFor = (agentId: string, proposed: string | null) => overrides[agentId] ?? proposed ?? ''

  async function save() {
    const assignments: Record<string, string> = {}
    for (const a of agents) {
      const m = modelFor(a.id, a.proposedModelId)
      if (m) assignments[a.id] = m
    }
    setSaving(true)
    setStatus(null)
    try {
      const res = await api.put<{ applied: number }>('/model/agent-assignments', { assignments })
      setStatus({ ok: true, msg: t('settings.modelAssignments.saved', { count: res.applied }) })
    } catch (e) {
      setStatus({ ok: false, msg: e instanceof ApiError ? e.message : t('settings.modelAssignments.saveFailed') })
    } finally {
      setSaving(false)
    }
  }

  // Nothing to configure (no seed agents or no providers yet) — hide the card.
  if (isLoading || agents.length === 0 || allModels.length === 0) return null

  return (
    <div className="glass-card p-4">
      <h3 className="text-sm font-semibold mb-1 flex items-center gap-2">
        <Cpu className="h-4 w-4" /> {t('settings.modelAssignments.heading')}
      </h3>
      <p className="text-xs text-muted-foreground mb-3">
        {t('settings.modelAssignments.subtitle')}
      </p>
      <div className="flex flex-col gap-2">
        {agents.map((a) => (
          <div key={a.id} className="flex items-center gap-3">
            <span className="text-sm flex-1 truncate">{a.name}</span>
            <select
              className="text-sm bg-accent/50 border border-border rounded-md px-2 py-1 min-w-[220px]"
              value={modelFor(a.id, a.proposedModelId)}
              onChange={(e) => setOverrides((o) => ({ ...o, [a.id]: e.target.value }))}
            >
              <option value="">{t('settings.modelAssignments.none')}</option>
              {allModels.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-3 mt-4">
        <Button size="sm" onClick={save} disabled={saving}>
          {saving ? t('settings.modelAssignments.saving') : t('settings.modelAssignments.save')}
        </Button>
        {status && (
          <span className={`text-xs ${status.ok ? 'text-emerald-500' : 'text-destructive'}`}>{status.msg}</span>
        )}
      </div>
    </div>
  )
}

import { useState } from 'react'
import { useApi } from '@/hooks/use-api'
import { api, ApiError } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Users } from 'lucide-react'
import { t } from './i18n'

interface TeamTemplate {
  id: string
  name: string
  description: string
  tier: string
  recommended: boolean
}

/**
 * Post-setup team-agent bootstrap. Authenticated replacement for the first-run
 * wizard's optional 'team-agents' step: lists the specialist templates from
 * GET /api/v1/agents/templates and bulk-creates the selected ones via
 * POST /api/v1/agents/team-bootstrap (requires 'create Agent').
 */
export default function TeamAgentsCard() {
  const { data, isLoading } = useApi<{ templates: TeamTemplate[] }>('/agents/templates')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<{ ok: boolean; msg: string } | null>(null)

  const templates = data?.templates ?? []
  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  async function addSelected() {
    if (selected.size === 0) return
    setBusy(true)
    setStatus(null)
    try {
      const res = await api.post<{ created: Array<{ id: string; name: string }> }>('/agents/team-bootstrap', {
        agentIds: [...selected],
      })
      setStatus({ ok: true, msg: t('settings.teamAgents.added', { count: res.created.length }) })
      setSelected(new Set())
    } catch (e) {
      setStatus({ ok: false, msg: e instanceof ApiError ? e.message : t('settings.teamAgents.addFailed') })
    } finally {
      setBusy(false)
    }
  }

  if (isLoading || templates.length === 0) return null

  return (
    <div className="glass-card p-4">
      <h3 className="text-sm font-semibold mb-1 flex items-center gap-2">
        <Users className="h-4 w-4" /> {t('settings.teamAgents.heading')}
      </h3>
      <p className="text-xs text-muted-foreground mb-3">
        {t('settings.teamAgents.subtitle')}
      </p>
      <div className="flex flex-col gap-2">
        {templates.map((tpl) => (
          <label key={tpl.id} className="flex items-start gap-3 p-2 rounded-lg bg-accent/30 cursor-pointer">
            <input
              type="checkbox"
              className="mt-1"
              checked={selected.has(tpl.id)}
              onChange={() => toggle(tpl.id)}
            />
            <span className="flex-1">
              <span className="text-sm flex items-center gap-2">
                {tpl.name}
                {tpl.recommended && <span className="text-[10px] text-emerald-500">{t('settings.teamAgents.recommended')}</span>}
              </span>
              <span className="block text-xs text-muted-foreground">{tpl.description}</span>
            </span>
          </label>
        ))}
      </div>
      <div className="flex items-center gap-3 mt-4">
        <Button size="sm" onClick={addSelected} disabled={busy || selected.size === 0}>
          {busy ? t('settings.teamAgents.adding') : t('settings.teamAgents.addSelected', { count: selected.size })}
        </Button>
        {status && (
          <span className={`text-xs ${status.ok ? 'text-emerald-500' : 'text-destructive'}`}>{status.msg}</span>
        )}
      </div>
    </div>
  )
}

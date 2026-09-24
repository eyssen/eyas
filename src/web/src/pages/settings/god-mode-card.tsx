import { useEffect, useMemo, useRef, useState } from 'react'
import { useApi } from '@/hooks/use-api'
import { api, ApiError } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Swords } from 'lucide-react'
import { t } from './i18n'
import {
  buildGodModeSaveBody,
  newParticipantId,
  type GodModeDraftRow,
} from './god-mode-card-utils'

interface GodModeConfigResponse {
  participants: GodModeDraftRow[]
  chairParticipantId: string | null
  costCeilingUsd: number | null
  workspaceRetentionHours: number
  updatedAt: string
  limits?: { min: number; max: number }
}

interface ProviderItem {
  id: string
  name: string
  enabled?: boolean
  active?: boolean
}

interface ModelOption {
  id: string
  modelId?: string
  name: string
  enabled?: boolean
}

const selectClass = 'text-sm bg-accent/50 border border-border rounded-md px-2 py-1 min-w-[140px]'
const inputClass = 'text-sm bg-accent/50 border border-border rounded-md px-2 py-1 w-full'

/**
 * Settings roster for God Mode. Reads GET /god-mode/config and persists via
 * PUT /god-mode/config (requires 'manage Model'). Provider/model lists come
 * from GET /model/providers then GET /model/providers/:id.
 */
export default function GodModeCard() {
  const { data: config, isLoading, error } = useApi<GodModeConfigResponse>('/god-mode/config')
  const { data: providerData } = useApi<{ providers: ProviderItem[] }>('/model/providers')

  const [participants, setParticipants] = useState<GodModeDraftRow[]>([])
  const [chairParticipantId, setChairParticipantId] = useState<string | null>(null)
  const [ceilingRaw, setCeilingRaw] = useState('')
  const [retentionRaw, setRetentionRaw] = useState('72')
  const [hydrated, setHydrated] = useState(false)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<{ ok: boolean; msg: string } | null>(null)

  const max = config?.limits?.max ?? 5
  const providers = useMemo(() => {
    const list = providerData?.providers ?? []
    return list.filter((p) => p.active !== false && p.enabled !== false)
  }, [providerData])

  useEffect(() => {
    if (!config || hydrated) return
    setParticipants(config.participants.map((p) => ({ ...p })))
    setChairParticipantId(config.chairParticipantId)
    setCeilingRaw(config.costCeilingUsd == null ? '' : String(config.costCeilingUsd))
    setRetentionRaw(String(config.workspaceRetentionHours ?? 72))
    setHydrated(true)
  }, [config, hydrated])

  const providerIds = useMemo(() => {
    const ids = new Set<string>()
    for (const p of providers) ids.add(p.id)
    for (const row of participants) if (row.providerId) ids.add(row.providerId)
    return [...ids]
  }, [providers, participants])

  const modelsByProvider = useProviderModels(providerIds)

  const { body, chairRequired } = useMemo(
    () =>
      buildGodModeSaveBody({
        participants,
        chairParticipantId,
        costCeilingRaw: ceilingRaw,
        retentionRaw,
      }),
    [participants, chairParticipantId, ceilingRaw, retentionRaw],
  )

  function applyConfig(next: GodModeConfigResponse) {
    setParticipants(next.participants.map((p) => ({ ...p })))
    setChairParticipantId(next.chairParticipantId)
    setCeilingRaw(next.costCeilingUsd == null ? '' : String(next.costCeilingUsd))
    setRetentionRaw(String(next.workspaceRetentionHours ?? 72))
  }

  function addRow() {
    if (participants.length >= max) return
    setParticipants((rows) => [...rows, { id: newParticipantId(), providerId: '', modelId: '' }])
    setStatus(null)
  }

  function removeRow(id: string) {
    setParticipants((rows) => rows.filter((r) => r.id !== id))
    setChairParticipantId((chair) => (chair === id ? null : chair))
    setStatus(null)
  }

  function patchRow(id: string, patch: Partial<GodModeDraftRow>) {
    setParticipants((rows) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r)))
    setStatus(null)
  }

  async function save() {
    if (chairRequired) return
    setSaving(true)
    setStatus(null)
    try {
      const res = await api.put<GodModeConfigResponse>('/god-mode/config', body)
      applyConfig(res)
      setStatus({ ok: true, msg: t('settings.godMode.saved') })
    } catch (e) {
      setStatus({ ok: false, msg: e instanceof ApiError ? e.message : t('settings.godMode.saveFailed') })
    } finally {
      setSaving(false)
    }
  }

  if (error && (error.status === 401 || error.status === 403)) return null

  return (
    <div className="glass-card p-4">
      <h3 className="text-sm font-semibold mb-1 flex items-center gap-2">
        <Swords className="h-4 w-4" /> {t('settings.godMode.heading')}
      </h3>
      <p className="text-xs text-muted-foreground mb-3">
        {t('settings.godMode.subtitle')}
      </p>

      {error && !isLoading && (
        <p className="text-xs text-destructive mb-2">{error.message}</p>
      )}

      {isLoading && !hydrated && (
        <p className="text-xs text-muted-foreground">{t('common.loading')}</p>
      )}

      {hydrated && (
        <>
          <div className="flex flex-col gap-2">
            {participants.map((row) => (
              <div key={row.id} className="flex items-center gap-2 flex-wrap">
                <select
                  className={selectClass}
                  aria-label={t('settings.godMode.provider')}
                  value={row.providerId}
                  onChange={(e) => patchRow(row.id, { providerId: e.target.value, modelId: '' })}
                >
                  <option value="">{t('settings.godMode.provider')}</option>
                  {providers.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
                <select
                  className={selectClass}
                  aria-label={t('settings.godMode.model')}
                  value={row.modelId}
                  disabled={!row.providerId}
                  onChange={(e) => patchRow(row.id, { modelId: e.target.value })}
                >
                  <option value="">{t('settings.godMode.model')}</option>
                  {(modelsByProvider[row.providerId] ?? []).map((m) => {
                    const value = m.modelId ?? m.id
                    return (
                      <option key={m.id || value} value={value}>{m.name}</option>
                    )
                  })}
                </select>
                <label className="flex items-center gap-1 text-xs whitespace-nowrap">
                  <input
                    type="radio"
                    name="god-mode-chair"
                    checked={chairParticipantId === row.id}
                    onChange={() => setChairParticipantId(row.id)}
                  />
                  {t('settings.godMode.chair')}
                </label>
                <Button variant="ghost" size="sm" onClick={() => removeRow(row.id)}>
                  {t('settings.godMode.remove')}
                </Button>
              </div>
            ))}
          </div>

          <div className="mt-3">
            <Button variant="outline" size="sm" onClick={addRow} disabled={participants.length >= max}>
              {t('settings.godMode.addModel')}
            </Button>
          </div>

          {chairRequired && (
            <p className="text-xs text-destructive mt-2">{t('settings.godMode.chairRequired')}</p>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">{t('settings.godMode.ceiling')}</span>
              <input
                type="number"
                min={0}
                step="0.01"
                className={inputClass}
                placeholder={t('settings.godMode.ceilingNone')}
                value={ceilingRaw}
                onChange={(e) => {
                  setCeilingRaw(e.target.value)
                  setStatus(null)
                }}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">{t('settings.godMode.retentionHours')}</span>
              <input
                type="number"
                min={0}
                step={1}
                className={inputClass}
                value={retentionRaw}
                onChange={(e) => {
                  setRetentionRaw(e.target.value)
                  setStatus(null)
                }}
              />
            </label>
          </div>

          <div className="flex items-center gap-3 mt-4">
            <Button size="sm" onClick={save} disabled={saving || chairRequired}>
              {saving ? t('settings.godMode.saving') : t('settings.godMode.save')}
            </Button>
            {status && (
              <span className={`text-xs ${status.ok ? 'text-emerald-500' : 'text-destructive'}`}>{status.msg}</span>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function useProviderModels(providerIds: string[]): Record<string, ModelOption[]> {
  const [byId, setById] = useState<Record<string, ModelOption[]>>({})
  const fetched = useRef(new Set<string>())
  const key = providerIds.join('|')

  useEffect(() => {
    for (const id of key ? key.split('|') : []) {
      if (!id || fetched.current.has(id)) continue
      fetched.current.add(id)
      api
        .get<{ models: ModelOption[] }>(`/model/providers/${id}`)
        .then((res) => {
          const models = (res.models ?? []).filter((m) => m.enabled !== false)
          setById((prev) => ({ ...prev, [id]: models }))
        })
        .catch(() => {
          fetched.current.delete(id)
          setById((prev) => ({ ...prev, [id]: [] }))
        })
    }
  }, [key])

  return byId
}

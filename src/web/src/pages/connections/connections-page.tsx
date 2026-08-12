import { useState, useCallback, useMemo } from 'react'
import { Link } from '@tanstack/react-router'
import { useApi } from '@/hooks/use-api'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import {
  Plug, Plus, Trash2, RefreshCw, Pencil, Loader2, CheckCircle2, XCircle,
  Store, Cable, KeyRound,
} from 'lucide-react'
import { t } from './i18n'

interface ConnectionField {
  name: string
  label: string
  required: boolean
  sensitive?: boolean
  placeholder?: string
  hint?: string
}

interface SystemType {
  id: string
  name: string
  description: string
  adapter: string
  category: string
  icon: string
  configFields: ConnectionField[]
  secretFields: ConnectionField[]
  setupIntro?: string
  tags?: string[]
}

interface Connection {
  id: string
  name: string
  systemType: string
  adapter: string
  config: Record<string, unknown>
  secretRefs: string[]
  status: string
  health: { lastCheckedAt: string | null; lastOkAt: string | null; lastError: string | null }
  scope: { default?: boolean }
  source: string
  reason: string | null
  createdAt: string
  updatedAt: string
}

const statusStyles: Record<string, string> = {
  connected: 'text-emerald-500 border-emerald-500/30 bg-emerald-500/10',
  error: 'text-red-400 border-red-400/30 bg-red-400/10',
  pending: 'text-amber-500 border-amber-500/30 bg-amber-500/10',
  disabled: 'text-zinc-400 border-zinc-400/30 bg-zinc-400/10',
  unknown: 'text-blue-400 border-blue-400/30 bg-blue-400/10',
}

export default function ConnectionsPage() {
  const { data, refetch } = useApi<{ connections: Connection[] }>('/connections')
  const { data: catalogData } = useApi<{ systems: SystemType[] }>('/connections/catalog')
  const [tab, setTab] = useState<'active' | 'catalog' | 'pending'>('active')
  const [showDialog, setShowDialog] = useState(false)
  const [editing, setEditing] = useState<Connection | null>(null)
  const [systemType, setSystemType] = useState<string>('odoo')
  const [name, setName] = useState('')
  const [configValues, setConfigValues] = useState<Record<string, string>>({})
  const [secretValues, setSecretValues] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [testBanner, setTestBanner] = useState<{ id: string; ok: boolean; message: string } | null>(null)

  const connections = data?.connections ?? []
  const systems = catalogData?.systems ?? []
  const catalogById = useMemo(() => Object.fromEntries(systems.map((s) => [s.id, s])), [systems])

  const activeList = connections.filter((c) => c.status !== 'pending')
  const pendingList = connections.filter((c) => c.status === 'pending')

  const selectedSystem = catalogById[systemType]

  const openCreate = (typeId?: string) => {
    setEditing(null)
    const tid = typeId ?? systems[0]?.id ?? 'odoo'
    setSystemType(tid)
    setName('')
    setConfigValues({})
    setSecretValues({})
    setShowDialog(true)
    setTab('active')
  }

  const openEdit = (conn: Connection) => {
    setEditing(conn)
    setSystemType(conn.systemType)
    setName(conn.name)
    const cfg: Record<string, string> = {}
    for (const [k, v] of Object.entries(conn.config ?? {})) {
      cfg[k] = v == null ? '' : String(v)
    }
    setConfigValues(cfg)
    setSecretValues({})
    setShowDialog(true)
  }

  const handleSave = useCallback(async () => {
    if (!name.trim() || !systemType) return
    setSaving(true)
    try {
      const config: Record<string, string> = {}
      for (const [k, v] of Object.entries(configValues)) {
        if (v.trim()) config[k] = v.trim()
      }
      const secrets: Record<string, string> = {}
      for (const [k, v] of Object.entries(secretValues)) {
        if (v.trim()) secrets[k] = v.trim()
      }
      if (editing) {
        await api.put(`/connections/${editing.id}`, {
          name: name.trim(),
          config,
          secrets: Object.keys(secrets).length ? secrets : undefined,
        })
      } else {
        await api.post('/connections', {
          name: name.trim(),
          systemType,
          config,
          secrets: Object.keys(secrets).length ? secrets : undefined,
          scope: { default: true },
        })
      }
      setShowDialog(false)
      refetch()
    } finally {
      setSaving(false)
    }
  }, [name, systemType, configValues, secretValues, editing, refetch])

  const handleDelete = useCallback(async (id: string) => {
    setBusyId(id)
    try {
      await api.delete(`/connections/${id}`)
      refetch()
    } finally {
      setBusyId(null)
    }
  }, [refetch])

  const handleTest = useCallback(async (id: string) => {
    setBusyId(id)
    setTestBanner(null)
    try {
      const res = await api.post<{ result: { ok: boolean; message?: string } }>(`/connections/${id}/test`, {})
      setTestBanner({
        id,
        ok: !!res.result?.ok,
        message: res.result?.message ?? (res.result?.ok ? t('connections.testOk') : t('connections.testFail')),
      })
      refetch()
    } catch (err: any) {
      setTestBanner({ id, ok: false, message: err?.message ?? t('connections.testFail') })
    } finally {
      setBusyId(null)
    }
  }, [refetch])

  const handleApprove = useCallback(async (id: string) => {
    setBusyId(id)
    try {
      await api.post(`/connections/${id}/approve`, {})
      refetch()
    } finally {
      setBusyId(null)
    }
  }, [refetch])

  const handleReject = useCallback(async (id: string) => {
    setBusyId(id)
    try {
      await api.post(`/connections/${id}/reject`, {})
      refetch()
    } finally {
      setBusyId(null)
    }
  }, [refetch])

  const renderRow = (conn: Connection, opts?: { pending?: boolean }) => {
    const sys = catalogById[conn.systemType]
    const busy = busyId === conn.id
    return (
      <div
        key={conn.id}
        className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-lg leading-none">{sys?.icon ?? '🔗'}</span>
              <h3 className="font-medium text-sm truncate">{conn.name}</h3>
              <Badge variant="outline" className={`text-[10px] ${statusStyles[conn.status] ?? ''}`}>
                {t(`connections.status.${conn.status}` as any) || conn.status}
              </Badge>
              <Badge variant="secondary" className="text-[10px]">{conn.systemType}</Badge>
              <Badge variant="outline" className="text-[10px]">{conn.adapter}</Badge>
            </div>
            {conn.reason && (
              <p className="text-xs text-muted-foreground mt-1">{conn.reason}</p>
            )}
            {conn.health?.lastError && conn.status === 'error' && (
              <p className="text-xs text-red-400 mt-1">{conn.health.lastError}</p>
            )}
            {testBanner?.id === conn.id && (
              <p className={`text-xs mt-1 ${testBanner.ok ? 'text-emerald-500' : 'text-red-400'}`}>
                {testBanner.message}
              </p>
            )}
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            {opts?.pending ? (
              <>
                <Button size="sm" variant="default" disabled={busy} onClick={() => handleApprove(conn.id)}>
                  {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                  <span className="ml-1">{t('connections.approve')}</span>
                </Button>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => handleReject(conn.id)}>
                  <XCircle className="h-3.5 w-3.5" />
                  <span className="ml-1">{t('connections.reject')}</span>
                </Button>
              </>
            ) : (
              <>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => handleTest(conn.id)}>
                  {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                  <span className="ml-1">{t('connections.test')}</span>
                </Button>
                <Button size="sm" variant="ghost" onClick={() => openEdit(conn)}>
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => handleDelete(conn.id)}>
                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="page-title flex items-center gap-2">
            <Plug className="h-5 w-5" />
            {t('connections.title')}
          </h1>
          <p className="text-sm text-muted-foreground">{t('connections.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          {connections.length > 0 && (
            <Badge variant="secondary" className="text-[10px]">
              {t('connections.count', { count: connections.length })}
            </Badge>
          )}
          <Link
            to="/mcp-settings"
            className="inline-flex items-center h-8 px-3 rounded-md border border-input bg-background text-sm hover:bg-accent/50"
          >
            <Cable className="h-4 w-4 mr-1" /> {t('connections.linkedMcp')}
          </Link>
          <Link
            to="/secrets"
            className="inline-flex items-center h-8 px-3 rounded-md border border-input bg-background text-sm hover:bg-accent/50"
          >
            <KeyRound className="h-4 w-4 mr-1" /> {t('connections.linkedSecrets')}
          </Link>
          <Button size="sm" onClick={() => openCreate()}>
            <Plus className="h-4 w-4 mr-1" /> {t('connections.add')}
          </Button>
        </div>
      </div>

      <div className="flex gap-1 mb-4 border-b border-border">
        {([
          ['active', t('connections.tab.active'), activeList.length],
          ['pending', t('connections.tab.pending'), pendingList.length],
          ['catalog', t('connections.tab.catalog'), systems.length],
        ] as const).map(([id, label, count]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`px-3 py-2 text-sm border-b-2 -mb-px transition-colors ${
              tab === id
                ? 'border-primary text-foreground font-medium'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {label}
            {count > 0 && (
              <span className="ml-1.5 text-[10px] text-muted-foreground">({count})</span>
            )}
          </button>
        ))}
      </div>

      {tab === 'active' && (
        <div className="flex flex-col gap-3">
          {activeList.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
              {t('connections.empty')}
            </div>
          ) : (
            activeList.map((c) => renderRow(c))
          )}
        </div>
      )}

      {tab === 'pending' && (
        <div className="flex flex-col gap-3">
          {pendingList.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
              {t('connections.emptyPending')}
            </div>
          ) : (
            pendingList.map((c) => renderRow(c, { pending: true }))
          )}
        </div>
      )}

      {tab === 'catalog' && (
        <div>
          <p className="text-sm text-muted-foreground mb-3">{t('connections.catalogIntro')}</p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {systems.map((s) => (
              <div key={s.id} className="rounded-lg border border-border bg-card p-4 flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-xl">{s.icon}</span>
                  <div>
                    <div className="font-medium text-sm">{s.name}</div>
                    <div className="text-[10px] text-muted-foreground">{s.adapter} · {s.category}</div>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground flex-1">{s.description}</p>
                <Button size="sm" variant="outline" onClick={() => openCreate(s.id)}>
                  <Store className="h-3.5 w-3.5 mr-1" />
                  {t('connections.useType')}
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editing ? t('connections.editTitle') : t('connections.createTitle')}
            </DialogTitle>
          </DialogHeader>

          <div className="flex flex-col gap-3 py-2">
            {!editing && (
              <div>
                <Label>{t('connections.pickSystem')}</Label>
                <select
                  className="mt-1 w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                  value={systemType}
                  onChange={(e) => {
                    setSystemType(e.target.value)
                    setConfigValues({})
                    setSecretValues({})
                  }}
                >
                  {systems.map((s) => (
                    <option key={s.id} value={s.id}>{s.icon} {s.name}</option>
                  ))}
                </select>
                {selectedSystem?.setupIntro && (
                  <p className="text-xs text-muted-foreground mt-1">{selectedSystem.setupIntro}</p>
                )}
              </div>
            )}

            <div>
              <Label>{t('connections.name')}</Label>
              <Input
                className="mt-1"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={selectedSystem ? `${selectedSystem.name} prod` : 'My connection'}
              />
            </div>

            {(selectedSystem?.configFields ?? []).map((f) => (
              <div key={f.name}>
                <Label>{f.label}{f.required ? ' *' : ''}</Label>
                <Input
                  className="mt-1"
                  value={configValues[f.name] ?? ''}
                  onChange={(e) => setConfigValues((prev) => ({ ...prev, [f.name]: e.target.value }))}
                  placeholder={f.placeholder}
                />
                {f.hint && <p className="text-[11px] text-muted-foreground mt-0.5">{f.hint}</p>}
              </div>
            ))}

            {(selectedSystem?.secretFields?.length ?? 0) > 0 && (
              <div className="rounded-md border border-border p-3 space-y-3">
                <div>
                  <Label className="text-sm">{t('connections.secrets')}</Label>
                  <p className="text-[11px] text-muted-foreground">{t('connections.secretsHint')}</p>
                </div>
                {selectedSystem!.secretFields.map((f) => (
                  <div key={f.name}>
                    <Label>{f.label}{f.required && !editing ? ' *' : ''}</Label>
                    <Input
                      className="mt-1"
                      type={f.sensitive ? 'password' : 'text'}
                      autoComplete="off"
                      value={secretValues[f.name] ?? ''}
                      onChange={(e) => setSecretValues((prev) => ({ ...prev, [f.name]: e.target.value }))}
                      placeholder={editing ? '••••••••' : f.placeholder}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)}>{t('connections.cancel')}</Button>
            <Button onClick={handleSave} disabled={saving || !name.trim()}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              {t('connections.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

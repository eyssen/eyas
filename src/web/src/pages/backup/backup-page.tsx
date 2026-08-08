// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { useState, useCallback } from 'react'
import { useApi } from '@/hooks/use-api'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  DatabaseBackup,
  Plus,
  RotateCcw,
  Loader2,
  Cloud,
  Trash2,
  Star,
  Plug,
} from 'lucide-react'
import { t } from './i18n'
import { ContextualHelp } from '@/components/docs/contextual-help'

interface Backup {
  id: string
  filename: string
  createdAt: string
  size?: number
  sizeBytes?: number
  paths: string[]
  eyasVersion?: string | null
}

interface Destination {
  id: string
  type: string
  name: string
  enabled: boolean
  settings: Record<string, string>
  secretRefs: Record<string, string>
  secretsConfigured?: Record<string, boolean>
}

interface DestType {
  type: string
  label: string
  settings: string[]
  secrets: string[]
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const EMPTY_FORM = {
  type: 's3' as string,
  name: '',
  settings: {} as Record<string, string>,
  secretRefs: {} as Record<string, string>,
}

export default function BackupPage() {
  const { data, refetch } = useApi<{ backups: Backup[] }>('/backup/list')
  const dests = useApi<{
    primaryDestinationId: string | null
    destinations: Destination[]
  }>('/backup/destinations')
  const types = useApi<{ types: DestType[] }>('/backup/destination-types')

  const [creating, setCreating] = useState(false)
  const [restoring, setRestoring] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [testing, setTesting] = useState<string | null>(null)

  const backups = data?.backups || []
  const destinations = dests.data?.destinations ?? []
  const primaryId = dests.data?.primaryDestinationId ?? null
  const typeMeta = types.data?.types ?? []
  const selectedType = typeMeta.find((x) => x.type === form.type)

  const handleCreate = useCallback(async () => {
    setCreating(true)
    setError(null)
    setNotice(null)
    try {
      const res = await api.post<{
        backup: Backup & { remoteUploads?: string[]; remoteWarning?: string }
      }>('/backup/create', {})
      if (res.backup.remoteWarning) {
        setNotice(res.backup.remoteWarning)
      } else if (res.backup.remoteUploads?.length) {
        setNotice(t('backup.remoteUploaded', { dest: res.backup.remoteUploads.join(', ') }))
      }
      refetch()
    } catch (e: any) {
      setError(e.message || t('backup.createFailed'))
    } finally {
      setCreating(false)
    }
  }, [refetch])

  const handleRestore = useCallback(async (id: string) => {
    if (!window.confirm(t('backup.restoreConfirm'))) return
    setRestoring(id)
    setError(null)
    try {
      await api.post(`/backup/${id}/restore`, {})
      refetch()
    } catch (e: any) {
      setError(e.message || t('backup.restoreFailed'))
    } finally {
      setRestoring(null)
    }
  }, [refetch])

  async function saveDestination() {
    setError(null)
    try {
      await api.post('/backup/destinations', {
        type: form.type,
        name: form.name || form.type,
        settings: form.settings,
        secretRefs: form.secretRefs,
        enabled: true,
      })
      setShowForm(false)
      setForm(EMPTY_FORM)
      dests.refetch()
    } catch (e: any) {
      setError(e.message || t('backup.destSaveFailed'))
    }
  }

  async function makePrimary(id: string) {
    await api.post(`/backup/destinations/${id}/primary`, {})
    dests.refetch()
  }

  async function clearPrimary() {
    await api.post('/backup/destinations/primary/clear', {})
    dests.refetch()
  }

  async function removeDest(id: string) {
    if (!window.confirm(t('backup.destDeleteConfirm'))) return
    await api.delete(`/backup/destinations/${id}`)
    dests.refetch()
  }

  async function testDest(id: string) {
    setTesting(id)
    setError(null)
    setNotice(null)
    try {
      const r = await api.post<{ ok: boolean; message: string }>(
        `/backup/destinations/${id}/test`,
        {},
      )
      if (r.ok) setNotice(r.message)
      else setError(r.message)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setTesting(null)
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="page-title inline-flex items-center gap-1.5">{t('backup.title')} <ContextualHelp helpId="admin.backup" /></h1>
          <p className="text-sm text-muted-foreground">{t('backup.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          {backups.length > 0 && (
            <Badge variant="secondary" className="text-[10px]">
              {t('backup.count', { count: backups.length })}
            </Badge>
          )}
          <Button size="sm" onClick={handleCreate} disabled={creating}>
            {creating ? (
              <Loader2 className="h-4 w-4 animate-spin mr-1" />
            ) : (
              <Plus className="h-4 w-4 mr-1" />
            )}
            {creating ? t('backup.creating') : t('backup.createBackup')}
          </Button>
        </div>
      </div>

      {error && <p className="text-sm text-destructive mb-4">{error}</p>}
      {notice && <p className="text-sm text-emerald-500 mb-4">{notice}</p>}

      <div className="glass-card p-3 mb-4 text-xs text-muted-foreground">
        <p className="font-medium text-foreground text-sm mb-1">{t('backup.restoreEmptyTitle')}</p>
        <p>{t('backup.restoreEmptySteps')}</p>
      </div>

      {/* Offsite destinations */}
      <div className="glass-card p-4 mb-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <Cloud className="h-4 w-4" />
            {t('backup.dest.heading')}
          </h2>
          <div className="flex gap-2">
            {primaryId && (
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => void clearPrimary()}>
                {t('backup.dest.localOnly')}
              </Button>
            )}
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setShowForm((v) => !v)}>
              <Plus className="h-3.5 w-3.5 mr-1" />
              {t('backup.dest.add')}
            </Button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground mb-3">{t('backup.dest.subtitle')}</p>

        {destinations.length === 0 && !showForm && (
          <p className="text-xs text-muted-foreground">{t('backup.dest.empty')}</p>
        )}

        <ul className="flex flex-col gap-2 mb-3">
          {destinations.map((d) => (
            <li
              key={d.id}
              className="flex flex-wrap items-center gap-2 rounded-lg bg-accent/25 px-3 py-2 text-sm"
            >
              <Badge variant="outline" className="text-[10px] uppercase">
                {d.type}
              </Badge>
              <span className="font-medium flex-1 min-w-[8rem]">{d.name}</span>
              {primaryId === d.id && (
                <Badge className="text-[10px] bg-amber-500/20 text-amber-300 border-0">
                  <Star className="h-3 w-3 mr-1" />
                  {t('backup.dest.primary')}
                </Badge>
              )}
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs"
                disabled={testing === d.id}
                onClick={() => void testDest(d.id)}
              >
                {testing === d.id ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Plug className="h-3.5 w-3.5" />
                )}
              </Button>
              {primaryId !== d.id && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs"
                  onClick={() => void makePrimary(d.id)}
                >
                  {t('backup.dest.setPrimary')}
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs text-destructive"
                onClick={() => void removeDest(d.id)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </li>
          ))}
        </ul>

        {showForm && selectedType && (
          <div className="border border-border/50 rounded-lg p-3 space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-[10px]">{t('backup.dest.type')}</Label>
                <select
                  className="w-full h-8 rounded-md border border-border bg-background px-2 text-xs mt-1"
                  value={form.type}
                  onChange={(e) =>
                    setForm({ type: e.target.value, name: '', settings: {}, secretRefs: {} })
                  }
                >
                  {typeMeta.map((tp) => (
                    <option key={tp.type} value={tp.type}>
                      {tp.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label className="text-[10px]">{t('backup.dest.name')}</Label>
                <Input
                  className="h-8 text-xs mt-1"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder={selectedType.label}
                />
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground">{t('backup.dest.settingsHint')}</p>
            <div className="grid grid-cols-2 gap-2">
              {selectedType.settings.map((key) => (
                <div key={key}>
                  <Label className="text-[10px] font-mono">{key}</Label>
                  <Input
                    className="h-8 text-xs mt-1 font-mono"
                    value={form.settings[key] ?? ''}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        settings: { ...form.settings, [key]: e.target.value },
                      })
                    }
                    placeholder={key === 'port' ? '21 / 22' : key}
                  />
                </div>
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground">{t('backup.dest.secretsHint')}</p>
            <div className="grid grid-cols-2 gap-2">
              {selectedType.secrets.map((key) => (
                <div key={key}>
                  <Label className="text-[10px] font-mono">{key} → env</Label>
                  <Input
                    className="h-8 text-xs mt-1 font-mono"
                    value={form.secretRefs[key] ?? ''}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        secretRefs: { ...form.secretRefs, [key]: e.target.value },
                      })
                    }
                    placeholder={
                      key === 'accessKeyId'
                        ? 'BACKUP_S3_ACCESS_KEY'
                        : key === 'accessToken'
                          ? 'BACKUP_DROPBOX_TOKEN'
                          : `BACKUP_${key.toUpperCase()}`
                    }
                  />
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <Button size="sm" className="h-8 text-xs" onClick={() => void saveDestination()}>
                {t('backup.dest.save')}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-8 text-xs"
                onClick={() => setShowForm(false)}
              >
                {t('common.cancel')}
              </Button>
            </div>
          </div>
        )}
      </div>

      {backups.length === 0 ? (
        <div className="glass-card p-12 text-center">
          <DatabaseBackup className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">{t('backup.empty')}</p>
          <p className="text-xs text-muted-foreground mt-1">{t('backup.emptyHint')}</p>
        </div>
      ) : (
        <div className="glass-card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--vibrancy-border)]">
                <th className="text-left p-3 section-label">{t('backup.colFilename')}</th>
                <th className="text-left p-3 section-label">{t('backup.colVersion')}</th>
                <th className="text-left p-3 section-label">{t('backup.colCreated')}</th>
                <th className="text-left p-3 section-label">{t('backup.colSize')}</th>
                <th className="text-right p-3 section-label">{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {backups.map((b) => (
                <tr key={b.id} className="border-b border-[var(--vibrancy-border)] last:border-0">
                  <td className="p-3 font-mono text-xs">{b.filename}</td>
                  <td className="p-3">
                    {b.eyasVersion ? (
                      <Badge variant="outline" className="font-mono text-[10px]">
                        {b.eyasVersion}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground text-xs">—</span>
                    )}
                  </td>
                  <td className="p-3 text-muted-foreground">
                    {new Date(b.createdAt).toLocaleString()}
                  </td>
                  <td className="p-3 text-muted-foreground">
                    {formatSize(b.sizeBytes ?? b.size ?? 0)}
                  </td>
                  <td className="p-3 text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleRestore(b.id)}
                      disabled={restoring === b.id}
                      className="text-xs"
                    >
                      {restoring === b.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                      ) : (
                        <RotateCcw className="h-3.5 w-3.5 mr-1" />
                      )}
                      {t('backup.restore')}
                    </Button>
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

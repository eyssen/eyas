import { useState } from 'react'
import { useApi } from '@/hooks/use-api'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { HardDrive, Cloud, BarChart2, CheckCircle2, AlertCircle, Clock, Eye, EyeOff } from 'lucide-react'
import { t } from './i18n'
import { ContextualHelp } from '@/components/docs/contextual-help'

interface DocumentStats {
  totalFiles: number
  totalSizeBytes: number
  localFiles: number
  localSizeBytes: number
  syncStatus: {
    synced: number
    pending: number
    error: number
    not_configured: number
  }
  topMimeTypes: Array<{ mimeType: string; count: number; totalSize: number }>
}

interface Secret {
  id: string
  name: string
  scope: string
  module: string | null
  createdAt: string
}

const S3_SECRET_KEYS = ['s3-endpoint', 's3-bucket', 's3-region', 's3-access-key', 's3-secret-key'] as const

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

function formatMimeType(mime: string): string {
  const map: Record<string, string> = {
    'application/pdf': 'PDF',
    'image/jpeg': 'JPEG',
    'image/png': 'PNG',
    'image/gif': 'GIF',
    'image/webp': 'WebP',
    'text/plain': 'Text',
    'text/html': 'HTML',
    'text/markdown': 'Markdown',
    'application/json': 'JSON',
    'application/msword': 'Word',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'DOCX',
    'application/vnd.ms-excel': 'Excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'XLSX',
    'video/mp4': 'MP4',
    'audio/mpeg': 'MP3',
  }
  return map[mime] ?? mime.split('/')[1] ?? mime
}

export default function DocumentsSettings() {
  const { data: stats, isLoading: statsLoading } = useApi<DocumentStats>('/documents/stats')
  const { data: secretsData, refetch: refetchSecrets } = useApi<{ secrets: Secret[] }>('/secrets?scope=system')

  const [endpoint, setEndpoint] = useState('')
  const [bucket, setBucket] = useState('')
  const [region, setRegion] = useState('')
  const [accessKey, setAccessKey] = useState('')
  const [secretKey, setSecretKey] = useState('')
  const [showAccessKey, setShowAccessKey] = useState(false)
  const [showSecretKey, setShowSecretKey] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)

  const existingSecrets = secretsData?.secrets ?? []
  const configuredKeys = new Set(existingSecrets.map((s) => s.name).filter((n) => S3_SECRET_KEYS.includes(n as any)))
  const isConfigured = S3_SECRET_KEYS.every((k) => configuredKeys.has(k))
  const isPartiallyConfigured = configuredKeys.size > 0 && !isConfigured

  const handleSaveS3 = async () => {
    const entries: Array<{ name: string; value: string }> = [
      { name: 's3-endpoint', value: endpoint },
      { name: 's3-bucket', value: bucket },
      { name: 's3-region', value: region },
      { name: 's3-access-key', value: accessKey },
      { name: 's3-secret-key', value: secretKey },
    ].filter((e) => e.value.trim() !== '')

    if (entries.length === 0) return

    setSaving(true)
    setSaveSuccess(false)
    try {
      await Promise.all(
        entries.map((e) => api.post('/secrets', { name: e.name, scope: 'system', value: e.value }))
      )
      setEndpoint('')
      setBucket('')
      setRegion('')
      setAccessKey('')
      setSecretKey('')
      setSaveSuccess(true)
      refetchSecrets()
      setTimeout(() => setSaveSuccess(false), 3000)
    } finally {
      setSaving(false)
    }
  }

  const maxMimeCount = stats?.topMimeTypes?.[0]?.count ?? 1

  return (
    <div>
      <div className="mb-5">
        <h1 className="page-title">{t('documents.title')} <ContextualHelp helpId="knowledge.documents" /></h1>
        <p className="text-sm text-muted-foreground">{t('documents.settings.subtitle')}</p>
      </div>

      {/* Section 1: Storage Statistics */}
      <Card className="glass-card mb-4">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold">
            <BarChart2 className="h-4 w-4 text-muted-foreground" />
            {t('documents.settings.stats')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {statsLoading ? (
            <p className="text-sm text-muted-foreground">{t('documents.settings.loadingStats')}</p>
          ) : stats ? (
            <div className="space-y-4">
              {/* Top-level stats */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-lg bg-[var(--vibrancy-surface)] p-3">
                  <p className="section-label mb-1">{t('documents.settings.totalFiles')}</p>
                  <p className="text-xl font-semibold tabular-nums">{stats.totalFiles.toLocaleString()}</p>
                  <p className="text-xs text-muted-foreground">{formatBytes(stats.totalSizeBytes)}</p>
                </div>
                <div className="rounded-lg bg-[var(--vibrancy-surface)] p-3">
                  <p className="section-label mb-1">{t('documents.settings.local')}</p>
                  <p className="text-xl font-semibold tabular-nums">{stats.localFiles.toLocaleString()}</p>
                  <p className="text-xs text-muted-foreground">{formatBytes(stats.localSizeBytes)}</p>
                </div>
                <div className="rounded-lg bg-[var(--vibrancy-surface)] p-3">
                  <p className="section-label mb-1">{t('documents.settings.synced')}</p>
                  <p className="text-xl font-semibold tabular-nums text-green-500">{stats.syncStatus.synced.toLocaleString()}</p>
                  <p className="text-xs text-muted-foreground">{t('documents.settings.pendingCount', { count: stats.syncStatus.pending })}</p>
                </div>
                <div className="rounded-lg bg-[var(--vibrancy-surface)] p-3">
                  <p className="section-label mb-1">{t('documents.settings.errors')}</p>
                  <p className="text-xl font-semibold tabular-nums text-destructive">{stats.syncStatus.error.toLocaleString()}</p>
                  <p className="text-xs text-muted-foreground">{t('documents.settings.notConfiguredCount', { count: stats.syncStatus.not_configured })}</p>
                </div>
              </div>

              {/* Sync status row */}
              <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                <span className="flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5 text-green-500" /> {t('documents.settings.syncedCount', { count: stats.syncStatus.synced })}</span>
                <span className="flex items-center gap-1"><Clock className="h-3.5 w-3.5 text-amber-500" /> {t('documents.settings.pendingCount', { count: stats.syncStatus.pending })}</span>
                <span className="flex items-center gap-1"><AlertCircle className="h-3.5 w-3.5 text-destructive" /> {t('documents.settings.errorsCount', { count: stats.syncStatus.error })}</span>
              </div>

              {/* Top MIME types */}
              {stats.topMimeTypes.length > 0 && (
                <div>
                  <p className="section-label mb-2">{t('documents.settings.topFileTypes')}</p>
                  <div className="space-y-1.5">
                    {stats.topMimeTypes.slice(0, 6).map((m) => (
                      <div key={m.mimeType} className="flex items-center gap-2">
                        <span className="w-14 text-right text-xs text-muted-foreground shrink-0">{formatMimeType(m.mimeType)}</span>
                        <div className="flex-1 rounded-full bg-[var(--vibrancy-border)] overflow-hidden h-2">
                          <div
                            className="h-2 rounded-full bg-primary/60"
                            style={{ width: `${(m.count / maxMimeCount) * 100}%` }}
                          />
                        </div>
                        <span className="w-8 text-xs text-muted-foreground tabular-nums">{m.count}</span>
                        <span className="w-14 text-xs text-muted-foreground text-right">{formatBytes(m.totalSize)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t('documents.settings.noData')}</p>
          )}
        </CardContent>
      </Card>

      {/* Section 2: Local Storage */}
      <Card className="glass-card mb-4">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold">
            <HardDrive className="h-4 w-4 text-muted-foreground" />
            {t('documents.settings.localStorage')}
          </CardTitle>
          <CardDescription className="text-xs">{t('documents.settings.localStorageDesc')}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="section-label">{t('documents.settings.storageDir')}</Label>
              <Input
                value="data/documents"
                readOnly
                className="font-mono text-xs bg-[var(--vibrancy-surface)] text-muted-foreground"
              />
              <p className="text-xs text-muted-foreground">{t('documents.settings.storageDirHint')}</p>
            </div>
            {stats && (
              <div className="flex items-center gap-4 text-sm">
                <span className="text-muted-foreground">{t('documents.settings.filesCount', { count: stats.localFiles.toLocaleString() })}</span>
                <span className="text-muted-foreground">·</span>
                <span className="text-muted-foreground">{t('documents.settings.usedCount', { count: formatBytes(stats.localSizeBytes) })}</span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Section 3: S3 Remote Storage */}
      <Card className="glass-card">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                <Cloud className="h-4 w-4 text-muted-foreground" />
                {t('documents.settings.s3')}
              </CardTitle>
              <CardDescription className="text-xs mt-0.5">{t('documents.settings.s3Desc')}</CardDescription>
            </div>
            <Badge
              variant={isConfigured ? 'default' : isPartiallyConfigured ? 'secondary' : 'outline'}
              className="text-[10px] shrink-0"
            >
              {isConfigured ? t('documents.settings.configured') : isPartiallyConfigured ? t('documents.settings.partial') : t('documents.settings.notConfigured')}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {/* Current configured keys */}
            {configuredKeys.size > 0 && (
              <div className="rounded-lg bg-[var(--vibrancy-surface)] p-3 space-y-1.5">
                <p className="section-label">{t('documents.settings.storedCredentials')}</p>
                <div className="flex flex-wrap gap-1.5">
                  {S3_SECRET_KEYS.map((k) => (
                    <div key={k} className="flex items-center gap-1 text-xs">
                      {configuredKeys.has(k) ? (
                        <CheckCircle2 className="h-3 w-3 text-green-500" />
                      ) : (
                        <AlertCircle className="h-3 w-3 text-amber-500" />
                      )}
                      <span className={configuredKeys.has(k) ? 'text-foreground' : 'text-muted-foreground'}>{k}</span>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">{t('documents.settings.updateCredentialHint')}</p>
              </div>
            )}

            {/* Input fields */}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>{t('documents.settings.endpointUrl')}</Label>
                <Input
                  placeholder="https://s3.amazonaws.com"
                  value={endpoint}
                  onChange={(e) => setEndpoint(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>{t('documents.settings.bucketName')}</Label>
                <Input
                  placeholder="my-documents-bucket"
                  value={bucket}
                  onChange={(e) => setBucket(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>{t('documents.settings.region')}</Label>
                <Input
                  placeholder="us-east-1"
                  value={region}
                  onChange={(e) => setRegion(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>{t('documents.settings.accessKey')}</Label>
                <div className="relative">
                  <Input
                    type={showAccessKey ? 'text' : 'password'}
                    placeholder={configuredKeys.has('s3-access-key') ? '••••••••' : 'AKIAIOSFODNN7EXAMPLE'}
                    value={accessKey}
                    onChange={(e) => setAccessKey(e.target.value)}
                    className="pr-9"
                  />
                  <button
                    type="button"
                    onClick={() => setShowAccessKey((v) => !v)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    tabIndex={-1}
                  >
                    {showAccessKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>{t('documents.settings.secretKey')}</Label>
                <div className="relative">
                  <Input
                    type={showSecretKey ? 'text' : 'password'}
                    placeholder={configuredKeys.has('s3-secret-key') ? '••••••••' : 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY'}
                    value={secretKey}
                    onChange={(e) => setSecretKey(e.target.value)}
                    className="pr-9"
                  />
                  <button
                    type="button"
                    onClick={() => setShowSecretKey((v) => !v)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    tabIndex={-1}
                  >
                    {showSecretKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Button
                size="sm"
                onClick={handleSaveS3}
                disabled={saving || (!endpoint && !bucket && !region && !accessKey && !secretKey)}
              >
                {saving ? t('documents.settings.saving') : t('documents.settings.saveCredentials')}
              </Button>
              {saveSuccess && (
                <span className="flex items-center gap-1 text-xs text-green-500">
                  <CheckCircle2 className="h-3.5 w-3.5" /> {t('documents.settings.saved')}
                </span>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

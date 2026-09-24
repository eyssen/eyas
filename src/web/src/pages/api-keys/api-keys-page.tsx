// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { useState, useCallback } from 'react'
import { useApi } from '@/hooks/use-api'
import { api } from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  KeyRound,
  Plus,
  Trash2,
  Copy,
  Check,
  AlertTriangle,
} from 'lucide-react'
import { t } from './i18n'
import { ContextualHelp } from '@/components/docs/contextual-help'

interface ApiKey {
  id: string
  name: string
  keyPrefix: string
  lastUsedAt: string | null
  expiresAt: string | null
  createdAt: string
}

interface NewApiKey extends ApiKey {
  key: string
}

export default function ApiKeysPage() {
  const { data, isLoading, error, refetch } = useApi<{ apiKeys: ApiKey[] }>('/api-keys')
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [expiresInDays, setExpiresInDays] = useState('')
  const [newKey, setNewKey] = useState<NewApiKey | null>(null)
  const [copied, setCopied] = useState(false)
  const [deleteInProgress, setDeleteInProgress] = useState<string | null>(null)

  const apiKeys = data?.apiKeys ?? []

  const handleCreate = useCallback(async () => {
    if (!name.trim()) return
    try {
      const result = await api.post<{ apiKey: NewApiKey }>('/api-keys', {
        name: name.trim(),
        expiresInDays: expiresInDays ? parseInt(expiresInDays, 10) : undefined,
      })
      setNewKey(result.apiKey)
      setName('')
      setExpiresInDays('')
      setCreating(false)
      refetch()
    } catch (err) {
      console.error('Failed to create API key:', err)
    }
  }, [name, expiresInDays, refetch])

  const handleDelete = useCallback(async (id: string) => {
    if (!confirm(t('apiKeys.revokeConfirm'))) return
    setDeleteInProgress(id)
    try {
      await api.delete(`/api-keys/${id}`)
      refetch()
    } finally {
      setDeleteInProgress(null)
    }
  }, [refetch])

  const handleCopy = useCallback(async (key: string) => {
    await navigator.clipboard.writeText(key)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [])

  return (
    <div>
      <div className="flex items-baseline justify-between mb-5">
        <div>
          <h1 className="page-title inline-flex items-center gap-1.5">{t('apiKeys.title')} <ContextualHelp helpId="admin.secrets" /></h1>
          <p className="text-sm text-muted-foreground">
            {t('apiKeys.subtitle')}
          </p>
        </div>
        <Button size="sm" onClick={() => setCreating(!creating)}>
          <Plus className="h-3.5 w-3.5 mr-1" />
          {t('apiKeys.create')}
        </Button>
      </div>

      {/* New key banner */}
      {newKey && (
        <div className="glass-card p-4 mb-4 border-emerald-500/30">
          <div className="flex items-start gap-3">
            <div className="h-8 w-8 rounded-lg bg-emerald-500/20 flex items-center justify-center flex-shrink-0">
              <KeyRound className="h-4 w-4 text-emerald-400" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium mb-1">{t('apiKeys.createdBanner', { name: newKey.name })}</div>
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-500 flex-shrink-0" />
                <span className="text-xs text-amber-500">
                  {t('apiKeys.copyWarning')}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-xs font-mono bg-accent/50 px-3 py-2 rounded-md break-all select-all">
                  {newKey.key}
                </code>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 p-0 flex-shrink-0"
                  onClick={() => handleCopy(newKey.key)}
                >
                  {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                </Button>
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="flex-shrink-0"
              onClick={() => setNewKey(null)}
            >
              {t('apiKeys.dismiss')}
            </Button>
          </div>
        </div>
      )}

      {/* Create form */}
      {creating && (
        <div className="glass-card p-4 mb-4 flex flex-col gap-3">
          <input
            className="bg-transparent border border-border-primary rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            placeholder={t('apiKeys.namePlaceholder')}
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
          <input
            className="bg-transparent border border-border-primary rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            placeholder={t('apiKeys.expiresPlaceholder')}
            type="number"
            min="1"
            value={expiresInDays}
            onChange={(e) => setExpiresInDays(e.target.value)}
          />
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" size="sm" onClick={() => setCreating(false)}>
              {t('common.cancel')}
            </Button>
            <Button size="sm" onClick={handleCreate} disabled={!name.trim()}>
              {t('common.create')}
            </Button>
          </div>
        </div>
      )}

      {/* Keys table */}
      <div className="glass-card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--vibrancy-border)]">
              <th className="text-left p-3 section-label">{t('common.name')}</th>
              <th className="text-left p-3 section-label">{t('apiKeys.colKeyPrefix')}</th>
              <th className="text-left p-3 section-label">{t('apiKeys.colCreated')}</th>
              <th className="text-left p-3 section-label">{t('apiKeys.colLastUsed')}</th>
              <th className="text-left p-3 section-label">{t('apiKeys.colExpires')}</th>
              <th className="text-right p-3 section-label"></th>
            </tr>
          </thead>
          <tbody>
            {apiKeys.length === 0 && !isLoading && (
              <tr>
                <td colSpan={6} className="p-8 text-center text-muted-foreground text-sm">
                  {t('apiKeys.empty')}
                </td>
              </tr>
            )}
            {apiKeys.map((k) => (
              <tr key={k.id} className="border-b border-[var(--vibrancy-border)] last:border-0">
                <td className="p-3 font-medium">{k.name}</td>
                <td className="p-3">
                  <code className="text-xs font-mono bg-accent/50 px-1.5 py-0.5 rounded">{k.keyPrefix}...</code>
                </td>
                <td className="p-3 text-muted-foreground text-xs">
                  {new Date(k.createdAt).toLocaleDateString()}
                </td>
                <td className="p-3 text-xs">
                  {k.lastUsedAt ? (
                    <span className="text-muted-foreground">{new Date(k.lastUsedAt).toLocaleDateString()}</span>
                  ) : (
                    <span className="text-muted-foreground italic">{t('apiKeys.never')}</span>
                  )}
                </td>
                <td className="p-3 text-xs">
                  {k.expiresAt ? (
                    <span className={new Date(k.expiresAt) < new Date() ? 'text-red-500' : 'text-muted-foreground'}>
                      {new Date(k.expiresAt).toLocaleDateString()}
                    </span>
                  ) : (
                    <Badge variant="outline" className="text-[10px]">{t('apiKeys.noExpiry')}</Badge>
                  )}
                </td>
                <td className="p-3 text-right">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 text-red-500 hover:text-red-400 hover:bg-red-500/10"
                    onClick={() => handleDelete(k.id)}
                    disabled={deleteInProgress === k.id}
                    title={t('apiKeys.revokeTitle')}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {isLoading && (
        <p className="text-sm text-muted-foreground mt-4">{t('apiKeys.loading')}</p>
      )}
      {error && (
        <p className="text-sm text-destructive mt-4">{t('apiKeys.loadFailed', { message: error.message })}</p>
      )}
    </div>
  )
}

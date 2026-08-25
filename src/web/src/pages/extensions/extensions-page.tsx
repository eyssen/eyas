// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { useState, useCallback } from 'react'
import { useApi } from '@/hooks/use-api'
import { api } from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Puzzle,
  Download,
  ExternalLink,
  Trash2,
  ChevronDown,
  ChevronUp,
  ShieldAlert,
  Check,
  Power,
} from 'lucide-react'
import { t } from './i18n'
import { t as tc } from '@/i18n'

interface ExtensionPack {
  id: string
  name: string
  description: string
  version: string
  author: string
  license: string
  licenseCompat: 'mit-compatible' | 'copyleft' | 'proprietary' | 'unknown'
  licenseNotice: string
  installType: 'auto' | 'manual'
  downloadUrl: string
  skillCount: number
  categories: string[]
  icon?: string
  tags?: string[]
  setupGuide?: string
  status: string
}

interface InstalledExtension {
  id: string
  version: string
  enabled: boolean
  installedAt: string
}

interface PageInfo {
  title: { en: string; hu: string }
  description: { en: string; hu: string }
}

interface ExtensionsResponse {
  pageInfo: PageInfo
  extensions: { auto: ExtensionPack[]; manual: ExtensionPack[] }
  installed: InstalledExtension[]
}

const licenseColors: Record<string, string> = {
  'mit-compatible': 'text-emerald-500 border-emerald-500/30 bg-emerald-500/10',
  copyleft: 'text-amber-500 border-amber-500/30 bg-amber-500/10',
  proprietary: 'text-red-400 border-red-400/30 bg-red-400/10',
  unknown: 'text-zinc-400 border-zinc-400/30 bg-zinc-400/10',
}

export default function ExtensionsPage() {
  const { data, isLoading, error, refetch } = useApi<ExtensionsResponse>('/extensions')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [installing, setInstalling] = useState<string | null>(null)

  const installed = new Map((data?.installed ?? []).map((i) => [i.id, i]))

  const handleInstall = useCallback(
    async (id: string) => {
      setInstalling(id)
      try {
        await api.post(`/extensions/${id}/install`, { licenseAccepted: true })
        setConfirmId(null)
        refetch()
      } catch {
        // error shown via UI
      } finally {
        setInstalling(null)
      }
    },
    [refetch],
  )

  const handleUninstall = useCallback(
    async (id: string) => {
      await api.delete(`/extensions/${id}`)
      refetch()
    },
    [refetch],
  )

  const handleToggle = useCallback(
    async (id: string) => {
      await api.post(`/extensions/${id}/toggle`)
      refetch()
    },
    [refetch],
  )

  function renderCard(ext: ExtensionPack) {
    const inst = installed.get(ext.id)
    const expanded = expandedId === ext.id
    const confirming = confirmId === ext.id
    const isInstalling = installing === ext.id

    return (
      <div key={ext.id} className="glass-card p-4 flex flex-col gap-3">
        {/* Header */}
        <div className="flex items-start gap-3">
          <div className="text-2xl flex-shrink-0">{ext.icon || '📦'}</div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-medium text-sm">{ext.name}</span>
              <Badge variant="outline" className={`text-[10px] ${licenseColors[ext.licenseCompat]}`}>
                {ext.license}
              </Badge>
              {inst && (
                <Badge variant="outline" className="text-[10px] text-emerald-500 border-emerald-500/30">
                  <Check className="h-2.5 w-2.5 mr-0.5" />
                  {t('extensions.installed')}
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">{ext.description}</p>
            <div className="flex items-center gap-3 mt-1.5 text-[11px] text-muted-foreground">
              <span>v{ext.version}</span>
              <span>{t('extensions.by', { author: ext.author })}</span>
              {ext.skillCount > 0 && <span>{t('extensions.skills', { count: ext.skillCount })}</span>}
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {ext.installType === 'manual' ? (
              <a
                href={ext.downloadUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex"
              >
                <Button size="sm" variant="outline">
                  <ExternalLink className="h-3.5 w-3.5 mr-1" />
                  {t('extensions.github')}
                </Button>
              </a>
            ) : inst ? (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => handleToggle(ext.id)}
                  title={inst.enabled ? t('extensions.disable') : t('extensions.enable')}
                >
                  <Power className={`h-3.5 w-3.5 ${inst.enabled ? 'text-emerald-500' : 'text-muted-foreground'}`} />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-destructive hover:text-destructive"
                  onClick={() => handleUninstall(ext.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </>
            ) : (
              <Button
                size="sm"
                onClick={() => setConfirmId(ext.id)}
                disabled={isInstalling}
              >
                <Download className="h-3.5 w-3.5 mr-1" />
                {isInstalling ? t('extensions.installing') : t('extensions.install')}
              </Button>
            )}
          </div>
        </div>

        {/* Tags */}
        {ext.tags && ext.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {ext.tags.map((t) => (
              <Badge key={t} variant="secondary" className="text-[10px]">
                {t}
              </Badge>
            ))}
          </div>
        )}

        {/* License consent dialog */}
        {confirming && (
          <div className="border border-amber-500/30 bg-amber-500/5 rounded-lg p-3 mt-1">
            <div className="flex items-start gap-2 mb-2">
              <ShieldAlert className="h-4 w-4 text-amber-500 flex-shrink-0 mt-0.5" />
              <div>
                <span className="text-sm font-medium text-amber-500">{t('extensions.licenseNotice')}</span>
                <pre className="text-[11px] text-muted-foreground mt-1 whitespace-pre-wrap font-sans">
                  {ext.licenseNotice}
                </pre>
              </div>
            </div>
            <div className="flex gap-2 justify-end mt-2">
              <Button size="sm" variant="ghost" onClick={() => setConfirmId(null)}>
                {tc('common.cancel')}
              </Button>
              <Button
                size="sm"
                onClick={() => handleInstall(ext.id)}
                disabled={isInstalling}
              >
                {isInstalling ? t('extensions.installing') : t('extensions.acceptInstall')}
              </Button>
            </div>
          </div>
        )}

        {/* Expand: setup guide or license notice */}
        {(ext.setupGuide || ext.installType === 'manual') && (
          <button
            type="button"
            className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground self-start"
            onClick={() => setExpandedId(expanded ? null : ext.id)}
          >
            {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            {expanded ? t('extensions.hideDetails') : t('extensions.setupGuide')}
          </button>
        )}

        {expanded && ext.setupGuide && (
          <div className="text-[12px] text-muted-foreground bg-accent/30 rounded-md p-3 mt-1 overflow-x-auto whitespace-pre-wrap max-h-[400px] overflow-y-auto font-mono">
            {ext.setupGuide}
          </div>
        )}
      </div>
    )
  }

  const autoExts = data?.extensions.auto ?? []
  const manualExts = data?.extensions.manual ?? []

  return (
    <div>
      <div className="flex items-baseline justify-between mb-3">
        <div>
          <h1 className="page-title">{t('extensions.title')}</h1>
          <p className="text-sm text-muted-foreground max-w-2xl">
            {t('extensions.subtitle')}
          </p>
        </div>
        <span className="text-xs text-muted-foreground">
          <strong className="text-foreground">{installed.size}</strong> {t('extensions.installedSuffix')}
        </span>
      </div>

      {/* Auto-installable */}
      {autoExts.length > 0 && (
        <>
          <h2 className="text-sm font-medium mt-6 mb-3 flex items-center gap-2">
            <Download className="h-4 w-4 text-muted-foreground" />
            {t('extensions.autoInstallable')}
          </h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {autoExts.map(renderCard)}
          </div>
        </>
      )}

      {/* Manual third-party */}
      {manualExts.length > 0 && (
        <>
          <h2 className="text-sm font-medium mt-6 mb-3 flex items-center gap-2">
            <ExternalLink className="h-4 w-4 text-muted-foreground" />
            {t('extensions.thirdParty')}
          </h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {manualExts.map(renderCard)}
          </div>
        </>
      )}

      {isLoading && (
        <p className="text-sm text-muted-foreground mt-4">{t('extensions.loading')}</p>
      )}
      {error && (
        <p className="text-sm text-destructive mt-4">{t('extensions.loadError', { message: error.message })}</p>
      )}
    </div>
  )
}

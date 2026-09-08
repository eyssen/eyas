import { useState, useCallback, useEffect } from 'react'
import { useApi } from '@/hooks/use-api'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Cable, Plus, Trash2, RefreshCw, Pencil, Loader2, CheckCircle2, XCircle,
  Terminal, Globe, Radio, Wrench, BookOpen, MessageSquare, Store,
  Download, ExternalLink, Key, ChevronDown, ChevronUp, ShieldAlert,
} from 'lucide-react'
import { t } from './i18n'
import { t as tc } from '@/i18n'
import { ContextualHelp } from '@/components/docs/contextual-help'

// ── Types ─────────────────────────────────────

interface McpServer {
  id: string
  name: string
  transport: string
  url: string | null
  command: string | null
  args: string[] | null
  enabled: boolean
  autoStart: boolean
  status: string
  error: string | null
  authType?: string
  ownedBy?: string | null
  discoveredTools: string[]
  discoveredResources: string[]
  discoveredPrompts: string[]
  createdAt: string
  updatedAt: string
}

interface McpRegistryEntry {
  id: string
  name: string
  description: string
  tier: 'bundled' | 'one-click' | 'manual'
  license: string
  licenseCompat: 'mit-compatible' | 'copyleft' | 'proprietary' | 'unknown'
  author: string
  repoUrl: string
  transport: string
  command?: string
  args?: string[]
  envKeys?: string[]
  url?: string
  authType?: string
  category: string
  icon: string
  tags: string[]
  setupGuide?: string
}

interface ServerForm {
  name: string
  transport: 'stdio' | 'http' | 'sse'
  url: string
  command: string
  args: string
  apiKey: string
}

// ── Constants ─────────────────────────────────

const emptyForm: ServerForm = { name: '', transport: 'stdio', url: '', command: '', args: '', apiKey: '' }

const transportIcons: Record<string, typeof Terminal> = {
  stdio: Terminal,
  http: Globe,
  sse: Radio,
}

const tierColors: Record<string, string> = {
  bundled: 'text-emerald-500 border-emerald-500/30 bg-emerald-500/10',
  'one-click': 'text-blue-500 border-blue-500/30 bg-blue-500/10',
  manual: 'text-amber-500 border-amber-500/30 bg-amber-500/10',
}

const licenseColors: Record<string, string> = {
  'mit-compatible': 'text-emerald-500 border-emerald-500/30 bg-emerald-500/10',
  copyleft: 'text-amber-500 border-amber-500/30 bg-amber-500/10',
  proprietary: 'text-red-400 border-red-400/30 bg-red-400/10',
  unknown: 'text-zinc-400 border-zinc-400/30 bg-zinc-400/10',
}

const tierLabelKeys: Record<string, string> = {
  bundled: 'mcp.tier.bundled',
  'one-click': 'mcp.tier.oneClick',
  manual: 'mcp.tier.manual',
}

// ── Component ─────────────────────────────────

export default function McpSettingsPage() {
  const { data, refetch } = useApi<{ servers: McpServer[] }>('/mcp/servers')
  const { data: registryData } = useApi<{ servers: McpRegistryEntry[] }>('/mcp/registry')
  const [tab, setTab] = useState<'active' | 'catalog'>('active')
  const [showDialog, setShowDialog] = useState(false)
  const [editing, setEditing] = useState<McpServer | null>(null)
  const [form, setForm] = useState<ServerForm>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<{ id: string; ok: boolean; error?: string } | null>(null)
  const [connecting, setConnecting] = useState<string | null>(null)
  const [oauthError, setOauthError] = useState(false)

  // Catalog state
  const [installing, setInstalling] = useState<string | null>(null)
  const [envDialog, setEnvDialog] = useState<McpRegistryEntry | null>(null)
  const [envValues, setEnvValues] = useState<Record<string, string>>({})
  const [expandedGuide, setExpandedGuide] = useState<string | null>(null)
  const [categoryFilter, setCategoryFilter] = useState<string>('all')

  const servers = data?.servers ?? []
  const registry = registryData?.servers ?? []
  const connectedCount = servers.filter(s => s.status === 'connected').length
  const installedNames = new Set(servers.map(s => s.name))

  const categories = ['all', ...new Set(registry.map(s => s.category))].sort()

  const filteredRegistry = categoryFilter === 'all'
    ? registry
    : registry.filter(s => s.category === categoryFilter)

  // ── Handlers: Active servers ──────────────────

  const openCreate = () => {
    setEditing(null)
    setForm(emptyForm)
    setShowDialog(true)
  }

  const openEdit = (s: McpServer) => {
    setEditing(s)
    setForm({
      name: s.name,
      transport: s.transport as ServerForm['transport'],
      url: s.url ?? '',
      command: s.command ?? '',
      args: s.args?.join(' ') ?? '',
      apiKey: '',
    })
    setShowDialog(true)
  }

  const handleSave = useCallback(async () => {
    setSaving(true)
    try {
      const body: Record<string, unknown> = {
        name: form.name,
        transport: form.transport,
      }
      if (form.transport === 'stdio') {
        body.command = form.command
        body.args = form.args ? form.args.split(/\s+/).filter(Boolean) : []
      } else {
        body.url = form.url
      }
      if (form.apiKey) body.apiKey = form.apiKey

      if (editing) {
        await api.put(`/mcp/servers/${editing.id}`, body)
      } else {
        await api.post('/mcp/servers', body)
      }
      setShowDialog(false)
      refetch()
    } finally {
      setSaving(false)
    }
  }, [form, editing, refetch])

  const handleDelete = useCallback(async (id: string) => {
    setDeleting(id)
    try {
      await api.delete(`/mcp/servers/${id}`)
      refetch()
    } finally {
      setDeleting(null)
    }
  }, [refetch])

  const handleRefresh = useCallback(async (id: string) => {
    setRefreshing(id)
    try {
      await api.post(`/mcp/servers/${id}/refresh`, {})
      refetch()
    } finally {
      setRefreshing(null)
    }
  }, [refetch])

  const handleTest = useCallback(async (id: string) => {
    setTestResult(null)
    try {
      const result = await api.post<{ ok: boolean; error?: string }>(`/mcp/servers/${id}/test`, {})
      setTestResult({ id, ...result })
    } catch {
      setTestResult({ id, ok: false, error: t('mcp.testFailed') })
    }
  }, [])

  const handleOAuthConnect = useCallback(async (id: string) => {
    setConnecting(id)
    try {
      const { url } = await api.post<{ url: string }>(`/mcp/servers/${id}/oauth/start`)
      window.location.assign(url)
    } catch {
      setTestResult({ id, ok: false, error: t('mcp.testFailed') })
      setConnecting(null)
    }
  }, [])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const oauth = params.get('oauth')
    if (oauth === 'ok') refetch()
    else if (oauth === 'error') setOauthError(true)
    if (oauth) {
      params.delete('oauth')
      const qs = params.toString()
      window.history.replaceState({}, '', `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash}`)
    }
  }, [refetch])

  // ── Handlers: Catalog install ─────────────────

  const handleCatalogInstall = useCallback(async (entry: McpRegistryEntry) => {
    if (entry.envKeys?.length) {
      setEnvValues(Object.fromEntries(entry.envKeys.map(k => [k, ''])))
      setEnvDialog(entry)
      return
    }
    setInstalling(entry.id)
    try {
      await api.post(`/mcp/registry/${entry.id}/install`, {})
      refetch()
    } finally {
      setInstalling(null)
    }
  }, [refetch])

  const handleEnvInstall = useCallback(async () => {
    if (!envDialog) return
    setInstalling(envDialog.id)
    try {
      await api.post(`/mcp/registry/${envDialog.id}/install`, { env: envValues })
      setEnvDialog(null)
      refetch()
    } finally {
      setInstalling(null)
    }
  }, [envDialog, envValues, refetch])

  // ── Render: Active servers tab ────────────────

  function renderActiveServers() {
    if (servers.length === 0) {
      return (
        <div className="glass-card p-12 text-center">
          <Cable className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">{t('mcp.noServers')}</p>
          <p className="text-xs text-muted-foreground mt-1">
            {t('mcp.noServersHint')}
          </p>
          <Button size="sm" variant="outline" className="mt-3" onClick={() => setTab('catalog')}>
            <Store className="h-3.5 w-3.5 mr-1" /> {t('mcp.browseCatalog')}
          </Button>
        </div>
      )
    }

    return (
      <div className="space-y-3">
        {servers.map((s) => {
          const TIcon = transportIcons[s.transport] ?? Globe
          const isConnected = s.status === 'connected'
          return (
            <div key={s.id} className="glass-card p-4">
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-2">
                  <TIcon className="h-4 w-4 text-muted-foreground" />
                  <span className="font-medium text-sm">{s.name}</span>
                  <span className={`h-2 w-2 rounded-full ${
                    isConnected ? 'bg-emerald-500' : s.status === 'error' ? 'bg-destructive' : 'bg-zinc-400'
                  }`} />
                  <Badge variant="outline" className="text-[10px]">{s.transport}</Badge>
                  {s.authType && s.authType !== 'none' && (
                    <Badge variant="outline" className="text-[10px]">
                      {s.authType === 'oauth' ? t('mcp.auth.oauth') : s.authType === 'bearer' ? t('mcp.auth.bearer') : t('mcp.auth.none')}
                    </Badge>
                  )}
                  {!s.enabled && <Badge variant="outline" className="text-[10px] text-muted-foreground">{t('mcp.disabled')}</Badge>}
                </div>
                <div className="flex gap-1">
                  <Button
                    variant="ghost" size="icon" className="h-7 w-7"
                    onClick={() => handleRefresh(s.id)}
                    disabled={refreshing === s.id}
                    title={tc('common.refresh')}
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${refreshing === s.id ? 'animate-spin' : ''}`} />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleTest(s.id)} title={t('mcp.test')}>
                    <CheckCircle2 className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(s)} title={tc('common.edit')}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost" size="icon"
                    className="h-7 w-7 text-destructive hover:text-destructive"
                    onClick={() => handleDelete(s.id)}
                    disabled={deleting === s.id}
                    title={tc('common.delete')}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>

              <p className="text-xs font-mono text-muted-foreground ml-6 mb-2">
                {s.transport === 'stdio' ? `${s.command} ${s.args?.join(' ') ?? ''}` : s.url}
              </p>

              {s.ownedBy === 'media' && (
                <p className="text-xs text-muted-foreground ml-6 mb-2">{t('mcp.oauth.managedByMedia')}</p>
              )}

              {s.authType === 'oauth' && (
                <div className="ml-6 mb-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleOAuthConnect(s.id)}
                    disabled={connecting === s.id}
                  >
                    {connecting === s.id ? (
                      <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                    ) : (
                      <Cable className="h-3.5 w-3.5 mr-1" />
                    )}
                    {s.name === 'magnific' || s.name === 'higgsfield'
                      ? t('mcp.oauth.connect')
                      : t('mcp.oauth.connectGeneric')}
                  </Button>
                </div>
              )}

              {s.error && (
                <p className="text-xs text-destructive ml-6 mb-2">{s.error}</p>
              )}

              {isConnected && (
                <div className="flex items-center gap-4 ml-6 text-xs text-muted-foreground">
                  {s.discoveredTools.length > 0 && (
                    <span className="flex items-center gap-1">
                      <Wrench className="h-3 w-3" /> {t('mcp.toolsCount', { count: s.discoveredTools.length })}
                    </span>
                  )}
                  {s.discoveredResources.length > 0 && (
                    <span className="flex items-center gap-1">
                      <BookOpen className="h-3 w-3" /> {t('mcp.resourcesCount', { count: s.discoveredResources.length })}
                    </span>
                  )}
                  {s.discoveredPrompts.length > 0 && (
                    <span className="flex items-center gap-1">
                      <MessageSquare className="h-3 w-3" /> {t('mcp.promptsCount', { count: s.discoveredPrompts.length })}
                    </span>
                  )}
                </div>
              )}

              {testResult?.id === s.id && (
                <div className={`flex items-center gap-1 ml-6 mt-1 text-xs ${testResult.ok ? 'text-emerald-500' : 'text-destructive'}`}>
                  {testResult.ok ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                  {testResult.ok ? t('mcp.connectionOk') : testResult.error}
                </div>
              )}
            </div>
          )
        })}
      </div>
    )
  }

  // ── Render: Catalog tab ───────────────────────

  function renderCatalog() {
    const tiers: Array<{ key: string; label: string; icon: typeof Download; entries: McpRegistryEntry[] }> = [
      {
        key: 'bundled',
        label: t('mcp.catalog.readyToUse'),
        icon: Download,
        entries: filteredRegistry.filter(s => s.tier === 'bundled'),
      },
      {
        key: 'one-click',
        label: t('mcp.catalog.oneClick'),
        icon: Key,
        entries: filteredRegistry.filter(s => s.tier === 'one-click'),
      },
      {
        key: 'manual',
        label: t('mcp.catalog.manual'),
        icon: ExternalLink,
        entries: filteredRegistry.filter(s => s.tier === 'manual'),
      },
    ]

    return (
      <div>
        {/* Category filter */}
        <div className="flex flex-wrap gap-1.5 mb-4">
          {categories.map(cat => (
            <button
              key={cat}
              type="button"
              className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors ${
                categoryFilter === cat
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-accent/30 text-muted-foreground border-transparent hover:bg-accent/50'
              }`}
              onClick={() => setCategoryFilter(cat)}
            >
              {cat === 'all' ? t('mcp.catalog.allWithCount', { count: registry.length }) : cat}
            </button>
          ))}
        </div>

        {tiers.map(({ key, label, icon: TierIcon, entries }) => entries.length > 0 && (
          <div key={key} className="mb-6">
            <h2 className="text-sm font-medium mb-3 flex items-center gap-2">
              <TierIcon className="h-4 w-4 text-muted-foreground" />
              {label}
              <Badge variant="secondary" className="text-[10px]">{entries.length}</Badge>
            </h2>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {entries.map(entry => {
                const isInstalled = installedNames.has(entry.id)
                const isExpanded = expandedGuide === entry.id
                return (
                  <div key={entry.id} className="glass-card p-4 flex flex-col gap-2">
                    {/* Header */}
                    <div className="flex items-start gap-3">
                      <div className="text-2xl flex-shrink-0">{entry.icon}</div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-sm">{entry.name}</span>
                          <Badge variant="outline" className={`text-[10px] ${licenseColors[entry.licenseCompat]}`}>
                            {entry.license}
                          </Badge>
                          <Badge variant="outline" className={`text-[10px] ${tierColors[entry.tier]}`}>
                            {t(tierLabelKeys[entry.tier])}
                          </Badge>
                          {isInstalled && (
                            <Badge variant="outline" className="text-[10px] text-emerald-500 border-emerald-500/30">
                              <CheckCircle2 className="h-2.5 w-2.5 mr-0.5" /> {tc('common.active')}
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">{entry.description}</p>
                        <div className="flex items-center gap-3 mt-1 text-[11px] text-muted-foreground">
                          <span>{t('mcp.by', { author: entry.author })}</span>
                          <span>{entry.transport}</span>
                          {entry.envKeys && (
                            <span className="flex items-center gap-0.5">
                              <Key className="h-2.5 w-2.5" />
                              {entry.envKeys.join(', ')}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        {entry.tier === 'manual' && !entry.url ? (
                          <a href={entry.repoUrl} target="_blank" rel="noopener noreferrer">
                            <Button size="sm" variant="outline">
                              <ExternalLink className="h-3.5 w-3.5 mr-1" /> {t('mcp.repo')}
                            </Button>
                          </a>
                        ) : isInstalled ? (
                          <Badge variant="outline" className="text-[10px] text-emerald-500">{t('mcp.installed')}</Badge>
                        ) : (
                          <Button
                            size="sm"
                            onClick={() => handleCatalogInstall(entry)}
                            disabled={installing === entry.id}
                          >
                            {installing === entry.id ? (
                              <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                            ) : (
                              <Download className="h-3.5 w-3.5 mr-1" />
                            )}
                            {t('mcp.install')}
                          </Button>
                        )}
                      </div>
                    </div>

                    {/* Tags */}
                    <div className="flex flex-wrap gap-1">
                      {entry.tags.map(t => (
                        <Badge key={t} variant="secondary" className="text-[10px]">{t}</Badge>
                      ))}
                    </div>

                    {/* Setup guide toggle */}
                    {entry.setupGuide && (
                      <>
                        <button
                          type="button"
                          className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground self-start"
                          onClick={() => setExpandedGuide(isExpanded ? null : entry.id)}
                        >
                          {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                          {isExpanded ? t('mcp.hideSetupGuide') : t('mcp.setupGuide')}
                        </button>
                        {isExpanded && (
                          <div className="text-[12px] text-muted-foreground bg-accent/30 rounded-md p-3 overflow-x-auto whitespace-pre-wrap max-h-[300px] overflow-y-auto font-mono">
                            {entry.setupGuide}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    )
  }

  // ── Main render ───────────────────────────────

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="page-title inline-flex items-center gap-1.5">{t('mcp.title')} <ContextualHelp helpId="ai.mcp" /></h1>
          <p className="text-sm text-muted-foreground">
            {t('mcp.subtitle')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {servers.length > 0 && (
            <Badge variant="secondary" className="text-[10px]">
              {t('mcp.connectedCount', { connected: connectedCount, total: servers.length })}
            </Badge>
          )}
          <Button size="sm" variant="outline" onClick={openCreate}>
            <Plus className="h-4 w-4 mr-1" /> {t('mcp.manual')}
          </Button>
        </div>
      </div>

      {/* Tab switcher */}
      <div className="flex gap-1 mb-4 p-0.5 bg-accent/30 rounded-lg w-fit">
        <button
          type="button"
          className={`text-xs px-3 py-1.5 rounded-md transition-colors ${
            tab === 'active' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
          }`}
          onClick={() => setTab('active')}
        >
          <Cable className="h-3.5 w-3.5 inline mr-1" />
          {t('mcp.tab.active', { count: servers.length })}
        </button>
        <button
          type="button"
          className={`text-xs px-3 py-1.5 rounded-md transition-colors ${
            tab === 'catalog' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
          }`}
          onClick={() => setTab('catalog')}
        >
          <Store className="h-3.5 w-3.5 inline mr-1" />
          {t('mcp.tab.catalog', { count: registry.length })}
        </button>
      </div>

      {oauthError && (
        <div className="flex items-center gap-1 mb-3 text-xs text-destructive">
          <XCircle className="h-3 w-3" />
          {tc('common.unknownError')}
        </div>
      )}

      {tab === 'active' ? renderActiveServers() : renderCatalog()}

      {/* Add / Edit dialog */}
      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? t('mcp.editServer') : t('mcp.addServer')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label>{t('mcp.field.name')}</Label>
              <Input placeholder={t('mcp.field.namePlaceholder')} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>{t('mcp.field.transport')}</Label>
              <Select value={form.transport} onValueChange={(v) => setForm({ ...form, transport: v as ServerForm['transport'] })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="stdio">{t('mcp.transport.stdio')}</SelectItem>
                  <SelectItem value="http">{t('mcp.transport.http')}</SelectItem>
                  <SelectItem value="sse">{t('mcp.transport.sse')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {form.transport === 'stdio' ? (
              <>
                <div className="space-y-1.5">
                  <Label>{t('mcp.field.command')}</Label>
                  <Input placeholder={t('mcp.field.commandPlaceholder')} value={form.command} onChange={(e) => setForm({ ...form, command: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>{t('mcp.field.arguments')}</Label>
                  <Input
                    placeholder={t('mcp.field.argsPlaceholder')}
                    value={form.args}
                    onChange={(e) => setForm({ ...form, args: e.target.value })}
                  />
                  <p className="text-xs text-muted-foreground">{t('mcp.field.argsHint')}</p>
                </div>
              </>
            ) : (
              <>
                <div className="space-y-1.5">
                  <Label>{t('mcp.field.url')}</Label>
                  <Input placeholder={t('mcp.field.urlPlaceholder')} value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>{t('mcp.field.apiKey')}</Label>
                  <Input type="password" placeholder={t('mcp.field.apiKeyPlaceholder')} value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} />
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button onClick={handleSave} disabled={saving || !form.name || (form.transport === 'stdio' ? !form.command : !form.url)}>
              {saving ? t('mcp.saving') : tc('common.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Env vars dialog for one-click install */}
      <Dialog open={!!envDialog} onOpenChange={() => setEnvDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              <span className="text-xl mr-2">{envDialog?.icon}</span>
              {t('mcp.configure', { name: envDialog?.name ?? '' })}
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{envDialog?.description}</p>
          <div className="space-y-3 py-2">
            {envDialog?.envKeys?.map(key => (
              <div key={key} className="space-y-1.5">
                <Label className="font-mono text-xs">{key}</Label>
                <Input
                  type="password"
                  placeholder={t('mcp.envPlaceholder', { key })}
                  value={envValues[key] ?? ''}
                  onChange={(e) => setEnvValues({ ...envValues, [key]: e.target.value })}
                />
              </div>
            ))}
          </div>
          {envDialog?.licenseCompat !== 'mit-compatible' && (
            <div className="flex items-start gap-2 p-3 bg-amber-500/5 border border-amber-500/20 rounded-lg">
              <ShieldAlert className="h-4 w-4 text-amber-500 flex-shrink-0 mt-0.5" />
              <p className="text-[11px] text-muted-foreground">
                {t('mcp.licenseNotice', { license: envDialog?.license ?? '' })}
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEnvDialog(null)}>{tc('common.cancel')}</Button>
            <Button
              onClick={handleEnvInstall}
              disabled={installing === envDialog?.id || !envDialog?.envKeys?.every(k => envValues[k])}
            >
              {installing === envDialog?.id ? (
                <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
              ) : (
                <Download className="h-3.5 w-3.5 mr-1" />
              )}
              {t('mcp.installConnect')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

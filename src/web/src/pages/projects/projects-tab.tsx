import { useState, useCallback, useMemo } from 'react'
import { Link } from '@tanstack/react-router'
import { useApi } from '@/hooks/use-api'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ProjectDesignSection } from './project-design-section'
import { Plus, Trash2, X, Pencil, Sparkles, BookOpen } from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import { ScopedPromptCoachDialog } from '@/components/prompt-coach'
import {
  WorkingDirectoriesEditor,
  emptyWorkingDirectory,
  namedWorkingDirectoriesFromRaw,
  payloadWorkingDirectories,
  type NamedWorkspace,
} from '@/components/working-directories-editor'
import { t as coachT } from '@/components/prompt-coach/i18n'
import { t, seedTypeName } from './i18n'

interface Agent {
  id: string
  name: string
  enabled: boolean
}

interface Project {
  id: string
  name: string
  typeId: string | null
  description: string | null
  prompt: string | null
  color: string | null
  defaultAgentId: string | null
  indexedSources: string[] | null
  workingDirectories: Array<string | NamedWorkspace> | null
  defaultConnectionId: string | null
  ticketConnectionId: string | null
  wikiAutoTickets?: boolean
  wikiAutoDecisions?: boolean
  wikiTicketBody?: 'title' | 'latest' | 'transcript'
  source?: 'seed' | 'user'
  createdAt: string
}

interface ProjectType {
  id: string
  name: string
  color: string | null
  prompt: string | null
  indexedSources: string[] | null
  workingDirectories: Array<string | NamedWorkspace> | null
}

interface SearchSourceItem {
  id: string
  name: string
  status: string
  config?: {
    label?: string
    version?: string
    edition?: string
    family?: string
  }
}

interface OdooConnection {
  id: string
  name: string
  systemType: string
  status: string
}

const NO_CONNECTION = 'none'

interface ProjectForm {
  id?: string
  name: string
  typeId: string
  description: string
  prompt: string
  color: string
  defaultAgentId: string
  indexedSourceIds: string[]
  workingDirectories: NamedWorkspace[]
  defaultConnectionId: string
  ticketConnectionId: string
  wikiAutoTickets: boolean
  wikiAutoDecisions: boolean
  wikiTicketBody: 'title' | 'latest' | 'transcript'
  source?: 'seed' | 'user'
}

const EMPTY_PROJECT: ProjectForm = {
  name: '', typeId: '', description: '', prompt: '', color: '', defaultAgentId: '', indexedSourceIds: [], workingDirectories: [emptyWorkingDirectory()],
  defaultConnectionId: '', ticketConnectionId: '',
  wikiAutoTickets: false, wikiAutoDecisions: false, wikiTicketBody: 'title',
}

export function ProjectsTab() {
  const { data, isLoading, error, refetch } = useApi<{ projects: Project[] }>('/projects')
  const { data: typesData } = useApi<{ projectTypes: ProjectType[] }>('/project-types')
  const { data: agentsData } = useApi<{ agents: Agent[] }>('/agents?enabled=true&tier=primary')
  const { data: sourcesData } = useApi<SearchSourceItem[] | { sources: SearchSourceItem[] }>('/search/sources')
  const { data: connectionsData } = useApi<{ connections: OdooConnection[] }>('/connections?systemType=odoo')
  const [editing, setEditing] = useState<ProjectForm | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [coachOpen, setCoachOpen] = useState(false)

  const projects = data?.projects ?? []
  const types = typesData?.projectTypes ?? []
  const agents = agentsData?.agents ?? []
  const searchSources = useMemo(() => {
    if (!sourcesData) return [] as SearchSourceItem[]
    if (Array.isArray(sourcesData)) return sourcesData
    return sourcesData.sources ?? []
  }, [sourcesData])
  const odooConnections = connectionsData?.connections ?? []

  const handleCreate = useCallback(() => {
    setEditing({ ...EMPTY_PROJECT, workingDirectories: [emptyWorkingDirectory()] })
  }, [])

  const handleEdit = useCallback((p: Project) => {
    setEditing({
      id: p.id,
      name: p.name,
      typeId: p.typeId ?? '',
      description: p.description ?? '',
      prompt: p.prompt ?? '',
      color: p.color ?? '',
      defaultAgentId: p.defaultAgentId ?? '',
      indexedSourceIds: p.indexedSources ?? [],
      workingDirectories: namedWorkingDirectoriesFromRaw(p.workingDirectories),
      defaultConnectionId: p.defaultConnectionId ?? '',
      ticketConnectionId: p.ticketConnectionId ?? '',
      wikiAutoTickets: !!p.wikiAutoTickets,
      wikiAutoDecisions: !!p.wikiAutoDecisions,
      wikiTicketBody: p.wikiTicketBody === 'latest' || p.wikiTicketBody === 'transcript' ? p.wikiTicketBody : 'title',
      source: p.source,
    })
  }, [])

  const handleSave = useCallback(async () => {
    if (!editing || !editing.name.trim() || !editing.defaultAgentId) return
    const dirs = payloadWorkingDirectories(editing.workingDirectories)
    if (dirs.length === 0) {
      setSaveError(t('projects.form.workingDirsRequired'))
      return
    }
    const payload = {
      name: editing.name.trim(),
      typeId: editing.typeId || null,
      description: editing.description.trim() || null,
      prompt: editing.prompt.trim() || null,
      color: editing.color.trim() || null,
      defaultAgentId: editing.defaultAgentId,
      indexedSources: editing.indexedSourceIds.length ? editing.indexedSourceIds : null,
      workingDirectories: dirs,
      defaultConnectionId: editing.defaultConnectionId || null,
      ticketConnectionId: editing.ticketConnectionId || null,
      wikiAutoTickets: editing.wikiAutoTickets,
      wikiAutoDecisions: editing.wikiAutoDecisions,
      wikiTicketBody: editing.wikiTicketBody,
    }
    try {
      setSaveError(null)
      if (editing.id) {
        await api.patch(`/projects/${editing.id}`, payload)
      } else {
        await api.post('/projects', payload)
      }
      setEditing(null)
      refetch()
    } catch (err: any) {
      const msg = err?.message || err?.data?.message || t('projects.saveFailed')
      setSaveError(msg)
    }
  }, [editing, refetch])

  const handleDelete = useCallback(async (id: string) => {
    try {
      await api.delete(`/projects/${id}`)
      setDeleting(null)
      refetch()
    } catch (err) {
      console.error('Failed to delete project:', err)
    }
  }, [refetch])

  const typeName = (typeId: string | null) => {
    if (!typeId) return null
    return seedTypeName(typeId, types.find(tp => tp.id === typeId)?.name ?? typeId)
  }

  const agentName = (agentId: string | null) => {
    if (!agentId) return null
    return agents.find(a => a.id === agentId)?.name ?? null
  }

  const coachContext = useMemo(() => {
    if (!editing) return {}
    const selectedType = types.find((tp) => tp.id === editing.typeId)
    return {
      name: editing.name || null,
      description: editing.description || null,
      typeName: selectedType?.name ?? null,
      typePrompt: selectedType?.prompt ?? null,
      defaultAgentName: agentName(editing.defaultAgentId || null),
    }
  }, [editing, types, agents])

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-muted-foreground">
          {t('projects.tab.intro')}
        </p>
        <Button size="sm" onClick={handleCreate} className="gap-1.5">
          <Plus className="h-3.5 w-3.5" />
          {t('projects.new')}
        </Button>
      </div>

      {/* Edit / Create form */}
      {editing && (
        <div className="glass-card p-4 mb-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium">{editing.id ? t('projects.edit') : t('projects.new')}</h3>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditing(null)}>
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">{t('projects.form.name')}</Label>
              <Input
                value={editing.name}
                onChange={e => setEditing({ ...editing, name: e.target.value })}
                placeholder={t('projects.form.namePh')}
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{t('projects.form.type')}</Label>
              <select
                value={editing.typeId}
                onChange={e => {
                  const newTypeId = e.target.value
                  const selectedType = types.find(tp => tp.id === newTypeId)
                  const updates: Partial<ProjectForm> = { typeId: newTypeId }
                  // Empty prompt inherits the type brief — do not copy it in
                  // (a copied prompt is an override, not `+` extension).
                  if (selectedType) {
                    if (editing.workingDirectories.every((row) => !row.path.trim()) && selectedType.workingDirectories?.length) {
                      updates.workingDirectories = namedWorkingDirectoriesFromRaw(selectedType.workingDirectories)
                    }
                    if (editing.indexedSourceIds.length === 0 && selectedType.indexedSources?.length) {
                      updates.indexedSourceIds = [...selectedType.indexedSources]
                    }
                  }
                  setEditing({ ...editing, ...updates })
                }}
                className="h-8 w-full px-3 text-sm bg-accent/30 border border-border/50 rounded-md focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="">{t('projects.form.selectType')}</option>
                {types.map(tp => (
                  <option key={tp.id} value={tp.id}>{seedTypeName(tp.id, tp.name)}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">{t('projects.form.description')}</Label>
            <Input
              value={editing.description}
              onChange={e => setEditing({ ...editing, description: e.target.value })}
              placeholder={t('projects.form.descriptionPh')}
              className="h-8 text-sm"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">{t('projects.form.color')}</Label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={editing.color || '#3b82f6'}
                  onChange={e => setEditing({ ...editing, color: e.target.value })}
                  className="h-8 w-10 rounded border border-border/50 cursor-pointer bg-transparent"
                />
                <Input
                  value={editing.color}
                  onChange={e => setEditing({ ...editing, color: e.target.value })}
                  placeholder="#3b82f6"
                  className="h-8 text-sm flex-1"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{t('projects.form.defaultAgent')}</Label>
              <Select
                value={editing.defaultAgentId || ''}
                onValueChange={(v) => setEditing({ ...editing, defaultAgentId: v })}
              >
                <SelectTrigger size="sm" className="w-full text-xs">
                  <SelectValue placeholder={t('projects.form.selectAgent')} />
                </SelectTrigger>
                <SelectContent position="popper" className="max-h-60">
                  {agents.map((a) => (
                    <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">{t('projects.form.defaultConnection')}</Label>
              {odooConnections.length === 0 ? (
                <p className="text-[11px] text-muted-foreground">
                  {t('projects.form.connectionsEmpty')}{' '}
                  <Link to="/connections" className="text-primary hover:underline">
                    {t('projects.form.connectionsLink')}
                  </Link>
                </p>
              ) : (
                <Select
                  value={editing.defaultConnectionId || NO_CONNECTION}
                  onValueChange={(v) => setEditing({ ...editing, defaultConnectionId: v === NO_CONNECTION ? '' : v })}
                >
                  <SelectTrigger size="sm" className="w-full text-xs">
                    <SelectValue placeholder={t('projects.form.selectConnection')} />
                  </SelectTrigger>
                  <SelectContent position="popper" className="max-h-60">
                    <SelectItem value={NO_CONNECTION}>{t('projects.form.selectConnection')}</SelectItem>
                    {odooConnections.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <p className="text-[11px] text-muted-foreground leading-snug">
                {t('projects.form.defaultConnectionHint')}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{t('projects.form.ticketConnection')}</Label>
              {odooConnections.length === 0 ? (
                <p className="text-[11px] text-muted-foreground">
                  {t('projects.form.connectionsEmpty')}{' '}
                  <Link to="/connections" className="text-primary hover:underline">
                    {t('projects.form.connectionsLink')}
                  </Link>
                </p>
              ) : (
                <Select
                  value={editing.ticketConnectionId || NO_CONNECTION}
                  onValueChange={(v) => setEditing({ ...editing, ticketConnectionId: v === NO_CONNECTION ? '' : v })}
                >
                  <SelectTrigger size="sm" className="w-full text-xs">
                    <SelectValue placeholder={t('projects.form.selectConnection')} />
                  </SelectTrigger>
                  <SelectContent position="popper" className="max-h-60">
                    <SelectItem value={NO_CONNECTION}>{t('projects.form.selectConnection')}</SelectItem>
                    {odooConnections.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <p className="text-[11px] text-muted-foreground leading-snug">
                {t('projects.form.ticketConnectionHint')}
              </p>
            </div>
          </div>
          <div className="space-y-2 rounded-md border border-border/50 p-3">
            <Label className="text-xs">{t('projects.form.wiki')}</Label>
            <p className="text-[11px] text-muted-foreground leading-snug">{t('projects.form.wikiHint')}</p>
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs">{t('projects.form.wikiTickets')}</span>
              <Switch
                checked={editing.wikiAutoTickets}
                onCheckedChange={(v) => setEditing({ ...editing, wikiAutoTickets: v })}
              />
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs">{t('projects.form.wikiDecisions')}</span>
              <Switch
                checked={editing.wikiAutoDecisions}
                onCheckedChange={(v) => setEditing({ ...editing, wikiAutoDecisions: v })}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{t('projects.form.wikiBody')}</Label>
              <Select
                value={editing.wikiTicketBody}
                onValueChange={(v) => setEditing({
                  ...editing,
                  wikiTicketBody: v === 'latest' || v === 'transcript' ? v : 'title',
                })}
                disabled={!editing.wikiAutoTickets}
              >
                <SelectTrigger size="sm" className="w-full text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="title">{t('projects.form.wikiBodyTitle')}</SelectItem>
                  <SelectItem value="latest">{t('projects.form.wikiBodyLatest')}</SelectItem>
                  <SelectItem value="transcript">{t('projects.form.wikiBodyTranscript')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <ProjectDesignSection projectId={editing.id || null} />

          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <Label className="text-xs">{t('projects.form.prompt')}</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 text-xs gap-1 text-blue-300 hover:text-blue-200"
                onClick={() => setCoachOpen(true)}
                title={coachT('promptCoach.openButtonTitle')}
              >
                <Sparkles className="h-3.5 w-3.5" />
                {coachT('promptCoach.openButton')}
              </Button>
            </div>
            <textarea
              value={editing.prompt}
              onChange={e => setEditing({ ...editing, prompt: e.target.value })}
              placeholder={t('projects.form.promptPh')}
              className="w-full min-h-[60px] px-3 py-2 text-sm bg-accent/30 border border-border/50 rounded-md focus:outline-none focus:ring-1 focus:ring-ring resize-y"
              rows={3}
            />
            <p className="text-[11px] text-muted-foreground leading-snug">
              {t('projects.form.promptInheritHint')}
            </p>
          </div>

          <WorkingDirectoriesEditor
            value={editing.workingDirectories}
            onChange={(workingDirectories) => setEditing((prev) => prev ? { ...prev, workingDirectories } : prev)}
            required
            seedEmptyHint={editing.source === 'seed'}
          />

          {/* Default code search sources for new conversations in this project */}
          <div className="space-y-1.5">
            <Label className="text-xs">{t('projects.form.codeSources')}</Label>
            <p className="text-[11px] text-muted-foreground leading-snug">
              {t('projects.form.codeSourcesHint')}
            </p>
            {searchSources.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">
                {t('projects.form.codeSourcesEmpty')}{' '}
                <Link to="/search-sources" className="text-primary hover:underline">
                  {t('projects.form.codeSourcesLink')}
                </Link>
              </p>
            ) : (
              <ul className="max-h-40 overflow-y-auto rounded-md border border-border/50 divide-y divide-border/30">
                {searchSources.map((s) => {
                  const checked = editing.indexedSourceIds.includes(s.id)
                  const label = s.config?.label
                  const ver = s.config?.version
                  return (
                    <li key={s.id}>
                      <label className={`flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-accent/30 ${checked ? 'bg-primary/5' : ''}`}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => {
                            setEditing((prev) => {
                              if (!prev) return prev
                              const set = new Set(prev.indexedSourceIds)
                              if (set.has(s.id)) set.delete(s.id)
                              else set.add(s.id)
                              return { ...prev, indexedSourceIds: Array.from(set) }
                            })
                          }}
                          className="h-3.5 w-3.5 rounded border-border accent-primary"
                        />
                        <span className="text-xs font-medium truncate flex-1">{s.name}</span>
                        {label && (
                          <span className="text-[10px] font-mono text-primary bg-primary/10 px-1.5 py-0.5 rounded">
                            {label}
                          </span>
                        )}
                        {ver && (
                          <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                            v{ver}
                          </span>
                        )}
                        <span className="text-[10px] text-muted-foreground">{s.status}</span>
                      </label>
                    </li>
                  )
                })}
              </ul>
            )}
            {editing.indexedSourceIds.length > 0 && (
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-[10px]">
                  {t('projects.form.codeSourcesSelected', { count: editing.indexedSourceIds.length })}
                </Badge>
                <button
                  type="button"
                  className="text-[10px] text-primary hover:underline"
                  onClick={() => setEditing({ ...editing, indexedSourceIds: [] })}
                >
                  {t('projects.form.codeSourcesClear')}
                </button>
              </div>
            )}
          </div>

          <ScopedPromptCoachDialog
            open={coachOpen}
            onClose={() => setCoachOpen(false)}
            scope="project"
            draft={editing.prompt}
            context={coachContext}
            onApply={(refined) => {
              setEditing((prev) => (prev ? { ...prev, prompt: refined } : prev))
            }}
          />
          {saveError && (
            <p className="text-xs text-destructive">{saveError}</p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setEditing(null)}>{t('common.cancel')}</Button>
            <Button size="sm" onClick={handleSave} disabled={!editing.name.trim() || !editing.defaultAgentId || (!editing.id && !editing.typeId)}>
              {editing.id ? t('common.save') : t('common.create')}
            </Button>
          </div>
        </div>
      )}

      {/* Project cards */}
      <div className="grid grid-cols-2 gap-3">
        {projects.map(p => (
          <div
            key={p.id}
            className="glass-card p-4 hover:bg-accent/30 transition-colors cursor-pointer"
            onClick={() => handleEdit(p)}
          >
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2">
                {p.color && (
                  <span className="h-3 w-3 rounded-full flex-shrink-0" style={{ backgroundColor: p.color }} />
                )}
                <span className="font-medium text-sm">{p.name}</span>
              </div>
              <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                <Button variant="ghost" size="icon" className="h-7 w-7" asChild>
                  <Link to="/projects/$projectId/wiki" params={{ projectId: p.id }} title={t('projects.wiki')}>
                    <BookOpen className="h-3 w-3" />
                  </Link>
                </Button>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleEdit(p)}>
                  <Pencil className="h-3 w-3" />
                </Button>
                {deleting === p.id ? (
                  <div className="flex items-center gap-1">
                    <Button variant="destructive" size="sm" className="h-7 text-xs" onClick={() => handleDelete(p.id)}>{t('common.confirm')}</Button>
                    <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setDeleting(null)}>{t('common.cancel')}</Button>
                  </div>
                ) : (
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => setDeleting(p.id)}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              {typeName(p.typeId) && (
                <Badge variant="secondary" className="text-[10px]">{typeName(p.typeId)}</Badge>
              )}
              {p.defaultAgentId && (
                <Badge variant="outline" className="text-[10px]">{agentName(p.defaultAgentId) ?? t('projects.badge.agent')}</Badge>
              )}
              {!p.defaultAgentId && (
                <Badge variant="destructive" className="text-[10px]">{t('projects.badge.noAgent')}</Badge>
              )}
              {p.indexedSources && p.indexedSources.length > 0 && (
                <Badge variant="outline" className="text-[10px]">
                  {t('projects.badge.sources', { count: p.indexedSources.length })}
                </Badge>
              )}
            </div>
            {p.description && (
              <p className="text-xs text-muted-foreground mt-1.5 line-clamp-2">{p.description}</p>
            )}
          </div>
        ))}
      </div>

      {isLoading && projects.length === 0 && (
        <p className="text-sm text-muted-foreground mt-4">{t('projects.loading')}</p>
      )}
      {error && (
        <p className="text-sm text-destructive mt-4">{t('projects.loadFailed', { message: error.message })}</p>
      )}
      {!isLoading && !error && projects.length === 0 && !editing && (
        <div className="glass-card p-8 text-center">
          <p className="text-sm text-muted-foreground">
            {t('projects.empty')}
          </p>
        </div>
      )}
    </div>
  )
}

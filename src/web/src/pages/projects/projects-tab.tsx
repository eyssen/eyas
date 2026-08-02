import { useState, useCallback } from 'react'
import { useApi } from '@/hooks/use-api'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Plus, Trash2, X, Pencil } from 'lucide-react'
import { t } from './i18n'

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
  createdAt: string
}

interface ProjectType {
  id: string
  name: string
  color: string | null
  prompt: string | null
}

interface ProjectForm {
  id?: string
  name: string
  typeId: string
  description: string
  prompt: string
  color: string
  defaultAgentId: string
}

const EMPTY_PROJECT: ProjectForm = {
  name: '', typeId: '', description: '', prompt: '', color: '', defaultAgentId: '',
}

export function ProjectsTab() {
  const { data, isLoading, error, refetch } = useApi<{ projects: Project[] }>('/projects')
  const { data: typesData } = useApi<{ projectTypes: ProjectType[] }>('/project-types')
  const { data: agentsData } = useApi<{ agents: Agent[] }>('/agents?enabled=true&tier=primary')
  const [editing, setEditing] = useState<ProjectForm | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)

  const projects = data?.projects ?? []
  const types = typesData?.projectTypes ?? []
  const agents = agentsData?.agents ?? []

  const handleCreate = useCallback(() => {
    setEditing({ ...EMPTY_PROJECT })
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
    })
  }, [])

  const handleSave = useCallback(async () => {
    if (!editing || !editing.name.trim() || !editing.defaultAgentId) return
    const payload = {
      name: editing.name.trim(),
      typeId: editing.typeId || null,
      description: editing.description.trim() || null,
      prompt: editing.prompt.trim() || null,
      color: editing.color.trim() || null,
      defaultAgentId: editing.defaultAgentId,
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
    return types.find(t => t.id === typeId)?.name ?? null
  }

  const agentName = (agentId: string | null) => {
    if (!agentId) return null
    return agents.find(a => a.id === agentId)?.name ?? null
  }

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
                  const updates: Partial<ProjectForm> = { typeId: newTypeId }
                  // Copy type prompt if project prompt is empty
                  if (!editing.prompt.trim() && newTypeId) {
                    const selectedType = types.find(t => t.id === newTypeId)
                    if (selectedType?.prompt) {
                      updates.prompt = selectedType.prompt
                    }
                  }
                  setEditing({ ...editing, ...updates })
                }}
                className="h-8 w-full px-3 text-sm bg-accent/30 border border-border/50 rounded-md focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="">{t('projects.form.selectType')}</option>
                {types.map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
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
          <div className="space-y-1.5">
            <Label className="text-xs">{t('projects.form.prompt')}</Label>
            <textarea
              value={editing.prompt}
              onChange={e => setEditing({ ...editing, prompt: e.target.value })}
              placeholder={t('projects.form.promptPh')}
              className="w-full min-h-[60px] px-3 py-2 text-sm bg-accent/30 border border-border/50 rounded-md focus:outline-none focus:ring-1 focus:ring-ring resize-y"
              rows={3}
            />
          </div>
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
            <div className="flex items-center gap-2 mt-1.5">
              {typeName(p.typeId) && (
                <Badge variant="secondary" className="text-[10px]">{typeName(p.typeId)}</Badge>
              )}
              {p.defaultAgentId && (
                <Badge variant="outline" className="text-[10px]">{agentName(p.defaultAgentId) ?? t('projects.badge.agent')}</Badge>
              )}
              {!p.defaultAgentId && (
                <Badge variant="destructive" className="text-[10px]">{t('projects.badge.noAgent')}</Badge>
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

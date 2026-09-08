import { useState, useCallback } from 'react'
import { useApi } from '@/hooks/use-api'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Plus, Trash2, X, Pencil, Sparkles,
  Code, Bug, Rocket, FileText, Settings, Users, Shield,
  Zap, Package, Globe, Database, Server, Layout, Cpu,
  BookOpen, MessageSquare, Mail, Bell, Search, Star,
  Heart, Flag, Target, Briefcase, Lightbulb, Wrench,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { ScopedPromptCoachDialog } from '@/components/prompt-coach'
import { t as coachT } from '@/components/prompt-coach/i18n'
import { t, seedTypeName, seedTypeDescription } from './i18n'
import {
  WorkingDirectoriesEditor,
  emptyWorkingDirectory,
  namedWorkingDirectoriesFromRaw,
  payloadWorkingDirectories,
  type NamedWorkspace,
} from '@/components/working-directories-editor'

const ICON_MAP: Record<string, LucideIcon> = {
  code: Code, bug: Bug, rocket: Rocket, 'file-text': FileText,
  settings: Settings, users: Users, shield: Shield, zap: Zap,
  package: Package, globe: Globe, database: Database, server: Server,
  layout: Layout, cpu: Cpu, 'book-open': BookOpen, 'message-square': MessageSquare,
  mail: Mail, bell: Bell, search: Search, star: Star,
  heart: Heart, flag: Flag, target: Target, briefcase: Briefcase,
  lightbulb: Lightbulb, wrench: Wrench,
}

interface ProjectType {
  id: string
  name: string
  prompt: string | null
  defaultStages: string[] | null
  defaultPriority: string | null
  color: string | null
  icon: string | null
  source?: 'seed' | 'user'
  workingDirectories?: Array<string | NamedWorkspace> | null
  createdAt: string
}

interface EditingType {
  id?: string
  name: string
  prompt: string
  defaultPriority: string
  color: string
  icon: string
  source?: 'seed' | 'user'
  workingDirectories: NamedWorkspace[]
}

const EMPTY_FORM: EditingType = {
  name: '',
  prompt: '',
  defaultPriority: 'normal',
  color: '#3b82f6',
  icon: '',
  workingDirectories: [emptyWorkingDirectory()],
}

const PRIORITY_OPTIONS = ['low', 'normal', 'high', 'urgent']

export function ProjectTypesTab() {
  const { data, isLoading, error, refetch } = useApi<{ projectTypes: ProjectType[] }>('/project-types')
  const [editing, setEditing] = useState<EditingType | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [showIconPicker, setShowIconPicker] = useState(false)
  const [coachOpen, setCoachOpen] = useState(false)

  const types = data?.projectTypes ?? []

  const handleCreate = useCallback(() => {
    setEditing({ ...EMPTY_FORM, workingDirectories: [emptyWorkingDirectory()] })
  }, [])

  const handleEdit = useCallback((pt: ProjectType) => {
    setEditing({
      id: pt.id,
      name: pt.name,
      prompt: pt.prompt ?? '',
      defaultPriority: pt.defaultPriority ?? 'normal',
      color: pt.color ?? '#3b82f6',
      icon: pt.icon ?? '',
      source: pt.source,
      workingDirectories: namedWorkingDirectoriesFromRaw(pt.workingDirectories),
    })
  }, [])

  const handleSave = useCallback(async () => {
    if (!editing || !editing.name.trim()) return
    const payload = {
      name: editing.name.trim(),
      prompt: editing.prompt.trim() || null,
      defaultPriority: editing.defaultPriority || null,
      color: editing.color.trim() || null,
      icon: editing.icon.trim() || null,
      workingDirectories: payloadWorkingDirectories(editing.workingDirectories),
    }
    try {
      if (editing.id) {
        await api.patch(`/project-types/${editing.id}`, payload)
      } else {
        await api.post('/project-types', payload)
      }
      setEditing(null)
      refetch()
    } catch (err) {
      console.error('Failed to save project type:', err)
    }
  }, [editing, refetch])

  const handleDelete = useCallback(async (id: string) => {
    try {
      await api.delete(`/project-types/${id}`)
      setDeleting(null)
      setEditing(null)
      refetch()
    } catch (err) {
      console.error('Failed to delete project type:', err)
    }
  }, [refetch])

  const SelectedIcon = editing?.icon ? ICON_MAP[editing.icon] : null

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-muted-foreground">
          {t('projects.types.intro')}
        </p>
        <Button size="sm" onClick={handleCreate} className="gap-1.5">
          <Plus className="h-3.5 w-3.5" />
          {t('projects.types.new')}
        </Button>
      </div>

      {/* Edit / Create form */}
      {editing && (
        <div className="glass-card p-4 mb-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium">{editing.id ? t('projects.types.edit') : t('projects.types.new')}</h3>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setEditing(null); setShowIconPicker(false) }}>
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">{t('projects.form.name')}</Label>
              <Input
                value={editing.name}
                onChange={e => setEditing({ ...editing, name: e.target.value })}
                placeholder={t('projects.types.namePh')}
                className="h-8 text-sm"
                disabled={editing.source === 'seed'}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{t('projects.types.defaultPriority')}</Label>
              <select
                value={editing.defaultPriority}
                onChange={e => setEditing({ ...editing, defaultPriority: e.target.value })}
                className="h-8 w-full px-3 text-sm bg-accent/30 border border-border/50 rounded-md focus:outline-none focus:ring-1 focus:ring-ring"
              >
                {PRIORITY_OPTIONS.map(p => (
                  <option key={p} value={p}>{t(`projects.priority.${p}`)}</option>
                ))}
              </select>
            </div>
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
              <Label className="text-xs">{t('projects.types.icon')}</Label>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowIconPicker(!showIconPicker)}
                  className="h-8 w-full px-3 text-sm bg-accent/30 border border-border/50 rounded-md focus:outline-none focus:ring-1 focus:ring-ring flex items-center gap-2 text-left"
                >
                  {SelectedIcon ? (
                    <>
                      <SelectedIcon className="h-3.5 w-3.5" />
                      <span>{editing.icon}</span>
                    </>
                  ) : (
                    <span className="text-muted-foreground">{t('projects.types.chooseIcon')}</span>
                  )}
                </button>
                {showIconPicker && (
                  <div className="absolute top-9 left-0 z-10 w-[280px] p-2 glass-card border border-border shadow-xl rounded-lg">
                    <div className="grid grid-cols-8 gap-1">
                      {Object.entries(ICON_MAP).map(([name, Icon]) => (
                        <button
                          key={name}
                          type="button"
                          onClick={() => {
                            setEditing({ ...editing, icon: name })
                            setShowIconPicker(false)
                          }}
                          className={`h-8 w-8 flex items-center justify-center rounded-md transition-colors ${editing.icon === name ? 'bg-primary text-primary-foreground' : 'hover:bg-accent/50 text-muted-foreground hover:text-foreground'}`}
                          title={name}
                        >
                          <Icon className="h-4 w-4" />
                        </button>
                      ))}
                    </div>
                    {editing.icon && (
                      <button
                        type="button"
                        onClick={() => {
                          setEditing({ ...editing, icon: '' })
                          setShowIconPicker(false)
                        }}
                        className="w-full mt-1 text-xs text-muted-foreground hover:text-foreground py-1"
                      >
                        {t('projects.types.clearIcon')}
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
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
              placeholder={t('projects.types.promptPh')}
              className="w-full min-h-[60px] px-3 py-2 text-sm bg-accent/30 border border-border/50 rounded-md focus:outline-none focus:ring-1 focus:ring-ring resize-y"
              rows={3}
            />
          </div>
          <ScopedPromptCoachDialog
            open={coachOpen}
            onClose={() => setCoachOpen(false)}
            scope="project-type"
            draft={editing.prompt}
            context={{ name: editing.name || null }}
            onApply={(refined) => {
              setEditing((prev) => (prev ? { ...prev, prompt: refined } : prev))
            }}
          />
          <WorkingDirectoriesEditor
            value={editing.workingDirectories}
            onChange={(workingDirectories) => setEditing({ ...editing, workingDirectories })}
            required={false}
          />
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => { setEditing(null); setShowIconPicker(false) }}>{t('common.cancel')}</Button>
            <Button size="sm" onClick={handleSave} disabled={!editing.name.trim()}>{t('common.save')}</Button>
          </div>
        </div>
      )}

      {/* Type cards */}
      <div className="grid grid-cols-2 gap-3">
        {types.map(pt => {
          const TypeIcon = pt.icon ? ICON_MAP[pt.icon] : null
          return (
            <div
              key={pt.id}
              className="glass-card p-4 hover:bg-accent/30 transition-colors cursor-pointer"
              onClick={() => handleEdit(pt)}
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  {pt.color && (
                    <span
                      className="h-3 w-3 rounded-full flex-shrink-0"
                      style={{ backgroundColor: pt.color }}
                    />
                  )}
                  {TypeIcon && <TypeIcon className="h-4 w-4 text-muted-foreground" />}
                  <span className="font-medium text-sm">{seedTypeName(pt.id, pt.name)}</span>
                </div>
                <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => handleEdit(pt)}
                  >
                    <Pencil className="h-3 w-3" />
                  </Button>
                  {pt.source === 'seed' ? null : deleting === pt.id ? (
                    <div className="flex items-center gap-1">
                      <Button
                        variant="destructive"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => handleDelete(pt.id)}
                      >
                        {t('common.confirm')}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => setDeleting(null)}
                      >
                        {t('common.cancel')}
                      </Button>
                    </div>
                  ) : (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive"
                      onClick={() => setDeleting(pt.id)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              </div>
              {pt.defaultPriority && (
                <Badge variant="outline" className="text-[10px] mt-1.5">{t(`projects.priority.${pt.defaultPriority}`)}</Badge>
              )}
              {(seedTypeDescription(pt.id) || pt.prompt) && (
                <p className="text-xs text-muted-foreground mt-1.5 line-clamp-2">
                  {seedTypeDescription(pt.id) || pt.prompt}
                </p>
              )}
            </div>
          )
        })}
      </div>

      {isLoading && types.length === 0 && (
        <p className="text-sm text-muted-foreground mt-4">{t('projects.types.loading')}</p>
      )}
      {error && (
        <p className="text-sm text-destructive mt-4">{t('projects.types.loadFailed', { message: error.message })}</p>
      )}
      {!isLoading && !error && types.length === 0 && !editing && (
        <div className="glass-card p-8 text-center">
          <p className="text-sm text-muted-foreground">
            {t('projects.types.empty')}
          </p>
        </div>
      )}
    </div>
  )
}

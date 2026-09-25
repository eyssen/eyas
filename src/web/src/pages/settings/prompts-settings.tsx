// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { useState, useCallback } from 'react'
import { useApi } from '@/hooks/use-api'
import { api } from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Plus, Trash2, Save, FileText, Lock } from 'lucide-react'
import { ContextualHelp } from '@/components/docs/contextual-help'
import { t } from './i18n'

interface PromptTemplate {
  id: string
  level: string
  targetId?: string
  name: string
  content: string
  section?: string
  locked: boolean
  isActive: boolean
  createdAt: string
  updatedAt: string
}

// Maps prompt levels to their i18n label keys; resolved with t() at render time
// via levelLabel() so it follows the active language.
const LEVEL_LABEL_KEYS: Record<string, string> = {
  master: 'settings.promptsList.level.master',
  project_type: 'settings.promptsList.level.project_type',
  project: 'settings.promptsList.level.project',
  conversation: 'settings.promptsList.level.conversation',
}

const levelLabel = (level: string): string =>
  LEVEL_LABEL_KEYS[level] ? t(LEVEL_LABEL_KEYS[level]) : level

const LEVEL_COLORS: Record<string, string> = {
  master: 'text-purple-400 border-purple-500/30',
  project_type: 'text-blue-400 border-blue-500/30',
  project: 'text-emerald-400 border-emerald-500/30',
  conversation: 'text-amber-400 border-amber-500/30',
}

function TemplateEditor({
  template,
  editForm,
  setEditForm,
  onSave,
  onToggle,
  onDelete,
}: {
  template: PromptTemplate | undefined
  editForm: { name: string; content: string; level: string }
  setEditForm: (f: { name: string; content: string; level: string }) => void
  onSave: () => void
  onToggle: (id: string, isActive: boolean) => void
  onDelete: (id: string) => void
}) {
  if (!template) return null
  const isLocked = template.locked

  return (
    <div className="glass-card p-4 space-y-4 sticky top-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold">{isLocked ? t('settings.promptsList.viewTemplate') : t('settings.promptsList.editTemplate')}</h3>
          {isLocked && (
            <Badge variant="outline" className="text-[10px] text-amber-400 border-amber-400/30">
              <Lock className="h-2.5 w-2.5 mr-1" />{t('settings.promptsList.readOnly')}
            </Badge>
          )}
        </div>
        {!isLocked && (
          <div className="flex gap-1">
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => onToggle(template.id, template.isActive)}>
              {template.isActive ? t('settings.promptsList.deactivate') : t('settings.promptsList.activate')}
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7 text-red-400 hover:text-red-300 hover:bg-red-500/10" onClick={() => onDelete(template.id)}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">{t('common.name')}</Label>
        <Input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} className="h-8 text-sm" disabled={isLocked} />
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">{t('settings.promptsList.content')}</Label>
        {isLocked ? (
          <pre className="w-full min-h-[300px] rounded-md border border-border/50 bg-accent/20 px-3 py-2 text-xs text-muted-foreground font-mono whitespace-pre-wrap overflow-y-auto">
            {editForm.content}
          </pre>
        ) : (
          <textarea
            value={editForm.content}
            onChange={(e) => setEditForm({ ...editForm, content: e.target.value })}
            className="w-full min-h-[300px] rounded-md border border-border/50 bg-background px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-ring resize-y"
            placeholder={t('settings.promptsList.contentPlaceholder')}
          />
        )}
      </div>

      {!isLocked && (
        <div className="flex justify-end">
          <Button size="sm" onClick={onSave}>
            <Save className="h-3.5 w-3.5 mr-1" />
            {t('common.save')}
          </Button>
        </div>
      )}
    </div>
  )
}

export default function PromptsSettingsPage() {
  const { data, isLoading, error, refetch } = useApi<{ templates: PromptTemplate[] }>('/prompts')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState({ name: '', content: '', level: 'master' })

  const templates = data?.templates ?? []
  const masterTemplates = templates.filter((t) => t.level === 'master')
  const projectTypeTemplates = templates.filter((t) => t.level === 'project_type')

  const handleCreate = useCallback(async (level: string) => {
    const template = await api.post<PromptTemplate>('/prompts', {
      level,
      name: t('settings.promptsList.newTemplateName', { level: levelLabel(level) }),
      content: '',
      createdBy: 'system',
    })
    setEditingId(template.id)
    setEditForm({ name: template.name, content: template.content, level: template.level })
    refetch()
  }, [refetch])

  const handleSave = useCallback(async () => {
    if (!editingId) return
    await api.patch(`/prompts/${editingId}`, {
      name: editForm.name,
      content: editForm.content,
    })
    setEditingId(null)
    refetch()
  }, [editingId, editForm, refetch])

  const handleDelete = useCallback(async (id: string) => {
    await api.delete(`/prompts/${id}`)
    if (editingId === id) setEditingId(null)
    refetch()
  }, [editingId, refetch])

  const handleToggle = useCallback(async (id: string, isActive: boolean) => {
    await api.patch(`/prompts/${id}`, { isActive: !isActive })
    refetch()
  }, [refetch])

  const renderTemplateList = (items: PromptTemplate[], level: string) => (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">{t('settings.promptsList.levelTemplates', { level: levelLabel(level) })}</h3>
        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => handleCreate(level)}>
          <Plus className="h-3 w-3 mr-1" />
          {t('common.add')}
        </Button>
      </div>

      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground py-2">{t('settings.promptsList.emptyLevel')}</p>
      ) : (
        items.map((tpl) => (
          <div
            key={tpl.id}
            className={`glass-card p-3 cursor-pointer hover:bg-accent/30 transition-colors ${editingId === tpl.id ? 'ring-1 ring-primary/50' : ''}`}
            onClick={() => {
              setEditingId(tpl.id)
              setEditForm({ name: tpl.name, content: tpl.content, level: tpl.level })
            }}
          >
            <div className="flex items-center gap-2">
              <FileText className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
              <span className="text-sm font-medium flex-1 truncate">{tpl.name}</span>
              <Badge variant="outline" className={`text-[9px] ${LEVEL_COLORS[tpl.level] ?? ''}`}>
                {levelLabel(tpl.level)}
              </Badge>
              {tpl.locked && (
                <Badge variant="outline" className="text-[9px] text-amber-400 border-amber-400/30">
                  <Lock className="h-2 w-2 mr-0.5" />{t('settings.promptsList.locked')}
                </Badge>
              )}
              {tpl.isActive ? (
                <Badge variant="secondary" className="text-[9px] text-emerald-500">{t('common.active')}</Badge>
              ) : (
                <Badge variant="outline" className="text-[9px] text-muted-foreground">{t('common.inactive')}</Badge>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground mt-1 line-clamp-2">
              {tpl.content || t('settings.promptsList.emptyTemplate')}
            </p>
          </div>
        ))
      )}
    </div>
  )

  return (
    <div>
      <div className="flex items-baseline justify-between mb-5">
        <div>
          <h1 className="page-title inline-flex items-center gap-1.5">{t('settings.promptsList.title')} <ContextualHelp helpId="ai.prompts" /></h1>
          <p className="text-sm text-muted-foreground">
            {t('settings.promptsList.subtitle')}
          </p>
        </div>
        <span className="text-xs text-muted-foreground">
          <strong className="text-foreground">{templates.length}</strong> {t('settings.promptsList.templatesWord')}
        </span>
      </div>

      <div className="grid grid-cols-5 gap-4">
        {/* Template lists */}
        <div className="col-span-2 space-y-6">
          {renderTemplateList(masterTemplates, 'master')}
          {renderTemplateList(projectTypeTemplates, 'project_type')}
        </div>

        {/* Editor */}
        <div className="col-span-3">
          {editingId ? (
            <TemplateEditor
              template={templates.find((t) => t.id === editingId)}
              editForm={editForm}
              setEditForm={setEditForm}
              onSave={handleSave}
              onToggle={handleToggle}
              onDelete={handleDelete}
            />
          ) : (
            <div className="glass-card p-8 flex flex-col items-center justify-center text-muted-foreground">
              <FileText className="h-8 w-8 mb-2 opacity-30" />
              <p className="text-sm">{t('settings.promptsList.selectToEdit')}</p>
            </div>
          )}
        </div>
      </div>

      {isLoading && templates.length === 0 && (
        <p className="text-sm text-muted-foreground mt-4">{t('settings.promptsList.loading')}</p>
      )}

      {error && (
        <p className="text-sm text-destructive mt-4">{t('settings.promptsList.loadError', { error: error.message })}</p>
      )}
    </div>
  )
}

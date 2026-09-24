import { useState, useCallback } from 'react'
import { useApi } from '@/hooks/use-api'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Plus, Trash2, GripVertical, ChevronUp, ChevronDown,
} from 'lucide-react'
import { t } from './i18n'

/** Sentinel value — Radix Select forbids an empty-string item value. */
const NO_AGENT = 'none'

interface Stage {
  id: string
  name: string
  color: string | null
  sortOrder: number
  isClosed: boolean
  isFolded: boolean
  botListen: boolean
  autoAssigneeId: string | null
}

interface Agent {
  id: string
  name: string
}

export function StagesSection() {
  const { data, refetch } = useApi<{ stages: Stage[] }>('/stages')
  const { data: agentsData } = useApi<{ agents: Agent[] }>('/agents?enabled=true')
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const agents = agentsData?.agents ?? []

  const stages = [...(data?.stages ?? [])].sort((a, b) => a.sortOrder - b.sortOrder)

  const handleAdd = useCallback(async () => {
    try {
      await api.post('/stages', { name: t('projects.stages.newStage'), sortOrder: stages.length })
      refetch()
    } catch (err) {
      console.error('Failed to add stage:', err)
    }
  }, [stages.length, refetch])

  const handleUpdate = useCallback(async (id: string, field: string, value: any) => {
    await api.patch(`/stages/${id}`, { [field]: value })
    refetch()
  }, [refetch])

  const handleDelete = useCallback(async (id: string) => {
    await api.delete(`/stages/${id}`)
    setDeletingId(null)
    refetch()
  }, [refetch])

  const handleReorder = useCallback(async (stageId: string, direction: 'up' | 'down') => {
    const idx = stages.findIndex(s => s.id === stageId)
    if (idx < 0) return
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1
    if (swapIdx < 0 || swapIdx >= stages.length) return
    const ids = stages.map(s => s.id)
    ;[ids[idx], ids[swapIdx]] = [ids[swapIdx], ids[idx]]
    await api.patch('/stages/reorder', { ids })
    refetch()
  }, [stages, refetch])

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm text-muted-foreground">
          {t('projects.stages.intro')}
        </p>
        <Button size="sm" onClick={handleAdd} className="gap-1.5">
          <Plus className="h-3.5 w-3.5" />
          {t('projects.stages.add')}
        </Button>
      </div>

      {/* Header row */}
      {stages.length > 0 && (
        <div className="flex items-center gap-2 px-2 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
          <div className="w-[52px]" /> {/* reorder + color */}
          <div className="flex-1 min-w-[140px]">{t('projects.stages.name')}</div>
          <div className="w-16 text-center">{t('projects.stages.closed')}</div>
          <div className="w-16 text-center">{t('projects.stages.folded')}</div>
          <div className="w-16 text-center">{t('projects.stages.bot')}</div>
          <div className="w-40">{t('projects.stages.autoAssign')}</div>
          <div className="w-8" /> {/* delete */}
        </div>
      )}

      <Separator className="mb-1" />

      {/* Stage rows */}
      <div className="space-y-0.5">
        {stages.map((stage, idx) => (
          <div
            key={stage.id}
            className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-accent/20 transition-colors group"
          >
            {/* Reorder arrows */}
            <div className="flex flex-col gap-0">
              <button
                type="button"
                className="h-3.5 w-4 flex items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-20"
                disabled={idx === 0}
                onClick={() => handleReorder(stage.id, 'up')}
              >
                <ChevronUp className="h-3 w-3" />
              </button>
              <button
                type="button"
                className="h-3.5 w-4 flex items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-20"
                disabled={idx === stages.length - 1}
                onClick={() => handleReorder(stage.id, 'down')}
              >
                <ChevronDown className="h-3 w-3" />
              </button>
            </div>

            {/* Color */}
            <input
              type="color"
              value={stage.color || '#6b7280'}
              onChange={e => handleUpdate(stage.id, 'color', e.target.value)}
              className="h-6 w-6 rounded border border-border/30 cursor-pointer bg-transparent flex-shrink-0"
            />

            {/* Name — inline editable */}
            <Input
              defaultValue={stage.name}
              onBlur={e => {
                const v = e.target.value.trim()
                if (v && v !== stage.name) handleUpdate(stage.id, 'name', v)
              }}
              onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
              className="h-7 text-sm flex-1 min-w-[140px] bg-transparent border-transparent hover:border-border/50 focus:border-border"
            />

            {/* Checkboxes */}
            <div className="w-16 flex justify-center">
              <input
                type="checkbox"
                checked={stage.isClosed}
                onChange={e => handleUpdate(stage.id, 'isClosed', e.target.checked)}
                className="h-3.5 w-3.5 rounded cursor-pointer"
                title={t('projects.stages.closedTitle')}
              />
            </div>
            <div className="w-16 flex justify-center">
              <input
                type="checkbox"
                checked={stage.isFolded}
                onChange={e => handleUpdate(stage.id, 'isFolded', e.target.checked)}
                className="h-3.5 w-3.5 rounded cursor-pointer"
                title={t('projects.stages.foldedTitle')}
              />
            </div>
            <div className="w-16 flex justify-center">
              <input
                type="checkbox"
                checked={stage.botListen}
                onChange={e => handleUpdate(stage.id, 'botListen', e.target.checked)}
                className="h-3.5 w-3.5 rounded cursor-pointer"
                title={t('projects.stages.botTitle')}
              />
            </div>

            {/* Auto-assign — cards entering this stage are handed to this agent
                and run autonomously, even when "Bot" is off. */}
            <div className="w-40" title={t('projects.stages.autoAssignTitle')}>
              <Select
                value={stage.autoAssigneeId ?? NO_AGENT}
                onValueChange={v => handleUpdate(stage.id, 'autoAssigneeId', v === NO_AGENT ? null : v)}
              >
                <SelectTrigger size="sm" className="w-full text-xs">
                  <SelectValue placeholder={t('projects.stages.autoAssignNone')} />
                </SelectTrigger>
                <SelectContent position="popper" className="max-h-60">
                  <SelectItem value={NO_AGENT}>{t('projects.stages.autoAssignNone')}</SelectItem>
                  {agents.map(a => (
                    <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Delete */}
            <div className="w-8 flex justify-center">
              {deletingId === stage.id ? (
                <Button
                  variant="destructive"
                  size="sm"
                  className="h-6 text-[10px] px-1.5"
                  onClick={() => handleDelete(stage.id)}
                >
                  ✓
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={() => setDeletingId(stage.id)}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>

      {stages.length === 0 && (
        <div className="glass-card p-8 text-center">
          <p className="text-sm text-muted-foreground">{t('projects.stages.empty')}</p>
        </div>
      )}
    </div>
  )
}

import { useApi } from '@/hooks/use-api'
import { Badge } from '@/components/ui/badge'
import { Calendar, Tag, Users, Bot, Brain, Network, Folder } from 'lucide-react'
import { t } from './i18n'
import { seedTypeName, t as projectsT } from '@/pages/projects/i18n'
import {
  resolveEffortValue,
  effortUpdate,
  pinWorkspacePrimary,
  toNamedWorkingDirectories,
  workspaceChipLabel,
} from './conversation-fields-utils'
import { payloadWorkingDirectories } from '@/components/working-directories-editor'
import { OrchestrationMenu } from './orchestration-menu'

interface ProjectItem {
  id: string
  name: string
  typeId: string | null
  color: string | null
  defaultAgentId: string | null
}

interface ProjectTypeItem {
  id: string
  name: string
}

interface StageItem {
  id: string
  name: string
  color: string | null
}

interface AgentItem {
  id: string
  name: string
}

interface ConversationFieldsProps {
  conversationId: string
  projectId: string | null
  stageId: string | null
  agentId: string | null
  dueDate: string | null
  assignees: string[]
  tags: string[]
  thinking: string
  thinkingBudget: number | null
  effort: string | null
  orchestration: string
  godMode: boolean
  hasMessages: boolean
  workingDirectories?: unknown
  onUpdate: (fields: Record<string, unknown>) => void
}

export function ConversationFields({
  conversationId,
  projectId,
  stageId,
  agentId,
  dueDate,
  assignees,
  tags,
  thinking,
  thinkingBudget,
  effort,
  orchestration,
  godMode,
  hasMessages,
  workingDirectories = null,
  onUpdate,
}: ConversationFieldsProps) {
  const { data: projectData } = useApi<{ projects: ProjectItem[] }>('/projects')
  const { data: typeData } = useApi<{ projectTypes: ProjectTypeItem[] }>('/project-types')
  // Always load global stages — all projects share the same stages
  const { data: stageData } = useApi<{ stages: StageItem[] }>('/stages')
  const { data: agentData } = useApi<{ agents: AgentItem[] }>('/agents?enabled=true&tier=primary')
  const { data: tagData } = useApi<{ tags: { id: string; name: string; color: string | null }[] }>(
    `/conversations/${conversationId}/tags`
  )

  const projects = projectData?.projects ?? []
  const projectTypes = typeData?.projectTypes ?? []
  const stages = stageData?.stages ?? []
  const groupedTypes = projectTypes
    .map((tp) => ({
      id: tp.id,
      name: seedTypeName(tp.id, tp.name),
      projects: projects.filter((p) => p.typeId === tp.id),
    }))
    .filter((g) => g.projects.length > 0)
  const ungroupedProjects = projects.filter((p) => !p.typeId || !projectTypes.some((tp) => tp.id === p.typeId))
  const agents = agentData?.agents ?? []
  const resolvedTags = tagData?.tags ?? tags.map((t) => ({ id: t, name: t, color: null }))

  const workspaces = toNamedWorkingDirectories(workingDirectories)
  const chip = workspaceChipLabel(workspaces)
  const primaryPath = workspaces[0]?.path ?? ''

  const handleProjectChange = (newProjectId: string | null) => {
    const updates: Record<string, unknown> = { projectId: newProjectId }
    // Auto-set agent from project default (only if no messages yet)
    if (!hasMessages && newProjectId) {
      const project = projects.find(p => p.id === newProjectId)
      if (project?.defaultAgentId) {
        updates.agentId = project.defaultAgentId
      }
    }
    onUpdate(updates)
  }

  return (
    <div className="flex items-center gap-4 px-4 py-2 border-b border-border/50 text-xs flex-shrink-0 overflow-x-auto">
      {/* Project */}
      <div className="flex items-center gap-1.5">
        <span className="text-muted-foreground">{t('conversations.fields.project')}</span>
        <select
          value={projectId ?? ''}
          onChange={(e) => handleProjectChange(e.target.value || null)}
          className="h-7 px-2 bg-accent/30 border border-border/50 rounded-md focus:outline-none focus:ring-1 focus:ring-ring text-xs"
        >
          <option value="">{t('conversations.fields.none')}</option>
          {groupedTypes.map((g) => (
            <optgroup key={g.id} label={g.name}>
              {g.projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </optgroup>
          ))}
          {ungroupedProjects.length > 0 && (
            <optgroup label={projectsT('projects.types.ungrouped')}>
              {ungroupedProjects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </optgroup>
          )}
        </select>
      </div>

      {/* Working folders — pin which root is primary (first = cwd) */}
      <div className="flex items-center gap-1.5">
        <Folder className="h-3 w-3 text-muted-foreground" />
        <span className="text-muted-foreground">{t('conversations.fields.folders')}</span>
        {workspaces.length === 0 ? (
          <span className="text-muted-foreground">{t('conversations.fields.foldersNone')}</span>
        ) : (
          <select
            value={primaryPath}
            onChange={(e) => {
              const next = pinWorkspacePrimary(workspaces, e.target.value)
              onUpdate({ workingDirectories: payloadWorkingDirectories(next) })
            }}
            title={chip.extra > 0 ? t('conversations.fields.foldersMore', { name: chip.name ?? '', count: chip.extra }) : (chip.name ?? '')}
            className="h-7 max-w-[12rem] px-2 bg-accent/30 border border-border/50 rounded-md focus:outline-none focus:ring-1 focus:ring-ring text-xs"
          >
            {workspaces.map((ws) => (
              <option key={ws.path} value={ws.path}>{ws.name}</option>
            ))}
          </select>
        )}
      </div>

      {/* Agent */}
      <div className="flex items-center gap-1.5">
        <Bot className="h-3 w-3 text-muted-foreground" />
        <select
          value={agentId ?? ''}
          onChange={(e) => onUpdate({ agentId: e.target.value || null })}
          disabled={hasMessages}
          title={hasMessages ? t('conversations.fields.agentLocked') : undefined}
          className="h-7 px-2 bg-accent/30 border border-border/50 rounded-md focus:outline-none focus:ring-1 focus:ring-ring text-xs disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <option value="">{t('conversations.fields.none')}</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
      </div>

      {/* Stage */}
      <div className="flex items-center gap-1.5">
        <span className="text-muted-foreground">{t('conversations.fields.stage')}</span>
        <select
          value={stageId ?? ''}
          onChange={(e) => onUpdate({ stageId: e.target.value || null })}
          className="h-7 px-2 bg-accent/30 border border-border/50 rounded-md focus:outline-none focus:ring-1 focus:ring-ring text-xs"
        >
          <option value="">{t('conversations.fields.none')}</option>
          {stages.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </div>

      {/* Reasoning effort — safe to change mid-conversation, so never locked */}
      <div className="flex items-center gap-1.5">
        <Brain className="h-3 w-3 text-muted-foreground" />
        <select
          value={resolveEffortValue(effort, thinking, thinkingBudget)}
          onChange={(e) => onUpdate(effortUpdate(e.target.value))}
          title={t('conversations.fields.effortHint')}
          className="h-7 px-2 bg-accent/30 border border-border/50 rounded-md focus:outline-none focus:ring-1 focus:ring-ring text-xs"
        >
          <option value="off">{t('conversations.fields.effortOff')}</option>
          <option value="low">{t('conversations.fields.effortLow')}</option>
          <option value="medium">{t('conversations.fields.effortMedium')}</option>
          <option value="high">{t('conversations.fields.effortHigh')}</option>
          <option value="max">{t('conversations.fields.effortMax')}</option>
        </select>
      </div>

      {/* Orchestration — custom menu so God Mode can use --god (OS popups cannot) */}
      <div className="flex items-center gap-1.5">
        <Network className="h-3 w-3 text-muted-foreground" />
        <OrchestrationMenu
          orchestration={orchestration}
          godMode={godMode}
          onUpdate={onUpdate}
        />
      </div>

      {/* Due date */}
      <div className="flex items-center gap-1.5">
        <Calendar className="h-3 w-3 text-muted-foreground" />
        <input
          type="date"
          value={dueDate ?? ''}
          onChange={(e) => onUpdate({ dueDate: e.target.value || null })}
          className="h-7 px-2 bg-accent/30 border border-border/50 rounded-md focus:outline-none focus:ring-1 focus:ring-ring text-xs"
        />
      </div>

      {/* Assignees */}
      {assignees.length > 0 && (
        <div className="flex items-center gap-1.5">
          <Users className="h-3 w-3 text-muted-foreground" />
          {assignees.map((a) => (
            <Badge key={a} variant="outline" className="text-[10px]">{a}</Badge>
          ))}
        </div>
      )}

      {/* Tags */}
      {resolvedTags.length > 0 && (
        <div className="flex items-center gap-1.5">
          <Tag className="h-3 w-3 text-muted-foreground" />
          {resolvedTags.map((tg: any) => (
            <Badge
              key={tg.id}
              variant="outline"
              className="text-[10px]"
              style={tg.color ? { borderColor: tg.color, color: tg.color } : undefined}
            >
              {tg.name}
            </Badge>
          ))}
        </div>
      )}
    </div>
  )
}

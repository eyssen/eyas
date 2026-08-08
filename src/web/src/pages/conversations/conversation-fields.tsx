import { useApi } from '@/hooks/use-api'
import { Badge } from '@/components/ui/badge'
import { Calendar, Tag, Users, Bot, Brain, Network } from 'lucide-react'
import { t } from './i18n'
import { resolveEffortValue, effortUpdate } from './conversation-fields-utils'

interface ProjectItem {
  id: string
  name: string
  color: string | null
  defaultAgentId: string | null
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
  hasMessages: boolean
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
  hasMessages,
  onUpdate,
}: ConversationFieldsProps) {
  const { data: projectData } = useApi<{ projects: ProjectItem[] }>('/projects')
  // Always load global stages — all projects share the same stages
  const { data: stageData } = useApi<{ stages: StageItem[] }>('/stages')
  const { data: agentData } = useApi<{ agents: AgentItem[] }>('/agents?enabled=true&tier=primary')
  const { data: tagData } = useApi<{ tags: { id: string; name: string; color: string | null }[] }>(
    `/conversations/${conversationId}/tags`
  )

  const projects = projectData?.projects ?? []
  const stages = stageData?.stages ?? []
  const agents = agentData?.agents ?? []
  const resolvedTags = tagData?.tags ?? tags.map((t) => ({ id: t, name: t, color: null }))

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
          {projects.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
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

      {/* Orchestration */}
      <div className="flex items-center gap-1.5">
        <Network className="h-3 w-3 text-muted-foreground" />
        <select
          value={orchestration || 'auto'}
          onChange={(e) => onUpdate({ orchestration: e.target.value })}
          title={t('conversations.fields.orchestrationHint')}
          className="h-7 px-2 bg-accent/30 border border-border/50 rounded-md focus:outline-none focus:ring-1 focus:ring-ring text-xs"
        >
          <option value="solo">{t('conversations.fields.orchestrationSolo')}</option>
          <option value="auto">{t('conversations.fields.orchestrationAuto')}</option>
          <option value="deep">{t('conversations.fields.orchestrationDeep')}</option>
        </select>
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
          {resolvedTags.map((t: any) => (
            <Badge
              key={t.id}
              variant="outline"
              className="text-[10px]"
              style={t.color ? { borderColor: t.color, color: t.color } : undefined}
            >
              {t.name}
            </Badge>
          ))}
        </div>
      )}
    </div>
  )
}

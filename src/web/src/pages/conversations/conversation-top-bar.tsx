import { useState } from 'react'
import { useNavigate, useRouter } from '@tanstack/react-router'
import { useApi } from '@/hooks/use-api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { ArrowLeft, Pencil, Check, Bot } from 'lucide-react'
import { ContextBar } from './context-bar'
import { VoiceScopeBadge } from './components/VoiceScopeBadge'
import type { VoiceScope } from '@/api/conversations'
import { t } from './i18n'

interface AgentInfo {
  id: string
  name: string
}

interface ConversationTopBarProps {
  conversationId: string
  title: string | null
  status: string
  priority: string
  providerId: string | null
  modelId: string | null
  agentId: string | null
  tokensUsed: number
  contextWindow: number
  voiceScope?: VoiceScope
  onProviderChange: (providerId: string, modelId: string) => void
  onTitleChange: (title: string) => void
  onUpdate: (fields: Record<string, unknown>) => void
}

const STATUS_BADGE: Record<string, { className: string; labelKey: string }> = {
  idle: { className: 'text-zinc-400', labelKey: 'conversations.status.idle' },
  working: { className: 'text-blue-400 animate-pulse', labelKey: 'conversations.status.working' },
  waiting: { className: 'text-yellow-400', labelKey: 'conversations.status.waiting' },
  waiting_approval: { className: 'text-amber-400', labelKey: 'conversations.status.waiting_approval' },
  archived: { className: 'text-zinc-600', labelKey: 'conversations.status.archived' },
}

const PRIORITY_OPTIONS = [
  { value: 'low', labelKey: 'conversations.topBar.priorityLow', className: 'text-zinc-400' },
  { value: 'normal', labelKey: 'conversations.topBar.priorityNormal', className: 'text-blue-400' },
  { value: 'high', labelKey: 'conversations.topBar.priorityHigh', className: 'text-orange-400' },
  { value: 'urgent', labelKey: 'conversations.topBar.priorityUrgent', className: 'text-red-400' },
]

const PROVIDER_NAMES: Record<string, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  openrouter: 'OpenRouter',
  gemini: 'Gemini',
  'claude-code': 'Claude Code CLI',
  'claude-code-sdk': 'Claude Code SDK',
}

export function ConversationTopBar({
  conversationId,
  title,
  status,
  priority,
  providerId,
  modelId,
  agentId,
  tokensUsed,
  contextWindow,
  voiceScope = null,
  onProviderChange,
  onTitleChange,
  onUpdate,
}: ConversationTopBarProps) {
  const navigate = useNavigate()
  const router = useRouter()
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState(title || '')
  const [localVoiceScope, setLocalVoiceScope] = useState<VoiceScope>(voiceScope)
  const { data: agentData } = useApi<{ agent: AgentInfo }>(agentId ? `/agents/${agentId}` : '')
  const saveTitle = () => {
    if (titleDraft.trim()) onTitleChange(titleDraft.trim())
    setEditingTitle(false)
  }

  const badge = STATUS_BADGE[status] ?? STATUS_BADGE.idle

  // navigate reserved for future navigation usage
  void navigate

  return (
    <div className="flex-shrink-0">
      <ContextBar tokensUsed={tokensUsed} contextWindow={contextWindow} />

      <div className="flex items-center gap-3 px-4 py-3 border-b border-border/50">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 flex-shrink-0"
          onClick={() => router.history.back()}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>

        <div className="flex items-center gap-2 min-w-0">
          {editingTitle ? (
            <div className="flex items-center gap-1">
              <Input
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && saveTitle()}
                onBlur={saveTitle}
                className="h-7 text-sm w-60"
                autoFocus
              />
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={saveTitle}>
                <Check className="h-3 w-3" />
              </Button>
            </div>
          ) : (
            <button
              className="text-sm font-semibold truncate flex items-center gap-1 hover:text-foreground/80"
              onClick={() => {
                setTitleDraft(title || '')
                setEditingTitle(true)
              }}
            >
              {title || t('conversations.untitled')}
              <Pencil className="h-3 w-3 text-muted-foreground" />
            </button>
          )}

          <Badge variant="outline" className={`text-[10px] ${badge.className}`}>
            {t(badge.labelKey)}
          </Badge>

          {agentId && agentData?.agent && (
            <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary">
              <Bot className="h-3 w-3" />
              {agentData.agent.name}
            </span>
          )}
        </div>

        {/* Priority selector */}
        <select
          value={priority}
          onChange={(e) => onUpdate({ priority: e.target.value })}
          className="h-8 px-2 text-xs bg-accent/30 border border-border/50 rounded-md focus:outline-none focus:ring-1 focus:ring-ring"
        >
          {PRIORITY_OPTIONS.map((p) => (
            <option key={p.value} value={p.value}>{t(p.labelKey)}</option>
          ))}
        </select>

        <div className="flex-1" />

        {/* Voice scope badge */}
        <VoiceScopeBadge
          conversationId={conversationId}
          currentScope={localVoiceScope}
          onChange={setLocalVoiceScope}
        />

        {/* Routing info (read-only) */}
        {providerId && (
          <span className="text-[10px] text-muted-foreground font-mono">
            {PROVIDER_NAMES[providerId] ?? providerId}
            {modelId && <> / {modelId.split('/').pop()}</>}
          </span>
        )}
        {!providerId && (
          <span className="text-[10px] text-muted-foreground">{t('conversations.topBar.autoRouting')}</span>
        )}
      </div>
    </div>
  )
}

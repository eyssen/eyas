import { useState } from 'react'
import { useNavigate, useRouter } from '@tanstack/react-router'
import { useApi } from '@/hooks/use-api'
import { Button } from '@/components/ui/button'
import { DesignAttachMenu } from './design-attach-menu'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { ArrowLeft, Pencil, Check, Bot, SquareTerminal, AlertTriangle } from 'lucide-react'
import { ContextBar } from './context-bar'
import { CompositionPanel } from './composition-panel'
import { VoiceScopeBadge } from './components/VoiceScopeBadge'
import type { VoiceScope } from '@/api/conversations'
import { cn } from '@/lib/utils'
import { ContextualHelp } from '@/components/docs/contextual-help'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { t } from './i18n'
import { useProviderDisplay } from '@/lib/provider-display'
import { bindingPatchFor, modelPickerView, type BindingPatch, type EffectiveBindingView, type PickerModel } from './model-picker'

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
  /** The conversation's binding mode and the pair its next turn runs on (GET effectiveBinding). */
  modelBinding?: string | null
  effectiveBinding?: EffectiveBindingView | null
  bindingError?: string | null
  /** The global "Allow Auto-routing" switch (GET autoRoutingEnabled). */
  autoRoutingEnabled?: boolean | null
  agentId: string | null
  parentConversationId?: string | null
  tokensUsed: number
  contextWindow: number
  estimatedTokens?: number
  /** true: estimatedTokens is the provider-reported prompt size of the last model call. */
  measured?: boolean
  voiceScope?: VoiceScope
  godMode?: boolean
  terminalOpen?: boolean
  onToggleTerminal?: () => void
  /** The model picker's choice, as the PATCH body that switches the binding. */
  onBindingChange: (patch: BindingPatch) => void
  onTitleChange: (title: string) => void
  onUpdate: (fields: Record<string, unknown>) => void
}

const STATUS_BADGE: Record<string, { className: string; labelKey: string }> = {
  idle: { className: 'text-zinc-400', labelKey: 'conversations.status.idle' },
  working: { className: 'text-blue-400 animate-pulse', labelKey: 'conversations.status.working' },
  waiting: { className: 'text-yellow-400', labelKey: 'conversations.status.waiting' },
  waiting_approval: { className: 'text-amber-400', labelKey: 'conversations.status.waiting_approval' },
  waiting_plan: { className: 'text-amber-400', labelKey: 'conversations.status.waiting_plan' },
  archived: { className: 'text-zinc-600', labelKey: 'conversations.status.archived' },
}

const PRIORITY_OPTIONS = [
  { value: 'low', labelKey: 'conversations.topBar.priorityLow', className: 'text-zinc-400' },
  { value: 'normal', labelKey: 'conversations.topBar.priorityNormal', className: 'text-blue-400' },
  { value: 'high', labelKey: 'conversations.topBar.priorityHigh', className: 'text-orange-400' },
  { value: 'urgent', labelKey: 'conversations.topBar.priorityUrgent', className: 'text-red-400' },
]

export function ConversationTopBar({
  conversationId,
  title,
  status,
  priority,
  providerId,
  modelId,
  modelBinding = null,
  effectiveBinding = null,
  bindingError = null,
  autoRoutingEnabled = null,
  agentId,
  parentConversationId = null,
  tokensUsed,
  contextWindow,
  estimatedTokens,
  measured = false,
  voiceScope = null,
  godMode = false,
  terminalOpen = false,
  onToggleTerminal,
  onBindingChange,
  onTitleChange,
  onUpdate,
}: ConversationTopBarProps) {
  const navigate = useNavigate()
  const router = useRouter()
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState(title || '')
  const [localVoiceScope, setLocalVoiceScope] = useState<VoiceScope>(voiceScope)
  const [compositionPanelOpen, setCompositionPanelOpen] = useState(false)
  const { data: agentData } = useApi<{ agent: AgentInfo }>(agentId ? `/agents/${agentId}` : '')
  // Enabled models of enabled providers — the fixed choices of the picker.
  const { data: modelsData } = useApi<{ models: PickerModel[] }>('/model/models')
  // The picker names providers from the shared catalog: re-render once it has loaded.
  useProviderDisplay()
  const saveTitle = () => {
    if (titleDraft.trim()) onTitleChange(titleDraft.trim())
    setEditingTitle(false)
  }

  const badge = STATUS_BADGE[status] ?? STATUS_BADGE.idle
  const picker = modelPickerView({
    modelBinding,
    providerId,
    modelId,
    agentId,
    parentConversationId,
    effectiveBinding,
    bindingError,
    autoRoutingEnabled,
    models: modelsData?.models ?? [],
  })

  // navigate reserved for future navigation usage
  void navigate

  return (
    <div className="flex-shrink-0">
      <ContextBar
        tokensUsed={tokensUsed}
        contextWindow={contextWindow}
        estimatedTokens={estimatedTokens}
        measured={measured}
        onClick={() => setCompositionPanelOpen(true)}
      />
      <CompositionPanel
        conversationId={conversationId}
        open={compositionPanelOpen}
        onOpenChange={setCompositionPanelOpen}
      />

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
          <ContextualHelp helpId="daily.conversations" className="shrink-0" />
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

        {onToggleTerminal && (
          <Button
            variant={terminalOpen ? 'secondary' : 'ghost'}
            size="icon"
            className="h-8 w-8"
            onClick={onToggleTerminal}
            title={t('conversations.topBar.terminal')}
            aria-pressed={terminalOpen}
          >
            <SquareTerminal className="h-4 w-4" />
          </Button>
        )}

        {/* Attached designs — an icon, because the bar has no room for a field. */}
        <DesignAttachMenu conversationId={conversationId} />

        {/* Voice scope badge */}
        <VoiceScopeBadge
          conversationId={conversationId}
          currentScope={localVoiceScope}
          onChange={setLocalVoiceScope}
        />

        {/* Model picker: a fixed model, Auto-routing or the colleague's
            default; the tooltip names the pair the next turn answers with. */}
        <div className={cn('flex min-w-0 items-center gap-1', godMode && 'opacity-50')}>
          {picker.tone !== 'normal' && (
            <span role="img" aria-label={picker.title} title={picker.title} className="flex-shrink-0">
              <AlertTriangle
                aria-hidden
                className={cn('h-3.5 w-3.5', picker.tone === 'error' ? 'text-destructive' : 'text-muted-foreground')}
              />
            </span>
          )}
          <SearchableSelect
            value={picker.value}
            displayLabel={picker.display}
            options={picker.options}
            onChange={(value) => {
              const patch = bindingPatchFor(value, picker.value)
              if (patch) onBindingChange(patch)
            }}
            title={godMode ? t('conversations.godMode.topBarMuted') : picker.title}
            ariaLabel={t('conversations.topBar.model')}
            searchPlaceholder={t('conversations.topBar.modelSearch')}
            emptyText={t('conversations.topBar.modelNoMatch')}
            className="w-40 min-w-0 sm:w-56"
            triggerClassName={picker.tone === 'error' ? 'border-destructive/60 text-destructive' : ''}
          />
        </div>
      </div>
    </div>
  )
}

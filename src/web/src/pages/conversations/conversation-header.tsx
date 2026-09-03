import { useState } from 'react'
import { useApi } from '@/hooks/use-api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { X, Pencil, Check } from 'lucide-react'
import { t } from './i18n'

interface ProviderOption {
  id: string
  name: string
  active: boolean
}
interface ModelOption {
  id: string
  modelId: string
  name: string
  enabled: boolean
}

interface ConversationHeaderProps {
  conversationId: string
  title: string | null
  status: string
  providerId: string | null
  modelId: string | null
  onClose: () => void
  onProviderChange: (providerId: string, modelId: string) => void
  onTitleChange: (title: string) => void
}

const STATUS_BADGE: Record<string, { className: string; labelKey: string }> = {
  idle: { className: 'text-zinc-400', labelKey: 'conversations.status.idle' },
  working: { className: 'text-blue-400 animate-pulse', labelKey: 'conversations.status.working' },
  waiting: { className: 'text-yellow-400', labelKey: 'conversations.status.waiting' },
  waiting_approval: { className: 'text-amber-400', labelKey: 'conversations.status.waiting_approval' },
  waiting_plan: { className: 'text-amber-400', labelKey: 'conversations.status.waiting_plan' },
  archived: { className: 'text-zinc-600', labelKey: 'conversations.status.archived' },
}

const PROVIDER_NAMES: Record<string, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  openrouter: 'OpenRouter',
  gemini: 'Gemini',
  'claude-code': 'Claude Code CLI',
  'claude-code-sdk': 'Claude Code SDK',
}

export function ConversationHeader({
  conversationId,
  title,
  status,
  providerId,
  modelId,
  onClose,
  onProviderChange,
  onTitleChange,
}: ConversationHeaderProps) {
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState(title || '')
  const { data: providerData } = useApi<{ providers: ProviderOption[] }>('/model/providers')
  const { data: modelData } = useApi<{ models: ModelOption[] }>(
    providerId ? `/model/providers/${providerId}` : ''
  )

  const providers = (providerData?.providers ?? []).filter((p) => p.active)
  const models: ModelOption[] = (modelData?.models ?? []).filter((m: ModelOption) => m.enabled)

  const saveTitle = () => {
    if (titleDraft.trim()) onTitleChange(titleDraft.trim())
    setEditingTitle(false)
  }

  const badge = STATUS_BADGE[status] ?? STATUS_BADGE.idle

  // Suppress unused variable warning — conversationId reserved for future use
  void conversationId

  return (
    <div className="flex items-center gap-3 p-4 border-b">
      <div className="flex-1 min-w-0 flex items-center gap-2">
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
      </div>

      {/* Provider select */}
      <select
        value={providerId ?? ''}
        onChange={(e) => onProviderChange(e.target.value, '')}
        className="h-8 px-2 text-xs bg-accent/30 border border-border/50 rounded-md focus:outline-none focus:ring-1 focus:ring-ring"
      >
        <option value="">{t('conversations.header.providerPlaceholder')}</option>
        {providers.map((p) => (
          <option key={p.id} value={p.id}>
            {PROVIDER_NAMES[p.id] ?? p.name}
          </option>
        ))}
      </select>

      {/* Model select */}
      <select
        value={modelId ?? ''}
        onChange={(e) => {
          if (providerId) onProviderChange(providerId, e.target.value)
        }}
        className="h-8 px-2 text-xs bg-accent/30 border border-border/50 rounded-md focus:outline-none focus:ring-1 focus:ring-ring max-w-[200px]"
      >
        <option value="">{t('conversations.header.modelPlaceholder')}</option>
        {models.map((m: ModelOption) => (
          <option key={m.id} value={m.modelId}>
            {m.name}
          </option>
        ))}
      </select>

      <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8 flex-shrink-0">
        <X className="h-4 w-4" />
      </Button>
    </div>
  )
}

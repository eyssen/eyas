import { ConversationMessages } from './conversation-messages'
import { ConversationInput } from './conversation-input'
import type { ToolCallData } from './components/tool-call-display'
import { PrivacyRefusalCard } from './privacy-refusal-card'
import { useConversationStore } from '@/stores/conversation-store'
import type { SendMessageOptions } from '@/hooks/use-streaming'

interface ConversationChatProps {
  messages: any[]
  streamingText: string
  streamingThinking: string
  isStreaming: boolean
  /** Server-side conversation status (working while agent runs even if SSE was detached) */
  conversationStatus?: string
  onSend: (content: string, attachmentIds?: string[], opts?: Pick<SendMessageOptions, 'plan' | 'privacy' | 'displayContent'>) => void
  onCancel?: () => void
  disabled: boolean
  conversationId: string
  providerId?: string | null
  modelId?: string | null
  godMode?: boolean
  workingDirectories?: unknown
  toolCalls?: ToolCallData[]
}

export function ConversationChat({
  messages,
  streamingText,
  streamingThinking,
  isStreaming,
  conversationStatus,
  onSend,
  onCancel,
  disabled,
  conversationId,
  providerId,
  modelId,
  godMode = false,
  workingDirectories,
  toolCalls = [],
}: ConversationChatProps) {
  const privacyProposal = useConversationStore((s) => s.privacyProposal)
  const refused = privacyProposal?.conversationId === conversationId ? privacyProposal : null

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <ConversationMessages
        messages={messages}
        conversationId={conversationId}
        streamingText={streamingText}
        streamingThinking={streamingThinking}
        isStreaming={isStreaming}
        conversationStatus={conversationStatus}
        onCancel={onCancel}
        onSend={(content) => onSend(content)}
        toolCalls={toolCalls}
      />
      {refused && (
        <div className="px-4 pb-2">
          <PrivacyRefusalCard
            proposal={refused}
            disabled={disabled}
            onSendMasked={() => {
              useConversationStore.getState().setPrivacyProposal(null)
              onSend(refused.content, refused.attachmentIds.length > 0 ? refused.attachmentIds : undefined, {
                ...(refused.plan ? { plan: true } : {}),
                privacy: 'mask',
                ...(refused.maskedContent !== null ? { displayContent: refused.maskedContent } : {}),
              })
            }}
            onEdit={() => {
              const state = useConversationStore.getState()
              state.setPrivacyProposal(null)
              state.setComposerDraft({ conversationId, content: refused.content, attachmentIds: refused.attachmentIds })
            }}
            onDismiss={() => useConversationStore.getState().setPrivacyProposal(null)}
          />
        </div>
      )}
      <ConversationInput
        onSend={onSend}
        disabled={disabled}
        conversationId={conversationId}
        providerId={providerId}
        modelId={modelId}
        godMode={godMode}
        conversationStatus={conversationStatus}
        workingDirectories={workingDirectories}
      />
    </div>
  )
}

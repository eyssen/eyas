import { ConversationMessages } from './conversation-messages'
import { ConversationInput } from './conversation-input'

interface ConversationChatProps {
  messages: any[]
  streamingText: string
  streamingThinking: string
  isStreaming: boolean
  /** Server-side conversation status (working while agent runs even if SSE was detached) */
  conversationStatus?: string
  onSend: (content: string, attachmentIds?: string[]) => void
  onCancel?: () => void
  disabled: boolean
  conversationId: string
  providerId?: string | null
  modelId?: string | null
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
}: ConversationChatProps) {
  return (
    <div className="flex-1 flex flex-col min-h-0">
      <ConversationMessages
        messages={messages}
        streamingText={streamingText}
        streamingThinking={streamingThinking}
        isStreaming={isStreaming}
        conversationStatus={conversationStatus}
        onCancel={onCancel}
        onSend={(content) => onSend(content)}
      />
      <ConversationInput
        onSend={onSend}
        disabled={disabled}
        conversationId={conversationId}
        providerId={providerId}
        modelId={modelId}
      />
    </div>
  )
}

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
  godMode?: boolean
  workingDirectories?: string[] | null
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
}: ConversationChatProps) {
  return (
    <div className="flex-1 flex flex-col min-h-0">
      <ConversationMessages
        messages={messages}
        conversationId={conversationId}
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
        godMode={godMode}
        conversationStatus={conversationStatus}
        workingDirectories={workingDirectories}
      />
    </div>
  )
}

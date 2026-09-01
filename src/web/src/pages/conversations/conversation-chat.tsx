import { ConversationMessages } from './conversation-messages'
import { ConversationInput } from './conversation-input'
import type { ToolCallData } from './components/tool-call-display'

interface ConversationChatProps {
  messages: any[]
  streamingText: string
  streamingThinking: string
  isStreaming: boolean
  /** Server-side conversation status (working while agent runs even if SSE was detached) */
  conversationStatus?: string
  onSend: (content: string, attachmentIds?: string[], opts?: { plan?: boolean }) => void
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

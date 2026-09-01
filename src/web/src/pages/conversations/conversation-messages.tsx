import { useState, useEffect, useRef, useMemo } from 'react'
import { Bot, User, Square, Brain, ChevronDown, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Streamdown } from 'streamdown'
import type { StreamdownProps } from 'streamdown'
import 'streamdown/styles.css'

/** Streamdown controls — fullscreen disabled (its fixed overlay conflicts with split layout) */
const sdControls: StreamdownProps['controls'] = {
  table: { copy: true, download: true, fullscreen: false },
  code: { copy: true, download: true },
}
import { A2UIRenderer } from '@/components/a2ui'
import { AgentConfigPreview, tryParseAgentConfig } from '@/components/agent-config-preview'
import { isA2UIMessage } from '../../../../shared/a2ui-types'
import type { A2UIMessage } from '../../../../shared/a2ui-types'
import { MessageAttachments } from './message-attachments'
import { t } from './i18n'
import { ToolCallDisplay, type ToolCallData } from './components/tool-call-display'

interface Message {
  id: number
  role: string
  content: string
  attachmentIds?: string[]
  createdAt: string
}

interface ConversationMessagesProps {
  messages: Message[]
  /** Needed to resolve the documents a message's attachments point at. */
  conversationId: string
  streamingText: string
  streamingThinking: string
  isStreaming: boolean
  /** When the server says working but local SSE is gone, show a background-run banner */
  conversationStatus?: string
  onCancel?: () => void
  onSend?: (content: string) => void
  toolCalls?: ToolCallData[]
}

/**
 * Try to parse message content as an A2UI structured message.
 * Returns the parsed A2UIMessage if valid, null otherwise.
 */
function tryParseA2UI(content: string): A2UIMessage | null {
  if (!content.startsWith('{')) return null
  try {
    const parsed = JSON.parse(content)
    return isA2UIMessage(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function ConversationMessages({
  messages,
  conversationId,
  streamingText,
  streamingThinking,
  isStreaming,
  conversationStatus,
  onCancel,
  onSend,
  toolCalls = [],
}: ConversationMessagesProps) {
  const paneRef = useRef<HTMLDivElement>(null)
  const [thinkingExpanded, setThinkingExpanded] = useState(false)
  const backgroundWorking =
    !isStreaming &&
    (conversationStatus === 'working' || conversationStatus === 'running')

  useEffect(() => {
    // Scroll only this pane. `scrollIntoView` walks every overflow ancestor,
    // so a 1cm-tall outer overflow (status bar + leftover padding) hid the
    // conversation header by jumping the whole page to the bottom.
    const pane = paneRef.current
    if (!pane) return
    pane.scrollTo({ top: pane.scrollHeight, behavior: 'smooth' })
  }, [messages.length, streamingText, streamingThinking, backgroundWorking, toolCalls.length])

  return (
    <div ref={paneRef} className="min-h-0 flex-1 overflow-y-auto p-4 space-y-4">
      {messages.map((msg) => (
        <div key={msg.id} className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : ''}`}>
          {msg.role !== 'user' && (
            <div className="h-7 w-7 rounded-lg bg-accent/50 flex items-center justify-center flex-shrink-0 mt-0.5">
              <Bot className="h-4 w-4 text-muted-foreground" />
            </div>
          )}
          <div
            className={`max-w-[75%] rounded-xl px-4 py-2.5 text-sm leading-relaxed ${msg.role === 'user' ? 'bg-primary text-primary-foreground whitespace-pre-wrap' : 'bg-accent/40 chat-message-content'}`}
          >
            {msg.attachmentIds && msg.attachmentIds.length > 0 && (
              <MessageAttachments attachmentIds={msg.attachmentIds} conversationId={conversationId} />
            )}
            {(() => {
              const a2ui = msg.role !== 'user' ? tryParseA2UI(msg.content) : null
              if (a2ui) {
                return (
                  <A2UIRenderer
                    message={a2ui}
                    onAction={(action, params) => {
                      const actionText = `[Action: ${action}] ${JSON.stringify(params)}`
                      onSend?.(actionText)
                    }}
                  />
                )
              }
              if (msg.role !== 'user') {
                const agentConfig = tryParseAgentConfig(msg.content)
                if (agentConfig) {
                  const textBefore = msg.content.replace(/```agent-config[\s\S]*?```/, '').trim()
                  return (
                    <>
                      {textBefore && <div className="mb-3"><Streamdown controls={sdControls}>{textBefore}</Streamdown></div>}
                      <AgentConfigPreview
                        config={agentConfig}
                        onModify={() => onSend?.('I want to modify this agent config')}
                      />
                    </>
                  )
                }
                // Render assistant messages with Streamdown (markdown)
                return <Streamdown controls={sdControls}>{msg.content}</Streamdown>
              }
              return msg.content
            })()}
          </div>
          {msg.role === 'user' && (
            <div className="h-7 w-7 rounded-lg bg-primary/20 flex items-center justify-center flex-shrink-0 mt-0.5">
              <User className="h-4 w-4 text-primary" />
            </div>
          )}
        </div>
      ))}

      {isStreaming && (
        <div className="flex gap-3">
          <div className="h-7 w-7 rounded-lg bg-accent/50 flex items-center justify-center flex-shrink-0 mt-0.5">
            <Bot className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="max-w-[75%]">
            {/* Thinking block — collapsible */}
            {streamingThinking && (
              <div className="mb-2">
                <button
                  onClick={() => setThinkingExpanded(!thinkingExpanded)}
                  className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors mb-1"
                >
                  <Brain className="h-3.5 w-3.5 text-violet-400" />
                  {thinkingExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                  <span className="italic">
                    {t('conversations.messages.thinking')}{!streamingText && <span className="animate-pulse">...</span>}
                    {' '}({streamingThinking.length.toLocaleString()} {t('conversations.messages.chars')})
                  </span>
                </button>
                {thinkingExpanded && (
                  <div className="rounded-lg px-3 py-2 text-xs leading-relaxed bg-violet-500/5 border border-violet-500/20 text-muted-foreground italic whitespace-pre-wrap max-h-60 overflow-y-auto">
                    {streamingThinking}
                  </div>
                )}
              </div>
            )}
            {toolCalls.length > 0 && (
              <div className="mb-2">
                {toolCalls.map((call, i) => (
                  <ToolCallDisplay key={call.toolUseId ?? `tool-${i}`} call={call} />
                ))}
              </div>
            )}
            <div className="rounded-xl px-4 py-2.5 text-sm leading-relaxed bg-accent/40">
              {streamingText ? (
                <Streamdown mode="streaming" controls={sdControls}>{streamingText}</Streamdown>
              ) : (
                streamingThinking
                  ? <span className="text-muted-foreground animate-pulse">{t('conversations.messages.composingResponse')}</span>
                  : toolCalls.some((c) => c.status === 'running')
                    ? <span className="text-muted-foreground animate-pulse">{t('conversations.messages.runningTools')}</span>
                    : <span className="text-muted-foreground animate-pulse">{t('conversations.messages.thinkingEllipsis')}</span>
              )}
            </div>
            {onCancel && (
              <div className="mt-1.5">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs text-muted-foreground hover:text-destructive"
                  onClick={onCancel}
                >
                  <Square className="h-3 w-3 mr-1 fill-current" />
                  {t('conversations.messages.stop')}
                </Button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Detached SSE: agent still running server-side */}
      {backgroundWorking && (
        <div className="flex gap-3">
          <div className="flex-shrink-0 w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center">
            <Bot className="h-3.5 w-3.5 text-primary animate-pulse" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs font-medium text-muted-foreground mb-1">Assistant</div>
            <div className="text-sm text-muted-foreground animate-pulse">
              {t('conversations.messages.backgroundWorking')}
            </div>
            {onCancel && (
              <div className="mt-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs text-destructive border-destructive/30 hover:bg-destructive/10"
                  onClick={onCancel}
                >
                  <Square className="h-3 w-3 mr-1 fill-current" />
                  {t('conversations.messages.stop')}
                </Button>
              </div>
            )}
          </div>
        </div>
      )}

      {messages.length === 0 && !isStreaming && !backgroundWorking && (
        <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
          {t('conversations.messages.emptyStart')}
        </div>
      )}

    </div>
  )
}

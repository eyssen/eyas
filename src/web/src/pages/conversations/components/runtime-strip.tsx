import { useEffect, useState } from 'react'
import { ChevronDown, ChevronRight, Activity } from 'lucide-react'
import { AgentProgress } from './agent-progress'
import { SubConversationTree } from './sub-conversation-tree'
import { RunTree } from './run-tree'
import type { ToolCallData } from './tool-call-display'
import { t } from '../i18n'

interface AgentProgressData {
  agentName: string
  turn: number
  maxTurns: number
  toolCalls: ToolCallData[]
  tokensUsed: number
  isRunning: boolean
}

interface RuntimeStripProps {
  forceOpen: boolean
  hasRunTree: boolean
  agentProgress: AgentProgressData | null
  onCancelProgress: () => void
  showSubTree: boolean
  conversationId: string
}

/**
 * Live runtime / orchestration UI for the conversation right column.
 * Kept separate from the context-rail history so agent idle↔working noise
 * never pollutes business notes and stage changes.
 */
export function RuntimeStrip({
  forceOpen,
  hasRunTree,
  agentProgress,
  onCancelProgress,
  showSubTree,
  conversationId,
}: RuntimeStripProps) {
  const hasContent = hasRunTree || Boolean(agentProgress) || showSubTree
  const [open, setOpen] = useState(forceOpen)

  useEffect(() => {
    if (forceOpen) setOpen(true)
  }, [forceOpen])

  if (!hasContent) return null

  return (
    <div className="flex-shrink-0 border-b border-border/30">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground hover:bg-accent/20 transition-colors"
      >
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        <Activity className="h-3 w-3" />
        <span>{t('conversations.chatter.runtime')}</span>
        {agentProgress?.isRunning && (
          <span className="ml-auto text-[10px] text-primary animate-pulse">
            {t('conversations.agentProgress.running')}
          </span>
        )}
      </button>

      {open && (
        <div className="max-h-[40vh] overflow-y-auto">
          {hasRunTree && (
            <div className="p-3 border-t border-border/20">
              <RunTree />
            </div>
          )}

          {agentProgress && (
            <div className="p-3 border-t border-border/20">
              <AgentProgress
                agentName={agentProgress.agentName}
                turn={agentProgress.turn}
                maxTurns={agentProgress.maxTurns}
                toolCalls={agentProgress.toolCalls}
                tokensUsed={agentProgress.tokensUsed}
                isRunning={agentProgress.isRunning}
                onCancel={onCancelProgress}
              />
            </div>
          )}

          {showSubTree && (
            <div className="p-3 border-t border-border/20">
              <SubConversationTree conversationId={conversationId} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

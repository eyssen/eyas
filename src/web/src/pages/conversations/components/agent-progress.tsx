// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// The live run panel (runtime strip). The same for every provider:
//   - who runs it: the colleague's name (resolved from agent_start.agentId),
//     an explicit run label (God Mode), else "Assistant";
//   - "Step N / Max" when the provider reports its steps (progress frames),
//     otherwise "N tool calls" — a CLI that runs its tools internally and
//     reports no steps is never shown as "Step 1" after dozens of calls;
//   - the token total summed over every model call of the run;
//   - the tool rows, each settled only by its own result.

import { Bot, XCircle } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useApi } from '@/hooks/use-api'
import { ToolCallDisplay, type ToolCallData } from './tool-call-display'
import { t } from '../i18n'

interface AgentProgressProps {
  /** The colleague the run speaks as; its name is looked up. */
  agentId?: string | null
  /** An explicit run label (God Mode); wins over the looked-up name. */
  agentName?: string
  agentAvatar?: string | null
  maxTurns: number
  steps?: number
  stepsKnown?: boolean
  toolCalls: ToolCallData[]
  tokensUsed: number
  isRunning: boolean
  onCancel?: () => void
}

/** The panel's progress line: provider-reported steps when known, else the tool-call count. */
export function progressLabel(p: { steps?: number; stepsKnown?: boolean; maxTurns: number; toolCallCount: number }): string {
  if (p.stepsKnown) return t('conversations.agentProgress.stepOf', { step: p.steps ?? 0, max: p.maxTurns })
  return t('conversations.agentProgress.toolCallsCount', { count: p.toolCallCount })
}

export function AgentProgress({
  agentId,
  agentName,
  agentAvatar,
  maxTurns,
  steps = 0,
  stepsKnown = false,
  toolCalls,
  tokensUsed,
  isRunning,
  onCancel,
}: AgentProgressProps) {
  const { data: agentData } = useApi<{ agent?: { name?: string | null } }>(agentId && !agentName ? `/agents/${agentId}` : '')
  const displayName = agentName || agentData?.agent?.name || t('conversations.messages.assistant')
  const activeCalls = toolCalls.filter((c) => c.status === 'running')
  const completedCalls = toolCalls.filter((c) => c.status !== 'running')
  const stepPct = stepsKnown && maxTurns > 0 ? Math.min((steps / maxTurns) * 100, 100) : 0

  return (
    <div className="glass-card p-3 space-y-3">
      {/* Agent header */}
      <div className="flex items-center gap-2.5">
        <div className="h-8 w-8 rounded-lg bg-primary/15 flex items-center justify-center flex-shrink-0">
          {agentAvatar ? (
            <span className="text-sm">{agentAvatar}</span>
          ) : (
            <Bot className="h-4 w-4 text-primary" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium truncate" data-testid="agent-progress-name">{displayName}</div>
          <div className="text-[10px] text-muted-foreground" data-testid="agent-progress-steps">
            {progressLabel({ steps, stepsKnown, maxTurns, toolCallCount: toolCalls.length })}
          </div>
        </div>
        {isRunning && (
          <Badge variant="outline" className="text-[10px] text-primary border-primary/30 animate-pulse">
            {t('conversations.agentProgress.running')}
          </Badge>
        )}
      </div>

      {/* Step progress bar — only when the provider reports its steps */}
      {stepsKnown && (
        <div className="h-1 rounded-full bg-accent/40 overflow-hidden">
          <div
            className="h-full rounded-full bg-primary transition-all duration-300"
            style={{ width: `${stepPct}%` }}
          />
        </div>
      )}

      {/* Active tool calls */}
      {activeCalls.length > 0 && (
        <div className="space-y-1">
          {activeCalls.map((call, i) => (
            <ToolCallDisplay key={call.toolUseId ?? `active-${i}`} call={call} />
          ))}
        </div>
      )}

      {/* Completed tool calls */}
      {completedCalls.length > 0 && (
        <div className="space-y-0.5 max-h-48 overflow-y-auto">
          {completedCalls.map((call, i) => (
            <ToolCallDisplay key={call.toolUseId ?? `done-${i}`} call={call} />
          ))}
        </div>
      )}

      {/* Footer: tokens + cancel */}
      <div className="flex items-center justify-between pt-1 border-t border-border/30">
        <span
          className="text-[10px] text-muted-foreground tabular-nums cursor-help"
          title={t('conversations.agentProgress.tokensHint')}
        >
          {t('conversations.agentProgress.tokens', { count: (tokensUsed || 0).toLocaleString() })}
        </span>
        {isRunning && onCancel && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-[10px] text-destructive hover:text-destructive hover:bg-destructive/10"
            onClick={onCancel}
          >
            <XCircle className="h-3 w-3 mr-1" />
            {t('conversations.agentProgress.cancel')}
          </Button>
        )}
      </div>
    </div>
  )
}

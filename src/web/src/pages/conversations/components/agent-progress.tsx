// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { Bot, XCircle, Loader2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ToolCallDisplay, type ToolCallData } from './tool-call-display'
import { t } from '../i18n'

interface AgentProgressProps {
  agentName: string
  agentAvatar?: string | null
  turn: number
  maxTurns: number
  toolCalls: ToolCallData[]
  tokensUsed: number
  isRunning: boolean
  onCancel?: () => void
}

export function AgentProgress({
  agentName,
  agentAvatar,
  turn,
  maxTurns,
  toolCalls,
  tokensUsed,
  isRunning,
  onCancel,
}: AgentProgressProps) {
  const activeCalls = toolCalls.filter((c) => c.status === 'running')
  const completedCalls = toolCalls.filter((c) => c.status !== 'running')
  const turnPct = maxTurns > 0 ? Math.min((turn / maxTurns) * 100, 100) : 0

  return (
    <div className="glass-card p-3 space-y-3">
      {/* Agent header */}
      <div className="flex items-center gap-2.5">
        <div className="h-8 w-8 rounded-lg bg-purple-500/20 flex items-center justify-center flex-shrink-0">
          {agentAvatar ? (
            <span className="text-sm">{agentAvatar}</span>
          ) : (
            <Bot className="h-4 w-4 text-purple-400" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium truncate">{agentName}</div>
          <div className="text-[10px] text-muted-foreground">
            {t('conversations.agentProgress.turnOf', { turn, max: maxTurns })}
          </div>
        </div>
        {isRunning && (
          <Badge variant="outline" className="text-[10px] text-blue-400 border-blue-500/30 animate-pulse">
            {t('conversations.agentProgress.running')}
          </Badge>
        )}
      </div>

      {/* Turn progress bar */}
      <div className="h-1 rounded-full bg-accent/40 overflow-hidden">
        <div
          className="h-full rounded-full bg-purple-500 transition-all duration-300"
          style={{ width: `${turnPct}%` }}
        />
      </div>

      {/* Active tool calls */}
      {activeCalls.length > 0 && (
        <div className="space-y-1">
          {activeCalls.map((call, i) => (
            <div key={`active-${i}`} className="flex items-center gap-2 text-xs text-blue-400">
              <Loader2 className="h-3 w-3 animate-spin flex-shrink-0" />
              <span className="font-mono truncate">{call.toolName}</span>
            </div>
          ))}
        </div>
      )}

      {/* Completed tool calls */}
      {completedCalls.length > 0 && (
        <div className="space-y-0.5 max-h-48 overflow-y-auto">
          {completedCalls.map((call, i) => (
            <ToolCallDisplay key={`done-${i}`} call={call} />
          ))}
        </div>
      )}

      {/* Footer: tokens + cancel */}
      <div className="flex items-center justify-between pt-1 border-t border-border/30">
        <span className="text-[10px] text-muted-foreground tabular-nums">
          {t('conversations.agentProgress.tokens', { count: tokensUsed.toLocaleString() })}
        </span>
        {isRunning && onCancel && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-[10px] text-red-400 hover:text-red-300 hover:bg-red-500/10"
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

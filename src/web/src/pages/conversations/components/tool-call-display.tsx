// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { ChevronDown, ChevronRight, CheckCircle2, XCircle, Loader2 } from 'lucide-react'
import { t } from '../i18n'

export interface ToolCallData {
  /** SSE tool_use block id — tool_result events match on it */
  toolUseId?: string
  toolName: string
  input?: Record<string, unknown>
  /** Tool result payload — plain string content from the SSE stream, or structured data */
  output?: unknown
  error?: string
  durationMs?: number
  status: 'running' | 'success' | 'error'
}

interface ToolCallDisplayProps {
  call: ToolCallData
}

export function ToolCallDisplay({ call }: ToolCallDisplayProps) {
  const [expanded, setExpanded] = useState(false)

  const hasOutput =
    call.output != null &&
    (typeof call.output === 'object'
      ? Object.keys(call.output as Record<string, unknown>).length > 0
      : String(call.output).length > 0)

  return (
    <div className="rounded-lg border border-border/50 bg-accent/20 text-xs my-1.5">
      <button
        type="button"
        className="flex items-center gap-2 w-full px-3 py-2 text-left hover:bg-accent/30 transition-colors rounded-lg"
        onClick={() => setExpanded(!expanded)}
      >
        {call.status === 'running' ? (
          <Loader2 className="h-3.5 w-3.5 text-blue-400 animate-spin flex-shrink-0" />
        ) : call.status === 'success' ? (
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 flex-shrink-0" />
        ) : (
          <XCircle className="h-3.5 w-3.5 text-red-400 flex-shrink-0" />
        )}

        <Badge variant="outline" className="text-[10px] font-mono">
          {call.toolName}
        </Badge>

        <span className="flex-1" />

        {call.durationMs !== undefined && (
          <span className="text-muted-foreground tabular-nums">
            {call.durationMs < 1000 ? `${call.durationMs}ms` : `${(call.durationMs / 1000).toFixed(1)}s`}
          </span>
        )}

        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
        )}
      </button>

      {expanded && (
        <div className="px-3 pb-2 space-y-2">
          {call.input && Object.keys(call.input).length > 0 && (
            <div>
              <span className="text-muted-foreground text-[10px] uppercase tracking-wider">{t('conversations.toolCall.input')}</span>
              <pre className="mt-0.5 p-2 rounded bg-background/50 text-[11px] overflow-x-auto max-h-32 overflow-y-auto">
                {JSON.stringify(call.input, null, 2)}
              </pre>
            </div>
          )}
          {hasOutput && (
            <div>
              <span className="text-muted-foreground text-[10px] uppercase tracking-wider">{t('conversations.toolCall.output')}</span>
              <pre className="mt-0.5 p-2 rounded bg-background/50 text-[11px] overflow-x-auto max-h-32 overflow-y-auto">
                {typeof call.output === 'string' ? call.output : JSON.stringify(call.output, null, 2)}
              </pre>
            </div>
          )}
          {call.error && (
            <div>
              <span className="text-red-400 text-[10px] uppercase tracking-wider">{t('conversations.toolCall.error')}</span>
              <pre className="mt-0.5 p-2 rounded bg-red-500/10 text-[11px] text-red-300 overflow-x-auto">
                {call.error}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

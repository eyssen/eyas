// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Badge } from '@/components/ui/badge'
import { Ban, ChevronDown, ChevronRight, CheckCircle2, CircleHelp, Loader2, ShieldAlert, SkipForward, XCircle } from 'lucide-react'
import { t } from '../i18n'
import { TOOL_STATUS_KEY, type ToolCallStatus } from '../tool-status'
import { briefToolArgs, briefToolResult, fileEditDiff, type DiffHunk } from './tool-trace'
import { parseSearchScopeTag, type SearchScopeTarget } from '../../../../../shared/memory-sovereignty/search-scope-code'

export interface ToolCallData {
  /** SSE tool_use block id — tool_result events match on it */
  toolUseId?: string
  /** The canonical tool name (the row label). */
  toolName: string
  /** The provider's own name for the tool, when it differs (shown as a tooltip). */
  rawName?: string
  input?: Record<string, unknown>
  /** Tool result payload — plain string content from the SSE stream, or structured data */
  output?: unknown
  error?: string
  durationMs?: number
  status: ToolCallStatus
}

/** One icon and one colour token per row status — the same on every provider. */
const STATUS_ICON: Record<ToolCallStatus, { icon: typeof CheckCircle2; className: string }> = {
  running: { icon: Loader2, className: 'text-primary animate-spin' },
  success: { icon: CheckCircle2, className: 'text-success' },
  error: { icon: XCircle, className: 'text-destructive' },
  denied: { icon: Ban, className: 'text-destructive' },
  approval_required: { icon: ShieldAlert, className: 'text-warning' },
  skipped: { icon: SkipForward, className: 'text-muted-foreground' },
  unknown: { icon: CircleHelp, className: 'text-muted-foreground' },
}

/**
 * A CLI search refused for what its folder contains (the memory-path policy's
 * tagged "search too broad" reason): explained in the viewer's language.
 */
const SEARCH_SCOPE_KEY: Record<SearchScopeTarget, string> = {
  'foreign-memory': 'conversations.toolCall.searchScope.foreignMemory',
  'eyas-data': 'conversations.toolCall.searchScope.eyasData',
  'provider-home': 'conversations.toolCall.searchScope.providerHome',
  'other-workspace': 'conversations.toolCall.searchScope.otherWorkspace',
}

/** Statuses whose label is spelled out on the row (running and success speak through their icon). */
const LABELLED: ReadonlySet<ToolCallStatus> = new Set<ToolCallStatus>(['error', 'denied', 'approval_required', 'skipped', 'unknown'])

interface ToolCallDisplayProps {
  call: ToolCallData
}

function DiffView({ hunks }: { hunks: DiffHunk[] }) {
  return (
    <pre className="mt-0.5 p-2 rounded bg-background/50 text-[11px] overflow-x-auto max-h-56 overflow-y-auto font-mono leading-5">
      {hunks.map((hunk, i) => (
        <div
          key={i}
          className={
            hunk.type === 'add'
              ? 'bg-success/10 text-success'
              : hunk.type === 'del'
                ? 'bg-destructive/10 text-destructive'
                : 'text-muted-foreground'
          }
        >
          {hunk.type === 'add' ? '+' : hunk.type === 'del' ? '-' : ' '}
          {hunk.text}
        </div>
      ))}
    </pre>
  )
}

function parseHandoff(call: ToolCallData): { conversationId: string; agentName?: string } | null {
  if (call.toolName !== 'handoff_to_colleague' || call.status !== 'success') return null
  let payload: unknown = call.output
  if (typeof payload === 'string') {
    try { payload = JSON.parse(payload) } catch { return null }
  }
  if (!payload || typeof payload !== 'object') return null
  const rec = payload as { handedOff?: unknown; conversationId?: unknown; agentName?: unknown }
  if (rec.handedOff && typeof rec.conversationId === 'string') {
    return { conversationId: rec.conversationId, agentName: typeof rec.agentName === 'string' ? rec.agentName : undefined }
  }
  return null
}

export function ToolCallDisplay({ call }: ToolCallDisplayProps) {
  const navigate = useNavigate()
  const handoff = parseHandoff(call)
  const diff = fileEditDiff(call)
  const [expanded, setExpanded] = useState(Boolean(diff) || Boolean(handoff))
  const args = briefToolArgs(call.toolName, call.input)
  const result = call.status === 'running' ? '' : briefToolResult(call)

  // A failed call carries its text as both output and error: show it once.
  const hasOutput =
    call.output != null &&
    call.output !== call.error &&
    (typeof call.output === 'object'
      ? Object.keys(call.output as Record<string, unknown>).length > 0
      : String(call.output).length > 0)
  const { icon: StatusIcon, className: statusClass } = STATUS_ICON[call.status] ?? STATUS_ICON.unknown
  const statusLabel = t(TOOL_STATUS_KEY[call.status] ?? TOOL_STATUS_KEY.unknown)
  const rawNameTitle = call.rawName && call.rawName !== call.toolName
    ? t('conversations.toolCall.rawName', { name: call.rawName })
    : undefined
  const searchScope = call.status === 'running'
    ? null
    : parseSearchScopeTag(call.error) ?? parseSearchScopeTag(typeof call.output === 'string' ? call.output : undefined)

  return (
    <div className="rounded-lg border border-border/50 bg-accent/20 text-xs my-1.5">
      <button
        type="button"
        className="flex items-center gap-2 w-full px-3 py-2 text-left hover:bg-accent/30 transition-colors rounded-lg"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="inline-flex flex-shrink-0" title={statusLabel}>
          <StatusIcon
            className={`h-3.5 w-3.5 ${statusClass}`}
            role="img"
            aria-label={statusLabel}
            data-status={call.status}
          />
        </span>

        <Badge variant="outline" className="text-[10px] font-mono" title={rawNameTitle}>
          {call.toolName}
        </Badge>

        {LABELLED.has(call.status) && (
          <span className={`shrink-0 text-[10px] ${statusClass.replace('animate-spin', '').trim()}`} data-testid="tool-status-label">
            {statusLabel}
          </span>
        )}

        {args && (
          <span className="font-mono text-muted-foreground truncate" title={args}>
            {args}
          </span>
        )}

        {result && (
          <span className="text-muted-foreground truncate hidden sm:inline" title={result}>
            {result}
          </span>
        )}

        {handoff && (
          <button
            type="button"
            className="shrink-0 text-[11px] text-primary hover:underline"
            onClick={(e) => {
              e.stopPropagation()
              navigate({ to: '/conversations/$conversationId', params: { conversationId: handoff.conversationId } })
            }}
          >
            {t('conversations.handoff.open', { name: handoff.agentName ?? '' })}
          </button>
        )}

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

      {searchScope && (
        <p className="px-3 pb-2 text-[11px] text-muted-foreground" data-testid="tool-search-scope">
          {t(SEARCH_SCOPE_KEY[searchScope])}
        </p>
      )}

      {expanded && (
        <div className="px-3 pb-2 space-y-2">
          {diff && diff.hunks.length > 0 && (
            <div>
              <span className="text-muted-foreground text-[10px] uppercase tracking-wider">{t('conversations.toolCall.diff')}</span>
              <DiffView hunks={diff.hunks} />
            </div>
          )}
          {call.input && Object.keys(call.input).length > 0 && !diff && (
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
              <span className="text-destructive text-[10px] uppercase tracking-wider">{t('conversations.toolCall.error')}</span>
              <pre className="mt-0.5 p-2 rounded bg-destructive/10 text-[11px] text-destructive overflow-x-auto whitespace-pre-wrap">
                {call.error}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

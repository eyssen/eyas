// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { useNavigate } from '@tanstack/react-router'
import { Bot, Clock, Zap, Layers, ExternalLink, ListChecks, CircleDollarSign } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { formatRunCost, useRunTreeStore, type RunNode, type RunNodeStatus, type RunStatus } from '@/stores/run-tree-store'
import { t } from '../i18n'

// Theme tokens only (CSS variables): the status reads the same in every theme.
const STATUS_DOT: Record<RunNodeStatus, string> = {
  pending: 'border border-muted-foreground bg-transparent',
  running: 'bg-primary animate-pulse',
  completed: 'bg-foreground/60',
  failed: 'bg-destructive',
  cancelled: 'bg-muted-foreground',
  paused: 'bg-god',
}

const STATUS_TEXT: Record<RunNodeStatus, string> = {
  pending: 'text-muted-foreground',
  running: 'text-primary',
  completed: 'text-foreground/70',
  failed: 'text-destructive',
  cancelled: 'text-muted-foreground',
  paused: 'text-god',
}

/** The localized name of a node's or a run's status. */
export function runStatusLabel(status: RunNodeStatus | Exclude<RunStatus, null>): string {
  return t(`conversations.runTree.status.${status}`)
}

function RunNodeRow({ nodeId, depth }: { nodeId: string; depth: number }) {
  const node = useRunTreeStore((s) => s.nodes[nodeId]) as RunNode | undefined
  const childIds = useRunTreeStore((s) => s.childIds[nodeId])
  const navigate = useNavigate()
  if (!node) return null

  const dot = STATUS_DOT[node.status] ?? 'bg-muted-foreground'
  const text = STATUS_TEXT[node.status] ?? 'text-muted-foreground'
  const isPlanStep = node.kind === 'plan_step'
  const Icon = isPlanStep ? ListChecks : node.kind === 'agent' ? Layers : Bot
  // A root started without a model name shows its agent, else the tree's name.
  const label = node.label || node.agentId || t('conversations.runTree.workflow')

  return (
    <div>
      <div
        className="glass-card p-2 flex items-center gap-2 mb-1.5"
        style={{ marginLeft: depth * 16 }}
        data-kind={node.kind}
        data-status={node.status}
      >
        <span className={`w-2 h-2 rounded-full shrink-0 ${dot}`} />
        {isPlanStep ? (
          <span role="img" className="shrink-0 flex" title={t('conversations.runTree.planStep')} aria-label={t('conversations.runTree.planStep')}>
            <Icon className={`h-3.5 w-3.5 ${text}`} aria-hidden />
          </span>
        ) : (
          <Icon className={`h-3.5 w-3.5 shrink-0 ${text}`} aria-hidden />
        )}
        <span className="text-xs font-medium truncate flex-1">{label}</span>

        {node.turn > 0 && (
          <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground shrink-0">
            <Clock className="h-3 w-3" />
            {node.turn}
          </span>
        )}
        {node.tokens > 0 && (
          <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground shrink-0">
            <Zap className="h-3 w-3" />
            {node.tokens.toLocaleString()}
          </span>
        )}
        {node.currentTool && (
          <span className="text-[10px] text-primary truncate max-w-[90px]">{node.currentTool}…</span>
        )}
        {!node.currentTool && (
          <Badge variant="outline" className={`text-[9px] shrink-0 ${text}`}>{runStatusLabel(node.status)}</Badge>
        )}
        {node.conversationId && (
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground shrink-0"
            title={t('conversations.runTree.openConversation')}
            onClick={() => navigate({ to: '/conversations/$conversationId', params: { conversationId: node.conversationId! } })}
          >
            <ExternalLink className="h-3 w-3" />
          </button>
        )}
      </div>

      {(childIds ?? []).map((childId) => (
        <RunNodeRow key={childId} nodeId={childId} depth={depth + 1} />
      ))}
    </div>
  )
}

/**
 * Live `/workflows`-style run tree. Reads the run-tree-store, which is fed by
 * the `orchestration:<runId>` WS subscriptions in conversation-page — the
 * agent runner emits it for every provider, a CLI adds its plan steps.
 */
export function RunTree() {
  const rootIds = useRunTreeStore((s) => s.rootIds)
  const status = useRunTreeStore((s) => s.status)
  const cost = useRunTreeStore((s) => s.cost)

  if (rootIds.length === 0) return null

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium">{t('conversations.runTree.workflow')}</span>
        {status && (
          <Badge variant={status === 'running' ? 'default' : 'outline'} className="text-[9px]">
            {runStatusLabel(status)}
          </Badge>
        )}
        {cost && (
          <span
            className="flex items-center gap-0.5 text-[10px] text-muted-foreground"
            title={cost.usd === null ? t('conversations.runTree.costUnknown') : undefined}
            data-testid="run-tree-cost"
          >
            <CircleDollarSign className="h-3 w-3" aria-hidden />
            {formatRunCost(cost.usd)}
          </span>
        )}
      </div>
      {rootIds.map((id) => (
        <RunNodeRow key={id} nodeId={id} depth={0} />
      ))}
    </div>
  )
}

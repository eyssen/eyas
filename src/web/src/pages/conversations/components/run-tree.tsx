// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { useNavigate } from '@tanstack/react-router'
import { Bot, Clock, Zap, Layers, ExternalLink } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { useRunTreeStore, type RunNode, type RunNodeStatus } from '@/stores/run-tree-store'
import { t } from '../i18n'

const STATUS_DOT: Record<RunNodeStatus, string> = {
  running: 'bg-blue-400 animate-pulse',
  completed: 'bg-emerald-400',
  failed: 'bg-red-400',
  cancelled: 'bg-zinc-400',
  paused: 'bg-amber-400',
}

const STATUS_TEXT: Record<RunNodeStatus, string> = {
  running: 'text-blue-400',
  completed: 'text-emerald-400',
  failed: 'text-red-400',
  cancelled: 'text-zinc-400',
  paused: 'text-amber-400',
}

function RunNodeRow({ nodeId, depth }: { nodeId: string; depth: number }) {
  const node = useRunTreeStore((s) => s.nodes[nodeId]) as RunNode | undefined
  const childIds = useRunTreeStore((s) => s.childIds[nodeId])
  const navigate = useNavigate()
  if (!node) return null

  const dot = STATUS_DOT[node.status] ?? 'bg-zinc-400'
  const text = STATUS_TEXT[node.status] ?? 'text-zinc-400'
  const isPhase = node.kind === 'agent'
  const Icon = isPhase ? Layers : Bot

  return (
    <div>
      <div
        className="glass-card p-2 flex items-center gap-2 mb-1.5"
        style={{ marginLeft: depth * 16 }}
      >
        <span className={`w-2 h-2 rounded-full shrink-0 ${dot}`} />
        <Icon className={`h-3.5 w-3.5 shrink-0 ${text}`} />
        <span className="text-xs font-medium truncate flex-1">{node.label}</span>

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
          <span className="text-[10px] text-blue-400 truncate max-w-[90px]">{node.currentTool}…</span>
        )}
        {!node.currentTool && (
          <Badge variant="outline" className={`text-[9px] shrink-0 ${text}`}>{node.status}</Badge>
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
 * the `orchestration:<runId>` WS subscription in conversation-page.
 */
export function RunTree() {
  const rootIds = useRunTreeStore((s) => s.rootIds)
  const status = useRunTreeStore((s) => s.status)

  if (rootIds.length === 0) return null

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium">{t('conversations.runTree.workflow')}</span>
        {status && (
          <Badge variant={status === 'running' ? 'default' : 'outline'} className="text-[9px]">
            {status}
          </Badge>
        )}
      </div>
      {rootIds.map((id) => (
        <RunNodeRow key={id} nodeId={id} depth={0} />
      ))}
    </div>
  )
}

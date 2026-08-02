// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { X } from 'lucide-react'
import { useNavigate } from '@tanstack/react-router'
import { cn } from '@/lib/utils'
import { api } from '@/lib/api'
import { useBoardStore } from '@/stores/board-store'
import { t } from './i18n'

interface PinnedConversation {
  id: string
  taskId: string
  title: string | null
  status: string
  stageName: string
  stageColor: string | null
}

interface BoardPinnedProps {
  conversations: PinnedConversation[]
  projectName?: string
  projectColor?: string
}

// waiting_approval reuses the 'waiting' amber — same convention as
// AgentCard.tsx / board-dashboard.tsx / board-timeline.tsx (amber = blocked
// on something outside the run itself, whether a reply or an approval).
const STATUS_LABEL: Record<string, { textKey: string; color: string } | null> = {
  working: { textKey: 'board.pinned.status.working', color: '#3fb950' },
  waiting: { textKey: 'board.pinned.status.waiting', color: '#d29922' },
  waiting_approval: { textKey: 'board.pinned.status.waiting_approval', color: '#d29922' },
  error: { textKey: 'board.pinned.status.error', color: '#f85149' },
  idle: null,
}

const STATUS_BORDER: Record<string, string> = {
  working: '#3fb950',
  waiting: '#d29922',
  waiting_approval: '#d29922',
  error: '#f85149',
  idle: 'transparent',
}

export function BoardPinned({ conversations }: BoardPinnedProps) {
  const navigate = useNavigate()
  const fetchBoard = useBoardStore(s => s.fetchBoard)
  const currentProjectId = useBoardStore(s => s.currentProjectId)

  const handleUnpin = async (e: React.MouseEvent, convId: string) => {
    e.stopPropagation()
    await api.patch(`/conversations/${convId}`, { pinned: false })
    if (currentProjectId) fetchBoard(currentProjectId)
  }

  return (
    <div className="w-[160px] min-w-[160px] border-r border-border/30 flex flex-col overflow-y-auto py-2 px-2">
      {/* Header */}
      <div className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/60 mb-2 px-0.5">
        {t('board.pinned.title')}
      </div>

      {/* Pinned cards */}
      <div className="flex flex-col gap-1">
        {conversations.map(conv => {
          const statusInfo = STATUS_LABEL[conv.status] ?? null
          const borderColor = STATUS_BORDER[conv.status] ?? 'transparent'
          return (
            <div
              key={conv.id}
              onClick={() => navigate({ to: '/conversations/$conversationId', params: { conversationId: conv.id } })}
              className="bg-card border border-border/30 rounded-md p-1.5 cursor-pointer hover:border-border/60 transition-colors group relative"
              style={{ borderLeftWidth: 3, borderLeftColor: borderColor }}
            >
              <div className="text-[10px] font-medium text-foreground truncate leading-tight">
                {conv.title || t('board.card.untitled')}
              </div>
              {statusInfo && (
                <div
                  className="text-[8px] mt-0.5 leading-tight"
                  style={{ color: statusInfo.color }}
                >
                  {t(statusInfo.textKey)}
                </div>
              )}
              <button
                onClick={(e) => handleUnpin(e, conv.id)}
                className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-accent/40 transition-all text-muted-foreground/40 hover:text-foreground"
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}

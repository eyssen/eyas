import { useState } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { Plus, ChevronsLeftRight, ChevronsRightLeft, AlertTriangle } from 'lucide-react'
import { BoardCard } from './board-card'
import { BOARD_ALL_PROJECTS_ID, useBoardStore, type BoardConversation } from '@/stores/board-store'
import { cn } from '@/lib/utils'
import { t } from './i18n'

interface BoardColumnProps {
  id: string
  name: string
  color: string | null
  isClosed: boolean
  isFolded: boolean
  wipLimit?: number | null
  conversations: BoardConversation[]
  projectName?: string
  projectColor?: string
}

function wipLevel(count: number, limit: number | null | undefined): 'ok' | 'warn' | 'full' | 'over' | 'unlimited' {
  if (limit == null || limit <= 0) return 'unlimited'
  if (count > limit) return 'over'
  if (count === limit) return 'full'
  if (count / limit >= 0.8) return 'warn'
  return 'ok'
}

export function BoardColumn({
  id,
  name,
  color,
  isClosed,
  isFolded: initialFolded,
  wipLimit,
  conversations,
  projectName,
  projectColor,
}: BoardColumnProps) {
  void isClosed
  const { setNodeRef, isOver } = useDroppable({ id })
  const [folded, setFolded] = useState(initialFolded)
  const [showNewInput, setShowNewInput] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const addConversationToStage = useBoardStore((s) => s.addConversationToStage)
  const projects = useBoardStore((s) => s.projects)
  const currentProjectId = useBoardStore((s) => s.currentProjectId)
  const allView = currentProjectId === BOARD_ALL_PROJECTS_ID

  const resolveProject = (projectId?: string | null) => {
    if (!allView) return { name: projectName, color: projectColor }
    const p = projects.find((x) => x.id === projectId)
    return { name: p?.name, color: p?.color ?? undefined }
  }

  const handleCreateConversation = async () => {
    const trimmed = newTitle.trim()
    if (!trimmed) {
      setShowNewInput(false)
      return
    }
    await addConversationToStage(trimmed, id)
    setNewTitle('')
    setShowNewInput(false)
  }

  const wip = wipLevel(conversations.length, wipLimit)
  const wipTitle =
    wipLimit != null && wipLimit > 0
      ? t('board.column.wip', { count: conversations.length, limit: wipLimit })
      : undefined

  // Folded: narrow vertical strip with rotated text (Odoo-style)
  if (folded) {
    return (
      <div
        ref={setNodeRef}
        onClick={() => setFolded(false)}
        className={cn(
          'flex items-center justify-center w-[36px] min-w-[36px] rounded-xl vibrancy border border-[var(--vibrancy-border)] cursor-pointer hover:bg-accent/20 transition-colors self-stretch',
          wip === 'over' && 'border-red-500/50',
          wip === 'full' && 'border-amber-500/40',
        )}
      >
        <div className="flex items-center gap-1.5" style={{ writingMode: 'vertical-rl', textOrientation: 'mixed' }}>
          <ChevronsLeftRight className="h-3 w-3 text-muted-foreground flex-shrink-0" />
          {color && <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />}
          <span className="text-xs font-semibold uppercase tracking-wide whitespace-nowrap">{name}</span>
          <span className="text-[10px] text-muted-foreground whitespace-nowrap">({conversations.length})</span>
        </div>
      </div>
    )
  }

  return (
    <div
      ref={setNodeRef}
      className={`flex flex-col w-[280px] min-w-[280px] rounded-xl ${isOver ? 'ring-2 ring-primary/50' : ''}`}
    >
      <div
        className={cn(
          'flex items-center gap-2 px-3 py-2.5 rounded-t-xl vibrancy border border-[var(--vibrancy-border)]',
          wip === 'over' && 'border-red-500/50 bg-red-500/5',
          wip === 'full' && 'border-amber-500/40',
          wip === 'warn' && 'border-amber-500/25',
        )}
        title={wipTitle}
      >
        {color && <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />}
        <span className="text-xs font-semibold uppercase tracking-wide flex-1 truncate">{name}</span>
        {(wip === 'over' || wip === 'full' || wip === 'warn') && (
          <AlertTriangle
            className={cn('h-3 w-3 flex-shrink-0', wip === 'over' ? 'text-red-400' : 'text-amber-400')}
          />
        )}
        <span
          className={cn(
            'text-[10px] tabular-nums',
            wip === 'over' && 'text-red-400 font-medium',
            wip === 'full' && 'text-amber-400 font-medium',
            wip === 'ok' || wip === 'unlimited' ? 'text-muted-foreground' : '',
          )}
        >
          {wipLimit != null && wipLimit > 0
            ? `${conversations.length}/${wipLimit}`
            : conversations.length}
        </span>
        <button
          onClick={() => setFolded(true)}
          className="text-muted-foreground hover:text-foreground transition-colors flex-shrink-0 ml-1"
          title={t('board.column.fold')}
        >
          <ChevronsRightLeft className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="flex-1 p-2 space-y-2 min-h-[80px] vibrancy border border-t-0 border-[var(--vibrancy-border)] rounded-b-xl">
        <SortableContext items={conversations.map((c) => c.id)} strategy={verticalListSortingStrategy}>
          {conversations.map((conv) => {
            const proj = resolveProject(conv.projectId)
            return (
              <BoardCard
                key={conv.id}
                id={conv.id}
                taskId={conv.taskId}
                title={conv.title}
                priority={conv.priority}
                tags={conv.tags}
                status={conv.status}
                pinned={conv.pinned}
                dueDate={conv.dueDate}
                tokensUsed={conv.tokensUsed}
                estimatedTokens={conv.estimatedTokens}
                contextWindow={conv.contextWindow}
                messageCount={conv.messageCount}
                assignees={conv.assignees}
                agentName={conv.agentName}
                mode={conv.mode}
                childCount={conv.childCount}
                childrenDone={conv.childrenDone}
                totalCostUsd={conv.totalCostUsd}
                updatedAt={conv.updatedAt}
                projectName={proj.name}
                projectColor={proj.color}
              />
            )
          })}
        </SortableContext>
        {conversations.length === 0 && !showNewInput && (
          <div className="text-[11px] text-muted-foreground/50 text-center py-4">
            {t('board.column.dropHere')}
          </div>
        )}

        {showNewInput ? (
          <input
            type="text"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreateConversation()
              if (e.key === 'Escape') {
                setShowNewInput(false)
                setNewTitle('')
              }
            }}
            onBlur={handleCreateConversation}
            placeholder={t('board.newConversationPlaceholder')}
            autoFocus
            className="w-full px-2 py-1.5 text-xs bg-accent/20 border border-border/50 rounded"
          />
        ) : (
          <button
            onClick={() => setShowNewInput(true)}
            className="w-full flex items-center justify-center gap-1 py-1.5 text-[10px] text-muted-foreground hover:text-foreground hover:bg-accent/20 rounded transition-colors"
          >
            <Plus className="h-3 w-3" /> {t('board.new')}
          </button>
        )}
      </div>
    </div>
  )
}

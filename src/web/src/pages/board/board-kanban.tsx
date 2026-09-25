// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { useState } from 'react'
import { DndContext, DragOverlay, closestCorners, PointerSensor, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from '@dnd-kit/core'
import { BoardCard } from './board-card'
import { BoardColumn } from './board-column'
import { BOARD_ALL_PROJECTS_ID, useBoardStore } from '@/stores/board-store'
import type { BoardViewProps } from './board-view-props'

/**
 * Kanban view: drag-and-drop columns of conversation cards.
 *
 * Renders the filtered `stages` passed in, but resolves drops against the
 * store's unfiltered stages — a card may be dropped onto a column that the
 * active filter hides from view, and its position must still be computed
 * against every sibling, not just the visible ones.
 */
export function BoardKanban({ stages, projectName, projectColor }: BoardViewProps) {
  const allStages = useBoardStore(s => s.stages)
  const moveConversation = useBoardStore(s => s.moveConversation)
  const projects = useBoardStore(s => s.projects)
  const currentProjectId = useBoardStore(s => s.currentProjectId)
  const allView = currentProjectId === BOARD_ALL_PROJECTS_ID

  const [activeId, setActiveId] = useState<string | null>(null)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string)
  }

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveId(null)
    const { active, over } = event
    if (!over || !active) return

    const convId = active.id as string
    const targetStageId = over.id as string

    // Find if dropped over a stage column
    const targetStage = allStages.find(s => s.id === targetStageId)
    if (targetStage) {
      const lastPos = targetStage.conversations.length > 0
        ? targetStage.conversations[targetStage.conversations.length - 1].position + 1.0
        : 1.0
      moveConversation(convId, targetStageId, lastPos)
      return
    }

    // Dropped on another card — find which stage that card is in
    for (const stage of allStages) {
      const overConv = stage.conversations.find(c => c.id === over.id)
      if (overConv) {
        const overIdx = stage.conversations.indexOf(overConv)
        const prevPos = overIdx > 0 ? stage.conversations[overIdx - 1].position : 0
        const newPos = (prevPos + overConv.position) / 2
        moveConversation(convId, stage.id, newPos)
        return
      }
    }
  }

  const activeConv = activeId
    ? allStages.flatMap(s => s.conversations).find(c => c.id === activeId)
    : undefined

  return (
    <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="flex-1 overflow-x-auto">
        <div className="flex gap-3 pb-4 min-h-[400px] px-2">
          {stages.map(stage => (
            <BoardColumn
              key={stage.id}
              id={stage.id}
              name={stage.name}
              color={stage.color}
              isClosed={stage.isClosed}
              isFolded={stage.isFolded}
              wipLimit={stage.wipLimit}
              conversations={stage.conversations}
              projectName={projectName}
              projectColor={projectColor}
            />
          ))}
        </div>
      </div>
      <DragOverlay dropAnimation={null}>
        {activeConv ? (
          <div style={{ rotate: '-3deg', width: 268 }}>
            <BoardCard
              id={activeConv.id}
              taskId={activeConv.taskId}
              title={activeConv.title}
              priority={activeConv.priority}
              tags={activeConv.tags}
              status={activeConv.status}
              pinned={activeConv.pinned}
              dueDate={activeConv.dueDate}
              tokensUsed={activeConv.tokensUsed}
              estimatedTokens={activeConv.estimatedTokens}
              contextWindow={activeConv.contextWindow}
              messageCount={activeConv.messageCount}
              assignees={activeConv.assignees}
              agentName={activeConv.agentName}
              mode={activeConv.mode}
              childCount={activeConv.childCount}
              childrenDone={activeConv.childrenDone}
              totalCostUsd={activeConv.totalCostUsd}
              updatedAt={activeConv.updatedAt}
              projectName={
                allView
                  ? projects.find((p) => p.id === activeConv.projectId)?.name
                  : projectName
              }
              projectColor={
                allView
                  ? projects.find((p) => p.id === activeConv.projectId)?.color ?? undefined
                  : projectColor
              }
            />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}

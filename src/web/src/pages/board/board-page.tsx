// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { useEffect } from 'react'
import { BOARD_ALL_PROJECTS_ID, useBoardStore } from '@/stores/board-store'
import { useWebSocket } from '@/hooks/use-websocket'
import { WS_TOPICS } from '@/lib/ws-topics'
import { BoardHeader } from './board-header'
import { BoardFilters } from './board-filters'
import { BoardKanban } from './board-kanban'
import { BoardList } from './board-list'
import { BoardTimeline } from './board-timeline'
import { BoardGraph } from './board-graph'
import { BoardDashboard } from './board-dashboard'
import { BoardPinned } from './board-pinned'
import { t } from './i18n'
import { ContextualHelp } from '@/components/docs/contextual-help'

export default function BoardPage() {
  const {
    currentProjectId, project, stages, projects, isLoading, viewMode,
    fetchProjects, setProject, fetchBoard, filteredStages,
  } = useBoardStore()

  const { subscribe } = useWebSocket()

  useEffect(() => {
    fetchProjects()
  }, [fetchProjects])

  // Subscribe to real-time board updates for the active scope
  useEffect(() => {
    if (!currentProjectId) return
    if (currentProjectId === BOARD_ALL_PROJECTS_ID) {
      const unsubs = projects.map((p) =>
        subscribe(WS_TOPICS.board(p.id), () => {
          fetchBoard(BOARD_ALL_PROJECTS_ID)
        }),
      )
      return () => { for (const u of unsubs) u() }
    }
    return subscribe(WS_TOPICS.board(currentProjectId), () => {
      fetchBoard(currentProjectId)
    })
  }, [currentProjectId, projects, subscribe, fetchBoard])

  const displayStages = filteredStages()

  if (projects.length === 0 && !isLoading) {
    return (
      <div>
        <h1 className="page-title mb-2 inline-flex items-center gap-1.5">{t('board.page.title')} <ContextualHelp helpId="daily.board" /></h1>
        <p className="text-sm text-muted-foreground">{t('board.page.noProjects')}</p>
      </div>
    )
  }

  // Collect pinned conversations from all stages
  const pinnedConversations = stages.flatMap(s =>
    s.conversations.filter(c => c.pinned).map(c => ({ ...c, stageName: s.name, stageColor: s.color }))
  )

  const hasPinned = pinnedConversations.length > 0

  // Every view renders from the same filtered `displayStages`, so switching is
  // instant and preserves the active filters. The switch is exhaustive: adding
  // a mode to `BoardViewMode` without handling it here is a compile error.
  const renderView = () => {
    const isAll = currentProjectId === BOARD_ALL_PROJECTS_ID
    const common = {
      stages: displayStages,
      // Single-project views share one badge; All view resolves per card.
      projectName: isAll ? undefined : project?.name,
      projectColor: isAll ? undefined : (project?.color ?? undefined),
    }
    switch (viewMode) {
      case 'kanban':
        return <BoardKanban {...common} />
      case 'list':
        return <BoardList {...common} />
      case 'timeline':
        return <BoardTimeline {...common} />
      case 'graph':
        return <BoardGraph {...common} projectId={currentProjectId} />
      case 'dashboard':
        return <BoardDashboard {...common} />
      default: {
        const exhaustive: never = viewMode
        return exhaustive
      }
    }
  }

  return (
    <div className="flex flex-col h-full">
      <BoardHeader
        projectName={project?.name ?? ''}
        projects={projects}
        currentProjectId={currentProjectId}
        onProjectChange={setProject}
      />

      <BoardFilters />

      {isLoading ? (
        <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">{t('common.loading')}</div>
      ) : (
        <div className="flex flex-1 overflow-hidden mt-2">
          {/* Left pinned sidebar */}
          {hasPinned && (
            <BoardPinned
              conversations={pinnedConversations}
              projectName={project?.name}
              projectColor={project?.color ?? undefined}
            />
          )}

          {/* Main content area */}
          {renderView()}
        </div>
      )}
    </div>
  )
}

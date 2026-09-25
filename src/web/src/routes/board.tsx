import { createFileRoute } from '@tanstack/react-router'
import { AppLayout } from '@/components/layout/app-layout'
import BoardPage from '@/pages/board/board-page'
import { useBoardStore } from '@/stores/board-store'

export const Route = createFileRoute('/board')({
  beforeLoad: () => {
    // Refresh board data every time we navigate to this page
    const { currentProjectId, fetchBoard, fetchProjects } = useBoardStore.getState()
    fetchProjects()
    if (currentProjectId) fetchBoard(currentProjectId)
  },
  component: () => (
    <AppLayout>
      <BoardPage />
    </AppLayout>
  ),
})

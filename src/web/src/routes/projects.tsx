import { createFileRoute } from '@tanstack/react-router'
import { AppLayout } from '@/components/layout/app-layout'
import ProjectsPage from '@/pages/projects/projects-page'

export const Route = createFileRoute('/projects')({
  component: () => (
    <AppLayout>
      <ProjectsPage />
    </AppLayout>
  ),
})

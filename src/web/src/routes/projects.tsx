import { createFileRoute, Outlet, useMatch } from '@tanstack/react-router'
import { AppLayout } from '@/components/layout/app-layout'
import ProjectsPage from '@/pages/projects/projects-page'

function ProjectsLayout() {
  const wikiMatch = useMatch({ from: '/projects/$projectId/wiki', shouldThrow: false })
  if (wikiMatch) return <Outlet />
  return (
    <AppLayout>
      <ProjectsPage />
    </AppLayout>
  )
}

export const Route = createFileRoute('/projects')({
  component: ProjectsLayout,
})

import { createFileRoute } from '@tanstack/react-router'
import { AppLayout } from '@/components/layout/app-layout'
import SkillsPage from '@/pages/skills/skills-page'

export const Route = createFileRoute('/skills')({
  component: () => (
    <AppLayout>
      <SkillsPage />
    </AppLayout>
  ),
})

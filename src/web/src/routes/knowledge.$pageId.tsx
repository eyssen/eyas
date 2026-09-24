import { createFileRoute } from '@tanstack/react-router'
import KnowledgePage from '@/pages/knowledge/knowledge-page'

export const Route = createFileRoute('/knowledge/$pageId')({
  component: KnowledgePage,
})

import { createFileRoute, Outlet, redirect, useMatch } from '@tanstack/react-router'

/**
 * Parent layout for conversation detail routes.
 * Bare `/conversations` redirects to the Board — the list page was removed
 * as redundant with the board (All projects / list view).
 */
function ConversationsLayout() {
  const childMatch = useMatch({ from: '/conversations/$conversationId', shouldThrow: false })
  if (childMatch) {
    return <Outlet />
  }
  // Should not render — beforeLoad redirects bare /conversations
  return null
}

export const Route = createFileRoute('/conversations')({
  beforeLoad: ({ location }) => {
    // Exact list path only — do not redirect /conversations/:id
    const path = location.pathname.replace(/\/$/, '') || '/'
    if (path === '/conversations') {
      throw redirect({ to: '/board' })
    }
  },
  component: ConversationsLayout,
})

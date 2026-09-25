// @vitest-environment jsdom
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

const { get } = vi.hoisted(() => ({ get: vi.fn() }))

vi.mock('@/lib/api', () => ({
  api: { get, post: vi.fn(), put: vi.fn() },
}))

vi.mock('@/hooks/use-websocket', () => ({
  useWebSocket: () => ({ subscribe: () => () => {}, connected: false }),
}))

vi.mock('@/components/docs/contextual-help', () => ({
  PageTitle: ({ title, subtitle }: { title: string; subtitle?: string }) => (
    <div>
      <h1>{title}</h1>
      {subtitle ? <p>{subtitle}</p> : null}
    </div>
  ),
  ContextualHelp: () => null,
}))

import MediaPage from '@/pages/media/media-page'

beforeEach(() => {
  get.mockImplementation(async (path: string) => {
    if (path === '/media/providers') {
      return {
        providers: [
          { id: 'heygen', name: 'HeyGen', capabilities: ['video', 'audio'], configured: false, balance: null },
          { id: 'magnific', name: 'Magnific', capabilities: ['image'], configured: false, balance: null },
        ],
      }
    }
    if (path === '/media/settings') {
      return {
        routing: {
          image: { defaultProviderId: null, fallbackProviderId: null, alsoRunOn: [] },
          video: { defaultProviderId: null, fallbackProviderId: null, alsoRunOn: [] },
          audio: { defaultProviderId: null, fallbackProviderId: null, alsoRunOn: [] },
          upscale: { defaultProviderId: null, fallbackProviderId: null, alsoRunOn: [] },
          edit: { defaultProviderId: null, fallbackProviderId: null, alsoRunOn: [] },
          '3d': { defaultProviderId: null, fallbackProviderId: null, alsoRunOn: [] },
        },
        budget: {},
        expertRawMcpTools: false,
      }
    }
    if (path === '/media/jobs') return { jobs: [] }
    return {}
  })
})

describe('MediaPage HeyGen', () => {
  it('lists the HeyGen card and a compare column', async () => {
    render(<MediaPage />)
    await waitFor(() => {
      expect(screen.getAllByText('HeyGen').length).toBeGreaterThan(0)
    })
    expect(screen.getByText('Talking-head avatars; presenter video from a prompt or script')).toBeInTheDocument()
    expect(screen.getByText(/talking-head → HeyGen/)).toBeInTheDocument()
    expect(screen.getByText('OAuth (HeyGen account)')).toBeInTheDocument()
  })
})

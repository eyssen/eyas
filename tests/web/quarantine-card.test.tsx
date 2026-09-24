// @vitest-environment jsdom
// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// B10 — the memory page's quarantine card: the owner picks providers and a
// date range, previews the counts, confirms inline, and releases a past
// quarantine from the history. Anyone else only sees that it is owner-only,
// and the card never calls the (owner-only) routes for them.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const h = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  role: 'owner' as string | undefined,
}))
vi.mock('@/lib/api', () => ({
  api: { get: h.get, post: h.post },
  ApiError: class ApiError extends Error {
    constructor(public status: number, message: string) { super(message) }
  },
}))
vi.mock('@/stores/auth-store', () => ({
  useAuthStore: (select: (s: any) => unknown) => select({ user: h.role ? { role: h.role } : null }),
}))

import QuarantineCard, { selectionBody, type QuarantineEntry } from '@/pages/memory/quarantine-card'
import { useLanguageStore } from '@/stores/language-store'
import en from '@/pages/memory/locales/en.json'

const E = en as Record<string, string>
const COUNTS = { raw: 4, facts: 2, gists: 3, notes: 1, conversations: 2 }

const released: QuarantineEntry = {
  id: '01OLD', providers: ['kimi-cli'], from: null, to: null, counts: COUNTS,
  createdAt: Date.UTC(2026, 8, 1), createdBy: 'owner-1', releasedAt: Date.UTC(2026, 8, 2), releasedBy: 'owner-1',
}
const active: QuarantineEntry = { ...released, id: '01ACTIVE', providers: ['grok-cli'], releasedAt: null, releasedBy: null }

describe('selectionBody', () => {
  it('(+) turns the dates into the start and the end of their local day', () => {
    const body = selectionBody(['grok-cli', 'claude-code'], '2026-09-10', '2026-09-12')
    expect(body.providers).toEqual(['claude-code', 'grok-cli'])
    expect(body.from).toBe(new Date('2026-09-10T00:00:00').getTime())
    expect(body.to).toBe(new Date('2026-09-12T23:59:59.999').getTime())
  })

  it('(−) an empty or unreadable date leaves that side open', () => {
    expect(selectionBody(['x'], '', '')).toEqual({ providers: ['x'] })
    expect(selectionBody(['x'], 'not-a-date', '')).toEqual({ providers: ['x'] })
  })
})

describe('QuarantineCard', () => {
  beforeEach(() => {
    h.get.mockReset()
    h.post.mockReset()
    h.role = 'owner'
    useLanguageStore.getState().setLang('en')
  })
  afterEach(() => {
    cleanup()
  })

  it('owner: preview, inline confirm, apply, then release from the history', async () => {
    h.get.mockResolvedValue({ entries: [active, released], providers: [{ provider: 'grok-cli', rows: 12 }] })
    render(<QuarantineCard />)
    const box = await screen.findByRole('checkbox')
    const previewButton = screen.getByRole('button', { name: E['memory.quarantine.preview'] })
    expect((previewButton as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(box)

    h.post.mockResolvedValueOnce({ counts: COUNTS })
    fireEvent.click(previewButton)
    await waitFor(() => expect(h.post).toHaveBeenCalledWith('/memory/quarantine/preview', { providers: ['grok-cli'] }))
    await screen.findByText(/Would hide 4 raw rows, 2 facts, 3 summaries and 1 capture notes from 2 conversations/)

    // The first click only asks; the second applies.
    fireEvent.click(screen.getByRole('button', { name: E['memory.quarantine.apply'] }))
    expect(screen.getByText(E['memory.quarantine.confirm'])).toBeTruthy()
    expect(h.post).toHaveBeenCalledTimes(1)
    h.post.mockResolvedValueOnce({ id: '01NEW', counts: COUNTS })
    fireEvent.click(screen.getByRole('button', { name: E['memory.quarantine.apply'] }))
    await waitFor(() => expect(h.post).toHaveBeenCalledWith('/memory/quarantine', { providers: ['grok-cli'] }))
    await screen.findByText(/Quarantined 4 raw rows/)

    // A released entry shows when; an active one offers Release.
    expect(screen.getAllByText(/^Released /).length).toBeGreaterThan(0)
    h.post.mockResolvedValueOnce({ id: '01ACTIVE' })
    fireEvent.click(screen.getByRole('button', { name: E['memory.quarantine.release'] }))
    await waitFor(() => expect(h.post).toHaveBeenCalledWith('/memory/quarantine/01ACTIVE/release', {}))
    await screen.findByText(E['memory.quarantine.released'])
  })

  it('(−) cancel in the confirm step applies nothing', async () => {
    h.get.mockResolvedValue({ entries: [], providers: [{ provider: 'grok-cli', rows: 1 }] })
    render(<QuarantineCard />)
    fireEvent.click(await screen.findByRole('checkbox'))
    h.post.mockResolvedValueOnce({ counts: COUNTS })
    fireEvent.click(screen.getByRole('button', { name: E['memory.quarantine.preview'] }))
    fireEvent.click(await screen.findByRole('button', { name: E['memory.quarantine.apply'] }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByText(E['memory.quarantine.confirm'])).toBeNull()
    expect(h.post).toHaveBeenCalledTimes(1)
    expect(screen.getByText(E['memory.quarantine.empty'])).toBeTruthy()
  })

  it('(−) a preview with nothing to hide offers no Quarantine button', async () => {
    h.get.mockResolvedValue({ entries: [], providers: [{ provider: 'grok-cli', rows: 0 }] })
    render(<QuarantineCard />)
    fireEvent.click(await screen.findByRole('checkbox'))
    h.post.mockResolvedValueOnce({ counts: { raw: 0, facts: 0, gists: 0, notes: 0, conversations: 1 } })
    fireEvent.click(screen.getByRole('button', { name: E['memory.quarantine.preview'] }))
    await screen.findByText(E['memory.quarantine.nothing'])
    expect(screen.queryByRole('button', { name: E['memory.quarantine.apply'] })).toBeNull()
  })

  it('(−) a failed apply shows the error and keeps the confirm step open', async () => {
    h.get.mockResolvedValue({ entries: [], providers: [{ provider: 'grok-cli', rows: 1 }] })
    render(<QuarantineCard />)
    fireEvent.click(await screen.findByRole('checkbox'))
    h.post.mockResolvedValueOnce({ counts: COUNTS })
    fireEvent.click(screen.getByRole('button', { name: E['memory.quarantine.preview'] }))
    fireEvent.click(await screen.findByRole('button', { name: E['memory.quarantine.apply'] }))
    h.post.mockRejectedValueOnce(new Error('boom'))
    fireEvent.click(screen.getByRole('button', { name: E['memory.quarantine.apply'] }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe(E['memory.quarantine.error'])
    expect(screen.getByText(E['memory.quarantine.confirm'])).toBeTruthy()
  })

  it('(−) not the owner: the card only says so and calls nothing', () => {
    h.role = 'admin'
    render(<QuarantineCard />)
    expect(screen.getByText(E['memory.quarantine.ownerOnly'])).toBeTruthy()
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(h.get).not.toHaveBeenCalled()
    expect(h.post).not.toHaveBeenCalled()
  })
})

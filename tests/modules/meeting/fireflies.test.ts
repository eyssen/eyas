// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, vi } from 'vitest'
import { createFirefliesProvider } from '../../../src/modules/meeting/providers/fireflies.js'

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

describe('createFirefliesProvider — unconfigured (no API key)', () => {
  it('reports configured=false and never fabricates a meeting list', async () => {
    const fetchImpl = vi.fn()
    const provider = createFirefliesProvider(undefined, { fetchImpl })
    await provider.connect()

    expect(provider.configured).toBe(false)

    const meetings = await provider.listMeetings()
    // Must be empty — no "Weekly Standup", no Alice/Bob mock data.
    expect(meetings).toEqual([])
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('throws an explicit not-configured error for detail calls (no fake transcript/summary/actions)', async () => {
    const fetchImpl = vi.fn()
    const provider = createFirefliesProvider(undefined, { fetchImpl })
    await provider.connect()

    await expect(provider.getTranscript('mock-1')).rejects.toThrow(/not configured/i)
    await expect(provider.getSummary('mock-1')).rejects.toThrow(/not configured/i)
    await expect(provider.getActionItems('mock-1')).rejects.toThrow(/not configured/i)
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

describe('createFirefliesProvider — configured (API key present)', () => {
  it('reports configured=true and maps a real GraphQL list response', async () => {
    const epochMs = Date.UTC(2026, 3, 1, 9, 0, 0)
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        data: {
          transcripts: [
            { id: 'real-1', title: 'Q2 Kickoff', date: epochMs, duration: 15, participants: ['carol@example.com'] },
          ],
        },
      }),
    )
    const provider = createFirefliesProvider('secret-key', { fetchImpl })
    await provider.connect()

    expect(provider.configured).toBe(true)

    const meetings = await provider.listMeetings()
    expect(meetings).toEqual([
      {
        id: 'real-1',
        title: 'Q2 Kickoff',
        date: new Date(epochMs).toISOString(),
        duration: 900, // 15 minutes -> seconds
        participants: ['carol@example.com'],
      },
    ])

    // Sent as an authenticated POST to the Fireflies endpoint.
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe('https://api.fireflies.ai/graphql')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer secret-key')
  })

  it('surfaces GraphQL errors instead of falling back to mock data', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ errors: [{ message: 'Unauthorized' }] }))
    const provider = createFirefliesProvider('secret-key', { fetchImpl })
    await provider.connect()

    await expect(provider.listMeetings()).rejects.toThrow(/Unauthorized/)
  })

  it('maps a real transcript response into segments', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        data: {
          transcript: {
            sentences: [
              { speaker_name: 'Carol', text: 'Welcome everyone.', start_time: 0, end_time: 2 },
            ],
          },
        },
      }),
    )
    const provider = createFirefliesProvider('secret-key', { fetchImpl })
    await provider.connect()

    const transcript = await provider.getTranscript('real-1')
    expect(transcript.segments).toEqual([
      { speaker: 'Carol', text: 'Welcome everyone.', startTime: 0, endTime: 2 },
    ])
  })
})

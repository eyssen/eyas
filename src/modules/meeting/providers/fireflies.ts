// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { MeetingProvider, Transcript, MeetingSummary, ActionItem, MeetingListItem } from '../types.js'

const FIREFLIES_ENDPOINT = 'https://api.fireflies.ai/graphql'

/** Provider surface exposed to the routes, including the unconfigured-state flag. */
export type FirefliesProvider = MeetingProvider & {
  /** True only when a Fireflies API key is configured. Never fabricate data when false. */
  configured: boolean
  listMeetings(): Promise<MeetingListItem[]>
}

export interface FirefliesOptions {
  /** Override the HTTP transport (tests). Defaults to SSRF-safe fetch. */
  fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>
}

/**
 * Fireflies.ai GraphQL API adapter.
 *
 * The endpoint host is a fixed public domain, but every request is still routed
 * through the research module's SSRF-safe fetch so redirect hops are validated.
 *
 * When no API key is configured the provider is UNCONFIGURED: list calls return
 * an empty array and detail calls throw an explicit "not configured" error.
 * It NEVER fabricates transcripts, summaries or action items.
 */
export function createFirefliesProvider(apiKey?: string, opts: FirefliesOptions = {}): FirefliesProvider {
  const configured = Boolean(apiKey)
  let connected = false

  async function query<T>(gql: string, variables: Record<string, unknown>): Promise<T> {
    if (!apiKey) throw new Error('Fireflies API key not configured')
    const doFetch = opts.fetchImpl ?? (await import('@modules/research/ssrf-guard.js')).safeFetch
    const res = await doFetch(FIREFLIES_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ query: gql, variables }),
    })
    if (!res.ok) {
      throw new Error(`Fireflies API error: ${res.status} ${res.statusText}`)
    }
    const payload = (await res.json()) as { data?: T; errors?: Array<{ message: string }> }
    if (payload.errors?.length) {
      throw new Error(`Fireflies GraphQL error: ${payload.errors.map((e) => e.message).join('; ')}`)
    }
    if (!payload.data) throw new Error('Fireflies GraphQL response missing data')
    return payload.data
  }

  return {
    id: 'fireflies',
    configured,

    async connect() {
      // No API key — provider stays unconfigured (fail closed, no mock data).
      connected = true
    },

    async listMeetings(): Promise<MeetingListItem[]> {
      if (!connected) throw new Error('Provider not connected')
      if (!apiKey) return []

      const data = await query<{
        transcripts: Array<{
          id: string
          title: string | null
          date: number | string | null
          duration: number | null
          participants: string[] | null
        }>
      }>(
        `query Transcripts($limit: Int) {
          transcripts(limit: $limit) {
            id
            title
            date
            duration
            participants
          }
        }`,
        { limit: 50 },
      )

      return (data.transcripts ?? []).map((t) => ({
        id: t.id,
        title: t.title ?? 'Untitled meeting',
        // Fireflies `date` is epoch milliseconds; normalize to ISO 8601.
        date: typeof t.date === 'number' ? new Date(t.date).toISOString() : (t.date ?? ''),
        // Fireflies `duration` is in minutes; expose seconds.
        duration: t.duration != null ? Math.round(t.duration * 60) : 0,
        participants: t.participants ?? [],
      }))
    },

    async getTranscript(meetingId: string): Promise<Transcript> {
      if (!connected) throw new Error('Provider not connected')
      if (!apiKey) throw new Error('Fireflies not configured')

      const data = await query<{
        transcript: {
          sentences: Array<{
            speaker_name: string | null
            text: string | null
            start_time: number | null
            end_time: number | null
          }> | null
        } | null
      }>(
        `query Transcript($id: String!) {
          transcript(id: $id) {
            sentences {
              speaker_name
              text
              start_time
              end_time
            }
          }
        }`,
        { id: meetingId },
      )

      if (!data.transcript) throw new Error(`Transcript ${meetingId} not found`)

      return {
        segments: (data.transcript.sentences ?? []).map((s) => ({
          speaker: s.speaker_name ?? 'Unknown',
          text: s.text ?? '',
          startTime: s.start_time ?? 0,
          endTime: s.end_time ?? 0,
        })),
        language: 'unknown',
      }
    },

    async getSummary(meetingId: string): Promise<MeetingSummary> {
      if (!connected) throw new Error('Provider not connected')
      if (!apiKey) throw new Error('Fireflies not configured')

      const data = await query<{
        transcript: {
          summary: {
            overview: string | null
            keywords: string[] | null
            bullet_gist: string | null
          } | null
        } | null
      }>(
        `query Summary($id: String!) {
          transcript(id: $id) {
            summary {
              overview
              keywords
              bullet_gist
            }
          }
        }`,
        { id: meetingId },
      )

      if (!data.transcript) throw new Error(`Summary for meeting ${meetingId} not found`)
      const summary = data.transcript.summary
      const bullets = (summary?.bullet_gist ?? '')
        .split('\n')
        .map((l) => l.replace(/^[-*\s]+/, '').trim())
        .filter(Boolean)

      return {
        memo: summary?.overview ?? '',
        keyPoints: bullets.length > 0 ? bullets : summary?.keywords ?? [],
        // Fireflies exposes no dedicated "decisions" field.
        decisions: [],
      }
    },

    async getActionItems(meetingId: string): Promise<ActionItem[]> {
      if (!connected) throw new Error('Provider not connected')
      if (!apiKey) throw new Error('Fireflies not configured')

      const data = await query<{
        transcript: {
          summary: { action_items: string | null } | null
        } | null
      }>(
        `query ActionItems($id: String!) {
          transcript(id: $id) {
            summary {
              action_items
            }
          }
        }`,
        { id: meetingId },
      )

      if (!data.transcript) throw new Error(`Action items for meeting ${meetingId} not found`)

      // Fireflies returns action items as a single newline-separated string.
      return (data.transcript.summary?.action_items ?? '')
        .split('\n')
        .map((l) => l.replace(/^[-*\s]+/, '').trim())
        .filter(Boolean)
        .map((description) => ({ description }))
    },
  }
}

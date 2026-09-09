// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'
import type { EyasDb } from '@core/types'
import {
  AgentEvent,
  AgentEventSchema,
  AppendEventInput,
  EventQueryOptions,
  EventTypes,
  validateEventPayload,
} from './types.js'
import { captureLlmResponse } from './l0-capture.js'

/**
 * EventStore — append-only log over agent_events.
 *
 * Guarantees:
 *  - seq is monotonically increasing per sessionId (0, 1, 2, …)
 *  - UNIQUE(session_id, seq) prevents duplicate writes (race-safe at the DB)
 *  - append() validates payload against the known schema for its type
 */
export class EventStoreError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message)
    this.name = 'EventStoreError'
  }
}

export interface EventStore {
  append(event: AppendEventInput): Promise<number>
  appendWithSeq(event: AgentEvent): Promise<number>
  query(sessionId: string, opts?: EventQueryOptions): AsyncIterable<AgentEvent>
  queryArray(sessionId: string, opts?: EventQueryOptions): Promise<AgentEvent[]>
  latestSeq(sessionId: string): Promise<number>
  countBySession(sessionId: string): Promise<number>
  getByTypes(sessionId: string, types: string[]): Promise<AgentEvent[]>
}

/**
 * Synchronous latestSeq read — a bridge for callers whose contract is sync
 * (e.g. RunSupervisor.eventSeq). Mirrors EventStore.latestSeq but defensive:
 * returns -1 when the session has no events OR the table is absent (so an
 * event-store-disabled deployment never throws on the supervisor tick).
 */
export function latestSeqSync(db: EyasDb, sessionId: string): number {
  try {
    const rows = (db as any).all(
      sql`SELECT MAX(seq) as max_seq FROM agent_events WHERE session_id = ${sessionId}`,
    ) as any[]
    const row = rows[0]
    if (!row || row.max_seq === null || row.max_seq === undefined) return -1
    return Number(row.max_seq)
  } catch {
    return -1
  }
}

function rowToEvent(r: any): AgentEvent {
  let payload: Record<string, unknown> = {}
  try {
    payload = r.payload ? JSON.parse(r.payload) : {}
  } catch {
    payload = {}
  }
  return {
    sessionId: r.session_id,
    seq: Number(r.seq),
    ts: Number(r.ts),
    type: r.event_type,
    actor: r.actor ?? undefined,
    payload,
  }
}

export function createEventStore(db: EyasDb): EventStore {
  const dbAny = db as any

  async function latestSeq(sessionId: string): Promise<number> {
    const rows = dbAny.all(
      sql`SELECT MAX(seq) as max_seq FROM agent_events WHERE session_id = ${sessionId}`,
    ) as any[]
    const row = rows[0]
    if (!row || row.max_seq === null || row.max_seq === undefined) return -1
    return Number(row.max_seq)
  }

  async function append(input: AppendEventInput): Promise<number> {
    const parsed = AppendEventInput.parse(input)
    const validatedPayload = validateEventPayload(parsed.type, parsed.payload ?? {})
    const ts = parsed.ts ?? Date.now()
    const sessionId = parsed.sessionId

    // Retry loop on UNIQUE collision (in case of concurrent append on the
    // same session). Each attempt re-reads latestSeq and re-tries.
    const MAX_ATTEMPTS = 8
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const nextSeq = (await latestSeq(sessionId)) + 1
      try {
        dbAny.run(
          sql`INSERT INTO agent_events (session_id, seq, ts, event_type, actor, payload)
              VALUES (${sessionId}, ${nextSeq}, ${ts}, ${parsed.type}, ${parsed.actor ?? null}, ${JSON.stringify(validatedPayload)})`,
        )
        // L0 capture at the persistence layer (spec §6): background outputs
        // never reach conversation_messages, this is their only copy.
        //
        // Guarded HERE, not only inside captureLlmResponse: this call sits in
        // the UNIQUE-collision retry `try`, so a throw would be read as an
        // insert failure. If its message happened to contain "constraint" the
        // loop would `continue` and INSERT again — up to 8 duplicate event
        // rows in the agent replay log. The capture path swallows its own
        // errors today; this makes that independent of three other files
        // continuing to do so.
        if (parsed.type === EventTypes.LlmResponse) {
          try {
            captureLlmResponse(db, sessionId, nextSeq, ts, validatedPayload as Record<string, unknown>)
          } catch {
            /* the event row is already committed; capture is best-effort */
          }
        }
        return nextSeq
      } catch (err: any) {
        const messages: string[] = []
        let cur: any = err
        while (cur) {
          if (cur.message) messages.push(String(cur.message))
          if (cur.code) messages.push(String(cur.code))
          cur = cur.cause
        }
        const joined = messages.join(' | ')
        if (
          joined.includes('UNIQUE') ||
          joined.includes('constraint') ||
          joined.includes('SQLITE_CONSTRAINT')
        ) {
          // Concurrent write beat us to it; retry with a fresh seq.
          continue
        }
        throw err
      }
    }
    throw new EventStoreError(
      `Failed to append event after ${MAX_ATTEMPTS} attempts on session ${sessionId}`,
      'APPEND_CONTENTION',
    )
  }

  /**
   * Append with an explicit seq — used by tests and snapshot restore paths.
   * Will throw on UNIQUE collision rather than retry.
   */
  async function appendWithSeq(event: AgentEvent): Promise<number> {
    const validated = AgentEventSchema.parse(event)
    const validatedPayload = validateEventPayload(validated.type, validated.payload)
    try {
      dbAny.run(
        sql`INSERT INTO agent_events (session_id, seq, ts, event_type, actor, payload)
            VALUES (${validated.sessionId}, ${validated.seq}, ${validated.ts}, ${validated.type}, ${validated.actor ?? null}, ${JSON.stringify(validatedPayload)})`,
      )
      return validated.seq
    } catch (err: any) {
      // Drizzle wraps underlying errors; walk the cause chain to find the constraint.
      const messages: string[] = []
      let cur: any = err
      while (cur) {
        if (cur.message) messages.push(String(cur.message))
        if (cur.code) messages.push(String(cur.code))
        cur = cur.cause
      }
      const joined = messages.join(' | ')
      if (
        joined.includes('UNIQUE') ||
        joined.includes('constraint') ||
        joined.includes('SQLITE_CONSTRAINT')
      ) {
        throw new EventStoreError(
          `Duplicate (sessionId=${validated.sessionId}, seq=${validated.seq})`,
          'DUPLICATE_SEQ',
        )
      }
      throw err
    }
  }

  async function queryArray(
    sessionId: string,
    opts: EventQueryOptions = {},
  ): Promise<AgentEvent[]> {
    const fromSeq = opts.fromSeq ?? 0
    const toSeq = opts.toSeq
    const types = opts.types
    const limit = opts.limit

    let rows: any[]
    if (types && types.length > 0) {
      // Build placeholders manually — drizzle's sql.join keeps this safe
      if (toSeq !== undefined && limit !== undefined) {
        rows = dbAny.all(
          sql`SELECT * FROM agent_events WHERE session_id = ${sessionId}
              AND seq >= ${fromSeq} AND seq <= ${toSeq}
              AND event_type IN (${sql.join(types.map((t) => sql`${t}`), sql`, `)})
              ORDER BY seq ASC LIMIT ${limit}`,
        ) as any[]
      } else if (toSeq !== undefined) {
        rows = dbAny.all(
          sql`SELECT * FROM agent_events WHERE session_id = ${sessionId}
              AND seq >= ${fromSeq} AND seq <= ${toSeq}
              AND event_type IN (${sql.join(types.map((t) => sql`${t}`), sql`, `)})
              ORDER BY seq ASC`,
        ) as any[]
      } else if (limit !== undefined) {
        rows = dbAny.all(
          sql`SELECT * FROM agent_events WHERE session_id = ${sessionId}
              AND seq >= ${fromSeq}
              AND event_type IN (${sql.join(types.map((t) => sql`${t}`), sql`, `)})
              ORDER BY seq ASC LIMIT ${limit}`,
        ) as any[]
      } else {
        rows = dbAny.all(
          sql`SELECT * FROM agent_events WHERE session_id = ${sessionId}
              AND seq >= ${fromSeq}
              AND event_type IN (${sql.join(types.map((t) => sql`${t}`), sql`, `)})
              ORDER BY seq ASC`,
        ) as any[]
      }
    } else {
      if (toSeq !== undefined && limit !== undefined) {
        rows = dbAny.all(
          sql`SELECT * FROM agent_events WHERE session_id = ${sessionId}
              AND seq >= ${fromSeq} AND seq <= ${toSeq}
              ORDER BY seq ASC LIMIT ${limit}`,
        ) as any[]
      } else if (toSeq !== undefined) {
        rows = dbAny.all(
          sql`SELECT * FROM agent_events WHERE session_id = ${sessionId}
              AND seq >= ${fromSeq} AND seq <= ${toSeq}
              ORDER BY seq ASC`,
        ) as any[]
      } else if (limit !== undefined) {
        rows = dbAny.all(
          sql`SELECT * FROM agent_events WHERE session_id = ${sessionId}
              AND seq >= ${fromSeq}
              ORDER BY seq ASC LIMIT ${limit}`,
        ) as any[]
      } else {
        rows = dbAny.all(
          sql`SELECT * FROM agent_events WHERE session_id = ${sessionId}
              AND seq >= ${fromSeq}
              ORDER BY seq ASC`,
        ) as any[]
      }
    }

    return rows.map(rowToEvent)
  }

  async function* query(
    sessionId: string,
    opts: EventQueryOptions = {},
  ): AsyncIterable<AgentEvent> {
    const events = await queryArray(sessionId, opts)
    for (const ev of events) yield ev
  }

  async function countBySession(sessionId: string): Promise<number> {
    const rows = dbAny.all(
      sql`SELECT COUNT(*) as c FROM agent_events WHERE session_id = ${sessionId}`,
    ) as any[]
    return Number(rows[0]?.c ?? 0)
  }

  async function getByTypes(sessionId: string, types: string[]): Promise<AgentEvent[]> {
    if (types.length === 0) return []
    return queryArray(sessionId, { types })
  }

  return { append, appendWithSeq, query, queryArray, latestSeq, countBySession, getByTypes }
}

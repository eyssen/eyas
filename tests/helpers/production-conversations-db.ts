// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'
import { createMemoryDb } from './test-db.js'

/**
 * Build an in-memory DB whose `conversations` table is shaped by the REAL
 * production DDL — i.e. by actually running the module `onRegister` hooks that
 * own it, in boot order.
 *
 * Why not reuse the hand-written DDL in `test-db.ts`: the conversations table
 * is assembled at runtime from three separate modules (conversations creates it
 * plus the thinking/effort/orchestration/voice ALTERs, board adds the kanban
 * columns, agent adds team_session_id). A hand-maintained copy of that shape
 * drifts silently, and a contract test asserting "the update chain covers every
 * column" is worthless if it runs against a stale replica. Running the real
 * hooks means a column added to any of the three modules shows up here on the
 * next test run without anyone remembering to mirror it.
 *
 * The hooks are driven with a stub ModuleContext (db + logger + bus). All three
 * tolerate it today: they only touch ctx.db/ctx.logger/ctx.bus during register
 * and resolve everything else lazily.
 */
export async function createProductionConversationsDb(): Promise<ReturnType<typeof createMemoryDb>> {
  const db = createMemoryDb()
  const logger: any = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => logger }
  const bus: any = { emit: () => {}, on: () => {}, off: () => {} }
  const ctx: any = { db, logger, bus, config: {} }

  const { conversationsModule } = await import('@modules/conversations/index.js')
  await conversationsModule.onRegister!(ctx)

  const { boardModule } = await import('@modules/board/index.js')
  await boardModule.onRegister!(ctx)

  const { agentModule } = await import('@modules/agent/index.js')
  await agentModule.onRegister!(ctx)

  return db
}

/** Column names of the live `conversations` table, in PRAGMA order. */
export function conversationColumns(db: any): string[] {
  return (db.all(sql`PRAGMA table_info(conversations)`) as any[]).map(c => String(c.name))
}

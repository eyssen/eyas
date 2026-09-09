// Part of eYssen. See LICENSE file for full copyright and licensing details.

/**
 * v0.5-style recurring board tasks: cron creates a board conversation/card.
 */

import { sql } from 'drizzle-orm'
import { generateId } from '@shared/crypto'
import type { Logger } from 'pino'
import { computeNextRunAt, normalizeCron } from './cron-utils.js'

export interface RecurringBoardTask {
  id: string
  title: string
  description?: string
  schedule: string
  nextOccurrence: string
  lastCreated?: string
  projectId: string
  priority: string
  assignee?: string
  autoStart: boolean
  status: 'active' | 'paused' | 'deleted'
  jobId?: string
  createdAt: string
}

export function ensureRecurringTables(db: any): void {
  db.run(sql`CREATE TABLE IF NOT EXISTS recurring_board_tasks (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    schedule TEXT NOT NULL,
    next_occurrence TEXT NOT NULL,
    last_created TEXT,
    project_id TEXT NOT NULL,
    priority TEXT NOT NULL DEFAULT 'normal',
    assignee TEXT,
    auto_start INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active',
    job_id TEXT,
    created_at TEXT NOT NULL
  )`)
}

export function createBoardRecurringService(deps: {
  db: any
  logger: Logger
  getBoard?: () => any
  getConversations?: () => any
  getScheduler?: () => any
}) {
  const { db, logger } = deps

  function rowToTask(r: any): RecurringBoardTask {
    return {
      id: r.id,
      title: r.title,
      description: r.description ?? undefined,
      schedule: r.schedule,
      nextOccurrence: r.next_occurrence,
      lastCreated: r.last_created ?? undefined,
      projectId: r.project_id,
      priority: r.priority ?? 'normal',
      assignee: r.assignee ?? undefined,
      autoStart: r.auto_start === 1,
      status: r.status,
      jobId: r.job_id ?? undefined,
      createdAt: r.created_at,
    }
  }

  return {
    list(status?: string): RecurringBoardTask[] {
      let rows: any[]
      if (status) {
        rows = db.all(sql`SELECT * FROM recurring_board_tasks WHERE status = ${status} ORDER BY next_occurrence`) as any[]
      } else {
        rows = db.all(sql`SELECT * FROM recurring_board_tasks WHERE status != 'deleted' ORDER BY next_occurrence`) as any[]
      }
      return rows.map(rowToTask)
    },

    get(id: string): RecurringBoardTask | null {
      const rows = db.all(sql`SELECT * FROM recurring_board_tasks WHERE id = ${id}`) as any[]
      return rows[0] ? rowToTask(rows[0]) : null
    },

    create(input: {
      title: string
      description?: string
      schedule: string
      projectId: string
      priority?: string
      assignee?: string
      autoStart?: boolean
    }): RecurringBoardTask {
      const id = generateId()
      const now = new Date().toISOString()
      const cron = normalizeCron(input.schedule)
      const next = computeNextRunAt('cron', JSON.stringify({ cron }), new Date()) ?? now

      db.run(sql`INSERT INTO recurring_board_tasks (
        id, title, description, schedule, next_occurrence, project_id, priority, assignee, auto_start, status, created_at
      ) VALUES (
        ${id}, ${input.title}, ${input.description ?? null}, ${cron}, ${next},
        ${input.projectId}, ${input.priority ?? 'normal'}, ${input.assignee ?? null},
        ${input.autoStart ? 1 : 0}, 'active', ${now}
      )`)

      // Mirror as a scheduler job so it shows in the Schedule Hub
      const scheduler = deps.getScheduler?.()
      let jobId: string | undefined
      if (scheduler?.create) {
        const job = scheduler.create({
          name: `Board: ${input.title}`,
          description: input.description ?? `Recurring board card for project ${input.projectId}`,
          triggerType: 'cron',
          triggerConfig: JSON.stringify({ cron }),
          handler: 'scheduler.board_recurring',
          handlerConfig: JSON.stringify({ recurringId: id }),
          source: 'user',
          kind: 'board_recurring',
          category: 'board',
        })
        jobId = job.id
        db.run(sql`UPDATE recurring_board_tasks SET job_id = ${jobId} WHERE id = ${id}`)
      }

      logger.info({ id, title: input.title }, 'recurring board task created')
      return this.get(id)!
    },

    pause(id: string): void {
      db.run(sql`UPDATE recurring_board_tasks SET status = 'paused' WHERE id = ${id}`)
      const t = this.get(id)
      if (t?.jobId) deps.getScheduler?.()?.pause?.(t.jobId)
    },

    resume(id: string): void {
      db.run(sql`UPDATE recurring_board_tasks SET status = 'active' WHERE id = ${id}`)
      const t = this.get(id)
      if (t?.jobId) deps.getScheduler?.()?.resume?.(t.jobId)
    },

    delete(id: string): void {
      const t = this.get(id)
      db.run(sql`UPDATE recurring_board_tasks SET status = 'deleted' WHERE id = ${id}`)
      if (t?.jobId) deps.getScheduler?.()?.delete?.(t.jobId)
    },

    /** Handler invoked by scheduler.board_recurring */
    async tick(config?: Record<string, unknown>): Promise<unknown> {
      const recurringId = String(config?.recurringId ?? '')
      const task = recurringId ? this.get(recurringId) : null
      if (!task || task.status !== 'active') {
        return { skipped: true, reason: 'not active' }
      }

      const conversations = deps.getConversations?.()
      const board = deps.getBoard?.()

      let conversationId: string | undefined
      if (conversations?.create) {
        const conv = await conversations.create({
          title: task.title,
          projectId: task.projectId,
          agentId: task.assignee,
          description: task.description,
          priority: task.priority,
        })
        conversationId = conv?.id
      } else if (board?.createTask) {
        const card = await board.createTask({
          title: task.title,
          description: task.description,
          projectId: task.projectId,
          assigneeId: task.assignee,
          priority: task.priority,
        })
        conversationId = card?.id
      } else {
        throw new Error('Board/conversations unavailable for board_recurring')
      }

      const now = new Date().toISOString()
      const next =
        computeNextRunAt('cron', JSON.stringify({ cron: task.schedule }), new Date()) ?? now
      db.run(sql`UPDATE recurring_board_tasks SET last_created = ${now}, next_occurrence = ${next} WHERE id = ${task.id}`)

      if (task.autoStart && conversations?.sendMessage && conversationId) {
        await conversations.sendMessage(conversationId, {
          role: 'user',
          content: task.description || task.title,
          metadata: { origin: 'scheduled', autonomous: true },
        })
      }

      return { conversationId, title: task.title, nextOccurrence: next }
    },
  }
}

export type BoardRecurringService = ReturnType<typeof createBoardRecurringService>

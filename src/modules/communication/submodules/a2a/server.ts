// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { Hono } from 'hono'
import type { Logger } from 'pino'
import { sql } from 'drizzle-orm'
import { generateId } from '@shared/crypto.js'
import { requirePermission } from '@modules/permissions/middleware.js'
import type { A2ARequest, A2AResponse, A2ATask, A2ATaskStatus } from './types.js'
import { A2A_ERRORS } from './types.js'

// ─── Task Store ──────────────────────────────────────────────────────────────

export interface A2ATaskStore {
  create(task: { id: string; externalId?: string; description: string; skill?: string; conversationId?: string }): void
  get(id: string): A2ATask | undefined
  updateStatus(id: string, status: A2ATaskStatus, extra?: { result?: string; error?: string }): void
  list(): A2ATask[]
}

/**
 * SQL-backed task store using Drizzle's sql tagged template.
 */
export function createA2ATaskStore(db: any): A2ATaskStore {
  // Ensure table exists (idempotent)
  db.run(sql`CREATE TABLE IF NOT EXISTS a2a_tasks (
    id TEXT PRIMARY KEY,
    external_id TEXT,
    description TEXT NOT NULL,
    skill TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    conversation_id TEXT,
    result TEXT,
    error TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at TEXT
  )`)

  function rowToTask(row: any): A2ATask {
    return {
      id: row.id,
      status: row.status,
      description: row.description,
      result: row.result ?? undefined,
      error: row.error ?? undefined,
      createdAt: row.created_at,
      completedAt: row.completed_at ?? undefined,
    }
  }

  return {
    create(task) {
      const now = new Date().toISOString()
      db.run(sql`INSERT INTO a2a_tasks (id, external_id, description, skill, status, conversation_id, created_at)
        VALUES (${task.id}, ${task.externalId ?? null}, ${task.description}, ${task.skill ?? null}, ${'pending'}, ${task.conversationId ?? null}, ${now})`)
    },

    get(id) {
      const rows = db.all(sql`SELECT * FROM a2a_tasks WHERE id = ${id}`) as any[]
      return rows[0] ? rowToTask(rows[0]) : undefined
    },

    updateStatus(id, status, extra) {
      const completedAt = (status === 'completed' || status === 'failed' || status === 'cancelled')
        ? new Date().toISOString()
        : null
      db.run(sql`UPDATE a2a_tasks
        SET status = ${status},
            result = COALESCE(${extra?.result ?? null}, result),
            error = COALESCE(${extra?.error ?? null}, error),
            completed_at = COALESCE(${completedAt}, completed_at)
        WHERE id = ${id}`)
    },

    list() {
      const rows = db.all(sql`SELECT * FROM a2a_tasks ORDER BY created_at DESC`) as any[]
      return rows.map(rowToTask)
    },
  }
}

// ─── JSON-RPC Response Helpers ───────────────────────────────────────────────

function successResponse(id: string | number, result: unknown): A2AResponse {
  return { jsonrpc: '2.0', id, result }
}

function errorResponse(id: string | number, error: { code: number; message: string }): A2AResponse {
  return { jsonrpc: '2.0', id, error }
}

// ─── Route Registration ─────────────────────────────────────────────────────

/**
 * Runs an accepted A2A task, advancing it past 'running' to a terminal state
 * ('completed'/'failed'). Called fire-and-forget from tasks/send. When no
 * executor is wired the server cannot run tasks, so tasks/send marks them
 * 'failed' with a clear reason rather than leaving them silently 'pending'.
 */
export type A2ATaskExecutor = (task: { id: string; description: string; skill?: string }) => Promise<void>

export interface A2AServerOptions {
  app: Hono
  taskStore: A2ATaskStore
  logger: Logger
  executor?: A2ATaskExecutor
}

export function registerA2ARoutes({ app, taskStore, logger, executor }: A2AServerOptions): void {
  app.post(
    '/api/v1/a2a',
    requirePermission('create', 'Conversation'),
    async (c) => {
      let body: A2ARequest
      try {
        body = await c.req.json()
      } catch {
        return c.json(errorResponse(0, A2A_ERRORS.PARSE_ERROR), 400)
      }

      if (!body.jsonrpc || body.jsonrpc !== '2.0' || !body.method || body.id == null) {
        return c.json(errorResponse(body?.id ?? 0, A2A_ERRORS.INVALID_REQUEST), 400)
      }

      const { method, params, id } = body

      switch (method) {
        case 'tasks/send': {
          const description = (params as any)?.description
          if (!description || typeof description !== 'string') {
            return c.json(errorResponse(id, A2A_ERRORS.INVALID_PARAMS), 400)
          }
          const skill = typeof (params as any)?.skill === 'string' ? (params as any).skill : undefined
          const taskId = generateId()
          taskStore.create({ id: taskId, description, skill })
          logger.info({ taskId, skill }, 'A2A task created')

          if (executor) {
            // Accepted for async execution: mark 'running' now, then run
            // fire-and-forget. The caller polls tasks/get for the terminal
            // state. Any failure is recorded on the task so it never silently
            // stays 'running'.
            taskStore.updateStatus(taskId, 'running')
            void Promise.resolve()
              .then(() => executor({ id: taskId, description, skill }))
              .catch((err) => {
                logger.error({ err, taskId }, 'A2A task execution failed')
                taskStore.updateStatus(taskId, 'failed', { error: err?.message ?? 'execution failed' })
              })
          } else {
            // No executor wired ⇒ this task can never run. Be honest: fail it
            // immediately with a clear reason instead of advertising success
            // and leaving the caller polling an eternal 'pending'.
            taskStore.updateStatus(taskId, 'failed', { error: 'A2A task execution is not available on this server' })
          }

          const task = taskStore.get(taskId)!
          return c.json(successResponse(id, task))
        }

        case 'tasks/get': {
          const taskId = (params as any)?.taskId
          if (!taskId || typeof taskId !== 'string') {
            return c.json(errorResponse(id, A2A_ERRORS.INVALID_PARAMS), 400)
          }
          const task = taskStore.get(taskId)
          if (!task) {
            return c.json(errorResponse(id, A2A_ERRORS.TASK_NOT_FOUND), 404)
          }
          return c.json(successResponse(id, task))
        }

        case 'tasks/cancel': {
          const taskId = (params as any)?.taskId
          if (!taskId || typeof taskId !== 'string') {
            return c.json(errorResponse(id, A2A_ERRORS.INVALID_PARAMS), 400)
          }
          const task = taskStore.get(taskId)
          if (!task) {
            return c.json(errorResponse(id, A2A_ERRORS.TASK_NOT_FOUND), 404)
          }
          if (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') {
            return c.json(errorResponse(id, A2A_ERRORS.TASK_NOT_CANCELLABLE), 400)
          }
          taskStore.updateStatus(taskId, 'cancelled')
          logger.info({ taskId }, 'A2A task cancelled')
          const updated = taskStore.get(taskId)!
          return c.json(successResponse(id, updated))
        }

        default:
          return c.json(errorResponse(id, A2A_ERRORS.METHOD_NOT_FOUND), 400)
      }
    },
  )
}

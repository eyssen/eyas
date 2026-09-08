// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'
import type { ProactiveAlert, SourceType } from './types.js'

export interface SourceAdapter {
  type: SourceType
  name: string
  check(): Promise<ProactiveAlert[]>
}

export function createTaskSourceAdapter(db: any): SourceAdapter {
  return {
    type: 'tasks',
    name: 'Task Monitor',
    async check(): Promise<ProactiveAlert[]> {
      const alerts: ProactiveAlert[] = []
      const now = new Date()
      const today = now.toISOString().split('T')[0]

      // Overdue conversations
      const overdue = db.all(
        sql`SELECT id, title, due_date FROM conversations WHERE due_date < ${today} AND status NOT IN ('deleted', 'archived', 'idle') AND due_date IS NOT NULL`,
      ) as any[]

      for (const row of overdue) {
        alerts.push({
          id: `overdue-${row.id}`,
          type: 'warning',
          title: `Overdue: ${row.title ?? 'Untitled'}`,
          body: `Due date was ${row.due_date}`,
          source: 'tasks',
          priority: 'high',
          actionable: true,
          action: { type: 'open_conversation', data: { conversationId: row.id } },
          createdAt: now.toISOString(),
        })
      }

      // Stalled conversations (working status for >1 hour)
      const hourAgo = new Date(now.getTime() - 3600_000).toISOString()
      const stalled = db.all(
        sql`SELECT id, title FROM conversations WHERE status = 'working' AND updated_at < ${hourAgo}`,
      ) as any[]

      for (const row of stalled) {
        alerts.push({
          id: `stalled-${row.id}`,
          type: 'warning',
          title: `Stalled: ${row.title ?? 'Untitled'}`,
          body: 'Conversation has been in "working" status for over an hour',
          source: 'tasks',
          priority: 'normal',
          actionable: true,
          action: { type: 'open_conversation', data: { conversationId: row.id } },
          createdAt: now.toISOString(),
        })
      }

      return alerts
    },
  }
}

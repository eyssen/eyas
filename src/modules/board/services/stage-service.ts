// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'
import { generateId } from '@shared/crypto'
import type { Stage } from './project-service.js'

export interface CreateStageInput {
  projectId?: string | null
  name: string
  color?: string
  sortOrder?: number
  isClosed?: boolean
  isFolded?: boolean
  botListen?: boolean
  /** Agent that picks up cards entering this stage. */
  autoAssigneeId?: string | null
  /** Max cards in this stage (null/0 = unlimited). */
  wipLimit?: number | null
}

export interface UpdateStageInput {
  name?: string
  color?: string | null
  sortOrder?: number
  isClosed?: boolean
  isFolded?: boolean
  botListen?: boolean
  /** Pass null to clear the auto-assignee; omit to leave it untouched. */
  autoAssigneeId?: string | null
  wipLimit?: number | null
}

export interface StageService {
  create(input: CreateStageInput): Stage
  get(id: string): Stage | null
  listByProject(projectId: string): Stage[]
  listGlobal(): Stage[]
  update(id: string, input: UpdateStageInput): void
  reorder(projectId: string | null, stageIds: string[]): void
  delete(id: string): void
}

function toStage(raw: any): Stage {
  return {
    id: raw.id,
    projectId: raw.project_id,
    name: raw.name,
    color: raw.color,
    sortOrder: raw.sort_order,
    isClosed: raw.is_closed === 1,
    isFolded: raw.is_folded === 1,
    botListen: raw.bot_listen === 1,
    autoAssigneeId: raw.auto_assignee_id ?? null,
    wipLimit: raw.wip_limit ?? null,
    createdAt: raw.created_at,
  }
}

export function createStageService(db: any): StageService {
  return {
    create(input: CreateStageInput): Stage {
      const id = generateId()
      const now = new Date().toISOString()
      db.run(sql`INSERT INTO stages (id, project_id, name, color, sort_order, is_closed, is_hidden, is_folded, bot_listen, auto_assignee_id, wip_limit, created_at)
        VALUES (${id}, ${input.projectId ?? null}, ${input.name}, ${input.color ?? null}, ${input.sortOrder ?? 0}, ${input.isClosed ? 1 : 0}, 0, ${input.isFolded ? 1 : 0}, ${input.botListen ? 1 : 0}, ${input.autoAssigneeId ?? null}, ${input.wipLimit ?? null}, ${now})`)
      return toStage((db.all(sql`SELECT * FROM stages WHERE id = ${id}`) as any[])[0])
    },

    get(id: string): Stage | null {
      const rows = db.all(sql`SELECT * FROM stages WHERE id = ${id}`) as any[]
      return rows.length > 0 ? toStage(rows[0]) : null
    },

    listByProject(projectId: string): Stage[] {
      return (db.all(sql`SELECT * FROM stages WHERE project_id = ${projectId} ORDER BY sort_order`) as any[]).map(toStage)
    },

    listGlobal(): Stage[] {
      return (db.all(sql`SELECT * FROM stages WHERE project_id IS NULL ORDER BY sort_order`) as any[]).map(toStage)
    },

    update(id: string, input: UpdateStageInput): void {
      if (input.name !== undefined) db.run(sql`UPDATE stages SET name = ${input.name} WHERE id = ${id}`)
      if (input.color !== undefined) db.run(sql`UPDATE stages SET color = ${input.color} WHERE id = ${id}`)
      if (input.sortOrder !== undefined) db.run(sql`UPDATE stages SET sort_order = ${input.sortOrder} WHERE id = ${id}`)
      if (input.isClosed !== undefined) db.run(sql`UPDATE stages SET is_closed = ${input.isClosed ? 1 : 0} WHERE id = ${id}`)
      if (input.isFolded !== undefined) db.run(sql`UPDATE stages SET is_folded = ${input.isFolded ? 1 : 0} WHERE id = ${id}`)
      if (input.botListen !== undefined) db.run(sql`UPDATE stages SET bot_listen = ${input.botListen ? 1 : 0} WHERE id = ${id}`)
      if (input.autoAssigneeId !== undefined) db.run(sql`UPDATE stages SET auto_assignee_id = ${input.autoAssigneeId} WHERE id = ${id}`)
      if (input.wipLimit !== undefined) db.run(sql`UPDATE stages SET wip_limit = ${input.wipLimit} WHERE id = ${id}`)
    },

    reorder(projectId: string | null, stageIds: string[]): void {
      if (projectId) {
        stageIds.forEach((id, idx) => {
          db.run(sql`UPDATE stages SET sort_order = ${idx} WHERE id = ${id} AND project_id = ${projectId}`)
        })
      } else {
        stageIds.forEach((id, idx) => {
          db.run(sql`UPDATE stages SET sort_order = ${idx} WHERE id = ${id} AND project_id IS NULL`)
        })
      }
    },

    delete(id: string): void {
      db.run(sql`UPDATE conversations SET stage_id = NULL WHERE stage_id = ${id}`)
      db.run(sql`DELETE FROM stages WHERE id = ${id}`)
    },
  }
}

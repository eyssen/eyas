// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'
import { generateId } from '@shared/crypto'

// ─── Types ──────────────────────────────────────────────

export interface ActivityType {
  id: string
  name: string
  icon: string | null
  category: string
  decoration: string
  delayDays: number
  delayUnit: string
  triggerNextTypeId: string | null
  suggestNextTypeId: string | null
  defaultUserId: string | null
  summaryTemplate: string | null
  sortOrder: number
  createdAt: string
}

export interface Activity {
  id: string
  typeId: string
  typeName: string
  typeIcon: string | null
  typeDecoration: string
  resModel: string
  resId: string
  summary: string | null
  note: string | null
  userId: string
  createdById: string
  dateDeadline: string
  doneAt: string | null
  feedback: string | null
  automated: boolean
  state: 'overdue' | 'today' | 'planned'
  createdAt: string
}

export interface ScheduleActivityInput {
  typeId: string
  resModel: string
  resId: string
  summary?: string
  note?: string
  userId: string
  createdById: string
  dateDeadline: string
  automated?: boolean
}

export interface ActivityStats {
  overdue: number
  today: number
  planned: number
}

export interface ActivityService {
  schedule(input: ScheduleActivityInput): Activity
  markDone(id: string, feedback?: string): Activity
  markCancel(id: string): void
  listByRecord(resModel: string, resId: string): Activity[]
  listByUser(userId: string): Activity[]
  getStats(userId: string): ActivityStats
  listTypes(): ActivityType[]
}

// ─── Mappers ────────────────────────────────────────────

function computeState(dateDeadline: string, doneAt: string | null): 'overdue' | 'today' | 'planned' {
  if (doneAt) return 'planned' // Done activities are "planned" (no longer actionable)
  const today = new Date().toISOString().slice(0, 10)
  const deadline = dateDeadline.slice(0, 10)
  if (deadline < today) return 'overdue'
  if (deadline === today) return 'today'
  return 'planned'
}

function toActivityType(raw: any): ActivityType {
  return {
    id: raw.id,
    name: raw.name,
    icon: raw.icon ?? null,
    category: raw.category ?? 'default',
    decoration: raw.decoration ?? 'normal',
    delayDays: raw.delay_days ?? 0,
    delayUnit: raw.delay_unit ?? 'days',
    triggerNextTypeId: raw.trigger_next_type_id ?? null,
    suggestNextTypeId: raw.suggest_next_type_id ?? null,
    defaultUserId: raw.default_user_id ?? null,
    summaryTemplate: raw.summary_template ?? null,
    sortOrder: raw.sort_order ?? 0,
    createdAt: raw.created_at,
  }
}

function toActivity(raw: any): Activity {
  return {
    id: raw.id,
    typeId: raw.type_id,
    typeName: raw.type_name ?? '',
    typeIcon: raw.type_icon ?? null,
    typeDecoration: raw.type_decoration ?? 'normal',
    resModel: raw.res_model,
    resId: raw.res_id,
    summary: raw.summary ?? null,
    note: raw.note ?? null,
    userId: raw.user_id,
    createdById: raw.created_by_id,
    dateDeadline: raw.date_deadline,
    doneAt: raw.done_at ?? null,
    feedback: raw.feedback ?? null,
    automated: raw.automated === 1,
    state: computeState(raw.date_deadline, raw.done_at),
    createdAt: raw.created_at,
  }
}

// ─── Helpers ────────────────────────────────────────────

function addDelay(fromDate: string, days: number, unit: string): string {
  const d = new Date(fromDate)
  switch (unit) {
    case 'weeks':
      d.setDate(d.getDate() + days * 7)
      break
    case 'months':
      d.setMonth(d.getMonth() + days)
      break
    default: // 'days'
      d.setDate(d.getDate() + days)
      break
  }
  return d.toISOString().slice(0, 10)
}

// ─── Activity query (JOIN with type) ────────────────────

const ACTIVITY_SELECT = sql.raw(`
  SELECT a.*, at.name as type_name, at.icon as type_icon, at.decoration as type_decoration
  FROM activities a
  LEFT JOIN activity_types at ON a.type_id = at.id
`)

// ─── Service ────────────────────────────────────────────

export function createActivityService(db: any): ActivityService {
  function getById(id: string): Activity | null {
    const rows = db.all(sql`SELECT a.*, at.name as type_name, at.icon as type_icon, at.decoration as type_decoration FROM activities a LEFT JOIN activity_types at ON a.type_id = at.id WHERE a.id = ${id}`) as any[]
    return rows.length > 0 ? toActivity(rows[0]) : null
  }

  function getTypeById(id: string): ActivityType | null {
    const rows = db.all(sql`SELECT * FROM activity_types WHERE id = ${id}`) as any[]
    return rows.length > 0 ? toActivityType(rows[0]) : null
  }

  return {
    listTypes(): ActivityType[] {
      return (db.all(sql`SELECT * FROM activity_types ORDER BY sort_order, name`) as any[]).map(toActivityType)
    },

    schedule(input: ScheduleActivityInput): Activity {
      const id = generateId()
      db.run(sql`INSERT INTO activities (id, type_id, res_model, res_id, summary, note, user_id, created_by_id, date_deadline, automated)
        VALUES (${id}, ${input.typeId}, ${input.resModel}, ${input.resId}, ${input.summary ?? null}, ${input.note ?? null}, ${input.userId}, ${input.createdById}, ${input.dateDeadline}, ${input.automated ? 1 : 0})`)
      return getById(id)!
    },

    markDone(id: string, feedback?: string): Activity {
      const activity = getById(id)
      if (!activity) throw new Error(`Activity not found: ${id}`)

      const now = new Date().toISOString()
      db.run(sql`UPDATE activities SET done_at = ${now}, feedback = ${feedback ?? null} WHERE id = ${id}`)

      // Chaining: trigger next activity if type has trigger_next_type_id
      const actType = getTypeById(activity.typeId)
      if (actType?.triggerNextTypeId) {
        const nextType = getTypeById(actType.triggerNextTypeId)
        if (nextType) {
          const nextDeadline = addDelay(now.slice(0, 10), nextType.delayDays, nextType.delayUnit)
          const nextId = generateId()
          db.run(sql`INSERT INTO activities (id, type_id, res_model, res_id, summary, note, user_id, created_by_id, date_deadline, automated)
            VALUES (${nextId}, ${nextType.id}, ${activity.resModel}, ${activity.resId}, ${nextType.summaryTemplate ?? null}, ${null}, ${activity.userId}, ${activity.createdById}, ${nextDeadline}, ${1})`)
        }
      }

      return getById(id)!
    },

    markCancel(id: string): void {
      db.run(sql`DELETE FROM activities WHERE id = ${id}`)
    },

    listByRecord(resModel: string, resId: string): Activity[] {
      return (db.all(sql`SELECT a.*, at.name as type_name, at.icon as type_icon, at.decoration as type_decoration FROM activities a LEFT JOIN activity_types at ON a.type_id = at.id WHERE a.res_model = ${resModel} AND a.res_id = ${resId} AND a.done_at IS NULL ORDER BY a.date_deadline`) as any[]).map(toActivity)
    },

    listByUser(userId: string): Activity[] {
      return (db.all(sql`SELECT a.*, at.name as type_name, at.icon as type_icon, at.decoration as type_decoration FROM activities a LEFT JOIN activity_types at ON a.type_id = at.id WHERE a.user_id = ${userId} AND a.done_at IS NULL ORDER BY a.date_deadline`) as any[]).map(toActivity)
    },

    getStats(userId: string): ActivityStats {
      const today = new Date().toISOString().slice(0, 10)
      const rows = db.all(sql`SELECT
        SUM(CASE WHEN date_deadline < ${today} THEN 1 ELSE 0 END) as overdue,
        SUM(CASE WHEN date_deadline = ${today} THEN 1 ELSE 0 END) as today,
        SUM(CASE WHEN date_deadline > ${today} THEN 1 ELSE 0 END) as planned
        FROM activities WHERE user_id = ${userId} AND done_at IS NULL`) as any[]
      const row = rows[0] ?? {}
      return {
        overdue: row.overdue ?? 0,
        today: row.today ?? 0,
        planned: row.planned ?? 0,
      }
    },
  }
}

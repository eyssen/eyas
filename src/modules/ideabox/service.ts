// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import type { EyasDb } from '@core/types'

export type IdeaStatus = 'new' | 'reviewed' | 'kanban' | 'rejected'

export interface Idea {
  id: string
  title: string
  description: string | null
  status: IdeaStatus
  impact: number | null
  effort: number | null
  score: number | null
  successCriteria: string | null
  projectId: string | null
  conversationId: string | null
  createdBy: string | null
  createdAt: string
  updatedAt: string
}

export interface IdeaboxService {
  create(input: { title: string; description?: string; createdBy?: string; projectId?: string }): Idea
  get(id: string): Idea | null
  list(opts?: { status?: string; activeOnly?: boolean }): Idea[]
  update(id: string, patch: Partial<{ title: string; description: string; status: IdeaStatus; impact: number; effort: number; successCriteria: string; projectId: string }>): Idea | null
  score(id: string, impact: number, effort: number): Idea | null
  promote(id: string, conversationId: string): Idea | null
  reject(id: string): Idea | null
  addComment(ideaId: string, author: string, body: string): { id: string }
  listComments(ideaId: string): any[]
  topSuggestions(limit?: number): Idea[]
}

function rowToIdea(r: any): Idea {
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    status: r.status,
    impact: r.impact,
    effort: r.effort,
    score: r.score,
    successCriteria: r.success_criteria,
    projectId: r.project_id,
    conversationId: r.conversation_id,
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

export function createIdeaboxTables(db: EyasDb): void {
  db.run(sql`CREATE TABLE IF NOT EXISTS ideas (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'new',
    impact INTEGER,
    effort INTEGER,
    score INTEGER,
    success_criteria TEXT,
    project_id TEXT,
    conversation_id TEXT,
    created_by TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`)
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_ideas_status ON ideas(status)`)
  db.run(sql`CREATE TABLE IF NOT EXISTS idea_comments (
    id TEXT PRIMARY KEY,
    idea_id TEXT NOT NULL,
    author TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`)
}

export function createIdeaboxService(db: EyasDb): IdeaboxService {
  return {
    create(input) {
      const id = randomUUID()
      db.run(sql`
        INSERT INTO ideas (id, title, description, created_by, project_id)
        VALUES (${id}, ${input.title}, ${input.description ?? null}, ${input.createdBy ?? null}, ${input.projectId ?? null})
      `)
      return this.get(id)!
    },

    get(id) {
      const rows = db.all(sql`SELECT * FROM ideas WHERE id = ${id}`) as any[]
      return rows[0] ? rowToIdea(rows[0]) : null
    },

    list(opts = {}) {
      if (opts.status) {
        return (db.all(sql`SELECT * FROM ideas WHERE status = ${opts.status} ORDER BY updated_at DESC`) as any[]).map(rowToIdea)
      }
      if (opts.activeOnly !== false) {
        return (db.all(sql`SELECT * FROM ideas WHERE status IN ('new','reviewed') ORDER BY COALESCE(score, -99) DESC, updated_at DESC`) as any[]).map(rowToIdea)
      }
      return (db.all(sql`SELECT * FROM ideas ORDER BY updated_at DESC`) as any[]).map(rowToIdea)
    },

    update(id, patch) {
      const cur = this.get(id)
      if (!cur) return null
      const title = patch.title ?? cur.title
      const description = patch.description ?? cur.description
      const status = patch.status ?? cur.status
      const impact = patch.impact ?? cur.impact
      const effort = patch.effort ?? cur.effort
      const score = impact != null && effort != null ? impact - effort : cur.score
      const successCriteria = patch.successCriteria ?? cur.successCriteria
      const projectId = patch.projectId ?? cur.projectId
      db.run(sql`
        UPDATE ideas SET
          title = ${title},
          description = ${description},
          status = ${status},
          impact = ${impact},
          effort = ${effort},
          score = ${score},
          success_criteria = ${successCriteria},
          project_id = ${projectId},
          updated_at = datetime('now')
        WHERE id = ${id}
      `)
      return this.get(id)
    },

    score(id, impact, effort) {
      return this.update(id, { impact, effort, status: 'reviewed' })
    },

    promote(id, conversationId) {
      const cur = this.get(id)
      if (!cur) return null
      db.run(sql`
        UPDATE ideas SET status = 'kanban', conversation_id = ${conversationId}, updated_at = datetime('now')
        WHERE id = ${id}
      `)
      return this.get(id)
    },

    reject(id) {
      return this.update(id, { status: 'rejected' })
    },

    addComment(ideaId, author, body) {
      const id = randomUUID()
      db.run(sql`
        INSERT INTO idea_comments (id, idea_id, author, body)
        VALUES (${id}, ${ideaId}, ${author}, ${body})
      `)
      db.run(sql`UPDATE ideas SET updated_at = datetime('now') WHERE id = ${ideaId}`)
      return { id }
    },

    listComments(ideaId) {
      return db.all(sql`SELECT * FROM idea_comments WHERE idea_id = ${ideaId} ORDER BY created_at ASC`)
    },

    topSuggestions(limit = 3) {
      return (db.all(sql`
        SELECT * FROM ideas
        WHERE status IN ('new','reviewed') AND score IS NOT NULL AND score >= 2
        ORDER BY score DESC, updated_at DESC
        LIMIT ${limit}
      `) as any[]).map(rowToIdea)
    },
  }
}

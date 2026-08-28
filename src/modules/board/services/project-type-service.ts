// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'
import { generateId } from '@shared/crypto'

export interface ProjectType {
  id: string
  name: string
  prompt: string
  defaultStages: string[]
  defaultPriority: string
  color: string | null
  icon: string | null
  source: 'seed' | 'user'
  indexedSources: string[] | null
  skills: string[] | null
  defaultAgentId: string | null
  permissions: Record<string, unknown> | null
  createdAt: string
}

export interface CreateProjectTypeInput {
  name: string
  prompt?: string
  defaultStages?: string[]
  defaultPriority?: string
  color?: string
  icon?: string
  defaultAgentId?: string
  indexedSources?: string[]
  skills?: string[]
  permissions?: Record<string, unknown>
}

export interface UpdateProjectTypeInput {
  name?: string
  prompt?: string
  defaultStages?: string[]
  defaultPriority?: string
  color?: string | null
  icon?: string | null
  defaultAgentId?: string | null
  indexedSources?: string[] | null
}

export interface ProjectTypeService {
  create(input: CreateProjectTypeInput): ProjectType
  list(): ProjectType[]
  get(id: string): ProjectType | null
  update(id: string, input: UpdateProjectTypeInput): void
  delete(id: string): void
}

function toProjectType(raw: any): ProjectType {
  return {
    id: raw.id,
    name: raw.name,
    prompt: raw.prompt,
    defaultStages: JSON.parse(raw.default_stages),
    defaultPriority: raw.default_priority,
    color: raw.color,
    icon: raw.icon,
    source: raw.source ?? 'user',
    defaultAgentId: raw.default_agent_id ?? null,
    indexedSources: raw.indexed_sources ? JSON.parse(raw.indexed_sources) : null,
    skills: raw.skills ? JSON.parse(raw.skills) : null,
    permissions: raw.permissions ? JSON.parse(raw.permissions) : null,
    createdAt: raw.created_at,
  }
}

export function createProjectTypeService(db: any): ProjectTypeService {
  return {
    create(input: CreateProjectTypeInput): ProjectType {
      const id = generateId()
      const now = new Date().toISOString()
      const defaultStages = JSON.stringify(input.defaultStages ?? ['Backlog', 'In Progress', 'Done'])
      const defaultPriority = input.defaultPriority ?? 'normal'
      db.run(sql`INSERT INTO project_types (id, name, prompt, default_stages, default_priority, color, icon, default_agent_id, indexed_sources, skills, permissions, created_at)
        VALUES (${id}, ${input.name}, ${input.prompt ?? ''}, ${defaultStages}, ${defaultPriority}, ${input.color ?? null}, ${input.icon ?? null}, ${input.defaultAgentId ?? null}, ${input.indexedSources ? JSON.stringify(input.indexedSources) : null}, ${input.skills ? JSON.stringify(input.skills) : null}, ${input.permissions ? JSON.stringify(input.permissions) : null}, ${now})`)
      return toProjectType((db.all(sql`SELECT * FROM project_types WHERE id = ${id}`) as any[])[0])
    },

    list(): ProjectType[] {
      return (db.all(sql`SELECT * FROM project_types ORDER BY name`) as any[]).map(toProjectType)
    },

    get(id: string): ProjectType | null {
      const rows = db.all(sql`SELECT * FROM project_types WHERE id = ${id}`) as any[]
      return rows.length > 0 ? toProjectType(rows[0]) : null
    },

    update(id: string, input: UpdateProjectTypeInput): void {
      const check = db.all(sql`SELECT source FROM project_types WHERE id = ${id}`) as any[]
      if (check.length > 0 && check[0].source === 'seed') throw new Error('Cannot modify system resource')
      if (input.name !== undefined) db.run(sql`UPDATE project_types SET name = ${input.name} WHERE id = ${id}`)
      if (input.prompt !== undefined) db.run(sql`UPDATE project_types SET prompt = ${input.prompt} WHERE id = ${id}`)
      if (input.defaultStages !== undefined) db.run(sql`UPDATE project_types SET default_stages = ${JSON.stringify(input.defaultStages)} WHERE id = ${id}`)
      if (input.defaultPriority !== undefined) db.run(sql`UPDATE project_types SET default_priority = ${input.defaultPriority} WHERE id = ${id}`)
      if (input.color !== undefined) db.run(sql`UPDATE project_types SET color = ${input.color} WHERE id = ${id}`)
      if (input.icon !== undefined) db.run(sql`UPDATE project_types SET icon = ${input.icon} WHERE id = ${id}`)
      if (input.defaultAgentId !== undefined) db.run(sql`UPDATE project_types SET default_agent_id = ${input.defaultAgentId} WHERE id = ${id}`)
      if (input.indexedSources !== undefined) {
        const val = input.indexedSources == null ? null : JSON.stringify(input.indexedSources)
        db.run(sql`UPDATE project_types SET indexed_sources = ${val} WHERE id = ${id}`)
      }
    },

    delete(id: string): void {
      const check = db.all(sql`SELECT source FROM project_types WHERE id = ${id}`) as any[]
      if (check.length > 0 && check[0].source === 'seed') throw new Error('Cannot delete system resource')
      db.run(sql`DELETE FROM project_types WHERE id = ${id}`)
    },
  }
}

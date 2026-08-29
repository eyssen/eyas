// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'
import { generateId } from '@shared/crypto'
import type { ProjectTypeService } from './project-type-service.js'

export interface Project {
  id: string
  name: string
  description: string | null
  typeId: string | null
  prompt: string | null
  defaultAgentId: string | null
  color: string | null
  source: 'seed' | 'user'
  sortOrder: number
  /** Search source IDs to pin for conversations in this project. */
  indexedSources: string[] | null
  /** Absolute working directories; first is primary cwd. Seed projects may be empty. */
  workingDirectories: string[] | null
  designSystemId: string | null
  createdAt: string
  updatedAt: string
}

export interface Stage {
  id: string
  projectId: string | null
  name: string
  color: string | null
  sortOrder: number
  isClosed: boolean
  isFolded: boolean
  botListen: boolean
  /** Agent that picks up cards entering this stage (NULL = none). */
  autoAssigneeId: string | null
  /** Max cards in stage (null/0 = unlimited). */
  wipLimit: number | null
  createdAt: string
}

export interface ProjectWithStages extends Project {
  stages: Stage[]
}

export interface CreateProjectInput {
  name: string
  description?: string
  typeId?: string
  prompt?: string
  defaultAgentId?: string
  color?: string
  indexedSources?: string[] | null
  workingDirectories?: string[] | null
  designSystemId?: string | null
}

export interface UpdateProjectInput {
  name?: string
  description?: string | null
  prompt?: string | null
  defaultAgentId?: string | null
  color?: string | null
  sortOrder?: number
  indexedSources?: string[] | null
  workingDirectories?: string[] | null
  designSystemId?: string | null
}

export interface ProjectService {
  create(input: CreateProjectInput): Project
  list(): Project[]
  get(id: string): Project | null
  getWithStages(id: string): ProjectWithStages | null
  update(id: string, input: UpdateProjectInput): void
  delete(id: string): void
}

function toProject(raw: any): Project {
  return {
    id: raw.id,
    name: raw.name,
    description: raw.description,
    typeId: raw.type_id,
    prompt: raw.prompt,
    defaultAgentId: raw.default_agent_id ?? null,
    color: raw.color,
    source: raw.source ?? 'user',
    sortOrder: raw.sort_order,
    indexedSources: raw.indexed_sources
      ? (typeof raw.indexed_sources === 'string'
          ? JSON.parse(raw.indexed_sources)
          : raw.indexed_sources)
      : null,
    workingDirectories: raw.working_directories
      ? (typeof raw.working_directories === 'string'
          ? JSON.parse(raw.working_directories)
          : raw.working_directories)
      : null,
    designSystemId: raw.design_system_id ?? null,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
  }
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

export function createProjectService(db: any, typeService: ProjectTypeService): ProjectService {
  return {
    create(input: CreateProjectInput): Project {
      const id = generateId()
      const now = new Date().toISOString()
      const indexedSources = input.indexedSources != null ? JSON.stringify(input.indexedSources) : null
      const workingDirectories = input.workingDirectories != null ? JSON.stringify(input.workingDirectories) : null
      db.run(sql`INSERT INTO projects (id, name, description, type_id, prompt, default_agent_id, color, sort_order, indexed_sources, working_directories, design_system_id, created_at, updated_at)
        VALUES (${id}, ${input.name}, ${input.description ?? null}, ${input.typeId ?? null}, ${input.prompt ?? null}, ${input.defaultAgentId ?? null}, ${input.color ?? null}, 0, ${indexedSources}, ${workingDirectories}, ${input.designSystemId ?? null}, ${now}, ${now})`)

      // Auto-create stages from project type
      if (input.typeId) {
        const pt = typeService.get(input.typeId)
        if (pt) {
          pt.defaultStages.forEach((stageName, idx) => {
            const stageId = generateId()
            const isClosed = idx === pt.defaultStages.length - 1 ? 1 : 0
            db.run(sql`INSERT INTO stages (id, project_id, name, sort_order, is_closed, is_hidden, is_folded, bot_listen, created_at)
              VALUES (${stageId}, ${id}, ${stageName}, ${idx}, ${isClosed}, 0, 0, 0, ${now})`)
          })
        }
      }

      return toProject((db.all(sql`SELECT * FROM projects WHERE id = ${id}`) as any[])[0])
    },

    list(): Project[] {
      return (db.all(sql`SELECT * FROM projects ORDER BY sort_order, name`) as any[]).map(toProject)
    },

    get(id: string): Project | null {
      const rows = db.all(sql`SELECT * FROM projects WHERE id = ${id}`) as any[]
      return rows.length > 0 ? toProject(rows[0]) : null
    },

    getWithStages(id: string): ProjectWithStages | null {
      const project = this.get(id)
      if (!project) return null
      // Project-specific stages first, fall back to global stages
      let stageRows = db.all(sql`SELECT * FROM stages WHERE project_id = ${id} ORDER BY sort_order`) as any[]
      if (stageRows.length === 0) {
        stageRows = db.all(sql`SELECT * FROM stages WHERE project_id IS NULL ORDER BY sort_order`) as any[]
      }
      return { ...project, stages: stageRows.map(toStage) }
    },

    update(id: string, input: UpdateProjectInput): void {
      // Seed projects are installed by the system. Their identity/structural
      // fields (name, sort order) must stay immutable so future seeding and
      // migrations aren't broken — but configuration fields (default agent,
      // prompt, color, description) may be customized by the user. The board
      // route only forwards the config subset for seed projects; this guard is
      // defense-in-depth for direct service callers. Parallels `delete()`.
      const check = db.all(sql`SELECT source FROM projects WHERE id = ${id}`) as any[]
      if (check.length > 0 && check[0].source === 'seed') {
        if (input.name !== undefined || input.sortOrder !== undefined) {
          throw new Error('Cannot modify system resource')
        }
      }
      const now = new Date().toISOString()
      if (input.name !== undefined) db.run(sql`UPDATE projects SET name = ${input.name}, updated_at = ${now} WHERE id = ${id}`)
      if (input.description !== undefined) db.run(sql`UPDATE projects SET description = ${input.description}, updated_at = ${now} WHERE id = ${id}`)
      if (input.prompt !== undefined) db.run(sql`UPDATE projects SET prompt = ${input.prompt}, updated_at = ${now} WHERE id = ${id}`)
      if (input.defaultAgentId !== undefined) db.run(sql`UPDATE projects SET default_agent_id = ${input.defaultAgentId}, updated_at = ${now} WHERE id = ${id}`)
      if (input.color !== undefined) db.run(sql`UPDATE projects SET color = ${input.color}, updated_at = ${now} WHERE id = ${id}`)
      if (input.sortOrder !== undefined) db.run(sql`UPDATE projects SET sort_order = ${input.sortOrder}, updated_at = ${now} WHERE id = ${id}`)
      if (input.indexedSources !== undefined) {
        const val = input.indexedSources == null ? null : JSON.stringify(input.indexedSources)
        db.run(sql`UPDATE projects SET indexed_sources = ${val}, updated_at = ${now} WHERE id = ${id}`)
      }
      if (input.workingDirectories !== undefined) {
        const val = input.workingDirectories == null ? null : JSON.stringify(input.workingDirectories)
        db.run(sql`UPDATE projects SET working_directories = ${val}, updated_at = ${now} WHERE id = ${id}`)
      }
      if (input.designSystemId !== undefined) {
        db.run(sql`UPDATE projects SET design_system_id = ${input.designSystemId}, updated_at = ${now} WHERE id = ${id}`)
      }
    },

    delete(id: string): void {
      const check = db.all(sql`SELECT source FROM projects WHERE id = ${id}`) as any[]
      if (check.length > 0 && check[0].source === 'seed') throw new Error('Cannot delete system resource')
      db.run(sql`DELETE FROM stages WHERE project_id = ${id}`)
      db.run(sql`UPDATE conversations SET project_id = NULL, stage_id = NULL WHERE project_id = ${id}`)
      db.run(sql`DELETE FROM projects WHERE id = ${id}`)
    },
  }
}

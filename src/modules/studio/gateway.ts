// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { sql } from 'drizzle-orm'
import type { Logger } from 'pino'
import type { EyasDb } from '@core/types'
import { generateId } from '@shared/crypto.js'
import type {
  StudioEngine,
  StudioEngineInfo,
  StudioGateway,
  StudioJob,
  StudioJobStatus,
  StudioProject,
} from './types.js'

type ProjectRow = {
  id: string
  engine_id: string
  title: string
  dir: string
  conversation_id: string | null
  created_at: string
  updated_at: string
}

type JobRow = {
  id: string
  engine_id: string
  project_id: string
  kind: string
  status: string
  error: string | null
  output_path: string | null
  document_ids: string | null
  conversation_id: string | null
  agent_id: string | null
  user_id: string | null
  created_at: string
  updated_at: string
  completed_at: string | null
}

function parseJsonArray(raw: string | null): string[] {
  if (!raw) return []
  try {
    const v = JSON.parse(raw)
    return Array.isArray(v) ? v.map(String) : []
  } catch {
    return []
  }
}

function rowToProject(row: ProjectRow): StudioProject {
  return {
    id: row.id,
    engineId: row.engine_id,
    title: row.title,
    dir: row.dir,
    conversationId: row.conversation_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function rowToJob(row: JobRow): StudioJob {
  return {
    id: row.id,
    engineId: row.engine_id,
    projectId: row.project_id,
    kind: row.kind as StudioJob['kind'],
    status: row.status as StudioJobStatus,
    error: row.error,
    outputPath: row.output_path,
    documentIds: parseJsonArray(row.document_ids),
    conversationId: row.conversation_id,
    agentId: row.agent_id,
    userId: row.user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  }
}

export function createStudioGateway(deps: {
  db: EyasDb
  logger: Logger
  projectsRoot: string
  ingest?: (job: StudioJob) => Promise<StudioJob>
  onSave?: (job: StudioJob) => void
  now?: () => Date
}): StudioGateway {
  const { db, logger, ingest } = deps
  const now = deps.now ?? (() => new Date())
  const engines = new Map<string, StudioEngine>()

  function loadProject(id: string): StudioProject | undefined {
    // drizzle bun-sqlite `.get()` can return a positional array; `.all()` is named objects.
    const row = db.all<ProjectRow>(sql`SELECT * FROM studio_projects WHERE id = ${id}`)[0]
    return row ? rowToProject(row) : undefined
  }

  function saveProject(project: StudioProject): void {
    db.run(sql`
      INSERT INTO studio_projects (id, engine_id, title, dir, conversation_id, created_at, updated_at)
      VALUES (
        ${project.id}, ${project.engineId}, ${project.title}, ${project.dir},
        ${project.conversationId}, ${project.createdAt}, ${project.updatedAt}
      )
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        dir = excluded.dir,
        conversation_id = excluded.conversation_id,
        updated_at = excluded.updated_at
    `)
  }

  function loadJob(id: string): StudioJob | undefined {
    const row = db.all<JobRow>(sql`SELECT * FROM studio_jobs WHERE id = ${id}`)[0]
    return row ? rowToJob(row) : undefined
  }

  function persistJob(job: StudioJob): void {
    db.run(sql`
      INSERT INTO studio_jobs (
        id, engine_id, project_id, kind, status, error, output_path, document_ids,
        conversation_id, agent_id, user_id, created_at, updated_at, completed_at
      ) VALUES (
        ${job.id}, ${job.engineId}, ${job.projectId}, ${job.kind}, ${job.status},
        ${job.error}, ${job.outputPath}, ${JSON.stringify(job.documentIds)},
        ${job.conversationId}, ${job.agentId}, ${job.userId},
        ${job.createdAt}, ${job.updatedAt}, ${job.completedAt}
      )
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status,
        error = excluded.error,
        output_path = excluded.output_path,
        document_ids = excluded.document_ids,
        updated_at = excluded.updated_at,
        completed_at = excluded.completed_at
    `)
    deps.onSave?.(job)
  }

  async function maybeIngest(job: StudioJob): Promise<StudioJob> {
    if (!ingest) return job
    if (job.status !== 'completed' || !job.outputPath) return job
    if (job.documentIds.length > 0) return job
    try {
      const ingested = await ingest(job)
      persistJob(ingested)
      return ingested
    } catch (err) {
      logger.warn({ err, jobId: job.id }, 'Studio ingest failed')
      return job
    }
  }

  return {
    registerEngine(engine) {
      engines.set(engine.id, engine)
    },

    listEngines(): StudioEngineInfo[] {
      return [...engines.values()].map((e) => ({
        id: e.id,
        name: e.name,
        description: e.description,
        enabled: e.enabled,
      }))
    },

    getEngine(id) {
      return engines.get(id)
    },

    async status() {
      const list = await Promise.all([...engines.values()].map((e) => e.status()))
      return { engines: list }
    },

    async createProject(input) {
      const engine = engines.get(input.engineId)
      if (!engine || !engine.enabled) {
        throw new Error(`Studio engine not available: ${input.engineId}. Open /studio.`)
      }
      const ts = now().toISOString()
      const id = generateId()
      const dir = join(deps.projectsRoot, input.engineId, id)
      mkdirSync(dir, { recursive: true })
      const project: StudioProject = {
        id,
        engineId: engine.id,
        title: input.title.trim() || 'Untitled',
        dir,
        conversationId: input.conversationId ?? null,
        createdAt: ts,
        updatedAt: ts,
      }
      await engine.createProject({
        id,
        title: project.title,
        dir,
        conversationId: input.conversationId,
      })
      saveProject(project)
      return project
    },

    getProject: loadProject,

    listProjects(filter) {
      const rows = db.all<ProjectRow>(sql`SELECT * FROM studio_projects ORDER BY created_at DESC`)
      let list = rows.map(rowToProject)
      if (filter?.engineId) list = list.filter((p) => p.engineId === filter.engineId)
      if (filter?.conversationId) list = list.filter((p) => p.conversationId === filter.conversationId)
      return list
    },

    async writeFile(projectId, relativePath, content) {
      const project = loadProject(projectId)
      if (!project) throw new Error(`Studio project not found: ${projectId}`)
      const engine = engines.get(project.engineId)
      if (!engine) throw new Error(`Studio engine not registered: ${project.engineId}`)
      return engine.writeFile(project, relativePath, content)
    },

    async lint(projectId) {
      const project = loadProject(projectId)
      if (!project) throw new Error(`Studio project not found: ${projectId}`)
      const engine = engines.get(project.engineId)
      if (!engine) throw new Error(`Studio engine not registered: ${project.engineId}`)
      return engine.lint(project)
    },

    async render(input) {
      const project = loadProject(input.projectId)
      if (!project) throw new Error(`Studio project not found: ${input.projectId}`)
      const engine = engines.get(project.engineId)
      if (!engine || !engine.enabled) {
        throw new Error(`Studio engine not available: ${project.engineId}. Open /studio.`)
      }
      const ts = now().toISOString()
      let job: StudioJob = {
        id: generateId(),
        engineId: engine.id,
        projectId: project.id,
        kind: 'render',
        status: 'running',
        error: null,
        outputPath: null,
        documentIds: [],
        conversationId: input.conversationId ?? project.conversationId,
        agentId: input.agentId ?? null,
        userId: input.userId ?? null,
        createdAt: ts,
        updatedAt: ts,
        completedAt: null,
      }
      persistJob(job)
      try {
        const { outputPath } = await engine.render(project, job)
        const done = now().toISOString()
        job = {
          ...job,
          status: 'completed',
          outputPath,
          updatedAt: done,
          completedAt: done,
        }
        persistJob(job)
        job = await maybeIngest(job)
        return job
      } catch (err) {
        const done = now().toISOString()
        job = {
          ...job,
          status: 'failed',
          error: err instanceof Error ? err.message : String(err),
          updatedAt: done,
          completedAt: done,
        }
        persistJob(job)
        return job
      }
    },

    saveJob(job) {
      persistJob(job)
    },

    getJob: loadJob,

    listJobs(filter) {
      const rows = db.all<JobRow>(sql`SELECT * FROM studio_jobs ORDER BY created_at DESC`)
      let jobs = rows.map(rowToJob)
      if (filter.conversationId !== undefined) {
        jobs = jobs.filter((j) => j.conversationId === filter.conversationId)
      }
      if (filter.projectId !== undefined) {
        jobs = jobs.filter((j) => j.projectId === filter.projectId)
      }
      if (filter.status !== undefined) {
        jobs = jobs.filter((j) => j.status === filter.status)
      }
      if (filter.since !== undefined) {
        const since = filter.since
        jobs = jobs.filter((j) => new Date(j.createdAt).getTime() >= since)
      }
      if (filter.limit !== undefined) {
        jobs = jobs.slice(0, filter.limit)
      }
      return jobs
    },
  }
}

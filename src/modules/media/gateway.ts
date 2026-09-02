// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'
import type { Logger } from 'pino'
import type { EyasDb } from '@core/types'
import type {
  MediaGateway,
  MediaGenerateRequest,
  MediaJob,
  MediaJobStatus,
  MediaKind,
  MediaProvider,
} from './types.js'

const TERMINAL: ReadonlySet<MediaJobStatus> = new Set(['completed', 'failed', 'cancelled'])

type MediaJobRow = {
  id: string
  batch_id: string | null
  provider_id: string
  provider_job_id: string
  kind: string
  status: string
  prompt: string | null
  model: string | null
  error: string | null
  result_urls: string | null
  document_ids: string | null
  credits: number | null
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

function rowToJob(row: MediaJobRow): MediaJob {
  return {
    id: row.id,
    providerId: row.provider_id,
    providerJobId: row.provider_job_id,
    kind: row.kind as MediaKind,
    status: row.status as MediaJobStatus,
    prompt: row.prompt ?? '',
    model: row.model,
    error: row.error,
    resultUrls: parseJsonArray(row.result_urls),
    documentIds: parseJsonArray(row.document_ids),
    credits: row.credits,
    conversationId: row.conversation_id,
    batchId: row.batch_id,
    agentId: row.agent_id,
    userId: row.user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  }
}

export function createMediaGateway(deps: {
  db: EyasDb
  logger: Logger
  now?: () => Date
  ingest?: (job: MediaJob) => Promise<MediaJob>
  onSave?: (job: MediaJob) => void
}): MediaGateway {
  const { db, logger, ingest } = deps
  const now = deps.now ?? (() => new Date())
  const providers = new Map<string, MediaProvider>()

  function loadJob(id: string): MediaJob | undefined {
    const row = db.get<MediaJobRow>(sql`SELECT * FROM media_jobs WHERE id = ${id}`)
    return row ? rowToJob(row) : undefined
  }

  function saveJob(job: MediaJob): void {
    db.run(sql`
      INSERT INTO media_jobs (
        id, batch_id, provider_id, provider_job_id, kind, status,
        prompt, model, error, result_urls, document_ids, credits,
        conversation_id, agent_id, user_id, created_at, updated_at, completed_at
      ) VALUES (
        ${job.id},
        ${job.batchId},
        ${job.providerId},
        ${job.providerJobId},
        ${job.kind},
        ${job.status},
        ${job.prompt},
        ${job.model},
        ${job.error},
        ${JSON.stringify(job.resultUrls)},
        ${JSON.stringify(job.documentIds)},
        ${job.credits},
        ${job.conversationId},
        ${job.agentId},
        ${job.userId},
        ${job.createdAt},
        ${job.updatedAt},
        ${job.completedAt}
      )
      ON CONFLICT(id) DO UPDATE SET
        batch_id = excluded.batch_id,
        provider_id = excluded.provider_id,
        provider_job_id = excluded.provider_job_id,
        kind = excluded.kind,
        status = excluded.status,
        prompt = excluded.prompt,
        model = excluded.model,
        error = excluded.error,
        result_urls = excluded.result_urls,
        document_ids = excluded.document_ids,
        credits = excluded.credits,
        conversation_id = excluded.conversation_id,
        agent_id = excluded.agent_id,
        user_id = excluded.user_id,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at,
        completed_at = excluded.completed_at
    `)
    deps.onSave?.(job)
  }

  async function maybeIngest(job: MediaJob): Promise<MediaJob> {
    if (
      ingest &&
      job.status === 'completed' &&
      job.documentIds.length === 0 &&
      job.resultUrls.length > 0
    ) {
      try {
        const next = await ingest(job)
        saveJob(next)
        return next
      } catch (err) {
        logger.warn({ err, jobId: job.id }, 'media ingest failed')
      }
    }
    return job
  }

  return {
    registerProvider(provider) {
      providers.set(provider.id, provider)
    },

    unregisterProvider(id) {
      providers.delete(id)
    },

    listProviders() {
      return [...providers.values()].map((p) => ({
        id: p.id,
        name: p.name,
        capabilities: p.capabilities,
        configured: p.configured,
      }))
    },

    getProvider(id) {
      return providers.get(id)
    },

    async generate(input: MediaGenerateRequest & { providerId: string; batchId?: string }) {
      const provider = providers.get(input.providerId)
      if (!provider) {
        throw new Error(`Media provider not registered: ${input.providerId}`)
      }

      let job = await provider.generate({
        kind: input.kind,
        prompt: input.prompt,
        model: input.model,
        references: input.references,
        options: input.options,
        conversationId: input.conversationId,
        agentId: input.agentId,
        userId: input.userId,
      })

      const ts = now().toISOString()
      job = {
        ...job,
        providerId: input.providerId,
        conversationId: input.conversationId ?? job.conversationId ?? null,
        batchId: input.batchId ?? job.batchId ?? null,
        agentId: input.agentId ?? job.agentId ?? null,
        userId: input.userId ?? job.userId ?? null,
        createdAt: job.createdAt || ts,
        updatedAt: ts,
        completedAt: job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled'
          ? (job.completedAt ?? ts)
          : job.completedAt,
      }

      saveJob(job)
      job = await maybeIngest(job)
      return job
    },

    async status(jobId: string) {
      const existing = loadJob(jobId)
      if (!existing) {
        throw new Error(`Media job not found: ${jobId}`)
      }
      if (TERMINAL.has(existing.status)) {
        return existing
      }

      const provider = providers.get(existing.providerId)
      if (!provider) {
        throw new Error(`Media provider not registered: ${existing.providerId}`)
      }

      const patch = await provider.status(existing.providerJobId)
      const ts = now().toISOString()
      let job: MediaJob = {
        ...existing,
        status: patch.status,
        resultUrls: patch.resultUrls ?? existing.resultUrls,
        error: patch.error !== undefined ? patch.error : existing.error,
        credits: patch.credits !== undefined ? patch.credits : existing.credits,
        updatedAt: ts,
        completedAt: TERMINAL.has(patch.status) ? (existing.completedAt ?? ts) : existing.completedAt,
      }
      saveJob(job)
      job = await maybeIngest(job)
      return job
    },

    async cancel(jobId: string) {
      const existing = loadJob(jobId)
      if (!existing) {
        throw new Error(`Media job not found: ${jobId}`)
      }
      if (TERMINAL.has(existing.status)) return

      const provider = providers.get(existing.providerId)
      if (!provider) {
        throw new Error(`Media provider not registered: ${existing.providerId}`)
      }

      await provider.cancel(existing.providerJobId)
      const ts = now().toISOString()
      saveJob({
        ...existing,
        status: 'cancelled',
        updatedAt: ts,
        completedAt: ts,
      })
    },

    listJobs(filter) {
      const rows = db.all<MediaJobRow>(
        sql`SELECT * FROM media_jobs ORDER BY created_at DESC`,
      )
      let jobs = rows.map(rowToJob)

      if (filter.conversationId !== undefined) {
        jobs = jobs.filter((j) => j.conversationId === filter.conversationId)
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

    saveJob,
  }
}

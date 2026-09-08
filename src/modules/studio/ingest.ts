// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { basename } from 'node:path'
import { readFile } from 'node:fs/promises'
import type { DocumentService } from '@modules/documents/document-service.js'
import type { StudioJob } from './types.js'

const DEFAULT_MAX_BYTES = 200 * 1024 * 1024

export function createStudioIngest(deps: {
  documents: { upload: DocumentService['upload']; link: DocumentService['link'] }
  maxBytes?: number
}): (job: StudioJob) => Promise<StudioJob> {
  const maxBytes = deps.maxBytes ?? DEFAULT_MAX_BYTES

  return async (job: StudioJob): Promise<StudioJob> => {
    if (!job.outputPath) return job
    try {
      const file = await readFile(job.outputPath)
      if (file.length > maxBytes) {
        return {
          ...job,
          error: job.error
            ? `${job.error}; ingest: file ${file.length} exceeds maxBytes ${maxBytes}`
            : `ingest: file ${file.length} exceeds maxBytes ${maxBytes}`,
        }
      }
      const filename = basename(job.outputPath) || `studio-${job.id}.mp4`
      const doc = await deps.documents.upload({
        file,
        filename,
        createdBy: job.userId ?? 'agent',
        metadata: {
          studioJobId: job.id,
          engineId: job.engineId,
          projectId: job.projectId,
        },
        module: 'studio',
      })
      if (job.conversationId) {
        deps.documents.link(doc.id, 'conversations', job.conversationId, 'ai')
      }
      return { ...job, documentIds: [...job.documentIds, doc.id] }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return {
        ...job,
        error: job.error ? `${job.error}; ingest: ${msg}` : `ingest: ${msg}`,
      }
    }
  }
}

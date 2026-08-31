// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { basename, extname } from 'node:path'
import type { DocumentService } from '@modules/documents/document-service.js'
import type { MediaJob } from './types.js'

const DEFAULT_MAX_BYTES = 200 * 1024 * 1024
const FETCH_TIMEOUT_MS = 60_000

function filenameForUrl(url: string, jobId: string): string {
  try {
    const path = new URL(url).pathname
    const base = basename(path)
    if (base && base !== '/' && base !== '.') return base
    const ext = extname(path) || '.bin'
    return `media-${jobId}${ext}`
  } catch {
    return `media-${jobId}.bin`
  }
}

async function readBodyCapped(res: Response, maxBytes: number): Promise<Buffer> {
  const contentLength = res.headers.get('content-length')
  if (contentLength) {
    const n = Number(contentLength)
    if (Number.isFinite(n) && n > maxBytes) {
      throw new Error(`ingest: response Content-Length ${n} exceeds maxBytes ${maxBytes}`)
    }
  }

  if (!res.body) {
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length > maxBytes) {
      throw new Error(`ingest: body ${buf.length} exceeds maxBytes ${maxBytes}`)
    }
    return buf
  }

  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue
    total += value.byteLength
    if (total > maxBytes) {
      try {
        await reader.cancel()
      } catch {
        /* ignore */
      }
      throw new Error(`ingest: body exceeds maxBytes ${maxBytes}`)
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks, total)
}

export function createIngest(deps: {
  documents: { upload: DocumentService['upload']; link: DocumentService['link'] }
  fetchImpl?: typeof fetch
  maxBytes?: number
}): (job: MediaJob) => Promise<MediaJob> {
  const fetchImpl = deps.fetchImpl ?? fetch
  const maxBytes = deps.maxBytes ?? DEFAULT_MAX_BYTES

  return async (job: MediaJob): Promise<MediaJob> => {
    const documentIds: string[] = [...job.documentIds]
    const errors: string[] = []

    for (const url of job.resultUrls) {
      try {
        const res = await fetchImpl(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`)
        }
        const file = await readBodyCapped(res, maxBytes)
        const filename = filenameForUrl(url, job.id)
        const doc = await deps.documents.upload({
          file,
          filename,
          createdBy: job.userId ?? 'agent',
          metadata: {
            mediaJobId: job.id,
            providerId: job.providerId,
            kind: job.kind,
          },
          module: 'media',
        })
        documentIds.push(doc.id)
        if (job.conversationId) {
          deps.documents.link(doc.id, 'conversations', job.conversationId, 'ai')
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        errors.push(msg.startsWith('ingest:') ? msg : `ingest: ${msg}`)
      }
    }

    if (errors.length === 0) {
      return { ...job, documentIds, error: job.error }
    }

    const ingestError = errors.join('; ')
    return {
      ...job,
      status: 'completed',
      documentIds,
      resultUrls: job.resultUrls,
      error: job.error ? `${job.error}; ${ingestError}` : ingestError,
    }
  }
}

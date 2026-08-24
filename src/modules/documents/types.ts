// Part of eYssen. See LICENSE file for full copyright and licensing details.

// ─── Storage Provider ─────────────────────────────────

export interface FileMeta {
  filename: string
  mimeType: string
  sizeBytes: number
}

export interface StorageProvider {
  id: string
  type: 'primary' | 'secondary'

  put(key: string, data: Buffer | ReadableStream, meta: FileMeta): Promise<void>
  get(key: string): Promise<{ data: ReadableStream; meta: FileMeta } | null>
  delete(key: string): Promise<void>
  exists(key: string): Promise<boolean>
  getUrl(key: string, expiresIn?: number): Promise<string | null>
}

export interface ThumbnailProvider {
  supports(mimeType: string): boolean
  generate(data: Buffer, options: ThumbnailOptions): Promise<Buffer>
}

export interface ThumbnailOptions {
  maxWidth: number
  maxHeight: number
  format: 'webp' | 'jpeg'
}

// ─── Document Link ───────────────────────────────────

export type DocumentSource = 'user' | 'ai' | 'system'

export interface DocumentLink {
  id: string
  documentId: string
  ownerModule: string
  ownerId: string
  source: DocumentSource
  createdAt: string
}

// ─── Document Record ──────────────────────────────────

export interface DocumentRecord {
  id: string
  links: DocumentLink[]
  filename: string
  mimeType: string
  sizeBytes: number
  checksumSha256: string
  storageKey: string
  localPath: string | null
  remoteProvider: string | null
  remoteStatus: 'pending' | 'synced' | 'error' | 'not_configured'
  thumbnailKey: string | null
  retainLocalUntil: string | null
  metadata: Record<string, unknown>
  createdBy: string | null
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

// ─── Retention ────────────────────────────────────────

export type RetentionTrigger = 'time' | 'lifecycle'

export interface RetentionRule {
  id: string
  triggerType: RetentionTrigger
  event: string | null
  stage: string | null
  condition: string | null
  localDays: number
  enabled: boolean
  createdAt: string
}

// ─── Upload ───────────────────────────────────────────

export interface UploadInput {
  file: Buffer
  filename: string
  metadata?: Record<string, unknown>
  createdBy?: string
}

export interface UploadLimits {
  maxFileSizeMb: number
  allowedTypes: string[]
}

// ─── Events ───────────────────────────────────────────

export interface DocumentUploadedEvent {
  documentId: string
  mimeType: string
  sizeBytes: number
  storageKey: string
}

export interface DocumentSyncedEvent {
  documentId: string
  remoteProvider: string
}

export interface DocumentSyncFailedEvent {
  documentId: string
  error: string
}

export interface DocumentDeletedEvent {
  documentId: string
}

export interface DocumentLocalCleanedEvent {
  documentId: string
}

// ─── Config ───────────────────────────────────────────

export interface DocumentsConfig {
  storage: { localDir: string }
  limits: {
    default: UploadLimits
    overrides: Record<string, Partial<UploadLimits>>
  }
  remote: {
    enabled: boolean
    provider: string
    bucket: string
    region: string
    endpoint: string
  }
  retention: {
    rules: Array<{
      trigger: RetentionTrigger
      event?: string
      stage?: string
      condition?: string
      localDays: number
    }>
  }
  sync: {
    retryAttempts: number
    retryDelaySeconds: number
    batchSize: number
  }
}

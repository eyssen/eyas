// Part of eYssen. See LICENSE file for full copyright and licensing details.

export type MediaKind = 'image' | 'video' | 'audio' | 'upscale' | 'edit' | '3d'
export type MediaJobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'

export interface MediaModel {
  id: string
  label: string
  kind: MediaKind
  providerId: string
}

export interface MediaBalance {
  providerId: string
  credits: number | null
  unit: string
  raw?: Record<string, unknown>
}

export interface MediaGenerateRequest {
  kind: MediaKind
  prompt: string
  model?: string
  references?: Array<{ url?: string; documentId?: string }>
  options?: Record<string, unknown>
  conversationId?: string
  agentId?: string
  userId?: string
}

export interface MediaJob {
  id: string
  providerId: string
  providerJobId: string
  kind: MediaKind
  status: MediaJobStatus
  prompt: string
  model: string | null
  error: string | null
  resultUrls: string[]
  documentIds: string[]
  credits: number | null
  conversationId: string | null
  batchId: string | null
  agentId: string | null
  userId: string | null
  createdAt: string
  updatedAt: string
  completedAt: string | null
}

export interface MediaProvider {
  id: string
  name: string
  capabilities: readonly MediaKind[]
  configured: boolean
  connect(): Promise<void>
  disconnect?(opts?: { forget?: boolean }): Promise<void>
  catalog(kind?: MediaKind): Promise<MediaModel[]>
  generate(req: MediaGenerateRequest): Promise<MediaJob>
  status(providerJobId: string): Promise<Pick<MediaJob, 'status' | 'resultUrls' | 'error' | 'credits'>>
  cancel(jobId: string): Promise<void>
  balance(): Promise<MediaBalance | null>
}

export interface MediaKindRouting {
  defaultProviderId: string | null
  fallbackProviderId: string | null
  alsoRunOn: string[]
}

export interface MediaSettings {
  routing: Record<MediaKind, MediaKindRouting>
  budget: Record<string, { dailyCredits: number | null; monthlyCredits: number | null }>
  expertRawMcpTools: boolean
}

export interface MediaGateway {
  registerProvider(provider: MediaProvider): void
  unregisterProvider(id: string): void
  listProviders(): Array<Pick<MediaProvider, 'id' | 'name' | 'capabilities' | 'configured'>>
  getProvider(id: string): MediaProvider | undefined
  generate(input: MediaGenerateRequest & { providerId: string; batchId?: string }): Promise<MediaJob>
  status(jobId: string): Promise<MediaJob>
  cancel(jobId: string): Promise<void>
  listJobs(filter: { conversationId?: string; since?: number; status?: MediaJobStatus; limit?: number }): MediaJob[]
  saveJob(job: MediaJob): void
}

export const MEDIA_KINDS: readonly MediaKind[] = ['image', 'video', 'audio', 'upscale', 'edit', '3d'] as const

export function emptyMediaKindRouting(): MediaKindRouting {
  return { defaultProviderId: null, fallbackProviderId: null, alsoRunOn: [] }
}

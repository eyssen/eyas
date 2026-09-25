// Part of eYssen. See LICENSE file for full copyright and licensing details.

export type StudioJobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
export type StudioCheckStatus = 'ok' | 'missing' | 'warn'
export type StudioJobKind = 'render' | 'lint' | 'create'

export interface StudioCheck {
  id: string
  label: string
  status: StudioCheckStatus
  detail?: string
  remedy?: string
}

export interface StudioEngineStatus {
  engineId: string
  name: string
  enabled: boolean
  available: boolean
  checks: StudioCheck[]
}

export interface StudioProject {
  id: string
  engineId: string
  title: string
  dir: string
  conversationId: string | null
  createdAt: string
  updatedAt: string
}

export interface StudioJob {
  id: string
  engineId: string
  projectId: string
  kind: StudioJobKind
  status: StudioJobStatus
  error: string | null
  outputPath: string | null
  documentIds: string[]
  conversationId: string | null
  agentId: string | null
  userId: string | null
  createdAt: string
  updatedAt: string
  completedAt: string | null
}

export interface StudioEngineInfo {
  id: string
  name: string
  description: string
  enabled: boolean
}

export interface StudioEngine extends StudioEngineInfo {
  status(): Promise<StudioEngineStatus>
  createProject(input: {
    id: string
    title: string
    dir: string
    conversationId?: string
  }): Promise<void>
  writeFile(project: StudioProject, relativePath: string, content: string): Promise<{ path: string; bytes: number }>
  lint(project: StudioProject): Promise<{ ok: boolean; engine: string; findings: unknown[] }>
  render(project: StudioProject, job: StudioJob): Promise<{ outputPath: string }>
  listFiles?(project: StudioProject): Promise<string[]>
}

export interface StudioGateway {
  registerEngine(engine: StudioEngine): void
  listEngines(): StudioEngineInfo[]
  getEngine(id: string): StudioEngine | undefined
  status(): Promise<{ engines: StudioEngineStatus[] }>
  createProject(input: {
    engineId: string
    title: string
    conversationId?: string
    userId?: string
    agentId?: string
  }): Promise<StudioProject>
  getProject(id: string): StudioProject | undefined
  listProjects(filter?: { engineId?: string; conversationId?: string }): StudioProject[]
  writeFile(projectId: string, relativePath: string, content: string): Promise<{ path: string; bytes: number }>
  lint(projectId: string): Promise<{ ok: boolean; engine: string; findings: unknown[] }>
  render(input: {
    projectId: string
    conversationId?: string
    userId?: string
    agentId?: string
  }): Promise<StudioJob>
  saveJob(job: StudioJob): void
  getJob(id: string): StudioJob | undefined
  listJobs(filter: {
    conversationId?: string
    projectId?: string
    since?: number
    status?: StudioJobStatus
    limit?: number
  }): StudioJob[]
}

export const HYPERFRAMES_VERSION_PIN = '0.8.17'

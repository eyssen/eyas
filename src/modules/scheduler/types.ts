// Part of eYssen. See LICENSE file for full copyright and licensing details.

export type TriggerType = 'cron' | 'event' | 'webhook' | 'manual' | 'interval'

export type JobStatus = 'active' | 'paused' | 'disabled' | 'dead_letter'
export type ExecutionStatus = 'running' | 'completed' | 'failed' | 'skipped'
export type JobSource = 'system' | 'user' | 'agent' | 'module'
export type JobKind = 'handler' | 'agent_run' | 'board_recurring'

export interface ScheduledJob {
  id: string
  name: string
  description?: string
  triggerType: TriggerType
  triggerConfig: string // JSON: { cron }, { intervalMs }, { event }, …
  handler: string
  handlerConfig?: string
  status: JobStatus
  lastRunAt?: string
  nextRunAt?: string
  runCount: number
  failCount: number
  consecutiveFails: number
  chainNextJobId?: string
  chainOnError: 'stop' | 'skip' | 'continue'
  source: JobSource
  kind: JobKind
  ownerAgentId?: string
  createdBy?: string
  category?: string
  timezone: string
  maxConsecutiveFails: number
  lastResultSummary?: string
  mutedUntil?: string
  createdAt: string
  updatedAt: string
  /** Live — not persisted. */
  isRunning?: boolean
  /** Optional enrichment from list(?include=stats24h). */
  stats24h?: JobStats24h
}

export interface JobStats24h {
  total: number
  success: number
  error: number
  skipped: number
  avgDurationMs: number
}

export interface JobExecution {
  id?: number
  jobId: string
  status: ExecutionStatus
  startedAt: string
  completedAt?: string
  durationMs?: number
  error?: string
  result?: string
  scheduledFor?: string
}

export interface JobAdminEvent {
  id?: number
  jobId: string
  event: string
  actor?: string
  detail?: string
  createdAt: string
}

export interface TimelineRun {
  id?: number
  jobId: string
  jobName: string
  status: string
  durationMs?: number
  error?: string
  startedAt: string
  completedAt?: string
}

export interface CreateJobInput {
  name: string
  description?: string
  triggerType: TriggerType
  triggerConfig: string
  handler: string
  handlerConfig?: string
  chainNextJobId?: string
  chainOnError?: 'stop' | 'skip' | 'continue'
  source?: JobSource
  kind?: JobKind
  ownerAgentId?: string
  createdBy?: string
  category?: string
  timezone?: string
  maxConsecutiveFails?: number
  status?: JobStatus
}

export interface UpdateJobInput {
  name?: string
  description?: string | null
  triggerType?: TriggerType
  triggerConfig?: string
  handler?: string
  handlerConfig?: string | null
  chainNextJobId?: string | null
  chainOnError?: 'stop' | 'skip' | 'continue'
  source?: JobSource
  kind?: JobKind
  ownerAgentId?: string | null
  category?: string | null
  timezone?: string
  maxConsecutiveFails?: number
  status?: JobStatus
  mutedUntil?: string | null
}

export interface ListJobsFilter {
  status?: string
  source?: string
  kind?: string
  q?: string
  ownerAgentId?: string
  includeStats?: boolean
}

export type JobHandler = (config?: Record<string, unknown>) => Promise<unknown>

export interface SchedulerRuntimeOptions {
  /** Max concurrent job executions (default 4). */
  maxConcurrent?: number
  /** Default consecutive fails before dead_letter (default 5). */
  defaultMaxConsecutiveFails?: number
  /** Execution retention days (default 90). */
  executionRetentionDays?: number
  /** Quiet hours local window — skip agent_run notify only (optional). */
  quietHours?: { startHour: number; endHour: number } | null
}

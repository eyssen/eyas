// Part of eYssen. See LICENSE file for full copyright and licensing details.

export type ViewMode = 'list' | 'gantt' | 'calendar'

export interface JobStats24h {
  total: number
  success: number
  error: number
  skipped: number
  avgDurationMs: number
}

export interface ScheduledJob {
  id: string
  name: string
  description?: string
  triggerType: 'cron' | 'interval' | 'event' | 'webhook' | 'manual'
  triggerConfig: string
  scheduleLabel?: string
  handler: string
  handlerConfig?: string
  status: 'active' | 'paused' | 'disabled' | 'dead_letter'
  lastRunAt?: string
  nextRunAt?: string
  lastRun?: string
  nextRun?: string
  cronExpression?: string
  intervalMs?: number
  runCount: number
  failCount: number
  consecutiveFails?: number
  source?: string
  kind?: string
  ownerAgentId?: string
  category?: string
  timezone?: string
  lastResultSummary?: string
  isRunning?: boolean
  stats24h?: JobStats24h
}

export interface JobExecution {
  id?: number
  jobId: string
  status: string
  startedAt: string
  completedAt?: string
  durationMs?: number
  error?: string
  result?: string
}

export interface TimelineRun {
  id?: number
  jobId: string
  jobName: string
  status: string
  durationMs?: number
  error?: string
  startedAt: string
}

export interface TimelineProjection {
  jobId: string
  jobName: string
  at: number
  kind: 'next' | 'future'
}

export interface SchedulerHealth {
  leader: boolean
  activeJobs: number
  running: number
  failed24h: number
  deadLetter: number
  overdue: number
}

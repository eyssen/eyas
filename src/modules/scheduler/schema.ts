// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'

export const scheduledJobs = sqliteTable('scheduled_jobs', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  triggerType: text('trigger_type').notNull(),
  triggerConfig: text('trigger_config').notNull(),
  handler: text('handler').notNull(),
  handlerConfig: text('handler_config'),
  status: text('status').notNull().default('active'),
  lastRunAt: text('last_run_at'),
  nextRunAt: text('next_run_at'),
  runCount: integer('run_count').notNull().default(0),
  failCount: integer('fail_count').notNull().default(0),
  consecutiveFails: integer('consecutive_fails').notNull().default(0),
  chainNextJobId: text('chain_next_job_id'),
  chainOnError: text('chain_on_error').default('stop'),
  source: text('source').notNull().default('system'),
  kind: text('kind').notNull().default('handler'),
  ownerAgentId: text('owner_agent_id'),
  createdBy: text('created_by'),
  category: text('category'),
  timezone: text('timezone').notNull().default('UTC'),
  maxConsecutiveFails: integer('max_consecutive_fails').notNull().default(5),
  lastResultSummary: text('last_result_summary'),
  mutedUntil: text('muted_until'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const jobExecutions = sqliteTable('job_executions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  jobId: text('job_id').notNull(),
  status: text('status').notNull(),
  startedAt: text('started_at').notNull(),
  completedAt: text('completed_at'),
  durationMs: integer('duration_ms'),
  error: text('error'),
  result: text('result'),
  scheduledFor: text('scheduled_for'),
})

export const schedulerLocks = sqliteTable('scheduler_locks', {
  lockKey: text('lock_key').primaryKey(),
  holderId: text('holder_id').notNull(),
  acquiredAt: integer('acquired_at').notNull(),
  expiresAt: integer('expires_at').notNull(),
  heartbeatAt: integer('heartbeat_at').notNull(),
})

export const jobAdminEvents = sqliteTable('job_admin_events', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  jobId: text('job_id').notNull(),
  event: text('event').notNull(),
  actor: text('actor'),
  detail: text('detail'),
  createdAt: text('created_at').notNull(),
})

export const recurringBoardTasks = sqliteTable('recurring_board_tasks', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  description: text('description'),
  schedule: text('schedule').notNull(),
  nextOccurrence: text('next_occurrence').notNull(),
  lastCreated: text('last_created'),
  projectId: text('project_id').notNull(),
  priority: text('priority').notNull().default('normal'),
  assignee: text('assignee'),
  autoStart: integer('auto_start').notNull().default(0),
  status: text('status').notNull().default('active'),
  jobId: text('job_id'),
  createdAt: text('created_at').notNull(),
})

// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core'

export const agentDefinitions = sqliteTable('agent_definitions', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  role: text('role'),
  description: text('description'),
  goal: text('goal'),
  backstory: text('backstory'),
  tier: text('tier').notNull().default('specialist'),
  agentType: text('agent_type').notNull().default('assistant'),
  systemPrompt: text('system_prompt'),
  capabilities: text('capabilities'),     // JSON array
  tools: text('tools'),                   // JSON array
  constraints: text('constraints'),       // JSON array
  model: text('model'),
  maxTurns: integer('max_turns'),
  effort: text('effort'),  // 'low' | 'medium' | 'high' | 'max' | NULL (= auto)
  enabled: integer('enabled').notNull().default(1),
  source: text('source').notNull().default('seed'),
  avatar: text('avatar'),
  tags: text('tags'),                     // JSON array
  monthlyTokenBudget: integer('monthly_token_budget').default(0),
  tokensUsedMonth: integer('tokens_used_month').default(0),
  budgetResetAt: text('budget_reset_at'),
  config: text('config'),                 // JSON extra config
  // Boolean flag stored as 0/1. Uses Drizzle boolean mode (vs `enabled` which uses raw integer)
  // because this represents a true/false trait, not a counter or state.
  addressable: integer('addressable', { mode: 'boolean' }).notNull().default(false),
  workspacePath: text('workspace_path'),  // relative path to data/agents/<id>/ — nullable until migration populates
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const agentSessions = sqliteTable('agent_sessions', {
  id: text('id').primaryKey(),
  conversationId: text('conversation_id').notNull(),
  agentId: text('agent_id').notNull(),
  status: text('status').notNull().default('running'),
  turnsUsed: integer('turns_used').default(0),
  tokensUsed: integer('tokens_used').default(0),
  costUsd: real('cost_usd').default(0),
  toolCalls: text('tool_calls'),          // JSON array
  error: text('error'),
  startedAt: text('started_at').notNull(),
  completedAt: text('completed_at'),
  // Supervision columns — ALTERed onto the table by ensureRunSupervisionSchema
  // (run-supervisor.ts), not by drizzle-kit. Mirrored here so this file stays
  // documentation the runtime shape actually matches (see the contract test).
  heartbeatAt: text('heartbeat_at'),
  deadlineAt: text('deadline_at'),
  attempts: integer('attempts').default(0),
  lastEventSeq: integer('last_event_seq').default(0),
  kind: text('kind').default('interactive'),
  supervisorState: text('supervisor_state'),
  checkpointRef: text('checkpoint_ref'),
  parentRunId: text('parent_run_id'),
  // F2 T2 — consumed by later F2 tasks; see run-supervisor.ts's ALTER comment.
  errorKind: text('error_kind'),
  nextAttemptAt: text('next_attempt_at'),
  verification: text('verification'),
  criticRounds: integer('critic_rounds').default(0),
})

// F2 T7 (D8) — plan-as-rubric artifacts. Built by ensureAgentPlansSchema
// (plan-store.ts) as idempotent runtime DDL, not by drizzle-kit; mirrored here
// so this file stays documentation the runtime shape matches (contract test).
export const agentPlans = sqliteTable('agent_plans', {
  id: text('id').primaryKey(),
  runId: text('run_id').notNull(),
  conversationId: text('conversation_id').notNull(),
  planJson: text('plan_json').notNull(),   // JSON Plan
  // Identity of the goal the plan was written for — an edited goal must get a
  // fresh plan, never the previous one (see plan-store.goalHash).
  goalHash: text('goal_hash'),
  createdAt: text('created_at').notNull(),
})

export const agentMessages = sqliteTable('agent_messages', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  sessionId: text('session_id').notNull(),
  fromAgent: text('from_agent').notNull(),
  toAgent: text('to_agent'),
  content: text('content').notNull(),
  createdAt: text('created_at').notNull(),
})

// Built by ensureTeamSchema (team-schema.ts) as idempotent runtime DDL, not by
// drizzle-kit; mirrored here so this file stays documentation the runtime shape
// matches (see tests/contracts/team-schema.contract.test.ts).
export const teamSessions = sqliteTable('team_sessions', {
  id: text('id').primaryKey(),
  parentConversationId: text('parent_conversation_id').notNull(),
  goalDescription: text('goal_description').notNull().default(''),
  status: text('status').notNull().default('proposing'),
  config: text('config').notNull().default('{}'),  // JSON TeamConfig
  reasoning: text('reasoning'),
  estimatedTokens: integer('estimated_tokens').default(0),
  totalTokens: integer('total_tokens').default(0),
  totalCostUsd: real('total_cost_usd').default(0),
  // F2 T10 — restart cursor. current_phase is the phase the session is ON;
  // phase_status says how far that phase got (see resumePhaseIndex).
  currentPhase: integer('current_phase').default(0),
  phaseStatus: text('phase_status'),  // pending | running | awaiting_checkpoint | done
  originatingAgentId: text('originating_agent_id'),  // nullable for backwards compat
  parentSnapshot: text('parent_snapshot'),           // JSON ParentSnapshot — voice profile of the originating agent
  createdAt: text('created_at').notNull(),
  completedAt: text('completed_at'),
})

// F2 T10 — per-member phase outcomes. What lets a re-driven session skip the
// members that already finished and still report whole totals.
export const teamPhaseResults = sqliteTable('team_phase_results', {
  id: text('id').primaryKey(),
  teamSessionId: text('team_session_id').notNull(),
  phaseIndex: integer('phase_index').notNull(),
  agentId: text('agent_id').notNull(),
  conversationId: text('conversation_id'),  // the member's child conversation
  status: text('status').notNull(),         // completed | failed
  summary: text('summary'),
  tokensUsed: integer('tokens_used').default(0),
  costUsd: real('cost_usd').default(0),
  createdAt: text('created_at').notNull(),
})

export const teamMemory = sqliteTable('team_memory', {
  id: text('id').primaryKey(),
  teamSessionId: text('team_session_id').notNull(),
  key: text('key').notNull(),
  value: text('value').notNull().default('null'),  // JSON
  layer: text('layer').notNull().default('system'),  // system | agent
  category: text('category').notNull().default('fact'),  // finding | decision | blocker | question | fact
  authorAgentId: text('author_agent_id'),
  visibility: text('visibility').notNull().default('all'),  // all | role:X
  createdAt: text('created_at').notNull(),
})

// Pre-migration snapshot — preserves the original v1 agent_definitions rows as
// JSON before Tasks 37–39 transform them into the v2 workspace layout.
// The table is bootstrapped by snapshotV1AgentRows() (self-contained, no drizzle-kit).
export const agentDefinitionsV1Snapshot = sqliteTable('agent_definitions_v1_snapshot', {
  id: text('id').primaryKey(),
  data: text('data').notNull(),
  snapshotAt: text('snapshot_at').notNull(),
})

// Normalized orchestration events (both engines) — replay for reloads + board.
export const orchestrationEvents = sqliteTable('orchestration_events', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  runId: text('run_id').notNull(),
  seq: integer('seq').notNull(),
  nodeId: text('node_id').notNull(),
  parentId: text('parent_id'),
  payload: text('payload').notNull(),  // JSON OrchestrationPayload
  createdAt: integer('created_at').notNull(),
})

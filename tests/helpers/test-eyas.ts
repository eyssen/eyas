// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Lightweight test harness for integration tests.
// Bootstraps workspace loader/writer, soul pipeline, and the prompt assembler
// without starting the full HTTP server or scheduler. All AI calls use a
// mock model provider that returns canned responses.

import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Database } from 'bun:sqlite'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { sql } from 'drizzle-orm'
import { generateId } from '@shared/crypto'

import { createWorkspaceLoader } from '@modules/prompt-wizard/workspace-loader.js'
import { createWorkspaceWriter } from '@modules/prompt-wizard/workspace-writer.js'
import { createSoulPipeline } from '@modules/prompt-wizard/soul-pipeline.js'
import { createProjectContextLoader } from '@modules/prompt-wizard/project-context-loader.js'
import { createPromptAssembler } from '@modules/prompt-wizard/assembler.js'
import { CORE_IDENTITY } from '@modules/prompt-wizard/core-identity.js'
import { CORE_RULES } from '@modules/prompt-wizard/core-rules.js'
import { DEFAULT_PERSONALITY } from '@modules/prompt-wizard/master-prompt.js'
import { bootstrapAgentWorkspaceFromSeed } from '@modules/agent/workspace-bootstrap.js'
import { buildSubagentPrompt } from '@modules/prompt-wizard/subagent-prompt-builder.js'
import { ALL_TEMPLATES } from '@modules/agent/agent-templates.js'
import type { AssembledPrompt, VoiceProfile, VoiceScope } from '@modules/prompt-wizard/types.js'
import type { WorkspaceLoader } from '@modules/prompt-wizard/workspace-loader.js'
import type { WorkspaceWriter } from '@modules/prompt-wizard/workspace-writer.js'
import type { PromptAssembler } from '@modules/prompt-wizard/assembler.js'
import type { SubAgentPromptInput } from '@modules/prompt-wizard/subagent-prompt-builder.js'
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite'

// ─── DB setup helpers ─────────────────────────────────────────────────────────

function createTestSqlite(dataDir: string): BunSQLiteDatabase {
  const sqlite = new Database(':memory:')
  const db = drizzle(sqlite)

  db.run(sql`CREATE TABLE IF NOT EXISTS agent_definitions (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    role TEXT,
    description TEXT,
    goal TEXT,
    backstory TEXT,
    tier TEXT NOT NULL DEFAULT 'specialist',
    agent_type TEXT NOT NULL DEFAULT 'assistant',
    system_prompt TEXT,
    capabilities TEXT,
    tools TEXT,
    constraints TEXT,
    model TEXT,
    max_turns INTEGER,
    enabled INTEGER NOT NULL DEFAULT 1,
    source TEXT NOT NULL DEFAULT 'seed',
    avatar TEXT,
    tags TEXT,
    monthly_token_budget INTEGER DEFAULT 0,
    tokens_used_month INTEGER DEFAULT 0,
    budget_reset_at TEXT,
    config TEXT,
    addressable INTEGER NOT NULL DEFAULT 0,
    workspace_path TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`)

  db.run(sql`CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    title TEXT,
    status TEXT NOT NULL DEFAULT 'idle',
    user_id TEXT NOT NULL,
    project_id TEXT,
    agent_id TEXT,
    team_session_id TEXT,
    voice_scope_override TEXT,
    thinking TEXT NOT NULL DEFAULT 'off',
    thinking_budget INTEGER,
    effort TEXT,
    orchestration TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`)

  db.run(sql`CREATE TABLE IF NOT EXISTS team_sessions (
    id TEXT PRIMARY KEY,
    parent_conversation_id TEXT NOT NULL,
    goal_description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'proposing',
    config TEXT NOT NULL DEFAULT '{}',
    originating_agent_id TEXT,
    parent_snapshot TEXT,
    created_at TEXT NOT NULL,
    completed_at TEXT
  )`)

  db.run(sql`CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`)

  db.run(sql`CREATE TABLE IF NOT EXISTS project_types (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`)

  return db as unknown as BunSQLiteDatabase
}

// ─── Mock voice profile ───────────────────────────────────────────────────────

export function makeMockVoiceProfile(overrides: Partial<VoiceProfile> = {}): VoiceProfile {
  return {
    address: 'tegező',
    tone: 'baráti',
    verbosity: 'kiegyensúlyozott',
    directness: 'direkt + udvarias',
    humor: 'száraz/szellemes',
    emoji: 'funkcionálisan',
    blockedPhrases: [],
    signature: '',
    ...overrides,
  }
}

// ─── Harness API shape ────────────────────────────────────────────────────────

export interface TestHarnessApi {
  createAgent(opts: { template: string; name: string; ownerName?: string }): Promise<string>
  saveSoulStyle(agentId: string, style: import('@modules/prompt-wizard/soul-style-schema.js').SoulStyleParsed): Promise<void>
  createConversation(opts: { agentId: string; projectId?: string }): Promise<string>
  sendMessage(conversationId: string, text: string): Promise<{ content: string }>
  startTeam(conversationId: string, agentIds: string[]): Promise<{ id: string }>
  delegateToSpecialist(input: {
    originatingAgentId: string
    specialistAgentId: string
    delegatedTask: string
    outputAudience?: 'parent' | 'external'
    cascadeProjectId?: string | null
  }): Promise<AssembledPrompt>
}

export interface TestHarness {
  api: TestHarnessApi
  workspaceLoader: WorkspaceLoader
  workspaceWriter: WorkspaceWriter
  assembler: PromptAssembler
  db: BunSQLiteDatabase
  dataDir: string
  shutdown(): Promise<void>
}

// ─── Main factory ─────────────────────────────────────────────────────────────

export function setupTestEyas(): TestHarness {
  // 1. Create a tmpdir as data directory
  const dataDir = mkdtempSync(join(tmpdir(), 'eyas-test-'))

  // 2. In-memory SQLite + drizzle
  const db = createTestSqlite(dataDir)

  // 3. Workspace loader + writer
  const workspaceWriter = createWorkspaceWriter({ dataDir })
  const workspaceLoader = createWorkspaceLoader({ dataDir })

  // 4. Soul pipeline (real)
  const soulPipeline = createSoulPipeline({ writer: workspaceWriter })

  // 5. Project context loader (stubs — no real projects in most tests)
  const projectContextLoader = createProjectContextLoader({
    dataDir,
    resolveProjectType: async (_projectId: string) => null,
  })

  // 6. Stub resolvers
  const resolveSkillsFor = async (_agentId: string) => []
  const resolveToolsFor = async (_agentId: string) => []
  const resolveTeamContext = async (_conversationId: string | null) => null
  const resolveMemoryContext = async (_conversationId: string | null, _agentId: string) => null
  const resolveActiveVoice = async (params: { agentId: string; channelContext: unknown; conversationId: string | null }) => ({
    scope: 'internal' as VoiceScope,
    reason: 'owner DM (test stub)',
    profile: makeMockVoiceProfile(),
  })
  const resolveRuntime = () => ({
    date: '2026-04-27',
    time: '10:00 CET',
    channel: 'owner_dm',
    os: 'macOS',
  })
  const resolveContextWindow = async (_agentId: string) => 200_000
  const resolveMasterSections = async () => ({ identity: CORE_IDENTITY, coreRules: CORE_RULES, personality: DEFAULT_PERSONALITY })

  // 7. Assembler
  const assembler = createPromptAssembler({
    workspaceLoader,
    projectContextLoader,
    resolveSkillsFor,
    resolveToolsFor,
    resolveTeamContext,
    resolveMemoryContext,
    resolveActiveVoice,
    resolveRuntime,
    resolveContextWindow,
    resolveMasterSections,
  })

  // ─── API implementation ─────────────────────────────────────────────────────

  async function createAgent(opts: { template: string; name: string; ownerName?: string }): Promise<string> {
    const tpl = ALL_TEMPLATES.find((t) => t.id === opts.template)
    if (!tpl) throw new Error(`Template not found: ${opts.template}`)
    if (!tpl.workspaceSeed) throw new Error(`Template ${opts.template} has no workspaceSeed`)

    const agentId = opts.name.toLowerCase().replace(/\s+/g, '-') + '-' + generateId().slice(0, 6)
    const now = new Date().toISOString()

    await bootstrapAgentWorkspaceFromSeed({
      dataDir,
      agentId,
      agentName: opts.name,
      tier: tpl.tier,
      seed: tpl.workspaceSeed,
    })

    const workspacePath = `${dataDir}/agents/${agentId}`
    const db2 = db as unknown as ReturnType<typeof drizzle>
    db2.run(sql`INSERT INTO agent_definitions
      (id, name, role, tier, agent_type, enabled, source, addressable, workspace_path, created_at, updated_at)
      VALUES (${agentId}, ${opts.name}, ${tpl.role}, ${tpl.tier}, ${tpl.agentType}, 1, 'seed',
        ${tpl.tier === 'primary' || tpl.tier === 'team' ? 1 : 0},
        ${workspacePath}, ${now}, ${now})`)

    workspaceLoader.invalidate(agentId)
    return agentId
  }

  async function saveSoulStyle(agentId: string, style: import('@modules/prompt-wizard/soul-style-schema.js').SoulStyleParsed): Promise<void> {
    const ws = await workspaceLoader.load(agentId)
    // Retrieve agent name from DB
    const db2 = db as unknown as ReturnType<typeof drizzle>
    const rows = db2.all(sql`SELECT name FROM agent_definitions WHERE id = ${agentId}`) as Array<{ name: string }>
    const name = rows[0]?.name ?? agentId
    await soulPipeline.saveStyle(agentId, name, style)
    workspaceLoader.invalidate(agentId)
  }

  async function createConversation(opts: { agentId: string; projectId?: string }): Promise<string> {
    const convId = generateId()
    const now = new Date().toISOString()
    const db2 = db as unknown as ReturnType<typeof drizzle>
    db2.run(sql`INSERT INTO conversations
      (id, title, status, user_id, project_id, agent_id, created_at, updated_at)
      VALUES (${convId}, 'Test conversation', 'idle', 'test-user',
        ${opts.projectId ?? null}, ${opts.agentId}, ${now}, ${now})`)
    return convId
  }

  async function sendMessage(_conversationId: string, _text: string): Promise<{ content: string }> {
    // Mock — does not call any LLM
    return { content: 'mocked response' }
  }

  async function startTeam(conversationId: string, _agentIds: string[]): Promise<{ id: string }> {
    const teamId = generateId()
    const now = new Date().toISOString()
    const db2 = db as unknown as ReturnType<typeof drizzle>
    db2.run(sql`INSERT INTO team_sessions
      (id, parent_conversation_id, status, config, created_at)
      VALUES (${teamId}, ${conversationId}, 'active', '{}', ${now})`)
    return { id: teamId }
  }

  async function delegateToSpecialist(input: {
    originatingAgentId: string
    specialistAgentId: string
    delegatedTask: string
    outputAudience?: 'parent' | 'external'
    cascadeProjectId?: string | null
  }): Promise<AssembledPrompt> {
    // Load originating agent's soul for voice snapshot
    const ws = await workspaceLoader.load(input.originatingAgentId)
    const db2 = db as unknown as ReturnType<typeof drizzle>
    const rows = db2.all(sql`SELECT name FROM agent_definitions WHERE id = ${input.originatingAgentId}`) as Array<{ name: string }>
    const originatingName = rows[0]?.name ?? input.originatingAgentId

    // Build parent snapshot from the originating agent's workspace
    let voiceProfile: VoiceProfile = makeMockVoiceProfile()
    const voiceScope: VoiceScope = 'internal'
    if (ws.soulStyleJson.exists && ws.soulStyleJson.body) {
      try {
        const { soulStyleSchema } = await import('@modules/prompt-wizard/soul-style-schema.js')
        const style = soulStyleSchema.parse(JSON.parse(ws.soulStyleJson.body))
        voiceProfile = style[voiceScope] as VoiceProfile
      } catch {
        // fall back to mock profile
      }
    }

    const parentSnapshot = {
      agentId: input.originatingAgentId,
      name: originatingName,
      voiceProfile,
      voiceProfileSource: voiceScope,
      blockedPhrases: voiceProfile.blockedPhrases ?? [],
      signature: voiceProfile.signature ?? '',
      originatingAgentId: input.originatingAgentId,
    }

    const cascade = await projectContextLoader.cascade({ projectId: input.cascadeProjectId ?? null })

    const promptInput: SubAgentPromptInput = {
      subagentName: input.specialistAgentId,
      delegatedTask: input.delegatedTask,
      outputAudience: input.outputAudience ?? 'parent',
      parentSnapshot,
      cascade,
      runtime: { date: '2026-04-27', channel: 'owner_dm', os: 'macOS' },
      childDepth: 1,
      maxSpawnDepth: 3,
    }

    return buildSubagentPrompt(promptInput)
  }

  const api: TestHarnessApi = {
    createAgent,
    saveSoulStyle,
    createConversation,
    sendMessage,
    startTeam,
    delegateToSpecialist,
  }

  async function shutdown(): Promise<void> {
    try {
      rmSync(dataDir, { recursive: true, force: true })
    } catch {
      // ignore cleanup errors
    }
  }

  return { api, workspaceLoader, workspaceWriter, assembler, db, dataDir, shutdown }
}

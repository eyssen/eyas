import type { Hono } from 'hono'
import type { Logger } from 'pino'
import type { PermissionRegistry } from '@modules/permissions/registry'
import type { SetupRegistry } from '@modules/setup/types'
import type { SecretsRegistry } from '@modules/secrets/types'
import type { ModelGateway } from '@modules/model/types'

// ─── Config ────────────────────────────────────────────

export interface EyasConfig {
  server: { host: string; port: number; allowedOrigins?: string[] }
  database: { path: string }
  log: { level: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal'; pretty: boolean }
  i18n: { defaultLanguage: 'hu' | 'en'; fallbackLanguage: 'en' }
  modules: { disabled: string[] }
  auth: {
    jwtSecret?: string
    sessionDuration: number
    accessTokenDuration: number
    refreshTokenDuration: number
  }
  autonomy: {
    identitySelfUpdate: boolean
  }
  memory?: {
    reflection: {
      enabled: boolean
      webEgress: { enabled: boolean; urls: string[]; maxItems: number }
    }
  }
  // Cap 5 heartbeat (Phase 3A.1) — OFF by default (privacy). Task 10: without
  // this schema entry the loader stripped `proactive`, same bug as `memory`.
  proactive?: {
    heartbeat: {
      enabled: boolean
      quietHours?: { startHour: number; endHour: number }
    }
  }
  // Forge self-improvement loop tuning (Phase 3A.3) — all optional, forge/
  // index.ts merges these over its own DEFAULT_CONFIG. Task 10: without this
  // schema entry the loader stripped `forge`, same bug as `memory`.
  forge?: {
    minFeedbacksForAnalysis?: number
    frictionRateThreshold?: number
    autoApproveConfidence?: number
    analysisWindowDays?: number
    maxProposalsPerRun?: number
  }
  // F2 T3 — approval subsystem TTL. Optional (same missing-schema-key bug
  // class as `memory`/`proactive`/`forge` above): security-gate reads this
  // defensively (`ctx.config?.security?.approvalTtlHours`) and falls back to
  // its own 72h default when absent.
  security?: {
    approvalTtlHours: number
  }
  // F2 T7 — completeness critic + plan-as-rubric. Optional for the same
  // reason `security` is: every reader takes it defensively
  // (`ctx.config?.agent?.criticEnabled ?? true`) so a config without the block
  // behaves exactly like the defaults.
  agent?: {
    criticEnabled: boolean
    criticMaxRounds: number
    /** God Mode multi-model debate (default on). */
    godModeEnabled: boolean
    godModeMinParticipants: number
    /** YAML cap above the default 5; roster hard-cap is 8. */
    godModeMaxParticipants: number
  }
  // F2 T9 — cost-producer pricing overrides (src/shared/model-pricing.ts).
  // Optional for the same missing-schema-key reason as `security`/`agent`:
  // every reader takes it defensively (`ctx.config?.model?.pricing`).
  model?: {
    pricing: Record<string, { input: number; output: number; cacheRead?: number; cacheWrite?: number }>
  }
  ops: {
    kubectl: { enabled: boolean; kubeconfigPath: string | null; binary: string }
    pr: {
      provider: 'gitea' | 'github' | null
      baseUrl: string | null
      owner: string | null
      repo: string | null
      baseBranch: string
    }
  }
  pipelines: {
    ticketToCode: {
      enabled: boolean
      prProvider: 'gitea' | 'github' | null
      prBaseUrl: string | null
      prOwner: string | null
      prRepo: string | null
      prBaseBranch: string
      approvalGates: Record<string, boolean>
    }
  }
  voice?: {
    enabled: boolean
    defaultMode: 'text' | 'voice' | 'auto'
    stt: { command: string; language: string; timeoutMs: number }
    tts: { command: string; voice: string; timeoutMs: number }
    workDir: string
  }
  costops?: {
    configPath: string
  }
  /**
   * Externally-visible base URL for this EYAS instance. Used by modules that
   * embed self-referential URLs (e.g. A2A agent card). Optional — falls back
   * to http://localhost:<server.port> when unset.
   */
  baseUrl?: string
}

// ─── Event Bus ─────────────────────────────────────────

export interface BusSubscription {
  subject: string
  id: string
  unsubscribe(): void
}

export interface EyasBus {
  emit(subject: string, data: unknown): void
  on(subject: string, handler: (data: unknown, emittedSubject?: string) => Promise<void>): BusSubscription
  off(subscription: BusSubscription): void
}

// ─── Module System ─────────────────────────────────────

export interface EyasDb {
  run(query: unknown): unknown
  /**
   * Execute a SELECT and return all rows. Matches Drizzle's sync sqlite
   * API. The optional type parameter lets call sites spell the row shape
   * instead of casting: `db.all<Row>(sql\`...\`)`.
   */
  all<T = unknown>(query: unknown): T[]
  /**
   * Execute a SELECT and return the first row (or undefined). Same story
   * as `all` — the caller knows the schema, we don't.
   */
  get<T = unknown>(query: unknown): T | undefined
}

export interface ModuleContext {
  config: EyasConfig
  db: EyasDb
  bus: EyasBus
  http: Hono
  logger: Logger
  i18n: { t: (key: string) => string }
  permissions: PermissionRegistry
  setup: SetupRegistry
  secrets: SecretsRegistry
  model: ModelGateway
  providerConfig: import('@modules/model/provider-config-service').ProviderConfigService
  providerReload: Map<string, () => Promise<void>>
  conversations: import('@modules/conversations/conversation-service').ConversationService
  board: {
    projectTypes: import('@modules/board/services/project-type-service').ProjectTypeService
    projects: import('@modules/board/services/project-service').ProjectService
    stages: import('@modules/board/services/stage-service').StageService
    tags: import('@modules/board/services/tag-service').TagService
  }
  search: import('@modules/search/types').SearchContext
  memory: import('@modules/memory/memory-service').MemoryService
  knowledge: import('@modules/knowledge/knowledge-service').KnowledgeService
  documents: import('@modules/documents/document-service').DocumentService
  workspaceLoader: import('@modules/prompt-wizard/workspace-loader').WorkspaceLoader
  workspaceWriter: import('@modules/prompt-wizard/workspace-writer').WorkspaceWriter
  promptAssembler: import('@modules/prompt-wizard/assembler').PromptAssembler
  internalContactsRegistry: import('@modules/communication/internal-contacts-registry').InternalContactsRegistry
  ephemeralOverrideStore: import('@modules/communication/voice-scope-overrides').EphemeralOverrideStore
  channelResolver: typeof import('@modules/communication/channel-resolver').resolveScope
  activeVoiceResolver: ReturnType<typeof import('@modules/communication/active-voice-resolver').createActiveVoiceResolver>
  hasModule(id: string): boolean
  getModule<T>(id: string): T
}

export interface EyasModule {
  id: string
  name: string
  version: string
  type: 'core' | 'extra' | 'user'
  required?: boolean
  description: string
  dependencies: string[]
  optional?: string[]
  capabilities?: string[]
  submodules?: SubmoduleManifest[]
  frontend?: FrontendManifest

  onRegister(ctx: ModuleContext): Promise<void>
  onStart(ctx: ModuleContext): Promise<void>
  onStop(ctx: ModuleContext): Promise<void>

  routes?(app: Hono): void
  migrations?: MigrationDefinition[]
  healthCheck?(): Promise<HealthStatus>
}

export interface SubmoduleManifest {
  id: string
  name: string
  parentModule: string
  enabled: boolean
  dependencies?: string[]
  frontend?: FrontendManifest
  onRegister?(ctx: ModuleContext): Promise<void>
  onStart?(ctx: ModuleContext): Promise<void>
  onStop?(ctx: ModuleContext): Promise<void>
}

// ─── Frontend Extension ────────────────────────────────

export interface FrontendManifest {
  pages?: PageRegistration[]
  widgets?: WidgetRegistration[]
  settings?: SettingsRegistration[]
}

export interface PageRegistration {
  id: string; path: string; title: string; icon: string; order: number
}

export interface WidgetRegistration {
  id: string; title: string; defaultSize: 'small' | 'medium' | 'large'
}

export interface SettingsRegistration {
  id: string; title: string; order: number
}

// ─── Database ──────────────────────────────────────────

export interface MigrationDefinition {
  version: number; description: string
}

// ─── Health ────────────────────────────────────────────

export interface HealthStatus {
  healthy: boolean; message?: string; details?: Record<string, unknown>
}

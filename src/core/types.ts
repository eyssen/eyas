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
  i18n: {
    defaultLanguage: 'hu' | 'en'
    fallbackLanguage: 'en'
    /** IANA zone for the model-facing clock; unset = the server's zone. */
    timezone?: string
  }
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
    /**
     * Gates deterministic L1 extraction only ('legacy' extracts while
     * l0.extractInLegacy is on). Recall is always v2 (spec 2026-09-03 §14).
     */
    engine?: 'legacy' | 'v2'
    /** L(−1)/L0 raw capture (plan p1b). */
    l0?: {
      enabled: boolean
      captureToolResults: boolean
      captureThinking: boolean
      toolResultMaxBytes: number
      idleFlushMinutes: number
      chunkTokens: number
      extractInLegacy: boolean
    }
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
    /** Extra memory stores protected from model tools (absolute paths). */
    foreignMemoryPaths?: string[]
    /** Kernel sandbox for CLI-native tools: 'auto' (when available) or 'required'. */
    cliSandbox?: 'auto' | 'required'
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
    /** Extra markdown persona directories. Empty = none. */
    importRoots?: string[]
  }
  // F2 T9 — cost-producer pricing overrides (src/shared/model-pricing.ts).
  // Optional for the same missing-schema-key reason as `security`/`agent`:
  // every reader takes it defensively (`ctx.config?.model?.pricing`).
  model?: {
    pricing: Record<string, { input: number; output: number; cacheRead?: number; cacheWrite?: number }>
    /** CLI turn timeouts in ms (model/cli-turn-watchdog.ts); read through cliTurnTimeoutsFrom(). */
    cli?: { idleTimeoutMs: number; toolTimeoutMs: number }
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
  // Observability module — retention window (days) for the context-composition
  // detail layer, read by the scheduler purge job (purgeContextDetail).
  // Optional for the same missing-schema-key reason as `security`/`agent`:
  // the reader takes it defensively (`ctx.config.observability?.contextRetentionDays ?? 7`).
  observability?: {
    contextRetentionDays: number
  }
  // Task 18 — dead-skill classification policy thresholds (OWNER-REVIEWABLE,
  // see src/modules/skills/classify-skill.ts). Optional for the same
  // missing-schema-key reason as `security`/`agent`: resolveClassifyConfig()
  // reads this defensively and falls back per-field to DEFAULT_CLASSIFY_CONFIG.
  skills?: {
    classify: {
      graceDays: number
      neverUsedDays: number
      dormantDays: number
      timeExemptSources: string[]
    }
    /** Extra markdown skill directories. Empty = none. */
    importRoots?: string[]
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
  /** Per-model reasoning capability (effort levels); set by the model module's onRegister. */
  reasoningRegistry?: import('@modules/model/reasoning/registry').ReasoningRegistry
  /**
   * The one window resolver (model/model-window.ts): context window + tool
   * support of a provider/model pair; set by the model module's onRegister.
   * Never throws; an unknown model resolves to the default window.
   */
  modelWindow?: (target: import('@modules/model/model-window').ModelWindowTarget) => import('@modules/model/model-window').ModelWindow
  /**
   * The one resolver for background (non-interactive) model calls; set by the
   * model module's onRegister and lazy inside, so it always calls the current
   * (trace-wrapped) ctx.model; privacy masks inside the raw gateway's egress slot.
   */
  auxiliaryModel?: import('@modules/model/auxiliary').AuxiliaryModelService
  /**
   * The one conversation/agent binding resolver (model/binding.ts, D3):
   * pinned pair, Auto-routing only on an Auto conversation, the colleague's
   * pair, the install default. Set by the model module's onRegister; every
   * input is read per call.
   */
  modelBinding?: import('@modules/model/binding').BindingResolver
  /**
   * Sign-in into the EYAS-owned homes of the Grok/Kimi CLIs (device code or
   * an EYAS-stored API key); set by the model module's onRegister.
   */
  cliSignIn?: import('@modules/model/cli-runtime/sign-in').CliSignInService
  /**
   * The raw gateway's egress slot; set by the model module's onRegister. An
   * egress filter (privacy) installed here sees every attempt of every call,
   * including calls through gateway references captured before it installed.
   */
  modelEgress?: import('@modules/model/egress').EgressSlot
  /**
   * The privacy policy and its one mask function; set by the privacy
   * module's onStart (absent when the module is disabled). Resolve it per
   * call — a module that starts earlier cannot capture it by value.
   */
  privacy?: import('@modules/privacy/service').PrivacyService
  /**
   * Boot self-test of the CLI-MCP tool bridge (Grok/Kimi → EYAS tools); set
   * by bootstrap after every module started. A failed check means those CLIs
   * run without EYAS tools; a deferred one ran before setup was complete.
   */
  cliMcpBridge?: import('@modules/model/cli-mcp/bridge-routes').CliMcpBridgeHealth
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
  /** Every registered, non-disabled module. Used by `home` to build the widget catalogue. */
  listModules(): import('./module-loader.js').ModuleListing[]
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
  /** '<module>.<widget>', e.g. 'scheduler.upcoming'. Matches the frontend registry key. */
  id: string
  /** i18n key — NOT a display string. The drawer renders it, so it must be translatable. */
  titleKey: string
  /** CASL subject gate; omitted means the module's own gate is enough. */
  capability?: string
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

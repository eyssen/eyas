import { z } from 'zod'
import type { EyasConfig } from '@core/types'
import { DEFAULT_SERVER_HOST, DEFAULT_SERVER_PORT } from './defaults.js'

export const configSchema = z.object({
  server: z.object({
    host: z.string().default(DEFAULT_SERVER_HOST),
    port: z.number().int().min(1).max(65535).default(DEFAULT_SERVER_PORT),
    // Cross-origin allowlist. When empty, CORS serves a wildcard WITHOUT
    // credentials (safe default). Credentialed CORS requires explicit origins.
    allowedOrigins: z.array(z.string()).default([]),
  }).default({}),
  database: z.object({
    path: z.string().default('data/sqlite/eyas.db'),
  }).default({}),
  log: z.object({
    level: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
    pretty: z.boolean().default(true),
  }).default({}),
  i18n: z.object({
    defaultLanguage: z.enum(['hu', 'en']).default('en'),
    fallbackLanguage: z.literal('en').default('en'),
  }).default({}),
  modules: z.object({
    disabled: z.array(z.string()).default([]),
  }).default({}),
  auth: z.object({
    jwtSecret: z.string().min(32).optional(),
    sessionDuration: z.number().int().positive().default(86400),       // 24h in seconds
    accessTokenDuration: z.number().int().positive().default(900),     // 15min in seconds
    refreshTokenDuration: z.number().int().positive().default(2592000), // 30 days in seconds
  }).default({}),
  autonomy: z.object({
    // When false, agents must use forge_propose_identity_change instead of
    // workspace_update_identity. The identity tool consults this flag at runtime.
    identitySelfUpdate: z.boolean().default(true),
  }).default({ identitySelfUpdate: true }),
  // F2 T3 — approval subsystem: how long a freshly-escalated approval sits
  // pending before the hourly sweep (security.approvals.sweep) auto-expires
  // it (D5). Read by security-gate's autonomyPolicy.defaultExpiresAt().
  security: z.object({
    approvalTtlHours: z.number().int().positive().default(72),
  }).default({}),
  // F2 T7 — verification-before-done. `criticEnabled` also gates the
  // plan-as-rubric pass (a plan whose criteria nothing judges is just cost).
  // `criticMaxRounds` caps the feedback resumes ONE run lineage may spend on
  // reaching 'complete' — 1 means: judge, hand back the gaps once, then stop.
  agent: z.object({
    criticEnabled: z.boolean().default(true),
    criticMaxRounds: z.number().int().nonnegative().default(1),
    /** When true, complex team proposals get git worktrees (also true for epic). */
    useWorktreesOnComplex: z.boolean().default(true),
    /**
     * Deterministic verify-before-done commands (P1). Empty = disabled.
     * Each entry: { name, command, args?, timeoutMs? } — runs without a shell.
     * Example: [{ "name": "bun-test", "command": "bun", "args": ["test"] }]
     */
    verifyCommands: z.array(z.object({
      name: z.string().min(1),
      command: z.string().min(1),
      args: z.array(z.string()).optional(),
      timeoutMs: z.number().int().positive().optional(),
    })).default([]),
    /** Working directory for verify commands (default: process.cwd()). */
    verifyCwd: z.string().optional(),
    /** God Mode multi-model debate (default on). */
    godModeEnabled: z.boolean().default(true),
    godModeMinParticipants: z.number().int().min(2).default(2),
    /** YAML cap above the default 5; roster hard-cap is 8. */
    godModeMaxParticipants: z.number().int().min(2).max(8).default(5),
    /**
     * Extra markdown persona directories (YAML frontmatter + body = prompt).
     * Empty by default — instance overlay lists the paths. Content is never
     * burned into src/.
     */
    importRoots: z.array(z.string()).default([]),
  }).default({}),
  // F2 T9 — cost-producer pricing overrides. Keys are provider-qualified
  // model ids ('anthropic/claude-sonnet-4-6') matching src/shared/model-pricing.ts's
  // DEFAULT_MODEL_PRICING; an entry here REPLACES that model's default rates
  // wholesale (not a per-field merge). Rates are USD per 1,000,000 tokens.
  model: z.object({
    pricing: z.record(z.string(), z.object({
      input: z.number().nonnegative(),
      output: z.number().nonnegative(),
      cacheRead: z.number().nonnegative().optional(),
      cacheWrite: z.number().nonnegative().optional(),
    })).default({}),
  }).default({}),
  // Cap 6 dream-engine — nightly reflection (OFF by default). Without this schema
  // entry the loader stripped `memory`, leaving the feature unreachable.
  memory: z.object({
    reflection: z.object({
      enabled: z.boolean().default(false),
      webEgress: z.object({
        enabled: z.boolean().default(false),
        // Operator-configured feeds. Validated https-only at load time; every
        // fetch is additionally SSRF-guarded at runtime (safeFetch).
        urls: z.array(z.string().url().refine((u) => /^https:\/\//i.test(u), 'webEgress urls must be https')).default([]),
        maxItems: z.number().int().positive().max(50).default(5),
      }).default({}),
    }).default({}),
    // Durable-memory capture. ON by default, deliberately: the whole reason
    // this exists is that the soft, opt-in path scored 0 writes in 24
    // conversations. It attaches a small model call to qualifying turns —
    // see config/default.yaml for the cost note.
    capture: z.object({
      enabled: z.boolean().default(true),
      /** A user message shorter than this cannot hold a durable fact. */
      minUserChars: z.number().int().positive().default(40),
      /** Runaway guard: extractions per conversation, not per turn. */
      maxPerConversation: z.number().int().positive().default(20),
      /** Each of the two messages is clipped to this before the model sees it. */
      maxInputChars: z.number().int().positive().default(4_000),
    }).default({}),
    // Related prior work. Default ON: a config file written before this block
    // must still inject the section. Lexical FTS, no model call.
    relatedWork: z.object({
      enabled: z.boolean().default(true),
      minQueryChars: z.number().int().positive().default(40),
      maxHits: z.number().int().positive().default(5),
      budgetChars: z.number().int().positive().default(1_200),
      maxSnippetChars: z.number().int().positive().default(140),
    }).default({}),
  }).default({}),
  // Cap 5 heartbeat (Phase 3A.1) — OFF by default (privacy). Task 10: this
  // entry was missing, so a `proactive:` YAML block was silently stripped
  // (z.object strips unknown keys) — the operator's config was ignored.
  proactive: z.object({
    heartbeat: z.object({
      enabled: z.boolean().default(false),
      quietHours: z.object({
        startHour: z.number().int().min(0).max(23),
        endHour: z.number().int().min(0).max(23),
      }).optional(),
    }).default({}),
  }).default({}),
  // Forge self-improvement loop tuning (Phase 3A.3) — optional, forge/index.ts
  // merges these over its own defaults. Task 10: same missing-schema bug as
  // `proactive` above stripped an operator's `forge:` YAML block.
  forge: z.object({
    minFeedbacksForAnalysis: z.number().int().positive().optional(),
    frictionRateThreshold: z.number().min(0).max(1).optional(),
    autoApproveConfidence: z.number().min(0).max(1).optional(),
    analysisWindowDays: z.number().int().positive().optional(),
    maxProposalsPerRun: z.number().int().positive().optional(),
  }).default({}),
  // Ops-agent module — read-only kubectl execution + GitOps PR provider.
  // Both sub-blocks are OFF/unset by default: kubectl.enabled=false means
  // every kubectl apply is honestly refused until an operator opts in, and
  // pr.provider=null means gitops-pr apply is honestly refused until a
  // provider + token are configured.
  ops: z.object({
    kubectl: z.object({
      enabled: z.boolean().default(false),
      kubeconfigPath: z.string().nullable().default(null),
      binary: z.string().default('kubectl'),
    }).default({}),
    pr: z.object({
      provider: z.enum(['gitea', 'github']).nullable().default(null),
      baseUrl: z.string().nullable().default(null),
      owner: z.string().nullable().default(null),
      repo: z.string().nullable().default(null),
      baseBranch: z.string().default('main'),
    }).default({}),
  }).default({}),
  // Ticket-to-code pipeline module — OFF by default. Mirrors ops.pr's
  // honest-refusal shape: prProvider=null means the pipeline stays inert
  // (no routes mounted) until enabled AND a PR provider + the
  // 'pipeline-pr-token' secret are configured. The internal EYAS board is
  // the only built-in ticket source — no vendor/ERP-specific defaults here.
  pipelines: z.object({
    ticketToCode: z.object({
      enabled: z.boolean().default(false),
      prProvider: z.enum(['gitea', 'github']).nullable().default(null),
      prBaseUrl: z.string().nullable().default(null),
      prOwner: z.string().nullable().default(null),
      prRepo: z.string().nullable().default(null),
      prBaseBranch: z.string().default('main'),
      // FIX C1: the orchestrator fires an approval gate AFTER a stage's body
      // runs (see orchestrator.ts runStage()), so gating 'pr-open' itself
      // would open the draft PR FIRST and only pause the run before the
      // no-op 'deploy' stage — i.e. too late, the human never got to block
      // the PR. Gating 'review' (the stage immediately before 'pr-open' in
      // STAGE_NAMES) pauses the run BEFORE any PR is opened.
      approvalGates: z.record(z.string(), z.boolean()).default({ review: true }),
    }).default({}),
  }).default({}),
  // Local speech STT/TTS (OFF by default — needs whisper/piper binaries).
  voice: z.object({
    enabled: z.boolean().default(false),
    defaultMode: z.enum(['text', 'voice', 'auto']).default('auto'),
    stt: z.object({
      command: z.string().default('bash scripts/voice/stt.sh {input} {output} {language}'),
      language: z.string().default('hu'),
      timeoutMs: z.number().int().positive().default(120_000),
    }).default({}),
    tts: z.object({
      command: z.string().default('bash scripts/voice/tts.sh {input} {output} {voice}'),
      voice: z.string().default('hu_HU-imre-medium'),
      timeoutMs: z.number().int().positive().default(60_000),
    }).default({}),
    workDir: z.string().default('data/voice'),
  }).default({}),
  costops: z.object({
    configPath: z.string().default('data/costops-config.json'),
  }).default({}),
  // Observability module — the context-composition detail layer
  // (context_compositions/context_sections) is short-retention by design; the
  // scheduler job purgeContextDetail() reads this to decide the cutoff.
  observability: z.object({
    contextRetentionDays: z.number().int().positive().default(7),
  }).default({}),
  // Task 18 — dead-skill classification policy (OWNER-REVIEWABLE, see
  // src/modules/skills/classify-skill.ts). Read via resolveClassifyConfig().
  skills: z.object({
    classify: z.object({
      graceDays: z.number().int().positive().default(30),
      neverUsedDays: z.number().int().positive().default(90),
      dormantDays: z.number().int().positive().default(180),
      timeExemptSources: z.array(z.string()).default(['user']),
    }).default({}),
    /**
     * Extra markdown skill directories scanned after config/skills.
     * Imported files win on id collision (recorded as shadows). Empty by
     * default — instance overlay lists the paths. Isolation stays on:
     * this is how host skills reach EYAS without settingSources.
     */
    importRoots: z.array(z.string()).default([]),
  }).default({}),
})

export const defaultConfig: EyasConfig = configSchema.parse({})

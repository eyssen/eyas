// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'
import type { EyasModule, ModuleContext } from '@core/types'
import { createMemoryTables } from './schema.js'
import { createWorkingMemoryService } from './tiers/working-memory.js'
import { createEpisodicMemoryService } from './tiers/episodic-memory.js'
import { createArchiveMemoryService } from './tiers/archive-memory.js'
import { createVaultService } from './vault/vault-service.js'
import { createVaultIndexer } from './vault/vault-indexer.js'
import { createWikilinkService } from '@shared/wikilinks'
import { createMemoryService } from './memory-service.js'
import {
  createReflectionDigestTables,
  createReflectionDigestService,
  buildMorningBriefing,
} from './reflection-digest.js'
import { registerReflectionJob } from './reflection-job.js'
import { buildMemoryIndex } from './memory-index.js'
import { buildRelatedWork } from './related-work.js'
import { ensureConversationFts, backfillConversationFts } from './search/conversation-fts.js'
import { createNoteWriter } from './capture/note-writer.js'
import { createMemoryCapture } from './capture/index.js'
import { createCaptureComplete } from './capture/completion.js'
import { createCompletedRunsPort } from '@modules/agent/completed-runs.js'
import { createModelBridge } from './embeddings/model-bridge.js'
import { createVecStore } from './embeddings/vec-store.js'
import { createEmbeddingService } from './embeddings/embedding-service.js'
import type { DecisionEngine } from '@modules/model/routing/decision-engine'
import { getRawDatabase } from '@core/db/connection'
import { getSqliteCapabilities, probeSqliteCapabilities, rawHandleOf, type SqliteCapabilities } from '@core/db/sqlite-capabilities.js'
import { createMemoryV2Tables } from './v2/schema.js'
import { getInstanceId } from './v2/instance.js'
import { wireL0Capture } from './v2/wire.js'
import { detachIngest, disableIngestBridge } from './v2/ingest-bridge.js'

export const memoryModule: EyasModule = {
  id: 'memory',
  name: 'Memory',
  version: '1.0.0',
  type: 'core',
  required: false,
  description: '5-tier hybrid memory system — working, episodic, semantic/procedural vault, archive',
  dependencies: ['model'],
  optional: ['conversations', 'scheduler'],
  frontend: {
    widgets: [{ id: 'memory.briefing', titleKey: 'home.widget.briefing.title' }],
  },

  async onRegister(ctx: ModuleContext) {
    createMemoryTables(ctx.db)

    // Sovereign layered memory (v2) tables — additive, idempotent, created
    // under BOTH engines so L0 capture (plan p1b) always has a sink. The
    // probe runs on this very connection and leaves sqlite-vec loaded on it,
    // which is what the vec0 DDL needs; its result is cached for
    // getSqliteCapabilities() later in onStart.
    try {
      createMemoryV2Tables(ctx.db, probeSqliteCapabilities(rawHandleOf(ctx.db), ctx.logger))
    } catch (err) {
      ctx.logger.error({ err }, 'memory v2 tables could not be created; L0 capture will stay buffered until the next start')
    }

    // F4 — Letta-style shared memory blocks (company / agent / team / run).
    const { createMemoryBlockService } = await import('./blocks/memory-blocks.js')
    const memoryBlocks = createMemoryBlockService(ctx.db)
    memoryBlocks.ensureTables()
    ;(ctx as any).memoryBlocks = memoryBlocks

    // Dream-engine groundwork (Cap 6) — persistent nightly reflection digests.
    createReflectionDigestTables(ctx.db)
    ;(ctx as any).reflectionDigests = createReflectionDigestService(ctx.db)
    // Cap 6 — the web-egress reflection bucket. The runtime gate is the config
    // flag (memory.reflection.webEgress.enabled, OFF by default); the scheduled
    // job runs as the system. The 'WebEgress' CASL subject is registered so a
    // future operator-facing toggle has a permission to bind to — it is NOT
    // enforced on the job itself today.
    try {
      ;(ctx as any).permissions?.registerSubject?.('WebEgress', {
        actions: ['read', 'manage'],
        defaults: { owner: ['manage'], admin: ['manage'] },
      })
    } catch { /* permissions module optional */ }

    const wikilinks = createWikilinkService(ctx.db)
    wikilinks.init()
    ;(ctx as any)._wikilinks = wikilinks

    ctx.logger.info('Memory module registered')
  },

  async onStart(ctx: ModuleContext) {
    const wikilinks = (ctx as any)._wikilinks

    const working = createWorkingMemoryService(ctx.db, {
      ttlHours: 24,
      maxTokensPerBlock: 500,
    })
    // Embedding service is wired below; we use a late-binding hook so episodic
    // create() can kick off async embedding without circular init.
    let embedLateHook: ((mem: { id: string; content: string }) => void) | null = null
    let removeLateHook: ((id: string) => void) | null = null
    const episodic = createEpisodicMemoryService(ctx.db, {
      onCreated: (m) => embedLateHook?.(m),
      onRemoved: (id) => removeLateHook?.(id),
    })
    const archive = createArchiveMemoryService(ctx.db)
    const vault = createVaultService('data/vault')
    let vaultIndexHook: ((path: string, content: string) => void) | null = null
    let vaultRemoveHook: ((path: string) => void) | null = null
    const indexer = createVaultIndexer(ctx.db, vault, wikilinks, {
      onIndexed: (p, c) => vaultIndexHook?.(p, c),
      onRemoved: (p) => vaultRemoveHook?.(p),
    })

    const indexed = indexer.indexAll()
    if (indexed > 0) ctx.logger.info('Indexed %d vault files', indexed)

    // L0 FTS: onRegister may have run before conversation_messages existed
    // (loader order). ensure is idempotent. Backfill yields off the start
    // stack — an async IIFE is synchronous until the first await, so the
    // first chunk (and every later chunk) waits a tick. Search during
    // backfill returns whatever is already indexed.
    try {
      ensureConversationFts(ctx.db)
      void (async () => {
        try {
          await new Promise<void>(r => setTimeout(r, 0))
          let after = 0
          for (;;) {
            const r = backfillConversationFts(ctx.db, { afterRowId: after })
            if (r.done || r.lastRowId <= after) break
            after = r.lastRowId
            await new Promise<void>(r => setTimeout(r, 0))
          }
        } catch (err) {
          ctx.logger.warn({ err }, 'Conversation FTS backfill failed')
        }
      })()
    } catch (err) {
      ctx.logger.warn({ err }, 'Conversation FTS ensure failed')
    }

    working.cleanupExpired()

    // Initialize embedding bridge + vector store before building memory service,
    // so search() can use vector channel from the start.
    let embeddingService: ReturnType<typeof createEmbeddingService> | undefined
    try {
      const decisionEngine = (ctx as any).decisionEngine as DecisionEngine | undefined
      let embedProvider: string | undefined
      let embedModel: string | undefined

      if (decisionEngine) {
        const resolved = decisionEngine.resolveForTier('embedding')
        if (resolved) {
          embedProvider = resolved.provider
          embedModel = resolved.model
        }
      }

      const bridge = createModelBridge(ctx.model, {
        provider: embedProvider,
        model: embedModel,
      })

      if (bridge.canEmbed()) {
        ;(ctx as any).embeddingBridge = bridge
        ctx.logger.info({ provider: embedProvider, model: embedModel }, 'Memory embedding bridge initialized')

        let rawDb: any = null
        try { rawDb = getRawDatabase() } catch { /* test env */ }
        if (rawDb) {
          const vecStore = createVecStore({ db: ctx.db, rawDb, logger: ctx.logger })
          embeddingService = createEmbeddingService({ db: ctx.db, vecStore, bridge, logger: ctx.logger })
          ;(ctx as any).embeddingService = embeddingService

          // Late-bind hooks so new episodic writes and vault updates are embedded in the background.
          embedLateHook = (m) => {
            void embeddingService!.embedAndStoreEpisodic(m.id, m.content).catch(() => {})
          }
          removeLateHook = (id) => embeddingService!.removeEpisodic(id)
          vaultIndexHook = (p, c) => {
            void embeddingService!.embedAndStoreVault(p, c).catch(() => {})
          }
          vaultRemoveHook = (p) => embeddingService!.removeVault(p)
        }
      } else {
        ctx.logger.info('No embedding-capable provider available — vector search disabled')
      }
    } catch (err) {
      ctx.logger.warn('Failed to initialize embedding bridge: %s', err)
    }

    const memoryService = createMemoryService({
      working, episodic, archive, vault, indexer, wikilinks,
      db: ctx.db,
      embeddings: embeddingService
        ? {
            searchEpisodic: (q, l, a) => embeddingService!.searchEpisodic(q, l, a),
            searchVault: (q, l) => embeddingService!.searchVault(q, l),
          }
        : undefined,
    })
    ;(ctx as any).memory = memoryService

    // The interactive conversation route has no db handle and no logger of its
    // own, so the guard lives here where both exist. A memory index that
    // cannot be built is a turn without memory, never a turn without an answer.
    ;(ctx as any).memoryIndex = (opts?: import('./memory-index.js').MemoryIndexOptions) => {
      try {
        return buildMemoryIndex(ctx.db, opts)
      } catch (err) {
        ctx.logger.warn({ err }, 'Memory index could not be built; this turn goes without it')
        return null
      }
    }

    // Same fail-soft contract as memoryIndex: a related-work miss is a turn
    // without that section, never a turn without an answer. Config is read
    // fresh on every call so a `config reload` takes effect without restart.
    ;(ctx as any).relatedWork = (opts: import('./related-work.js').RelatedWorkOptions) => {
      try {
        const c = (ctx.config as any)?.memory?.relatedWork ?? {}
        return buildRelatedWork(ctx.db, {
          ...opts,
          enabled: c.enabled ?? true,
          minQueryChars: c.minQueryChars ?? 40,
          maxHits: c.maxHits ?? 5,
          budgetChars: c.budgetChars ?? 1_200,
          maxSnippetChars: c.maxSnippetChars ?? 140,
        })
      } catch (err) {
        ctx.logger.warn({ err }, 'Related work could not be built; this turn goes without it')
        return null
      }
    }

    // ── Durable-memory capture (F1) ───────────────────────────────────────
    // Built here because this is the only place the db, the vault, the indexer
    // and a logger are all already in scope. Published on ctx for both call
    // sites: the interactive route reaches it through a lazy accessor, the
    // background runner through a ConversationRunnerDeps entry.
    ;(ctx as any).memoryCapture = createMemoryCapture({
      db: ctx.db,
      // Read fresh on every capture so a `config reload` takes effect without a
      // restart. The defaults mirror config/schema.ts: a config file written
      // before this block existed still runs the feature as designed.
      config: () => {
        const c = (ctx.config as any)?.memory?.capture ?? {}
        return {
          enabled: c.enabled ?? true,
          minUserChars: c.minUserChars ?? 40,
          maxPerConversation: c.maxPerConversation ?? 20,
          maxInputChars: c.maxInputChars ?? 4_000,
        }
      },
      // The cheap tier is the FIRST choice, not the only one: on an instance
      // whose 'heartbeat' tier names a provider it does not have, the pin used
      // to be dropped and the gateway's unpinned fallback answered — a CLI
      // agent, in prose, which parses as nothing. Ladder: capture/completion.ts.
      // Every lookup it needs is resolved per call, never captured: privacy and
      // observability replace ctx.model during their own onStart, which may run
      // after this one (the lazy-gateway lesson from conversations/index.ts).
      complete: createCaptureComplete({
        getGateway: () => ctx.model,
        getDecisionEngine: () => (ctx as any).decisionEngine as DecisionEngine | undefined,
        getProviderConfig: () => ctx.providerConfig,
        logger: ctx.logger,
      }),
      writer: createNoteWriter({
        db: ctx.db,
        vault,
        indexer,
        // Always present, identity when the privacy module is absent: the real
        // sanitiser is published in privacy's own onStart, which may run after
        // this one, so it cannot be captured by value here.
        privacySanitize: async (text: string) => {
          const fn = (ctx as any).privacySanitize as ((t: string) => Promise<string>) | undefined
          return fn ? fn(text) : text
        },
      }),
      logger: ctx.logger,
    })

    // ── L0 capture (sovereign memory v2, plan p1b) ─────────────────────────
    // The bridge has been buffering since the first addMessage of this boot;
    // attaching here drains it. Capabilities come from the main connection's
    // probe (p1a); the fallback probe covers a test harness without one.
    let caps: SqliteCapabilities | null = null
    try {
      caps = getSqliteCapabilities()
    } catch {
      try { caps = probeSqliteCapabilities(getRawDatabase(), ctx.logger) } catch { caps = null }
    }
    if (caps) {
      const ingest = await wireL0Capture({
        db: ctx.db,
        logger: ctx.logger,
        caps,
        instanceId: getInstanceId(ctx.db),
        bus: ctx.bus,
        scheduler: (ctx as any).scheduler,
        // Defaults mirror config/schema.ts memory.l0; read fresh per call.
        config: () => {
          const c = (ctx.config as any)?.memory?.l0 ?? {}
          return {
            enabled: c.enabled ?? true,
            toolResultMaxBytes: c.toolResultMaxBytes ?? 8_192,
            idleFlushMinutes: c.idleFlushMinutes ?? 30,
            chunkTokens: c.chunkTokens ?? 8_000,
            captureToolResults: c.captureToolResults === true,
            // Extraction (plan p1c) reads the engine switch and the legacy opt-in.
            engine: ((ctx.config as any)?.memory?.engine ?? 'legacy') as 'legacy' | 'v2',
            extractInLegacy: c.extractInLegacy ?? true,
          }
        },
      })
      ;(ctx as any).memoryIngest = ingest ?? undefined
    } else {
      // Same reason as wire.ts's zstd-failure path: the capture hooks live in
      // other modules and keep calling captureUnit whatever happens here, so
      // the bridge has to be told to stop rather than left buffering into a
      // queue nothing will ever drain.
      disableIngestBridge()
      ctx.logger.warn('L0 capture skipped: SQLite capabilities could not be probed; capture is off')
    }

    const { createMemoryRoutes } = await import('./routes.js')
    createMemoryRoutes(ctx.http, memoryService, ctx.logger, { db: ctx.db, wikilinks })

    // Cap 6 morning briefing — latest reflection digest, rendered.
    const { requirePermission: requireMemPerm } = await import('@modules/permissions/middleware')
    ctx.http.get('/api/v1/memory/briefing', requireMemPerm('read', 'MemoryEntry'), (c: any) => {
      const latest = (ctx as any).reflectionDigests.latest()
      return c.json({ briefing: latest ? buildMorningBriefing(latest) : null, digest: latest })
    })

    // Fire-and-forget: embed any rows missing an up-to-date vector. Runs in
    // background so boot stays fast.
    if (embeddingService) {
      void (async () => {
        try {
          await embeddingService!.backfill(200)
        } catch { /* already logged inside */ }
      })()
    }

    // Start vault file watcher
    const { createVaultWatcher } = await import('./vault/vault-watcher.js')
    const vaultWatcher = createVaultWatcher('data/vault', indexer, ctx.logger)
    vaultWatcher.start()
    ;(ctx as any).vaultWatcher = vaultWatcher

    // Register nightly sleep-time consolidator with scheduler (if available).
    try {
      const scheduler = (ctx as any).scheduler
      if (scheduler && typeof scheduler.registerHandler === 'function') {
        const { createConsolidator } = await import('./consolidator/index.js')
        const { registerConsolidatorJob } = await import('./consolidator/schedule.js')
        const { createSemanticPromoter } = await import('./consolidator/semantic-promoter.js')
        const { createReviewQueue } = await import('./consolidator/review-queue.js')
        const { createCompletedRunsPort } = await import('@modules/agent/completed-runs.js')
        const reviewQueue = createReviewQueue(ctx.db)
        ;(ctx as any).memoryReviewQueue = reviewQueue
        // Real completed-run feed (from agent_sessions) replaces the empty stub,
        // so the skill-candidate miner actually mines runs into the review queue.
        const completedRuns = createCompletedRunsPort(ctx.db)

        // Plug the LLM summariser in when the model gateway is available so
        // phase 2 produces real vault notes instead of just invalidating rows.
        let semanticPromoter
        try {
          if (ctx.model) {
            const decisionEngine = (ctx as any).decisionEngine as DecisionEngine | undefined
            semanticPromoter = createSemanticPromoter({
              gateway: ctx.model,
              decisionEngine,
              vault,
              indexer,
              logger: ctx.logger,
            })
          }
        } catch (err) {
          ctx.logger.debug({ err: String(err) }, 'semantic promoter unavailable — fallback to invalidate-only')
        }

        const consolidator = createConsolidator({
          memory: {
            working: { listAll: () => working.listAll(), delete: (k) => working.delete(k) },
            episodic: {
              list: (opts) => episodic.list(opts),
              create: (input) => episodic.create(input),
              invalidate: (id) => episodic.invalidate(id),
              delete: (id) => episodic.delete(id),
            },
          },
          events: completedRuns,
          wiki: { listActiveClients: () => [], proposeEditsForClient: () => [] },
          logger: ctx.logger,
          semanticPromoter,
          persistSkillCandidates: (cands) => reviewQueue.persistSkillCandidates(cands),
          persistWikiProposals: (props) => reviewQueue.persistWikiProposals(props),
        })

        ;(ctx as any).memoryConsolidator = consolidator
        registerConsolidatorJob({ scheduler, consolidator })
        ctx.logger.info({ hasSemanticPromoter: !!semanticPromoter }, 'Memory consolidator scheduled (nightly 02:00)')

        // Cap 6 dream-engine — nightly reflection digest (off by default; a
        // deterministic scaffold until an LLM reflection pass fills the
        // buckets). Extracted to reflection-job.ts (Task 10 review fix) so
        // the real handler is directly testable without booting the rest of
        // this module.
        registerReflectionJob(scheduler, ctx, episodic)

        // Team memory retention — archive rows older than 30 days from completed
        // sessions. Runs once per day at 03:00 (a safe hour after consolidator).
        try {
          scheduler.registerHandler('memory.team_memory.retention', async () => {
            const cutoff = new Date(Date.now() - 30 * 86400000).toISOString()
            const result = ctx.db.run(sql`DELETE FROM team_memory
              WHERE team_session_id IN (
                SELECT id FROM team_sessions WHERE status = 'completed' AND completed_at < ${cutoff}
              )`) as any
            return { deleted: result?.changes ?? 0 }
          })
          const existing = scheduler.list().find((j: any) => j.name === 'memory.team_memory.retention')
          if (!existing) {
            scheduler.create({
              name: 'memory.team_memory.retention',
              description: 'Archive team_memory rows from sessions completed >30 days ago',
              triggerType: 'cron',
              triggerConfig: JSON.stringify({ cron: '0 3 * * *' }),
              handler: 'memory.team_memory.retention',
            })
          }
        } catch (err) {
          ctx.logger.debug({ err: String(err) }, 'team_memory retention job registration skipped')
        }
      } else {
        ctx.logger.debug('Scheduler module not available — consolidator will only run on demand')
      }
    } catch (err) {
      ctx.logger.warn('Failed to register consolidator: %s', err)
    }

    ctx.logger.info('Memory module started')
  },

  async onStop(ctx: ModuleContext) {
    const watcher = (ctx as any).vaultWatcher
    if (watcher && typeof watcher.stop === 'function') watcher.stop()
    // Whatever is still buffered belongs to L0 — a restart must not lose it.
    try {
      const flushed = (ctx as any).memoryIngest?.flushAll('manual')
      if (flushed) ctx.logger.info({ conversations: flushed }, 'L0 capture: buffers flushed on stop')
    } catch (err) {
      ctx.logger.warn({ err }, 'L0 capture: flush on stop failed')
    }
    // bootstrap closes the database right after this. Leaving the bridge
    // attached would point a straggling captureUnit at an ingest holding a
    // closed connection.
    detachIngest()
  },
}

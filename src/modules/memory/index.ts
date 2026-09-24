// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'
import type { EyasModule, ModuleContext } from '@core/types'
import { createMemoryTables } from './schema.js'
import { createWorkingMemoryService } from './tiers/working-memory.js'
import { createEpisodicMemoryService } from './tiers/episodic-memory.js'
import { createArchiveMemoryService } from './tiers/archive-memory.js'
import { createVaultService } from './vault/vault-service.js'
import { prepareVaultDir } from './vault/legacy-location.js'
import { resolveInstance } from '@core/instance.js'
import { createVaultIndexer } from './vault/vault-indexer.js'
import { createWikilinkService } from '@shared/wikilinks'
import { createMemoryService } from './memory-service.js'
import {
  createReflectionDigestTables,
  createReflectionDigestService,
  buildMorningBriefing,
} from './reflection-digest.js'
import { registerReflectionJob } from './reflection-job.js'
import { recallIncludesSecrets } from './memory-index.js'
import { ensureConversationFts, backfillConversationFts } from './search/conversation-fts.js'
import { createNoteWriter } from './capture/note-writer.js'
import { createMemoryCapture, completeViaAuxiliary } from './capture/index.js'
import { createCompletedRunsPort } from '@modules/agent/completed-runs.js'
import { createHashEmbedder, HASH_EMBED_MODEL_ID } from './embeddings/hash-embedder.js'
import { createBestLocalEmbedder, E5_CACHE_DIR, E5_MODEL_ID } from './embeddings/local-embedder.js'
import { selectEmbeddingBridges } from './embeddings/select-bridges.js'
import { resetLegacyIndexOnModelSwap } from './embeddings/legacy-model-swap.js'
import { createVecStore } from './embeddings/vec-store.js'
import { createEmbeddingService } from './embeddings/embedding-service.js'
import { migrateImportedIntoL0 } from './v2/migrate-imported.js'
import { migrateBlocksIntoL0 } from './v2/migrate-blocks.js'
import { runVaultReprovenance } from './v2/reprovenance.js'
import { reextractMissingImportedFacts } from './v2/reextract.js'
import { wipeForeignModelEmbeddings } from './v2/l3-embed.js'
import { createL3EmbedWorker, type L3EmbedWorker } from './v2/l3-worker.js'
import { runL3Repartition } from './v2/l3-repartition.js'
import { runSecretsBackfill } from './v2/secrets-backfill.js'
import { retrieve } from './v2/retrieve.js'
import { expandMemoryId } from './v2/expand.js'
import { createMemoryRecall } from './v2/assemble.js'
import type { DecisionEngine } from '@modules/model/routing/decision-engine'
import { getRawDatabase } from '@core/db/connection'
import { getSqliteCapabilities, probeSqliteCapabilities, rawHandleOf, type SqliteCapabilities } from '@core/db/sqlite-capabilities.js'
import { createMemoryV2Tables, migrateMemoryV2Schema } from './v2/schema.js'
import { getInstanceId } from './v2/instance.js'
import { wireL0Capture } from './v2/wire.js'
import { detachIngest, disableIngestBridge, setCapturePolicy } from './v2/ingest-bridge.js'

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
    // An existing database may predate the current v2 schema (v1 → v2 widens
    // memory_raw.source_type with 'thinking'). One guarded rebuild; a failure
    // rolls back and leaves v1 working — the ingest then drops only the units
    // the old CHECK refuses. No-op when memory_raw is missing or already current.
    try {
      const started = Date.now()
      const migration = migrateMemoryV2Schema(ctx.db)
      if (migration.rebuilt) {
        ctx.logger.info({ rows: migration.rows, from: migration.fromVersion, to: migration.toVersion, ms: Date.now() - started }, 'memory v2: L0 schema migrated (memory_raw rebuilt)')
      }
    } catch (err) {
      ctx.logger.error({ err }, 'memory v2: L0 schema migration failed and was rolled back; memory_raw stays at the older schema until the next start')
    }

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
    // The vault lives in <dataDir>/vault, so it follows EYAS_DATA_DIR; notes a
    // pre-move install kept in <home>/data/vault are copied in once. The one
    // path goes to the service AND the watcher below.
    const vaultDir = prepareVaultDir(resolveInstance({ ensureDirs: false }), ctx.logger)
    const vault = createVaultService(vaultDir)
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

    // Two embedders, two jobs (select-bridges.ts). Recall — L3 vectors and the
    // query-side KNN — always runs on the local embedder, on every install and
    // whatever chat provider answers: multilingual-e5-small when its weights
    // load, else the hashed stem embedder (spec §3 / §16-2). The 'embedding'
    // routing tier feeds only the legacy vault/episodic search index.
    // Built before the memory service so search() has its vector channel from
    // the start.
    let embeddingService: ReturnType<typeof createEmbeddingService> | undefined
    let l3Worker: L3EmbedWorker | undefined
    let legacyModelId: string | undefined
    try {
      const decisionEngine = (ctx as any).decisionEngine as DecisionEngine | undefined
      // A routing hiccup costs the legacy index its tier, never recall its embedder.
      let embeddingTier: { provider: string; model: string } | null = null
      try {
        embeddingTier = decisionEngine?.resolveForTier('embedding') ?? null
      } catch (err) {
        ctx.logger.debug({ err }, 'embedding tier could not be resolved; the legacy index uses the local embedder')
      }
      const { l3: l3Bridge, legacy: legacyBridge, legacySource } = await selectEmbeddingBridges({
        gateway: ctx.model,
        embeddingTier,
        createLocal: async () => {
          try {
            return await createBestLocalEmbedder({ cacheDir: E5_CACHE_DIR, logger: ctx.logger })
          } catch (err) {
            ctx.logger.warn({ err }, 'Local embedder could not be built; recall uses the hashed stem embedder')
            return createHashEmbedder()
          }
        },
      })
      const l3Model = l3Bridge.modelId?.() || HASH_EMBED_MODEL_ID
      const legacyModel = legacyBridge.modelId?.() || HASH_EMBED_MODEL_ID
      legacyModelId = legacyModel
      // ctx.embeddingBridge is read by v2 recall only (retrieve, memoryRecall).
      ;(ctx as any).embeddingBridge = l3Bridge
      ctx.logger.info({ recall: l3Model, legacyIndex: legacyModel, legacySource }, 'Memory embedders initialized')

      let rawDb: any = null
      try { rawDb = getRawDatabase() } catch { /* test env */ }
      try {
        const dropped = wipeForeignModelEmbeddings(ctx.db, rawDb ?? undefined, l3Model)
        if (dropped > 0) ctx.logger.info({ dropped, keep: l3Model }, 'Wiped L3 vectors from a previous embedder')
      } catch (err) {
        ctx.logger.debug({ err }, 'L3 embedder-swap wipe skipped')
      }

      l3Worker = createL3EmbedWorker({
        db: ctx.db,
        getRawDb: () => {
          try { return getRawDatabase() as any } catch { return undefined }
        },
        bridge: l3Bridge,
        logger: ctx.logger,
        includeSecrets: () => recallIncludesSecrets(ctx.config),
      })
      // Health/observability read status() from here.
      ;(ctx as any).memoryL3Worker = l3Worker

      if (rawDb && legacyBridge.canEmbed()) {
        // Before createVecStore: a changed legacy embedder empties that index
        // (its vec0 tables have a fixed dimension) so it is re-embedded.
        try {
          resetLegacyIndexOnModelSwap(ctx.db, legacyModel, ctx.logger)
        } catch (err) {
          ctx.logger.debug({ err }, 'legacy embedding index model check skipped')
        }
        const vecStore = createVecStore({ db: ctx.db, rawDb, logger: ctx.logger })
        embeddingService = createEmbeddingService({
          db: ctx.db, vecStore, bridge: legacyBridge, logger: ctx.logger,
          // D-7 / P-19 — the same accessor the index, related work, search,
          // the consolidator and the skill matcher read. With an embedding
          // tier this is a sink that leaves the machine, so it gets the gate
          // too: the vault-index hook, the episodic hook and the boot backfill
          // all end here.
          recall: () => ({ includeSecrets: recallIncludesSecrets(ctx.config) }),
        })
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
    } catch (err) {
      ctx.logger.warn('Failed to initialize embedding bridge: %s', err)
    }

    const memoryService = createMemoryService({
      working, episodic, archive, vault, indexer, wikilinks,
      db: ctx.db,
      // D-7 / P-19 — one accessor decides the secrets exclusion everywhere.
      // Read per search rather than captured, so nothing has to be rebuilt if
      // the config object behind it is ever replaced at runtime.
      recall: () => ({ includeSecrets: recallIncludesSecrets(ctx.config) }),
      embeddings: embeddingService
        ? {
            searchEpisodic: (q, l, a) => embeddingService!.searchEpisodic(q, l, a),
            searchVault: (q, l) => embeddingService!.searchVault(q, l),
          }
        : undefined,
    })
    ;(ctx as any).memory = memoryService
    ;(memoryService as any).db = ctx.db
    ;(memoryService as any).retrieve = (opts: Parameters<typeof retrieve>[1]) => {
      let rawDb: any
      try { rawDb = getRawDatabase() } catch { rawDb = undefined }
      return retrieve({
        db: ctx.db,
        rawDb,
        bridge: (ctx as any).embeddingBridge,
        logger: ctx.logger,
      }, { ...opts, includeSecrets: opts.includeSecrets ?? recallIncludesSecrets(ctx.config) })
    }
    ;(memoryService as any).expand = (id: string, opts?: { projectId?: string | null; projectTypeId?: string | null; includeSecrets?: boolean }) =>
      expandMemoryId(ctx.db, id, {
        projectId: opts?.projectId,
        projectTypeId: opts?.projectTypeId,
        includeSecrets: opts?.includeSecrets ?? recallIncludesSecrets(ctx.config),
      })

    // THE recall service (v2/assemble.ts): one fenced <eyas-memory> block per
    // turn, the same on every provider and entry path — and the only one: no
    // other accessor pushes memory into a prompt. The prompt assembler
    // calls it with the turn text, the answering model's delivery profile and
    // the block's budget; the query and its language are composed inside (J6)
    // and the scope is the conversation's own, never a caller's. Everything
    // it reads is resolved per call — the raw handle and the embedder can
    // appear after this line runs.
    ;(ctx as any).memoryRecall = createMemoryRecall({
      db: ctx.db,
      getRawDb: () => {
        try { return getRawDatabase() as any } catch { return undefined }
      },
      getBridge: () => (ctx as any).embeddingBridge,
      logger: ctx.logger,
      includeSecrets: () => recallIncludesSecrets(ctx.config),
    })

    // ── Durable-memory capture (F1) ───────────────────────────────────────
    // Built here because this is the only place the db, the vault, the indexer
    // and a logger are all already in scope. Published on ctx for every run
    // path, each reading it lazily and calling it through the one run-end
    // entry (capture/run-end.ts captureRunEnd): the interactive route, the
    // background runner, executeAgent (delegation, specialist, pipeline, A2A),
    // team members and channel replies. One gate, one cap, one run row.
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
      // The background model service (model/auxiliary.ts) is the extractor's
      // only route to a model: an API provider or a CLI that runs isolated,
      // never a gateway-chosen one. No eligible model → a 'no_eligible_model'
      // run row and no call. Read per call, never captured.
      complete: completeViaAuxiliary(() => ctx.auxiliaryModel),
      writer: createNoteWriter({
        db: ctx.db,
        vault,
        indexer,
        // Vault notes are masked at rest by the same function that masks
        // egress (dates kept, mask- and block-class values replaced). Always
        // present, identity when the privacy module is absent; ctx.privacy is
        // published in privacy's own onStart, which may run after this one,
        // so it is resolved per call, never captured.
        privacySanitize: async (text: string) => ctx.privacy?.maskAtRest(text) ?? text,
      }),
      logger: ctx.logger,
    })

    // ── L0 capture (sovereign memory v2, plan p1b) ─────────────────────────
    // The opt-in switches every run's capture reads (memory/v2/run-capture.ts):
    // tool output from every provider, and model reasoning. Read per call so
    // `config reload` applies without a restart; anything but true is off.
    setCapturePolicy(() => {
      const c = (ctx.config as any)?.memory?.l0 ?? {}
      return { toolResults: c.captureToolResults === true, thinking: c.captureThinking === true }
    })
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
            captureThinking: c.captureThinking === true,
            // Extraction (plan p1c) reads the engine switch and the legacy opt-in.
            engine: ((ctx.config as any)?.memory?.engine ?? 'legacy') as 'legacy' | 'v2',
            extractInLegacy: c.extractInLegacy ?? true,
          }
        },
      })
      ;(ctx as any).memoryIngest = ingest ?? undefined
      if (ingest) {
        // Incremental L3: registered after wireL0Capture's extraction
        // listener, so the gists and facts a flush extracts are committed
        // before the (debounced, asynchronous) drain looks for them.
        ingest.onFlushed(() => l3Worker?.kick())
        // After listen: a sync pass of 4k extractions would stall boot.
        setTimeout(() => {
          void (async () => {
            try {
              const report = await migrateImportedIntoL0({
                db: ctx.db,
                ingest,
                vault,
                logger: ctx.logger,
              })
              if (report.vault + report.episodic + report.skipped > 0) {
                ctx.logger.info(report, 'L0 migrate: vault notes and episodic rows')
              }
              // One-shot: the retired memory blocks (memory_block_read/_write)
              // become derived L0 documents; the table itself stays.
              try {
                const blocks = await migrateBlocksIntoL0({ db: ctx.db, ingest, logger: ctx.logger })
                if (blocks.migrated > 0) ctx.logger.info(blocks, 'L0 migrate: memory blocks')
              } catch (err) {
                ctx.logger.warn({ err }, 'memory blocks migration failed; it is retried at the next start')
              }
              const extractionConfig = () => {
                const c = (ctx.config as any)?.memory?.l0 ?? {}
                return {
                  engine: ((ctx.config as any)?.memory?.engine ?? 'legacy') as 'legacy' | 'v2',
                  extractInLegacy: c.extractInLegacy ?? true,
                }
              }
              // One-shot: vault notes captured before their trust and project
              // were stored get them now, and their facts are re-derived.
              try {
                const provenance = await runVaultReprovenance({ db: ctx.db, logger: ctx.logger, config: extractionConfig })
                if (provenance.fixed + provenance.failed > 0) ctx.logger.info(provenance, 'vault provenance: notes re-derived')
              } catch (err) {
                ctx.logger.warn({ err }, 'vault provenance pass failed; it is retried at the next start')
              }
              const facts = await reextractMissingImportedFacts({
                db: ctx.db,
                logger: ctx.logger,
                config: extractionConfig,
              })
              if (facts.conversations > 0) ctx.logger.info(facts, 'L1 reextract: imported facts')
              // Before this start's L3 pass: rows derived from a note or
              // episodic row tagged contains-secrets carry the marker, so
              // recall and the L3 pass below leave them out.
              try {
                runSecretsBackfill({ db: ctx.db, logger: ctx.logger })
              } catch (err) {
                ctx.logger.warn({ err }, 'contains-secrets backfill failed; it is retried at the next start')
              }
              let rawDb: any = null
              try { rawDb = getRawDatabase() } catch { /* test env */ }
              // Vectors written before D1 partitions existed all sit in the
              // global partition; file them under their project first, so the
              // L3 pass below and every KNN see the project lock.
              try {
                const moved = runL3Repartition({ db: ctx.db, rawDb: rawDb ?? undefined, logger: ctx.logger })
                if (!moved.skipped) ctx.logger.info(moved, 'L3 repartition: vectors filed under their project')
              } catch (err) {
                ctx.logger.warn({ err }, 'L3 repartition failed; it is retried at the next start')
              }
              // This start's L3 pass: the worker embeds whatever is missing,
              // retires dead vectors and applies the live-index cap. From here
              // on every flush kicks it again (onFlushed below).
              l3Worker?.kick()
            } catch (err) {
              ctx.logger.warn({ err }, 'L0 migrate of imported memory failed')
            }
          })()
        }, 2_000)
      } else {
        // No capture this start, but gists and facts from earlier ones are
        // still recalled: embed what is missing and retire what died.
        l3Worker?.kick()
      }
    } else {
      l3Worker?.kick()
      // Same reason as wire.ts's zstd-failure path: the capture hooks live in
      // other modules and keep calling captureUnit whatever happens here, so
      // the bridge has to be told to stop rather than left buffering into a
      // queue nothing will ever drain.
      disableIngestBridge()
      ctx.logger.warn('L0 capture skipped: SQLite capabilities could not be probed; capture is off')
    }

    const { createMemoryRoutes } = await import('./routes.js')
    createMemoryRoutes(ctx.http, memoryService, ctx.logger, {
      db: ctx.db,
      wikilinks,
      // B10 quarantine: every accessor is read per call (the audit module may
      // register after this one; the ingest exists only when L0 is wired).
      quarantine: {
        flushPending: () => { (ctx as any).memoryIngest?.flushAll('manual') },
        afterChange: () => l3Worker?.kick(),
        audit: () => (ctx as any).audit,
      },
      // J13 recall engine card: read per request, so a config reload shows.
      engine: {
        bridge: () => (ctx as any).embeddingBridge,
        worker: () => l3Worker,
        config: () => ctx.config,
        captureActive: () => !!(ctx as any).memoryIngest,
      },
    })

    // Cap 6 morning briefing — latest reflection digest, rendered.
    const { requirePermission: requireMemPerm } = await import('@modules/permissions/middleware')
    ctx.http.get('/api/v1/memory/briefing', requireMemPerm('read', 'MemoryEntry'), (c: any) => {
      const latest = (ctx as any).reflectionDigests.latest()
      return c.json({ briefing: latest ? buildMorningBriefing(latest) : null, digest: latest })
    })

    // Fire-and-forget: embed vault/episodic rows missing a vector in the
    // legacy search index. Spec §4 L3 never embeds raw text when the local e5
    // path is on — those go through gist/fact vectors instead. The hashed
    // embedder and an embedding-tier provider still backfill the legacy
    // vault/episodic vec tables.
    if (embeddingService && legacyModelId !== E5_MODEL_ID) {
      void (async () => {
        try {
          for (;;) {
            const batch = await embeddingService!.backfill(200)
            if (batch.episodic + batch.vault === 0) break
            await new Promise<void>((r) => setTimeout(r, 0))
          }
        } catch { /* already logged inside */ }
      })()
    }

    // Start vault file watcher
    const { createVaultWatcher } = await import('./vault/vault-watcher.js')
    const vaultWatcher = createVaultWatcher(vaultDir, indexer, ctx.logger)
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

        // Plug the LLM summariser in when the model module is present so
        // phase 2 produces real vault notes instead of just invalidating rows.
        // It reaches a model only through the background model service, read
        // per call; with no eligible model a cluster is kept for a later run.
        let semanticPromoter
        try {
          if (ctx.auxiliaryModel) {
            semanticPromoter = createSemanticPromoter({
              get aux() {
                return ctx.auxiliaryModel
              },
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
          // D-7 / P-19 — a flagged episodic row is not clustered, not
          // summarised by the promoter, and not invalidated. It stays a valid
          // hidden row rather than being laundered into a recallable note.
          includeSecrets: recallIncludesSecrets(ctx.config),
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
    // Stop before the final flush: bootstrap closes the database after this,
    // so no drain may start from that flush. A running batch gets a bounded
    // wait; whatever it misses is embedded at the next start.
    const l3Worker = (ctx as any).memoryL3Worker as L3EmbedWorker | undefined
    if (l3Worker) {
      await Promise.race([
        l3Worker.stop().catch(() => {}),
        new Promise<void>((r) => { const t = setTimeout(r, 5_000); (t as any).unref?.() }),
      ])
    }
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

// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { EyasModule, ModuleContext } from '@core/types'
import { generateId } from '@shared/crypto'
import { createPipelineTables } from './schema.js'
import {
  createTicketToCodeOrchestrator,
  type TicketToCodeOrchestrator,
} from './orchestrator.js'
import type { PipelineDeps } from './port-types.js'
import type { StageName } from './types.js'
import { ticketToCodePipelineManifest } from './manifest.js'
import { createPrProviderFromConfig } from '../../ops/actions/pr-provider.js'
import { createBoardTicketSource } from './adapters/board-ticket-source.js'
import { createAgentRunnerPort } from './adapters/agent-runner-port.js'
import { createArtifactPort } from './adapters/artifact-port.js'
import { createPipelinePrClient } from './adapters/pipeline-pr-client.js'
import { createNoopCheckpoint } from './adapters/checkpoint-noop.js'

export * from './types.js'
export * from './port-types.js'
export {
  createTicketToCodeOrchestrator,
  PipelineNotFoundError,
  InvalidPipelineStateError,
  type TicketToCodeOrchestrator,
  type TicketToCodeOrchestratorOptions,
} from './orchestrator.js'
export { createPipelineTables } from './schema.js'
export { createTicketToCodeRoutes } from './routes.js'

/**
 * Factory for tests and alternative bootstraps: returns the orchestrator
 * given an EyasDb + assembled deps. The module object below uses this
 * under the hood but also wires up permissions and routes against the
 * full ModuleContext.
 */
export function createTicketToCodePipeline(
  db: import('@core/types').EyasDb,
  deps: PipelineDeps,
): TicketToCodeOrchestrator {
  return createTicketToCodeOrchestrator(db, deps)
}

export const ticketToCodePipelineModule: EyasModule = {
  ...ticketToCodePipelineManifest,

  async onRegister(ctx: ModuleContext) {
    createPipelineTables(ctx.db)

    try {
      ctx.permissions.registerSubject('Pipeline', {
        actions: ['read', 'create', 'approve', 'manage'],
        defaults: {
          owner: ['manage'],
          admin: ['manage'],
          user: ['read', 'create', 'approve'],
          agent: ['read', 'create'],
          guest: ['read'],
        },
      })
    } catch {
      // Already registered (hot-reload) — ignore.
    }

    ctx.logger.info('Ticket-to-code pipeline module registered')
  },

  async onStart(ctx: ModuleContext) {
    // Off by default (config.pipelines.ticketToCode.enabled=false). Honest
    // refusal, mirroring the ops.pr gate: stay fully inert (no ports built,
    // no routes mounted) until an operator opts in.
    const cfg = ctx.config.pipelines.ticketToCode
    if (!cfg.enabled) {
      ctx.logger.info(
        'Ticket-to-code pipeline disabled (config.pipelines.ticketToCode.enabled=false) — skipping.',
      )
      return
    }

    // GitOps PR provider — built from config + the 'pipeline-pr-token'
    // secret. null (unset provider/owner/repo, non-https baseUrl, or a
    // missing token) → the pipeline stays inert rather than mounting routes
    // it can't actually fulfil.
    const prProvider = await createPrProviderFromConfig(
      {
        provider: cfg.prProvider,
        baseUrl: cfg.prBaseUrl,
        owner: cfg.prOwner,
        repo: cfg.prRepo,
        baseBranch: cfg.prBaseBranch,
      },
      () => ctx.secrets.get('pipeline-pr-token', 'system'),
    )
    if (!prProvider) {
      ctx.logger.warn(
        'Ticket-to-code pipeline disabled: PR provider not fully configured ' +
          '(config.pipelines.ticketToCode.prProvider/prOwner/prRepo) or the ' +
          '"pipeline-pr-token" secret is missing.',
      )
      return
    }

    // Real ports over sibling modules. 'agent' and 'conversations' are hard
    // manifest dependencies (see manifest.ts) so ModuleLoader guarantees
    // they've already registered ctx.agents/ctx.conversations by the time
    // this onStart runs; 'artifacts' is also a hard dependency and its
    // onStart (which sets ctx.artifacts) runs before this one in the same
    // dependency-resolved order.
    const executeAgent = (ctx as any).agents?.executeAgent as
      | ((
          conversationId: string,
          agentId: string,
          task: string,
          opts?: { origin?: 'pipeline' | 'delegation' },
        ) => Promise<{ text: string; status: 'completed' | 'failed' | 'max_turns'; sessionId: string }>)
      | undefined
    const artifacts = (ctx as any).artifacts
    const conversations = ctx.conversations
    if (!executeAgent || !artifacts || !conversations) {
      ctx.logger.warn(
        'Ticket-to-code pipeline disabled: agent/artifacts/conversations modules not available ' +
          '— check module dependencies and load order.',
      )
      return
    }

    const assembledDeps: PipelineDeps = {
      ticketSource: createBoardTicketSource(conversations),
      agentRunner: createAgentRunnerPort({ executeAgent }),
      artifacts: createArtifactPort(artifacts),
      prClient: createPipelinePrClient(prProvider),
      checkpoint: createNoopCheckpoint(),
      logger: ctx.logger,
    }
    ;(ctx as any).pipelineDeps = assembledDeps

    // The real deps are now wired above from config + sibling modules. If
    // they're missing (e.g. this branch is skipped or a future refactor
    // clears ctx.pipelineDeps) we log and skip route registration — this
    // lets the module load in environments where the pipeline isn't enabled.
    const pipelineDeps = (ctx as any).pipelineDeps as PipelineDeps | undefined
    if (!pipelineDeps) {
      ctx.logger.warn(
        'Ticket-to-code pipeline skipped: ctx.pipelineDeps not provided. Attach ports via bootstrap to enable.',
      )
      return
    }

    const deps: PipelineDeps = {
      ...pipelineDeps,
      newId: pipelineDeps.newId ?? generateId,
      now: pipelineDeps.now ?? Date.now,
      logger: pipelineDeps.logger ?? ctx.logger,
    }

    const orchestrator = createTicketToCodeOrchestrator(ctx.db, deps, {
      defaultApprovalGates: cfg.approvalGates as Partial<Record<StageName, boolean>>,
    })
    ;(ctx as any).ticketToCodePipeline = orchestrator

    const { createTicketToCodeRoutes } = await import('./routes.js')
    createTicketToCodeRoutes(ctx.http, orchestrator, ctx.logger)

    ctx.logger.info('Ticket-to-code pipeline module started')
  },

  async onStop() {
    // No long-running workers to stop.
  },
}

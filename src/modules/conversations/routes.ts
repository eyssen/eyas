// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { Hono } from 'hono'
import { z } from 'zod'
import { HTTPException } from 'hono/http-exception'
import { requirePermission } from '@modules/permissions/middleware'
import type { ConversationService } from './conversation-service.js'
import type { ModelGateway, ContentBlock, ToolDefinition } from '@modules/model/types'
import type { ProviderConfigService } from '@modules/model/provider-config-service'
import type { DocumentService } from '@modules/documents/document-service'
import type { createAgentRunner, AgentEvent } from '@modules/agent/agent-runner'
import type { ToolRegistry } from '@modules/tools/tool-registry'
import type { DecisionEngine } from '@modules/model/routing/decision-engine'
import type { RoutingTier } from '@modules/model/routing/types'
import { registerPromptEnhancerRoute } from './prompt-enhancer-route.js'
import { registerPromptCoachRoute } from './prompt-coach-route.js'
import { resolveConversationSystemPrompt } from './system-prompt.js'
import { resolveThinkingAndEffort } from './thinking-resolver.js'
import { buildOrchestrationDirective } from './orchestration-directive.js'
import {
  buildTeamNudgeDirective,
  buildTeamProposeInFlightDirective,
  decideTeamAutoPropose,
  estimateMessageComplexity,
  fireTeamProposal,
  isActiveTeamStatus,
} from './team-auto-propose.js'
import { estimateCost, type PricingTable } from '@shared/model-pricing.js'
import { toolWorkspaceFields, validateWorkingDirectories } from '@modules/tools/working-directories.js'
import { listDirectories } from '@modules/tools/filesystem-browse.js'
import {
  generateConversationTitle,
  isUntitledTitle,
  planAutoTitle,
} from './auto-title.js'

/** Lightweight callback for memory lifecycle events during conversation turns */
export interface ConversationMemoryHooks {
  /** Called when the Claude Code SDK compacts its context — save summary to episodic memory */
  onContextCompact?(conversationId: string, summary: string): void
  /** Called after a full assistant turn — extract implicit facts from the exchange */
  onTurnComplete?(conversationId: string, userMessage: string, assistantMessage: string): void
  /** Called when episodic memories are accessed from a conversation — track cross-conversation usage */
  onMemoryAccessed?(conversationId: string, memoryIds: string[]): void
}

// D6 (F2 T2): PATCH validates ONLY the dangerous fields — a client-settable
// `status` whitelist plus the totalCostUsd strip below. Every other
// UPDATE_FIELD_MAP field keeps passing through unvalidated (matching the
// existing permissive style); `.passthrough()` is deliberate — adding
// `.strict()` here would reject those unrelated fields with 400.
// 'waiting_approval' is runner-owned (run-supervisor's park()) and every
// other conversation status is either system-driven or not client-facing —
// only the three a human legitimately sets from the UI are allowed.
const PatchConversationSchema = z.object({
  status: z.enum(['idle', 'waiting', 'archived']).optional(),
}).passthrough()

export interface ConversationRouteDeps {
  chatService: ConversationService
  gateway: ModelGateway
  configService?: ProviderConfigService
  getDocuments?: () => DocumentService | undefined
  getAgentRunner?: () => ReturnType<typeof createAgentRunner> | undefined
  getToolRegistry?: () => ToolRegistry | undefined
}

export function createConversationRoutes(
  app: Hono,
  chatService: ConversationService,
  gateway: ModelGateway,
  configService?: ProviderConfigService,
  getDocuments?: () => DocumentService | undefined,
  getAgentRunner?: () => ReturnType<typeof createAgentRunner> | undefined,
  getToolRegistry?: () => ToolRegistry | undefined,
  getDecisionEngine?: () => DecisionEngine | undefined,
  getAssembler?: () => import('@modules/prompt-wizard/assembler').PromptAssembler | undefined,
  getSkills?: () => { loader: { list(enabled?: boolean): any[] }; matcher: { match(query: string, skills: any[], maxResults?: number): { skill: { content: string; name: string }; matchScore: number }[] } } | undefined,
  memoryHooks?: ConversationMemoryHooks,
  getBoard?: () => {
    projects: {
      get?(id: string): {
        defaultAgentId: string | null
        indexedSources?: string[] | null
        workingDirectories?: string[] | null
      } | null
      getWithStages(id: string): {
        defaultAgentId: string | null
        indexedSources?: string[] | null
        workingDirectories?: string[] | null
        stages: { id: string; isClosed: boolean; sortOrder: number }[]
      } | null
    }
  } | undefined,
  /** F2 T9 — config `model.pricing` override for the interactive turn's cost estimate. */
  getPricingOverrides?: () => PricingTable | undefined,
  /**
   * Optional team auto-propose deps (agent orchestrator + team sessions).
   * Lazy: agent module may start after conversations route registration.
   */
  getTeamPropose?: () => import('./team-auto-propose.js').TeamProposeDeps | undefined,
): void {
  const router = app as any

  // Host directory picker for working-folder assignment (server-local paths).
  router.get('/api/v1/filesystem/browse', requirePermission('update', 'Conversation'), (c: any) => {
    try {
      return c.json(listDirectories(c.req.query('path')))
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      throw new HTTPException(400, { message })
    }
  })

  // ─── List Conversations ─────────────────────────
  router.get('/api/v1/conversations', requirePermission('read', 'Conversation'), async (c: any) => {
    const userId = c.get('userId') as string | undefined
    if (!userId) throw new HTTPException(401, { message: 'Authentication required' })

    // If parentId is specified, return children of that conversation.
    // Verify the parent belongs to the requesting user first (mirrors the
    // ownership guard on GET /:id) so sub-conversations can't be read via IDOR.
    const parentId = c.req.query('parentId')
    if (parentId) {
      const parent = chatService.get(parentId)
      if (!parent || parent.userId !== userId) throw new HTTPException(404, { message: 'Conversation not found' })
      const conversations = chatService.getChildren(parentId)
      return c.json({ conversations })
    }

    const status = c.req.query('status')
    const excludeArchived = c.req.query('active') === 'true'
    const conversations = chatService.list(userId, { status, excludeArchived })
    return c.json({ conversations })
  })

  // ─── Create Conversation ────────────────────────
  router.post('/api/v1/conversations', requirePermission('create', 'Conversation'), async (c: any) => {
    const userId = c.get('userId') as string | undefined
    if (!userId) throw new HTTPException(401, { message: 'Authentication required' })
    const body = await c.req.json().catch(() => ({}))
    let providerId = body.providerId
    let modelId = body.modelId
    // Determine routing tier — default "standard", but callers can request a specific tier
    const routingTier = body.routingTier || 'standard'
    if (!providerId) {
      // 1. Try the requested routing tier — this is what the user configured
      const engine = getDecisionEngine?.()
      if (engine) {
        const resolved = engine.resolveForTier(routingTier)
        if (resolved) {
          providerId = resolved.provider
          modelId = resolved.model
        }
      }
      // 2. Fall back to explicit default provider
      if (!providerId && configService) {
        const def = configService.getDefault()
        if (def) {
          providerId = def.providerId
          modelId = def.modelId
        }
      }
      // 3. Last resort: first active provider (skip host CLI providers)
      if (!providerId && configService) {
        const providers = configService.listProviders().filter(p => p.enabled && p.id !== 'claude-code' && p.id !== 'grok-cli' && p.id !== 'kimi-cli')
        for (const p of providers) {
          if (gateway.getProvider(p.id)) {
            providerId = p.id
            const models = configService.listEnabledModels(p.id)
            if (models.length > 0) modelId = models[0].id
            break
          }
        }
      }
    }
    const conversation = chatService.create({ userId, title: body.title, providerId, modelId })

    // Auto-assign to project (default: general-general) and first open stage
    const projectId = body.projectId || 'general-general'
    const updateFields: Record<string, unknown> = { projectId }

    // Resolve stage, agent, and code-search pin from project
    const board = getBoard?.()
    if (board) {
      const project = board.projects.getWithStages(projectId) as any
      if (project) {
        // Stage: use provided stageId, or first non-closed stage
        if (body.stageId) {
          updateFields.stageId = body.stageId
        } else if (project.stages.length) {
          const firstOpen = project.stages.find((s: any) => !s.isClosed) ?? project.stages[0]
          if (firstOpen) updateFields.stageId = firstOpen.id
        }
        // Agent: inherit from project default
        if (!body.agentId && project.defaultAgentId) {
          updateFields.agentId = project.defaultAgentId
        }
        // Code sources pin: project.indexedSources → conversation.searchContext
        if (body.searchContext === undefined) {
          const ids = project.indexedSources as string[] | null | undefined
          updateFields.searchContext = ids?.length ? { sourceIds: [...ids] } : null
        } else {
          updateFields.searchContext = body.searchContext
        }
        // Working directories: project list → conversation (first = primary cwd)
        if (body.workingDirectories === undefined) {
          const dirs = project.workingDirectories as string[] | null | undefined
          updateFields.workingDirectories = dirs?.length ? [...dirs] : null
        } else {
          const parsed = validateWorkingDirectories(body.workingDirectories)
          if (!parsed.ok) throw new HTTPException(400, { message: parsed.error })
          updateFields.workingDirectories = parsed.paths.length ? parsed.paths : null
        }
      }
    } else if (body.stageId) {
      updateFields.stageId = body.stageId
    }
    if (body.agentId) updateFields.agentId = body.agentId
    if (body.searchContext !== undefined && updateFields.searchContext === undefined) {
      updateFields.searchContext = body.searchContext
    }
    if (body.workingDirectories !== undefined && updateFields.workingDirectories === undefined) {
      const parsed = validateWorkingDirectories(body.workingDirectories)
      if (!parsed.ok) throw new HTTPException(400, { message: parsed.error })
      updateFields.workingDirectories = parsed.paths.length ? parsed.paths : null
    }

    chatService.update(conversation.id, updateFields)

    return c.json(chatService.get(conversation.id) ?? conversation, 201)
  })

  // ─── Get Conversation with Messages ─────────────
  router.get('/api/v1/conversations/:id', requirePermission('read', 'Conversation'), async (c: any) => {
    const userId = c.get('userId') as string | undefined
    if (!userId) throw new HTTPException(401, { message: 'Authentication required' })
    const conv = chatService.get(c.req.param('id'))
    if (!conv || conv.userId !== userId) throw new HTTPException(404, { message: 'Conversation not found' })
    return c.json(conv)
  })

  // ─── Update Conversation ────────────────────────
  router.patch('/api/v1/conversations/:id', requirePermission('update', 'Conversation'), async (c: any) => {
    const userId = c.get('userId') as string | undefined
    if (!userId) throw new HTTPException(401, { message: 'Authentication required' })
    const id = c.req.param('id')
    const conv = chatService.get(id)
    if (!conv || conv.userId !== userId) throw new HTTPException(404, { message: 'Conversation not found' })
    const body = await c.req.json()
    const parsed = PatchConversationSchema.safeParse(body)
    if (!parsed.success) {
      throw new HTTPException(400, { message: `Invalid status: ${parsed.error.flatten().fieldErrors.status?.join(', ') ?? 'validation failed'}` })
    }
    // teamSessionId is system-managed (stamped by teamSessionService.create() /
    // the orchestrator only) — strip any client-supplied value so a PATCH can't
    // forge a team-session association. totalCostUsd is likewise system-managed
    // (Task 9's cost producer) — a client PATCH must not be able to forge cost.
    delete body.teamSessionId
    delete body.totalCostUsd

    // When the project changes (and the client did not send an explicit
    // searchContext), adopt the project's default code-source pin.
    if (
      body.projectId !== undefined &&
      body.projectId !== conv.projectId &&
      body.searchContext === undefined
    ) {
      const board = getBoard?.()
      const project = body.projectId
        ? (board?.projects as any)?.get?.(body.projectId)
          ?? (board?.projects as any)?.getWithStages?.(body.projectId)
        : null
      const ids = project?.indexedSources as string[] | null | undefined
      body.searchContext = ids?.length ? { sourceIds: [...ids] } : null
    }

    // Project change always adopts the new project's working directories
    // unless the same PATCH sends an explicit list.
    if (
      body.projectId !== undefined &&
      body.projectId !== conv.projectId &&
      body.workingDirectories === undefined
    ) {
      const board = getBoard?.()
      const project = body.projectId
        ? (board?.projects as any)?.get?.(body.projectId)
          ?? (board?.projects as any)?.getWithStages?.(body.projectId)
        : null
      const dirs = project?.workingDirectories as string[] | null | undefined
      body.workingDirectories = dirs?.length ? [...dirs] : null
    } else if (body.workingDirectories !== undefined) {
      const parsed = validateWorkingDirectories(body.workingDirectories)
      if (!parsed.ok) throw new HTTPException(400, { message: parsed.error })
      body.workingDirectories = parsed.paths.length ? parsed.paths : null
    }

    chatService.update(id, body)
    return c.json(chatService.get(id))
  })

  // ─── Soft Delete ────────────────────────────────
  router.delete('/api/v1/conversations/:id', requirePermission('delete', 'Conversation'), async (c: any) => {
    const userId = c.get('userId') as string | undefined
    if (!userId) throw new HTTPException(401, { message: 'Authentication required' })
    const id = c.req.param('id')
    const conv = chatService.get(id)
    if (!conv || conv.userId !== userId) throw new HTTPException(404, { message: 'Conversation not found' })
    chatService.softDelete(id)
    return c.json({ message: 'Conversation deleted' })
  })

  // ─── Send Message + Stream Response ─────────────
  router.post('/api/v1/conversations/:id/messages', requirePermission('create', 'ConversationMessage'), async (c: any) => {
    const userId = c.get('userId') as string | undefined
    if (!userId) throw new HTTPException(401, { message: 'Authentication required' })

    const id = c.req.param('id')
    const conv = chatService.get(id)
    if (!conv || conv.userId !== userId) throw new HTTPException(404, { message: 'Conversation not found' })

    let body: any
    try {
      body = await c.req.json()
    } catch {
      throw new HTTPException(400, { message: 'Invalid JSON body' })
    }
    const attachmentIds: string[] = Array.isArray(body.attachmentIds) ? body.attachmentIds : []
    if (!body.content && attachmentIds.length === 0) {
      throw new HTTPException(400, { message: 'content or attachmentIds required' })
    }

    // Route to optimal provider+model via decision engine
    const decisionEngine = getDecisionEngine?.()
    let providerId: string
    let modelId: string
    let routingInfo: { tier?: string; strategy?: string; reason?: string } = {}
    // Set ONLY when the decision engine picked the provider — it is the
    // gateway's licence to fail over to the tier's fallback provider (D10).
    // A hand-pinned provider stays unstamped and is never swapped.
    let routedTier: RoutingTier | undefined

    if (decisionEngine && !body.provider) {
      // Auto-routing: decision engine picks the best model
      const messageText = body.content || ''
      const decision = await decisionEngine.route(messageText)
      providerId = decision.provider
      modelId = decision.model
      routedTier = decision.tier
      routingInfo = { tier: decision.tier, strategy: decision.strategy, reason: decision.reason }
    } else {
      // Manual override or no decision engine
      providerId = body.provider || conv.providerId
      modelId = body.model || conv.modelId
    }

    if (!providerId || !modelId) {
      throw new HTTPException(400, { message: 'No provider/model configured and auto-routing unavailable' })
    }

    // Verify provider is available
    const provider = gateway.getProvider(providerId)
    if (!provider) {
      throw new HTTPException(400, { message: `Provider "${providerId}" is not active` })
    }

    // Resolve documents service lazily (may have started after conversations)
    const documents = getDocuments?.()

    // Link attachments to conversation via documents service
    if (documents && attachmentIds.length > 0) {
      for (const docId of attachmentIds) {
        try { documents.link(docId, 'conversations', id, 'user') } catch { /* ignore if already linked */ }
      }
    }

    // Save user message with attachments
    chatService.addMessage(id, { role: 'user', content: body.content || '', attachmentIds: attachmentIds.length > 0 ? attachmentIds : undefined })
    chatService.update(id, { status: 'working' })

    // Build message history with multimodal content for attachments
    const fullConv = chatService.get(id)!

    // First-turn title: if still Untitled / Névtelen, name it from this request.
    // Persist the snippet immediately so a dropped stream still leaves a name;
    // a cheap-tier model may refine it in the background without blocking.
    const userText = typeof body.content === 'string' ? body.content : ''
    const fallbackTitle = planAutoTitle(fullConv.title, userText)
    let refineTitle: Promise<string> | null = null
    if (fallbackTitle) {
      try { chatService.update(id, { title: fallbackTitle }) } catch { /* non-fatal */ }
      refineTitle = generateConversationTitle({
        ctx: { model: gateway, decisionEngine: getDecisionEngine?.() },
        userMessage: userText,
      })
    }

    const messages: Array<{ role: 'user' | 'assistant'; content: string | ContentBlock[] }> = []
    for (const m of fullConv.messages) {
      if (m.attachmentIds.length === 0 || !documents) {
        // Skip messages with empty content (Anthropic rejects empty text blocks with cache_control)
        if (m.content) {
          messages.push({ role: m.role as 'user' | 'assistant', content: m.content })
        }
        continue
      }

      // Build multimodal content blocks
      const blocks: ContentBlock[] = []

      for (const docId of m.attachmentIds) {
        const doc = documents.getById(docId)
        if (doc && doc.mimeType.startsWith('image/')) {
          try {
            const result = await documents.download(docId)
            if (result) {
              const chunks: Uint8Array[] = []
              const reader = result.data.getReader()
              while (true) {
                const { done, value } = await reader.read()
                if (done) break
                if (value) chunks.push(value)
              }
              const buffer = Buffer.concat(chunks)
              blocks.push({
                type: 'image',
                source: { type: 'base64', mediaType: doc.mimeType, data: buffer.toString('base64') },
              })
            }
          } catch { /* skip unreadable attachments */ }
        }
      }

      if (m.content) {
        blocks.push({ type: 'text', text: m.content })
      }

      // Only push if we have actual content blocks (skip empty messages)
      if (blocks.length > 0) {
        messages.push({
          role: m.role as 'user' | 'assistant',
          content: blocks,
        })
      }
    }

    // Merge consecutive same-role messages (Anthropic requires alternating user/assistant)
    // Also filter out empty text blocks (Anthropic rejects cache_control on empty text)
    const mergedMessages: typeof messages = []
    for (const msg of messages) {
      const prev = mergedMessages[mergedMessages.length - 1]
      if (prev && prev.role === msg.role) {
        const prevBlocks: ContentBlock[] = typeof prev.content === 'string'
          ? [{ type: 'text', text: prev.content }]
          : prev.content
        const currBlocks: ContentBlock[] = typeof msg.content === 'string'
          ? [{ type: 'text', text: msg.content }]
          : msg.content
        prev.content = [...prevBlocks, ...currBlocks]
      } else {
        mergedMessages.push({ ...msg })
      }
    }
    // Strip empty text blocks from all messages
    for (const msg of mergedMessages) {
      if (Array.isArray(msg.content)) {
        msg.content = (msg.content as ContentBlock[]).filter(
          (b) => b.type !== 'text' || (b as any).text?.trim()
        )
        // If all blocks were empty, add a placeholder
        if (msg.content.length === 0) {
          msg.content = '...'
        }
      }
    }

    // Resolve agent runner and tools (lazy — may not be available yet)
    const agentRunner = getAgentRunner?.()
    const toolRegistry = getToolRegistry?.()

    // Build tool definitions for model — all enabled tools available to conversation
    const tools: ToolDefinition[] = toolRegistry?.toToolDefinitions() ?? []

    // Build system prompt via PromptAssembler (Task 29 wiring).
    // body.system still wins; otherwise assemble from the conversation's agent.
    let system = await resolveConversationSystemPrompt({
      bodySystem: body.system,
      assembler: getAssembler?.(),
      agentId: (conv as any).agentId ?? null,
      projectId: (conv as any).projectId ?? null,
      conversationId: id,
      fallbackAgentId: () =>
        getBoard?.()?.projects.getWithStages((conv as any).projectId ?? '')?.defaultAgentId ?? null,
    })

    // Skill injection — match conversation messages against skill trigger patterns
    // Check all user messages (not just current) so the skill stays active throughout
    let activeSkill = false
    try {
      const skillsService = getSkills?.()
      if (skillsService) {
        const enabledSkills = skillsService.loader.list(true)
        // Combine all user messages for matching
        const allUserText = conv.messages
          .filter((m: any) => m.role === 'user')
          .map((m: any) => m.content)
          .join(' ')
        const combinedText = `${allUserText} ${body.content || ''}`
        const matches = skillsService.matcher.match(combinedText, enabledSkills, 1)
        if (matches.length > 0 && matches[0].matchScore > 0.1) {
          activeSkill = true
          system = system
            ? `${system}\n\n## Active Skill: ${matches[0].skill.name}\n\n${matches[0].skill.content}`
            : `## Active Skill: ${matches[0].skill.name}\n\n${matches[0].skill.content}`
        }
      }
    } catch {
      // Skill matching failure is non-fatal
    }

    // When a skill is active, disable tools — skills are pure conversation, no tool use
    if (activeSkill) {
      tools.length = 0
    }

    // Resolve thinking + effort + orchestration config from conversation
    const orchestrationMode = (((conv as any).orchestration ?? 'auto') as 'solo' | 'auto' | 'deep')
    const { thinking: thinkingConfig, effort: effortLevel } = resolveThinkingAndEffort({
      thinking: (conv as any).thinking,
      thinkingBudget: (conv as any).thinkingBudget,
      effort: (conv as any).effort,
      orchestration: orchestrationMode,
    })
    const orchestrationDirective = buildOrchestrationDirective(orchestrationMode, providerId)
    if (orchestrationDirective) {
      system = system ? `${system}\n\n${orchestrationDirective}` : orchestrationDirective
    }

    // ── First-turn team auto-propose / soft nudge ──────────────────────────
    // Does not block the agent stream. Complex first messages (or deep mode)
    // fire analyzeAndPropose in the background → TeamProposalCard via WS.
    // User still must Approve. Solo orchestration is a hard no-op.
    {
      const messageText = body.content || ''
      const userMessageCount = fullConv.messages.filter((m: any) => m.role === 'user').length
      const complexity =
        ((conv as any).complexity as string | null | undefined) ||
        estimateMessageComplexity(messageText)

      // Persist triage complexity when the conversation has none yet.
      if (!(conv as any).complexity && complexity) {
        try {
          chatService.update(id, { complexity })
        } catch {
          /* non-fatal */
        }
      }

      const teamDeps = getTeamPropose?.()
      const hasActiveTeamSession = teamDeps
        ? teamDeps.teamSessions
            .listByConversation(id)
            .some((s) => isActiveTeamStatus(s.status))
        : !!(conv as any).teamSessionId

      const teamDecision = decideTeamAutoPropose({
        orchestration: orchestrationMode,
        userMessageCount,
        complexity,
        hasActiveTeamSession,
        message: messageText,
      })

      if (teamDecision.action === 'propose' && teamDeps) {
        void fireTeamProposal(teamDeps, id, messageText || 'User task', teamDecision.complexity)
        const inflight = buildTeamProposeInFlightDirective()
        system = system ? `${system}\n\n${inflight}` : inflight
      } else if (teamDecision.action === 'nudge' || (teamDecision.action === 'propose' && !teamDeps)) {
        // Nudge path, or propose desired but agent module not ready → steer the model.
        const nudge = buildTeamNudgeDirective(teamDecision.complexity, teamDecision.reason)
        system = system ? `${system}\n\n${nudge}` : nudge
      }
    }

    // Host CLI providers (Claude Code / Grok CLI): pass sessionId for continuity
    const sdkSessionId =
      providerId === 'claude-code' || providerId === 'grok-cli' || providerId === 'kimi-cli'
        ? (conv as any).sdkSessionId
        : undefined

    // Fix round 1 (Important 4) — the Claude Code SDK's `total_cost_usd` is
    // SESSION-CUMULATIVE, not per-turn, when a run resumes a prior session:
    // on `--resume` the CLI seeds its running cost total from the session's
    // last saved total before adding this turn's own spend, and persists the
    // new cumulative total back for the next resume (verified against the
    // bundled Claude Agent SDK CLI's session-state restore/save functions —
    // there is no per-turn-only total exposed alongside it). Since addRunCost
    // ADDS its `costUsd` argument on every turn, trusting a session-cumulative
    // number here would compound: turn 2's "cost" already includes turn 1's,
    // and it gets added on top of what turn 1 already wrote. This is a REAL
    // risk only when a session is actually being resumed — a fresh session's
    // first turn has nothing to seed from, so its total_cost_usd is honestly
    // this turn's own spend. Gate accordingly: on a resumed claude-code
    // session, always re-derive this turn's cost from its own token counts
    // instead of trusting `usage.costUsd`.
    const claudeCodeSessionWasResumed = providerId === 'claude-code' && Boolean(sdkSessionId)

    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        const send = (data: string) => controller.enqueue(encoder.encode(`data: ${data}\n\n`))
        if (fallbackTitle) {
          send(JSON.stringify({ type: 'title', title: fallbackTitle }))
        }
        if (refineTitle) {
          void refineTitle.then((title) => {
            if (!title) return
            const latest = chatService.get(id)
            if (!latest) return
            const stillOurs = isUntitledTitle(latest.title) || latest.title === fallbackTitle
            if (!stillOurs) return
            if (title !== latest.title) {
              try { chatService.update(id, { title }) } catch { /* non-fatal */ }
            }
            try { send(JSON.stringify({ type: 'title', title })) } catch { /* stream already closed */ }
          })
        }
        try {
          let fullText = ''
          let totalIn = 0
          let totalOut = 0
          // F2 T9 (R3/R7) — direct per-turn costUsd (CLI-authoritative) wins
          // over the table estimate computed at 'done' from totalIn/totalOut.
          let directCostUsd: number | undefined

          if (agentRunner) {
            // ── Full pipeline: tools + security gate (system prompt built by assembler above) ──
            const runOptions = {
              messages: mergedMessages,
              tools,
              system: system || undefined,
              maxTurns: 10,
              provider: providerId,
              model: modelId,
              thinking: thinkingConfig,
              effort: effortLevel,
              orchestration: orchestrationMode,
              conversationId: id,
              toolContext: {
                conversationId: id,
                userId,
                logger: undefined as any,
                teamSessionId: conv.teamSessionId ?? undefined,
                agentId: conv.agentId ?? undefined,
                ...toolWorkspaceFields(conv.workingDirectories),
                // The executor authorizes against this identity — forward the
                // real authenticated caller, not a fabricated one.
                actor: {
                  kind: 'user' as const,
                  role: (c.get('role') as string | undefined) ?? 'guest',
                  ability: c.get('ability') as { can(action: string, subject: string): boolean } | undefined,
                },
              },
              metadata: {
                conversationId: id,
                userId,
                agentId: conv.agentId ?? undefined,
                teamSessionId: conv.teamSessionId ?? undefined,
                // F0 R4 — a human is driving this conversation via the chat
                // route. teamSessionId (when present) still wins autonomous
                // classification, so do NOT add autonomous:false here.
                origin: 'interactive' as const,
                tier: routedTier,
              },
            }

            // Arm the chat-rail agent progress panel (AgentProgress +
            // ToolCallDisplay) — without this frame the tool-call UI never
            // initializes and per-tool progress is lost after streaming.
            send(JSON.stringify({ type: 'agent_start', agentName: (conv as any).agentId ?? 'Assistant', maxTurns: 10 }))

            for await (const event of agentRunner.run(runOptions)) {
              switch (event.type) {
                case 'text':
                  fullText += event.text
                  send(JSON.stringify(event))
                  break
                case 'thinking':
                  send(JSON.stringify(event))
                  break
                case 'tool_use_start':
                  send(JSON.stringify({ type: 'tool_use', name: (event as any).name, id: (event as any).id }))
                  break
                case 'tool_use_end':
                  send(JSON.stringify({ type: 'tool_use_end' }))
                  break
                case 'tool_result':
                  send(JSON.stringify({
                    type: 'tool_result',
                    toolUseId: (event as any).toolUseId,
                    output: (event as any).content,
                    error: (event as any).isError ? (event as any).content : undefined,
                    durationMs: (event as any).durationMs,
                  }))
                  break
                case 'turn_complete':
                  // Fix round 1 (Important 3) — `tokensUsed` is the COMBINED
                  // input+output scalar (agent-runner.ts sums them for the
                  // legacy field); accumulating it into `totalIn` and then
                  // ALSO adding the final turn's outputTokens again at 'done'
                  // billed that turn's output twice. Split from `usage`
                  // (F2 T9's addition to turn_complete) instead.
                  totalIn += (event as any).usage?.inputTokens ?? 0
                  totalOut += (event as any).usage?.outputTokens ?? 0
                  if ((event as any).usage?.costUsd !== undefined) {
                    directCostUsd = (directCostUsd ?? 0) + (event as any).usage.costUsd
                  }
                  send(JSON.stringify({ type: 'turn_complete', turn: (event as any).turn, tokensUsed: (event as any).tokensUsed }))
                  break
                case 'max_turns_reached':
                  send(JSON.stringify({ type: 'max_turns_reached', turns: (event as any).turns }))
                  break
                // F2 T5 — an interactive run never parks (the runner parks only
                // autonomous + supervised runs), but a runner event this switch
                // drops silently is exactly how F1's dead frames happened: if it
                // ever arrives, forward it rather than losing the run's ending.
                case 'parked_for_approval':
                  chatService.update(id, { status: 'waiting_approval' })
                  send(JSON.stringify({
                    type: 'parked_for_approval',
                    approvalId: (event as any).approvalId,
                    toolName: (event as any).toolName,
                  }))
                  break
                case 'done': {
                  const doneEvent = event as any
                  // Use the accumulated turn_complete split; fall back to the
                  // final response's own usage ONLY if no turn_complete ever
                  // contributed (defensive — every turn that reaches 'done'
                  // fires its own turn_complete first in practice). Fix round
                  // 1 (Important 3): do NOT also add the final response's
                  // outputTokens here — turn_complete already counted it,
                  // and doing both double-billed the last turn's output.
                  if (totalIn === 0 && totalOut === 0) {
                    totalIn = doneEvent.response?.usage?.inputTokens ?? 0
                    totalOut = doneEvent.response?.usage?.outputTokens ?? 0
                  }

                  // Save SDK session ID for conversation continuity
                  if (doneEvent.response?.sessionId) {
                    chatService.update(id, { sdkSessionId: doneEvent.response.sessionId })
                  }

                  const saved = chatService.addMessage(id, {
                    role: 'assistant',
                    content: fullText,
                    model: modelId,
                    provider: providerId,
                    tokensIn: totalIn,
                    tokensOut: totalOut,
                  })
                  chatService.update(id, { status: 'idle' })
                  // F2 T9 (R7) — one estimate per message turn. `tokens` is
                  // OMITTED here: addMessage (above) already incremented
                  // tokens_used via tokensIn/tokensOut for this same turn, so
                  // passing it too would double-count.
                  chatService.addRunCost(id, {
                    costUsd: directCostUsd ?? estimateCost(providerId, modelId, { inputTokens: totalIn, outputTokens: totalOut }, getPricingOverrides?.()),
                  })
                  const updatedConv = chatService.get(id)!
                  send(JSON.stringify({ type: 'done', message: saved, conversation: { tokensUsed: updatedConv.tokensUsed, status: 'idle' } }))
                  break
                }
                case 'error':
                  chatService.update(id, { status: 'idle' })
                  send(JSON.stringify({ type: 'error', error: (event as any).error?.message ?? 'Unknown error' }))
                  break
              }
            }

            // If agent runner finished without a 'done' event (tool-use loop exhausted), save what we have
            if (fullText && totalIn === 0) {
              const saved = chatService.addMessage(id, {
                role: 'assistant',
                content: fullText,
                model: modelId,
                provider: providerId,
                tokensIn: 0,
                tokensOut: 0,
              })
              chatService.update(id, { status: 'idle' })
              const updatedConv = chatService.get(id)!
              send(JSON.stringify({ type: 'done', message: saved, conversation: { tokensUsed: updatedConv.tokensUsed, status: 'idle' } }))
            }
          } else {
            // ── Fallback: direct gateway streaming (no tools/memory/skills) ──
            const streamRequest: any = {
              provider: providerId,
              model: modelId,
              messages: mergedMessages,
              thinking: thinkingConfig,
              effort: effortLevel,
              orchestration: orchestrationMode,
              metadata: {
                conversationId: id,
                userId,
                agentId: conv.agentId ?? undefined,
                teamSessionId: conv.teamSessionId ?? undefined,
                ...toolWorkspaceFields(conv.workingDirectories),
                // F0 R4 — same rationale as the full-pipeline branch above.
                origin: 'interactive' as const,
                tier: routedTier,
              },
            }
            if (sdkSessionId) streamRequest.sessionId = sdkSessionId
            if (system) streamRequest.system = system

            for await (const event of gateway.stream(streamRequest)) {
              if (event.type === 'text') {
                fullText += event.text
                send(JSON.stringify(event))
              } else if (event.type === 'thinking') {
                send(JSON.stringify(event))
              } else if (event.type === 'context_compact') {
                // PreCompact: save context summary to episodic memory before Claude Code compresses
                try { memoryHooks?.onContextCompact?.(id, (event as any).summary) } catch { /* non-fatal */ }
              } else if (event.type === 'tool_use_start') {
                send(JSON.stringify({ type: 'tool_use', name: event.name, id: event.id }))
              } else if (event.type === 'tool_use_end') {
                send(JSON.stringify({ type: 'tool_use_end' }))
              } else if (event.type === 'done') {
                totalIn = event.response.usage.inputTokens
                totalOut = event.response.usage.outputTokens
                if (event.response.sessionId) {
                  chatService.update(id, { sdkSessionId: event.response.sessionId })
                }
                const saved = chatService.addMessage(id, {
                  role: 'assistant',
                  content: fullText,
                  model: modelId,
                  provider: providerId,
                  tokensIn: totalIn,
                  tokensOut: totalOut,
                })
                chatService.update(id, { status: 'idle' })
                // F2 T9 (R3/R7) — `usage.costUsd` (CLI-authoritative) wins
                // over the table estimate; `tokens` omitted (addMessage above
                // already incremented tokens_used for this turn). Fix round 1
                // (Important 4) — EXCEPT on a resumed claude-code session,
                // where `costUsd` is cumulative for the whole session, not
                // this turn: re-derive from this turn's own token counts there.
                chatService.addRunCost(id, {
                  costUsd: (!claudeCodeSessionWasResumed && event.response.usage.costUsd !== undefined)
                    ? event.response.usage.costUsd
                    : estimateCost(providerId, modelId, { inputTokens: totalIn, outputTokens: totalOut }, getPricingOverrides?.()),
                })
                const updatedConv = chatService.get(id)!
                send(JSON.stringify({ type: 'done', message: saved, conversation: { tokensUsed: updatedConv.tokensUsed, status: 'idle' } }))
              } else if (event.type === 'error') {
                chatService.update(id, { status: 'idle' })
                send(JSON.stringify({ type: 'error', error: event.error.message }))
              }
            }
          }

          // ── Post-turn memory hooks ──
          // Fire-and-forget: extract implicit facts from the completed exchange
          if (fullText && memoryHooks?.onTurnComplete) {
            try {
              const userContent = typeof body.content === 'string' ? body.content : ''
              memoryHooks.onTurnComplete(id, userContent, fullText)
            } catch { /* non-fatal */ }
          }
        } catch (err: any) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', error: err.message })}\n\n`))
        } finally {
          // Always reset to idle — prevents conversations from getting stuck in 'working' state
          // when SDK timeouts, max turns, or connection drops occur without a clean 'done' event
          try { chatService.update(id, { status: 'idle' }) } catch { /* best effort */ }
        }
        controller.close()
      },
    })

    return new Response(stream, {
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
    })
  })

  // ─── Voice Scope Override ────────────────────────────
  router.put('/api/v1/conversations/:id/voice-scope', requirePermission('update', 'Conversation'), async (c: any) => {
    const userId = c.get('userId') as string | undefined
    if (!userId) throw new HTTPException(401, { message: 'Authentication required' })
    const id = c.req.param('id')
    const conv = chatService.get(id)
    if (!conv || conv.userId !== userId) throw new HTTPException(404, { message: 'Conversation not found' })
    let body: { scope?: 'internal' | 'external' | null }
    try {
      body = await c.req.json()
    } catch {
      throw new HTTPException(400, { message: 'Invalid JSON body' })
    }
    const { scope } = body
    if (scope !== null && scope !== undefined && scope !== 'internal' && scope !== 'external') {
      throw new HTTPException(400, { message: 'scope must be "internal", "external", or null' })
    }
    chatService.update(id, { voiceScopeOverride: scope === undefined ? null : scope })
    return c.json({ ok: true })
  })

  // Prompt Enhancer sub-conversation bootstrap route.
  registerPromptEnhancerRoute(app, chatService, getDecisionEngine)
  // Scoped coaches for project / project-type / agent system prompts.
  registerPromptCoachRoute(app, chatService, getDecisionEngine)
}

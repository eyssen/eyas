// Part of eYssen. See LICENSE file for full copyright and licensing details.

/**
 * Shared cheap-tier, fail-open model pass.
 *
 * This is the ONLY place cost caps and fail-open behaviour live for the
 * Phase-3 self-improvement loops (heartbeat composer, reflection enrichment,
 * forge/skill/self-learning authoring). It mirrors the proven reference in
 * memory/consolidator/semantic-promoter.ts:
 *   1. Resolve the 'heartbeat' routing tier (best-effort, try/catch).
 *   2. Call the model gateway with the resolved provider/model, if any.
 *   3. Extract the response text.
 *   4. On ANY failure — missing model, a thrown error, or empty output —
 *      log a warning and return the caller's deterministic fallback.
 * Never throws.
 */

import type { Logger } from 'pino'
import type { ModelGateway } from './types.js'

/**
 * Structural subset of a module context/deps object a cheap pass needs.
 * Any module's ModuleContext (or its own narrower deps type, e.g. forge's
 * ProposalEngineDeps) satisfies this as long as it carries `model` and,
 * optionally, `logger`. `decisionEngine` is deliberately left off this type
 * — it's an ad-hoc ctx property (see model/index.ts), so it's read via a
 * cast, same as the semantic promoter does.
 */
export interface CheapModelPassContext {
  model?: Pick<ModelGateway, 'complete'>
  logger?: Logger
}

export interface CheapModelPassOptions {
  system: string
  user: string
  maxTokens?: number
  temperature?: number
  fallback: string
}

/**
 * Extract text from a gateway response. ModelResponse.content is a
 * ContentBlock[] array (no `.text` field) — join the text blocks, the same
 * way the semantic promoter / reflection summariser do. A plain `.text`
 * string (some fakes/providers) is honoured as a fallback.
 */
function extractResponseText(resp: any): string {
  if (Array.isArray(resp?.content)) {
    return resp.content.map((b: any) => (b?.type === 'text' ? b.text : '')).join('\n')
  }
  if (typeof resp?.text === 'string') return resp.text
  return String(resp?.content ?? '')
}

/**
 * Run one cheap ('heartbeat' tier), fail-open model pass. Returns
 * `opts.fallback` on a missing model, a thrown error, or empty output.
 * NEVER throws.
 */
export async function runCheapModelPass(ctx: CheapModelPassContext, opts: CheapModelPassOptions): Promise<string> {
  const { system, user, maxTokens = 200, temperature = 0.4, fallback } = opts

  if (!ctx.model?.complete) return fallback

  let resolved: { provider: string; model: string } | null = null
  try {
    resolved = (ctx as any).decisionEngine?.resolveForTier('heartbeat') ?? null
  } catch {
    // decision engine not configured — fall back to gateway defaults
  }

  try {
    const resp = await ctx.model.complete({
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      maxTokens,
      temperature,
      ...(resolved ? { provider: resolved.provider, model: resolved.model } : {}),
    } as any)
    const text = extractResponseText(resp)
    if (!text.trim()) {
      ctx.logger?.warn('runCheapModelPass: empty model output, falling back')
      return fallback
    }
    return text
  } catch (err) {
    ctx.logger?.warn({ err: String(err) }, 'runCheapModelPass: model.complete failed, falling back')
    return fallback
  }
}

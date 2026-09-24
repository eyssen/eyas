// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { Attributes, Span, Tracer } from '../types.js'

export interface AgentRunContext {
  agentId: string
  agentName?: string
  sessionId?: string
  turn?: number
  userId?: string
}

/**
 * Wrap an agent run in a root span. Returns the wrapped function.
 *
 * Wire up: in `src/modules/agent/*` when the agent runtime starts a turn,
 * replace `run(ctx, ...)` with `instrumentAgentRun(tracer)(run)(ctx, ...)`.
 * We deliberately do NOT modify the agent module source here — integration
 * is a future task, documented in the module README.
 */
export function instrumentAgentRun(
  tracer: Tracer,
) {
  return function wrap<Args extends unknown[], R>(
    fn: (ctx: AgentRunContext, ...args: Args) => Promise<R>,
  ): (ctx: AgentRunContext, ...args: Args) => Promise<R> {
    return (ctx, ...args) => {
    return Promise.resolve(
      tracer.startActiveSpan(
        `agent.run ${ctx.agentName ?? ctx.agentId}`,
        {
          kind: 'INTERNAL',
          attributes: agentAttributes(ctx),
        },
        async (span: Span) => {
          const result = await fn(ctx, ...args)
          span.setStatus({ code: 'OK' })
          return result
        },
      ),
    ) as Promise<R>
    }
  }
}

export function agentAttributes(ctx: AgentRunContext): Attributes {
  const attrs: Attributes = { 'eyas.agent.id': ctx.agentId }
  if (ctx.agentName) attrs['eyas.agent.name'] = ctx.agentName
  if (ctx.sessionId) attrs['eyas.session.id'] = ctx.sessionId
  if (typeof ctx.turn === 'number') attrs['eyas.turn'] = ctx.turn
  if (ctx.userId) attrs['eyas.user.id'] = ctx.userId
  return attrs
}

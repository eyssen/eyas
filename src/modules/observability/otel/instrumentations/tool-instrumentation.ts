// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { Attributes, Span, Tracer } from '../types.js'

export interface ToolCallContext {
  toolName: string
  riskTier?: 'safe' | 'moderate' | 'sensitive' | 'critical'
  argsSummary?: string
  callId?: string
}

/**
 * Wrap a tool invocation in a child span. The span becomes a child of the
 * active agent span via AsyncLocalStorage — no manual parent plumbing.
 *
 * Wire up: in `src/modules/tools/*` around `executeTool(...)`. See README.
 */
export function instrumentToolCall(tracer: Tracer) {
  return function wrap<Args extends unknown[], R>(
    fn: (ctx: ToolCallContext, ...args: Args) => Promise<R>,
  ): (ctx: ToolCallContext, ...args: Args) => Promise<R> {
    return (ctx, ...args) => {
    return Promise.resolve(
      tracer.startActiveSpan(
        `tool.${ctx.toolName}`,
        {
          kind: 'INTERNAL',
          attributes: toolAttributes(ctx),
        },
        async (span: Span) => {
          const started = Date.now()
          try {
            const result = await fn(ctx, ...args)
            span.setAttribute('eyas.tool.result', 'success')
            span.setAttribute('eyas.tool.duration_ms', Date.now() - started)
            span.setStatus({ code: 'OK' })
            return result
          } catch (err) {
            span.setAttribute('eyas.tool.result', 'error')
            span.recordException(err)
            span.setStatus({ code: 'ERROR', message: String((err as Error)?.message ?? err) })
            throw err
          }
        },
      ),
    ) as Promise<R>
    }
  }
}

export function toolAttributes(ctx: ToolCallContext): Attributes {
  const attrs: Attributes = { 'eyas.tool.name': ctx.toolName }
  if (ctx.riskTier) attrs['eyas.tool.risk_tier'] = ctx.riskTier
  if (ctx.argsSummary) attrs['eyas.tool.args_summary'] = ctx.argsSummary
  if (ctx.callId) attrs['eyas.tool.call_id'] = ctx.callId
  return attrs
}

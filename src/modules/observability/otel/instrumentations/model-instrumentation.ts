// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { Attributes, Span, Tracer } from '../types.js'

export interface ModelCallContext {
  provider: string // 'anthropic' | 'openai' | 'google' | 'ollama' | ...
  model: string
  operation?: 'chat' | 'embed' | 'completion'
  streaming?: boolean
}

export interface ModelCallUsage {
  inputTokens?: number
  outputTokens?: number
  cachedInputTokens?: number
  reasoningTokens?: number
  costUsd?: number
}

/**
 * Wrap a model (LLM/embedding) call in a child span. Usage is reported
 * back via the `reportUsage` callback given to the wrapped function.
 *
 * Wire up: in `src/modules/model/providers/*` where `call()` invokes
 * the SDK. See README.
 */
export function instrumentModelCall(tracer: Tracer) {
  return function wrap<Args extends unknown[], R>(
    fn: (
      ctx: ModelCallContext,
      reportUsage: (u: ModelCallUsage) => void,
      ...args: Args
    ) => Promise<R>,
  ): (ctx: ModelCallContext, ...args: Args) => Promise<R> {
    return (ctx, ...args) => {
    return Promise.resolve(
      tracer.startActiveSpan(
        `model.${ctx.operation ?? 'chat'} ${ctx.provider}/${ctx.model}`,
        {
          kind: 'CLIENT',
          attributes: modelAttributes(ctx),
        },
        async (span: Span) => {
          const report = (u: ModelCallUsage) => {
            if (u.inputTokens !== undefined) span.setAttribute('eyas.model.usage.input_tokens', u.inputTokens)
            if (u.outputTokens !== undefined) span.setAttribute('eyas.model.usage.output_tokens', u.outputTokens)
            if (u.cachedInputTokens !== undefined) span.setAttribute('eyas.model.usage.cached_input_tokens', u.cachedInputTokens)
            if (u.reasoningTokens !== undefined) span.setAttribute('eyas.model.usage.reasoning_tokens', u.reasoningTokens)
            if (u.costUsd !== undefined) span.setAttribute('eyas.model.usage.cost_usd', u.costUsd)
          }
          try {
            const result = await fn(ctx, report, ...args)
            span.setStatus({ code: 'OK' })
            return result
          } catch (err) {
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

export function modelAttributes(ctx: ModelCallContext): Attributes {
  const attrs: Attributes = {
    'eyas.model.provider': ctx.provider,
    'eyas.model.name': ctx.model,
  }
  if (ctx.operation) attrs['eyas.model.operation'] = ctx.operation
  if (typeof ctx.streaming === 'boolean') attrs['eyas.model.streaming'] = ctx.streaming
  return attrs
}

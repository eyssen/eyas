// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { AciFormatter, FormatContext, FormattedOutput, FormattingStrategy } from './types.js'
import { resolveStrategy } from './registry.js'

/**
 * Create an ACI formatter instance.
 *
 * The formatter is a thin dispatcher: it resolves a strategy for each
 * incoming tool name (via overrides or the default registry) and delegates
 * all real work to the strategy function. All strategies are pure, so the
 * formatter is trivially safe to share across concurrent tool calls.
 */
export function createAciFormatter(): AciFormatter {
  const overrides = new Map<string, FormattingStrategy>()

  const format = (raw: unknown, ctx: FormatContext): FormattedOutput => {
    const strategy = resolveStrategy(ctx.toolName, overrides)
    return strategy(raw, ctx)
  }

  const registerStrategy = (toolName: string, strategy: FormattingStrategy): void => {
    overrides.set(toolName, strategy)
  }

  const getStrategy = (toolName: string): FormattingStrategy => {
    return resolveStrategy(toolName, overrides)
  }

  return { format, registerStrategy, getStrategy }
}

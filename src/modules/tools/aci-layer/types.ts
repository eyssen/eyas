// Part of eYssen. See LICENSE file for full copyright and licensing details.

/**
 * ACI (Agent-Computer Interface) output post-processing types.
 *
 * The ACI layer lives between a raw tool result and the model-facing message.
 * It applies per-tool formatting strategies that trim large outputs while
 * preserving the signal the model needs to continue reasoning.
 *
 * Inspired by SWE-agent's "agent-computer interface" concept: a small set of
 * structured transformations over tool output produces dramatically better
 * LLM performance than raw dumps, at a tiny fraction of the tokens.
 */

/** Information a formatter receives about the tool call that produced `raw`. */
export interface FormatContext {
  /** Name of the tool whose output is being formatted. */
  toolName: string
  /**
   * Optional override for the maximum characters in the formatted output.
   * Individual strategies may also enforce line-based caps; this is a
   * char-level safety net.
   */
  maxOutputChars?: number
  /**
   * Optional hint pattern (substring or /regex/ literal) from the caller —
   * e.g. a keyword lifted from the current task. Strategies like `line-grep`
   * use this to focus output on lines that mention the hint.
   */
  hintPattern?: string
  /**
   * Optional per-strategy overrides. Kept loose so new strategies can add
   * their own knobs without breaking callers.
   */
  options?: Record<string, unknown>
}

/** Shape every strategy returns. `formatted` is the LLM-facing text. */
export interface FormattedOutput {
  /** Model-facing text. Always a string; callers should not re-serialise. */
  formatted: string
  /** Size of the raw input in characters (post `String(raw)`-ification). */
  originalSize: number
  /** True when the strategy dropped content to fit limits. */
  truncated: boolean
  /** Name of the strategy that produced this output. */
  strategy: string
  /**
   * Suggested next action for the model when we had to drop content —
   * e.g. "Use search_pattern tool with pattern='X' to see more". Only
   * populated when `truncated === true`.
   */
  followUpHint?: string
}

/** A formatting strategy is a pure function from (raw, ctx) to FormattedOutput. */
export type FormattingStrategy = (raw: unknown, ctx: FormatContext) => FormattedOutput

/** Public API for the ACI formatter. */
export interface AciFormatter {
  /** Apply the strategy registered for `ctx.toolName`, falling back to default. */
  format(raw: unknown, ctx: FormatContext): FormattedOutput
  /** Override (or install) the strategy for a tool name. */
  registerStrategy(toolName: string, strategy: FormattingStrategy): void
  /** Look up the strategy currently bound to `toolName`. */
  getStrategy(toolName: string): FormattingStrategy
}

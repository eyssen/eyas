// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// The output cap of an isolated CLI completion (MISSED-M-1). Claude Code,
// Grok and Kimi take no max-output-tokens setting from EYAS, so an isolated
// one-shot (a title, a triage verdict, a memory extraction) would otherwise
// answer at whatever length the model picks. EYAS bounds it on its own side:
// once the streamed answer passes ModelRequest.maxTokens × 4 characters (the
// usual characters-per-token estimate), the provider stops the CLI and the
// call ends with done, stopReason 'max_tokens' and the answer so far clipped
// to the cap. That is an outcome, never an error, the same as an API
// provider's own max_tokens stop.
//
// Only the answer text counts. Reasoning is not part of the answer, and how
// long a model reasons is up to the effort level. A turn with tools (a chat
// or agent turn) is never capped here: maxTokens bounds one model call, and
// a CLI turn is a whole loop of them.

/** The characters-per-token estimate the cap is measured in. */
export const CLI_OUTPUT_CHARS_PER_TOKEN = 4

export interface CliOutputCap {
  /** The most answer characters the call may return (maxTokens × 4). */
  readonly limitChars: number
  /** True once more answer was offered than fits: the call must end now. */
  readonly reached: boolean
  /**
   * The part of one streamed chunk that still fits. The chunk that passes
   * the cap is cut at it, and every chunk after it returns ''.
   */
  take(chunk: string): string
  /**
   * A whole answer reported at once (not streamed), clipped to the cap.
   * A longer one sets `reached`, just like a streamed one.
   */
  fit(whole: string): string
}

/**
 * `text` cut to at most `limit` UTF-16 units, never between the two halves
 * of a surrogate pair (an emoji is dropped whole, not split).
 */
export function clipChars(text: string, limit: number): string {
  if (text.length <= limit) return text
  let end = Math.max(0, limit)
  const last = text.charCodeAt(end - 1)
  if (end > 0 && last >= 0xd800 && last <= 0xdbff) end -= 1
  return text.slice(0, end)
}

/**
 * The output cap of one request: set only for an isolated completion with a
 * positive maxTokens, otherwise null (nothing to enforce).
 */
export function cliOutputCapFor(request: { isolated?: boolean; maxTokens?: number }): CliOutputCap | null {
  if (request.isolated !== true) return null
  const maxTokens = request.maxTokens
  if (typeof maxTokens !== 'number' || !Number.isFinite(maxTokens) || maxTokens < 1) return null
  const limitChars = Math.floor(maxTokens) * CLI_OUTPUT_CHARS_PER_TOKEN
  let used = 0
  let reached = false
  return {
    limitChars,
    get reached() {
      return reached
    },
    take(chunk) {
      if (reached || !chunk) return ''
      if (used + chunk.length <= limitChars) {
        used += chunk.length
        return chunk
      }
      reached = true
      const part = clipChars(chunk, limitChars - used)
      used += part.length
      return part
    },
    fit(whole) {
      if (whole.length > limitChars) reached = true
      return clipChars(whole, limitChars)
    },
  }
}

// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// The text a tool_result StreamEvent carries for a tool a CLI runtime ran
// itself (Claude Code's Bash/Read…, an ACP tool_call_update). The runtime
// reports the output in its own shape — a string, or a list of content blocks
// — and it can be arbitrarily large (a Read of a big file, a noisy command).
// The stream carries one flat, bounded string: the UI row, the run's
// ToolResult event and tool_executions all read it, so one cap applies to all.

/** Largest tool_result content a provider forwards, in UTF-8 bytes (64 KiB). */
export const TOOL_RESULT_CONTENT_CAP_BYTES = 64 * 1024

/** Placeholders for non-text blocks: the stream carries text only. */
const BLOCK_PLACEHOLDERS: Readonly<Record<string, string>> = {
  image: '[image]',
  document: '[document]',
}

function blockText(block: unknown): string | null {
  if (typeof block === 'string') return block
  if (!block || typeof block !== 'object') return null
  const b = block as { type?: unknown; text?: unknown }
  if (b.type === 'text') return typeof b.text === 'string' ? b.text : ''
  if (typeof b.type === 'string' && Object.prototype.hasOwnProperty.call(BLOCK_PLACEHOLDERS, b.type)) {
    return BLOCK_PLACEHOLDERS[b.type]!
  }
  try {
    return JSON.stringify(block)
  } catch {
    return null
  }
}

/**
 * One tool output as flat text: a string stays as it is, content blocks are
 * joined (text blocks by their text, images/documents as a placeholder, any
 * other block as JSON), anything else is serialized. Absent output is ''.
 */
export function toolResultText(content: unknown): string {
  if (content === undefined || content === null) return ''
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content.map(blockText).filter((t): t is string => t !== null && t.length > 0).join('\n')
  }
  try {
    return JSON.stringify(content) ?? ''
  } catch {
    return String(content)
  }
}

/**
 * Bound a tool output to `capBytes` UTF-8 bytes. A longer text keeps its head
 * (never a split character) and says how much was cut.
 */
export function capToolResultContent(text: string, capBytes: number = TOOL_RESULT_CONTENT_CAP_BYTES): string {
  // Fast path: a UTF-16 code unit is at most 3 UTF-8 bytes.
  if (text.length * 3 <= capBytes) return text
  const bytes = new TextEncoder().encode(text)
  if (bytes.length <= capBytes) return text
  const head = new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(0, capBytes)).replace(/�+$/, '')
  return `${head}\n… [truncated: ${bytes.length - capBytes} of ${bytes.length} bytes not shown]`
}

// Part of eYssen. See LICENSE file for full copyright and licensing details.

/**
 * Parse SSE lines from a raw text buffer.
 * Returns [parsed events, remaining buffer].
 * SSE format: "data: JSON\n\n" (double newline separates events).
 */
export function parseSSEBuffer<T = unknown>(buffer: string): [T[], string] {
  const events: T[] = []
  // Split on double newline (SSE event boundary)
  const parts = buffer.split('\n\n')
  // Last part may be incomplete
  const remaining = parts.pop()!

  for (const part of parts) {
    for (const line of part.split('\n')) {
      if (!line.startsWith('data: ')) continue
      try {
        events.push(JSON.parse(line.slice(6)))
      } catch {
        // Malformed JSON — skip
      }
    }
  }

  return [events, remaining]
}

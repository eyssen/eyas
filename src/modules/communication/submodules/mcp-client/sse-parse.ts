// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { JsonRpcResponse } from './types.js'

export function parseJsonRpcFromHttpResponse(
  _status: number,
  contentType: string | null,
  bodyText: string,
  expectedId?: number | string,
): JsonRpcResponse {
  const ct = (contentType ?? '').toLowerCase()
  if (ct.includes('text/event-stream')) {
    for (const block of bodyText.split('\n\n')) {
      const dataLine = block.split('\n').find((l) => l.startsWith('data: '))
      if (!dataLine) continue
      try {
        const parsed = JSON.parse(dataLine.slice(6)) as JsonRpcResponse
        if (!parsed || parsed.jsonrpc !== '2.0') continue
        // Notifications/progress have no matching id — keep scanning.
        if (expectedId !== undefined && parsed.id !== expectedId) continue
        return parsed
      } catch { /* skip malformed frames */ }
    }
    throw new Error(
      expectedId !== undefined
        ? `SSE response contained no JSON-RPC payload for id ${expectedId}`
        : 'SSE response contained no JSON-RPC payload',
    )
  }
  return JSON.parse(bodyText) as JsonRpcResponse
}

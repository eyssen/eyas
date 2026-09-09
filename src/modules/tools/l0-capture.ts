// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Phase 1b L0 capture for tool results (spec §16-4): only successful
// outputs inside a task, `ingested` trust, byte-capped by the ingest
// (memory.l0.toolResultMaxBytes), and OFF unless memory.l0.captureToolResults
// is set.
//
// What "off by default" is protecting against, precisely. `content` is
// JSON.stringify(entry.output) — the whole tool result, verbatim and
// unredacted — and `meta.input` carries 2 048 clipped but equally unredacted
// characters of the call's arguments. `run_command` returns raw stdout,
// `read_file` returns file contents, and `browser_totp` returns a live
// one-time auth code. Nothing here redacts, and nothing encrypts at rest:
// `dek_id` is written NULL, and the blob is zstd-compressed, which is not
// confidentiality.
//
// Do NOT read plan p1e as making this safe. Its Task 11 teaches
// privacy.collectSegments to scan `tool_result` blocks on their way INTO a
// prompt; it does not touch what this function has already written into
// memory_raw. At-rest scanning of L0 is unscoped work.

import type { EyasDb } from '@core/types'
import { generateId } from '@shared/crypto'
import { captureUnit } from '@modules/memory/v2/ingest-bridge.js'
import { resolveConversationScope } from '@modules/memory/v2/scope.js'
import type { ExecutionLogEntry } from './tool-executor.js'

const META_INPUT_MAX_CHARS = 2_048

function clipJson(value: unknown, maxChars: number): string {
  let text: string
  try {
    text = JSON.stringify(value) ?? ''
  } catch {
    text = '"[unserialisable]"'
  }
  return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text
}

export function captureToolResult(db: EyasDb, entry: ExecutionLogEntry, isEnabled: () => boolean): void {
  try {
    if (!isEnabled()) return
    if (!entry.success || !entry.output || !entry.conversationId) return
    const content = JSON.stringify(entry.output)
    if (!content || content === '{}') return
    const scope = resolveConversationScope(db, entry.conversationId)
    const occurredAtMs = Date.parse(entry.timestamp)
    captureUnit({
      id: generateId(),
      sourceType: 'tool_result',
      actor: entry.agentId ?? 'tool',
      conversationId: entry.conversationId,
      projectId: scope.projectId,
      projectTypeId: scope.projectTypeId,
      occurredAtMs: Number.isFinite(occurredAtMs) ? occurredAtMs : Date.now(),
      content,
      trustTier: 'ingested',
      meta: {
        origin: 'tool_executions',
        toolName: entry.toolName,
        sessionId: entry.sessionId ?? null,
        durationMs: entry.durationMs,
        input: clipJson(entry.input, META_INPUT_MAX_CHARS),
      },
    })
  } catch {
    /* the tool_executions row is already written; capture is best-effort */
  }
}

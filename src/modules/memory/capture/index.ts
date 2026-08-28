// Part of eYssen. See LICENSE file for full copyright and licensing details.
// src/modules/memory/capture/index.ts
//
// Deterministic WHEN, model-decided WHAT. This function is called after the
// reply has already reached the user, and it may not throw into that turn.

import { z } from 'zod'
import { sql } from 'drizzle-orm'
import type { EyasDb } from '@core/types'
import { createCandidateSchema, MAX_CANDIDATES, type CandidateNote } from './candidate-schema.js'
import { CAPTURE_SYSTEM_PROMPT, buildCaptureUser, type CaptureExtras } from './capture-prompt.js'
import { countExtractions, shouldExtract, type CaptureConfig } from './capture-gate.js'
import type { NoteWriter } from './note-writer.js'
import { attemptedProviderOf, type CompleteResult } from './completion.js'
import { buildMemoryIndex } from '../memory-index.js'
import { effectiveProjectId } from '../types.js'

export interface CaptureDeps {
  db: EyasDb
  config: () => CaptureConfig
  /** A bare string is a valid reply — the provider is then simply unknown. The
   * object form carries WHICH model answered, which is what the run row
   * attributes an outcome to (see capture/completion.ts). */
  complete: (args: { system: string; user: string }) => Promise<CompleteResult>
  writer: NoteWriter
  logger: { warn: (o: unknown, m?: string) => void; debug?: (o: unknown, m?: string) => void }
}

export interface CaptureInput {
  conversationId: string
  /**
   * The conversation's project as stored — RAW. `effectiveProjectId` is applied
   * here rather than at the call sites, so the seed catch-all project cannot be
   * mistaken for a real one in one place and not the other (spec D2).
   */
  projectId: string | null
  userMessage: string
  assistantMessage: string
}

/** Enough of the existing index for the do-not-restate rule to be checkable. */
const MAX_EXISTING_INDEX_CHARS = 1_200

/** `provider` is `provider/model` when a model actually answered, NULL otherwise
 * — a gate skip spent nothing, and a call that threw may never have reached a
 * provider. */
function recordRun(db: EyasDb, conversationId: string, written: number, kinds: string | null, skipped: string | null, provider: string | null = null): void {
  try {
    db.run(sql`INSERT INTO memory_capture_runs (conversation_id, notes_written, kinds, skipped_reason, provider)
      VALUES (${conversationId}, ${written}, ${kinds}, ${skipped}, ${provider})`)
  } catch { /* the counter is diagnostics; losing a row must not fail a capture */ }
}

/** The project a fact would be scoped to, for the prompt. Best-effort: the board module may not be installed. */
function resolveProject(db: EyasDb, projectId: string): { name: string; description: string | null } | null {
  try {
    const row = (db.all(sql`SELECT name, description FROM projects WHERE id = ${projectId}`) as Array<{ name: string; description: string | null }>)[0]
    return row ? { name: row.name, description: row.description ?? null } : null
  } catch {
    return null
  }
}

/** The index one-liners only — the heading is instructions for a different reader. */
function existingIndexLines(db: EyasDb, projectId: string | null): string | undefined {
  try {
    const index = buildMemoryIndex(db, { projectId })
    if (!index) return undefined
    const lines = index.content.split('\n').filter((l) => l.startsWith('- '))
    if (lines.length === 0) return undefined
    return lines.join('\n').slice(0, MAX_EXISTING_INDEX_CHARS)
  } catch {
    return undefined
  }
}

/** How much of an unusable reply the warn carries. Enough to tell prose from a
 * fence from an empty string; short enough to log on every failing turn. */
const WARN_HEAD_CHARS = 200

/**
 * Every `{…}` block in the reply, outermost-first, in the order they appear.
 * String-aware, so a brace inside a JSON string value does not close the block.
 * This is the envelope of last resort: an agentic CLI narrates what it is about
 * to do and then answers, and that answer is a perfectly good batch wearing a
 * paragraph of prose.
 */
function* balancedJsonBlocks(text: string): Generator<string> {
  let depth = 0
  let start = -1
  let inString = false
  let escaped = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    // Outside every object, only an opening brace matters — and it RESTARTS the
    // scan. Narration is prose: an apostrophe or a lone quote in it ("here's
    // what I found:") would otherwise leave the scanner inside a string it
    // never closes, and swallow the object that follows.
    if (depth === 0) {
      if (ch === '{') { start = i; depth = 1; inString = false; escaped = false }
      continue
    }
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0 && start >= 0) yield text.slice(start, i + 1)
    }
  }
}

/** The envelopes a reply may be wearing, cheapest first: the whole reply, then
 * a markdown fence, then any object embedded in prose. */
function* jsonCandidates(text: string): Generator<string> {
  yield text
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced) yield fenced[1].trim()
  yield* balancedJsonBlocks(text)
}

/**
 * The batch, or null when the reply carries no usable {"notes":[...]} envelope.
 * A model that wraps its JSON in a markdown fence — or in a sentence — is
 * answering correctly in the wrong envelope; the reflection engine already
 * unwraps a fence (reflection-engine.parseReflection).
 *
 * Schema-invalid members are dropped INDIVIDUALLY: a mislabeled note (project
 * kind in a no-project conversation) must not sink a valid sibling — live
 * measurement showed ~1/3 of good extractions dying exactly that way, recorded
 * as `unparsable`. Anything past the last candidate is a dropped batch, never a
 * retry, because the turn is over and nobody is waiting for this.
 */
function parseBatch(
  raw: string,
  noteSchema: ReturnType<typeof createCandidateSchema>,
): { notes: CandidateNote[]; droppedInvalid: number } | null {
  const envelope = z.object({ notes: z.array(z.unknown()).max(MAX_CANDIDATES).default([]) })
  for (const candidate of jsonCandidates(raw.trim())) {
    let json: unknown
    try {
      json = JSON.parse(candidate)
    } catch {
      continue
    }
    const shell = envelope.safeParse(json)
    if (!shell.success) continue
    const notes: CandidateNote[] = []
    let droppedInvalid = 0
    for (const item of shell.data.notes) {
      const parsed = noteSchema.safeParse(item)
      if (parsed.success) notes.push(parsed.data)
      else droppedInvalid++
    }
    return { notes, droppedInvalid }
  }
  return null
}

export function createMemoryCapture(deps: CaptureDeps) {
  return async function capture(input: CaptureInput): Promise<void> {
    // Above the try on purpose: a throw AFTER the model answered still knows
    // which model answered, and an 'error' row that drops that is a row nobody
    // can trace. Stays null when the call itself threw — then no provider ever
    // spoke.
    let provider: string | null = null
    try {
      const config = deps.config()
      const verdict = shouldExtract({
        config,
        userMessage: input.userMessage,
        alreadyExtracted: countExtractions(deps.db, input.conversationId),
      })
      if (!verdict.run) {
        // Skips are recorded too. Without them, "how often does the gate fire"
        // is unanswerable and minUserChars stays a guess forever.
        if (verdict.reason !== 'disabled') recordRun(deps.db, input.conversationId, 0, null, verdict.reason)
        return
      }

      const effProjectId = effectiveProjectId(input.projectId)
      const extras: CaptureExtras = {}
      if (effProjectId !== null) {
        // The announcement and the schema's allowProject gate must agree: the
        // kind is opened by the effective project id, so a project whose row
        // cannot be read is still announced, by id.
        const project = resolveProject(deps.db, effProjectId)
        extras.project = project ?? { name: effProjectId, description: null }
      }
      const existingIndex = existingIndexLines(deps.db, effProjectId)
      if (existingIndex) extras.existingIndex = existingIndex

      const reply = await deps.complete({
        system: CAPTURE_SYSTEM_PROMPT,
        user: buildCaptureUser(input.userMessage, input.assistantMessage, config.maxInputChars, extras),
      })
      const raw = typeof reply === 'string' ? reply : reply.text
      provider = typeof reply === 'string' ? null : reply.provider ?? null

      const batch = parseBatch(raw, createCandidateSchema({ allowProject: effProjectId !== null }))
      if (!batch) {
        // The reply itself, clipped, is the diagnosis: prose, a refusal, an
        // empty string and a fenced batch that failed the SCHEMA all reach this
        // line, and a conversation id alone cannot tell them apart.
        deps.logger.warn({
          conversationId: input.conversationId,
          provider,
          replyChars: raw.length,
          replyHead: raw.slice(0, WARN_HEAD_CHARS),
        }, 'Memory capture: unusable extractor output, batch dropped')
        recordRun(deps.db, input.conversationId, 0, null, 'unparsable', provider)
        return
      }

      if (batch.droppedInvalid > 0) {
        deps.logger.warn(
          { conversationId: input.conversationId, provider, droppedInvalid: batch.droppedInvalid },
          'Memory capture: schema-invalid notes dropped from batch',
        )
      }

      const kinds: string[] = []
      for (const note of batch.notes) {
        try {
          const outcome = await deps.writer.write(note, {
            conversationId: input.conversationId,
            projectId: effProjectId,
          })
          if (outcome.action !== 'skipped') kinds.push(note.kind)
        } catch (err) {
          // Per note, not per batch: one unwritable note must not discard the
          // count of a sibling that DID reach disk, or notes_written would
          // under-report what the vault actually holds.
          deps.logger.warn({ err, conversationId: input.conversationId, kind: note.kind }, 'Memory capture: note could not be written')
        }
      }
      // Three zero-write shapes, three labels: a batch whose only members were
      // schema-invalid is 'rejected-shape' (the model extracted, the shape gate
      // ate it); a batch with writable notes that all failed to write stays
      // 'error'; a genuinely empty batch stays the healthy NULL row.
      const failedWholesale = batch.notes.length > 0 && kinds.length === 0
      const rejectedWholesale = batch.notes.length === 0 && batch.droppedInvalid > 0
      // The kinds are the measurement: mislabeling (a project fact filed as
      // `user`) is otherwise invisible until someone reads the vault by hand.
      recordRun(
        deps.db,
        input.conversationId,
        kinds.length,
        JSON.stringify(kinds),
        failedWholesale ? 'error' : rejectedWholesale ? 'rejected-shape' : null,
        provider,
      )
    } catch (err) {
      // A call that never returned still names what it tried, on the error
      // itself — an 'error' row with a NULL provider cannot say whether the
      // model was unreachable, unconfigured, or refused the alias it was given.
      provider ??= attemptedProviderOf(err)
      // The reply has already been delivered. A failed capture is a missing
      // note, never a failed conversation.
      deps.logger.warn({ err, conversationId: input.conversationId, provider }, 'Memory capture failed')
      // Every outcome writes a row, this one included: an unreachable model and
      // an unwritable vault are the two most measurable ways this feature dies,
      // and without a row they are the two most invisible. recordRun swallows
      // its own failure, so this cannot re-throw out of the catch block.
      recordRun(deps.db, input.conversationId, 0, null, 'error', provider)
    }
  }
}

export type MemoryCapture = ReturnType<typeof createMemoryCapture>

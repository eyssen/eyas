// Part of eYssen. See LICENSE file for full copyright and licensing details.
// src/modules/memory/capture/candidate-schema.ts
//
// The contract for what the extractor may return. Everything here is attacker-
// influenced text: the model writes it from conversation content, and the
// result becomes a file that is replayed into later system prompts. The schema
// is what fixes the SHAPE of that file even when its content is chosen by
// someone else.

import { z } from 'zod'

/** Two is a batch; more per turn means the extractor is inventing. */
export const MAX_CANDIDATES = 2

/**
 * `project` is scoped by the call site, not the schema alone:
 * `createCandidateBatchSchema` only accepts it when the conversation has an
 * effective project to scope the fact to — a project note written without one
 * would be a file nothing can place.
 */
export const CANDIDATE_KINDS = ['user', 'feedback', 'project', 'reference'] as const

const base = z.object({
  kind: z.enum(CANDIDATE_KINDS),
  title: z.string().min(3).max(120),
  summary: z.string().min(3).max(140),
  body: z.string().min(3).max(4_000),
  why: z.string().max(400).optional(),
  howToApply: z.string().max(400).optional(),
})

export type CandidateNote = z.infer<typeof base>

/**
 * `allowProject: false` closes the `project` kind for SCOPING purposes — a
 * fact cannot be filed against a project the conversation does not have — but
 * the note itself is not rejected: its kind is downgraded to `reference` (see
 * the transform below), so the fact still reaches the vault.
 *
 * One candidate under the same rules the batch enforces — the salvage pass in
 * capture/index.ts validates notes individually so one bad note cannot sink
 * its siblings.
 */
export function createCandidateSchema(opts: { allowProject: boolean }) {
  return base
    .refine(
      (n) => n.kind !== 'feedback' || (!!n.why?.trim() && !!n.howToApply?.trim()),
      { message: 'a feedback note must carry both why and howToApply' },
    )
    // A fact worth keeping must not die on a label: without an active project
    // the model still (measured 5/6) files repo-flavoured rules as `project`.
    // Downgrading to `reference` keeps the fact in the vault; the prompt keeps
    // steering toward correct kinds, this is the net under it.
    .transform((n) => (!opts.allowProject && n.kind === 'project' ? { ...n, kind: 'reference' as const } : n))
}

export function createCandidateBatchSchema(opts: { allowProject: boolean }) {
  return z.object({ notes: z.array(createCandidateSchema(opts)).max(MAX_CANDIDATES).default([]) })
}

// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { z } from 'zod'
import type { GodModeConfig, RosterValidation } from './types.js'

const participantSchema = z.object({
  id: z.string().min(1),
  providerId: z.string().min(1),
  modelId: z.string().min(1),
})

const rosterInputSchema = z.object({
  participants: z.array(participantSchema),
  chairParticipantId: z.string().nullable().optional(),
  costCeilingUsd: z.number().nullable().optional(),
  workspaceRetentionHours: z.number().optional(),
  updatedAt: z.string().optional(),
})

function participantKey(p: { providerId: string; modelId: string }): string {
  return `${p.providerId}/${p.modelId}`
}

/**
 * Validate a God Mode roster payload (Settings save + run start).
 * Pure: no DB/HTTP. `liveKeys` entries are `"${providerId}/${modelId}"`.
 */
export function validateRoster(
  input: unknown,
  opts: { min: number; max: number; liveKeys?: Set<string>; allowEmpty?: boolean },
): RosterValidation {
  const parsed = rosterInputSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid roster' }
  }

  const { participants } = parsed.data
  const chairParticipantId = parsed.data.chairParticipantId ?? null
  const costCeilingUsd = parsed.data.costCeilingUsd ?? null
  const workspaceRetentionHours = parsed.data.workspaceRetentionHours ?? 72

  const emptyAllowed = opts.allowEmpty === true && participants.length === 0

  if (!emptyAllowed && participants.length < opts.min) {
    return {
      ok: false,
      error: `Roster must have at least ${opts.min} participants`,
    }
  }

  if (participants.length > opts.max) {
    return {
      ok: false,
      error: `Roster must have at most ${opts.max} participants`,
    }
  }

  const seenKeys = new Set<string>()
  for (const p of participants) {
    const key = participantKey(p)
    if (seenKeys.has(key)) {
      return { ok: false, error: `Duplicate provider/model pair: ${key}` }
    }
    seenKeys.add(key)
  }

  if (!emptyAllowed && participants.length % 2 === 0 && chairParticipantId == null) {
    return {
      ok: false,
      error: 'Chair is required when the roster has an even number of participants',
    }
  }

  if (chairParticipantId != null) {
    const inRoster = participants.some((p) => p.id === chairParticipantId)
    if (!inRoster) {
      return {
        ok: false,
        error: `Chair participant id "${chairParticipantId}" is not in the roster`,
      }
    }
  }

  if (opts.liveKeys) {
    for (const p of participants) {
      const key = participantKey(p)
      if (!opts.liveKeys.has(key)) {
        return {
          ok: false,
          error: `Participant not available (not in live providers): ${key}`,
        }
      }
    }
  }

  const config: GodModeConfig = {
    participants,
    chairParticipantId,
    costCeilingUsd,
    workspaceRetentionHours,
    updatedAt: parsed.data.updatedAt ?? new Date().toISOString(),
  }

  return { ok: true, config }
}

export type { GodModeConfig, RosterValidation, GodModeParticipantSpec } from './types.js'

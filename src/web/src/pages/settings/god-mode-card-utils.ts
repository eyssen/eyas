// Part of eYssen. See LICENSE file for full copyright and licensing details.

export interface GodModeDraftRow {
  id: string
  providerId: string
  modelId: string
}

export interface GodModeSaveBody {
  participants: GodModeDraftRow[]
  chairParticipantId: string | null
  costCeilingUsd: number | null
  workspaceRetentionHours: number
}

/** Even non-empty roster needs a chair (empty roster is valid to store). */
export function chairRequiredForCount(count: number, chairParticipantId: string | null): boolean {
  return count > 0 && count % 2 === 0 && chairParticipantId == null
}

export function parseCostCeiling(raw: string): number | null {
  const s = raw.trim()
  if (!s) return null
  const n = Number(s)
  if (!Number.isFinite(n) || n < 0) return null
  return n
}

export function parseRetentionHours(raw: string, fallback = 72): number {
  const s = raw.trim()
  if (!s) return fallback
  const n = Number(s)
  if (!Number.isFinite(n) || n < 0) return fallback
  return Math.floor(n)
}

export function newParticipantId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `p-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/** Complete rows only; drop a chair that is no longer in the roster. */
export function buildGodModeSaveBody(input: {
  participants: GodModeDraftRow[]
  chairParticipantId: string | null
  costCeilingRaw: string
  retentionRaw: string
}): { body: GodModeSaveBody; chairRequired: boolean } {
  const participants = input.participants.filter((p) => p.providerId && p.modelId)
  const chairParticipantId =
    input.chairParticipantId && participants.some((p) => p.id === input.chairParticipantId)
      ? input.chairParticipantId
      : null
  return {
    body: {
      participants,
      chairParticipantId,
      costCeilingUsd: parseCostCeiling(input.costCeilingRaw),
      workspaceRetentionHours: parseRetentionHours(input.retentionRaw),
    },
    chairRequired: chairRequiredForCount(participants.length, chairParticipantId),
  }
}

// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Rule-based importance (spec §6): message count, user text volume,
// decision markers, task outcome, user pin. Hand-set weights — labelled as
// such, one of four ranking inputs in Phase 2, never the whole score.

export interface ImportanceInput {
  messageCount: number
  userChars: number
  decisionMarkers: number
  taskClosed: boolean
  userPinned: boolean
}

export const DECISION_MARKERS: Record<'en' | 'hu' | 'de' | 'es' | 'fr', readonly string[]> = {
  en: ['decided', 'decision', 'approved', 'approve', 'agreed', 'todo', 'to-do', 'blocked', 'blocker', 'deadline', 'must'],
  hu: ['eldöntöttük', 'eldöntött', 'döntés', 'jóváhagyva', 'jóváhagytuk', 'jóváhagyás', 'megegyeztünk', 'teendő', 'teendők', 'blokkolva', 'blokkoló', 'határidő'],
  de: ['entschieden', 'entscheidung', 'genehmigt', 'freigegeben', 'vereinbart', 'aufgabe', 'blockiert', 'blocker', 'frist'],
  es: ['decidido', 'decidimos', 'decisión', 'aprobado', 'acordado', 'pendiente', 'tarea', 'bloqueado', 'bloqueo', 'plazo'],
  fr: ['décidé', 'décision', 'approuvé', 'validé', 'convenu', 'à faire', 'tâche', 'bloqué', 'blocage', 'échéance'],
}

// Markers hold only letters, spaces and hyphens, so no regex escaping is
// needed. Unicode lookarounds instead of \b (ASCII-only in JavaScript).
const MARKER_REGEX = new RegExp(
  String.raw`(?<![\p{L}\p{N}])(?:${Object.values(DECISION_MARKERS).flat().join('|')})(?![\p{L}\p{N}])`,
  'giu',
)

export function countDecisionMarkers(text: string): number {
  if (!text) return 0
  return (text.match(MARKER_REGEX) ?? []).length
}

const WEIGHTS = { base: 0.15, messages: 0.25, chars: 0.15, markers: 0.25, closed: 0.10, pinned: 0.10 } as const
const SATURATION = { messages: 30, chars: 4_000, markers: 5 } as const

function unit(value: number, saturation: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0
  return Math.min(1, value / saturation)
}

export function scoreImportance(input: ImportanceInput): number {
  const score = WEIGHTS.base
    + WEIGHTS.messages * unit(input.messageCount, SATURATION.messages)
    + WEIGHTS.chars * unit(input.userChars, SATURATION.chars)
    + WEIGHTS.markers * unit(input.decisionMarkers, SATURATION.markers)
    + (input.taskClosed ? WEIGHTS.closed : 0)
    + (input.userPinned ? WEIGHTS.pinned : 0)
  return Math.round(Math.max(0, Math.min(1, score)) * 1000) / 1000
}

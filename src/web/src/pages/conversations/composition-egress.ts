// Part of eYssen. See LICENSE file for full copyright and licensing details.
// Pure helpers for the context inspector's privacy view: what the privacy
// egress did to each recorded section on the way to the model. The server
// returns the section content as assembled plus the masked spans of the last
// remote call; these helpers render the content as the model received it and
// pick the badge for a section. Nothing here ever sees a detected value that
// the assembled content does not already hold.

/** A masked span within a section's recorded content: [start, end, type]. */
export type EgressSpan = [start: number, end: number, type: string]

/** GET /observability/compositions/:id → sections[].egress */
export interface SectionEgress {
  masked: number
  spans: EgressSpan[]
  /** An EYAS-generated section, sent without scanning. */
  skipped: boolean
}

/** GET /observability/compositions/:id → composition.egress (the last model call of the turn). */
export interface CompositionEgress {
  locality: 'local' | 'remote'
  transport: string
  providerId: string | null
  rulesetVersion: string
  calls: number
  at: string
  unattributed: { masked: number; warned: number }
  messages: { masked: number; warned: number }
  toolResults: Array<{ toolName: string; transport: string; masked: number; warned: number; calls: number }>
  byType: Record<string, number>
}

/** The placeholder the privacy mask puts in place of a value (privacy/service.ts maskPlaceholder). */
export function maskPlaceholder(type: string): string {
  return `[${type.toUpperCase()}]`
}

function isValidSpan(span: unknown, length: number): span is EgressSpan {
  if (!Array.isArray(span) || span.length < 3) return false
  const [start, end, type] = span
  return (
    Number.isInteger(start) &&
    Number.isInteger(end) &&
    typeof type === 'string' &&
    type.length > 0 &&
    start >= 0 &&
    end > start &&
    end <= length
  )
}

/**
 * The section content as sent to the model: every span replaced by its
 * placeholder. A span outside the content, an empty or inverted one, or one
 * overlapping a span already applied is ignored — the text around it stays
 * as assembled rather than being cut wrongly.
 */
export function applyEgressSpans(content: string, spans: readonly unknown[] | null | undefined): string {
  if (!content || !spans || spans.length === 0) return content
  const valid = spans
    .filter((s): s is EgressSpan => isValidSpan(s, content.length))
    .slice()
    .sort((a, b) => a[0] - b[0] || a[1] - b[1])
  if (valid.length === 0) return content
  let out = ''
  let cursor = 0
  for (const [start, end, type] of valid) {
    if (start < cursor) continue
    out += content.slice(cursor, start) + maskPlaceholder(type)
    cursor = end
  }
  return out + content.slice(cursor)
}

export type EgressBadge =
  /** Values in this section were replaced before the model saw them. */
  | { kind: 'masked'; count: number; types: string[] }
  /** Scanned; nothing needed masking. */
  | { kind: 'none' }
  /** EYAS-generated (identity, rules, clock, folders, inventories): sent as it is. */
  | { kind: 'notScanned' }
  /** The model runs on a local destination: nothing is masked on purpose. */
  | { kind: 'local' }

/** The types of the masked spans, in order of first appearance. */
export function spanTypes(spans: readonly EgressSpan[]): string[] {
  const out: string[] = []
  for (const [, , type] of spans) if (!out.includes(type)) out.push(type)
  return out
}

/**
 * The badge for one section, or null when nothing was recorded for it (no
 * model call yet, a composition from before this existed, a section that
 * rode in the user message, or one scanned with the unattributed text).
 */
export function sectionEgressBadge(
  sectionEgress: SectionEgress | null | undefined,
  compositionEgress: CompositionEgress | null | undefined,
): EgressBadge | null {
  if (!compositionEgress) return null
  if (compositionEgress.locality === 'local') return { kind: 'local' }
  if (!sectionEgress) return null
  if (sectionEgress.skipped) return { kind: 'notScanned' }
  if (sectionEgress.masked > 0) {
    return { kind: 'masked', count: sectionEgress.masked, types: spanTypes(sectionEgress.spans ?? []) }
  }
  return { kind: 'none' }
}

/** True when at least one section has masks to show in the 'as sent' view. */
export function hasEgressSpans(sections: ReadonlyArray<{ egress?: SectionEgress | null }>): boolean {
  return sections.some((s) => (s.egress?.spans?.length ?? 0) > 0)
}

/**
 * Memory tool results with masked values, one entry per tool (the gateway's
 * view of the history and the results masked on a CLI tool bridge, summed).
 */
export function maskedToolResults(egress: CompositionEgress | null | undefined): Array<{ toolName: string; masked: number }> {
  if (!egress || egress.locality !== 'remote') return []
  const byTool = new Map<string, number>()
  for (const t of egress.toolResults ?? []) {
    if (t.masked > 0) byTool.set(t.toolName, (byTool.get(t.toolName) ?? 0) + t.masked)
  }
  return [...byTool].map(([toolName, masked]) => ({ toolName, masked }))
}

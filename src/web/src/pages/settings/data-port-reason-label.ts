// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Every machine code a scan puts on a row — the reason it was listed, the tags
// it carries, the class of a folder that was not entered — reaches the owner as
// a translated label. Nothing here invents a string: each helper looks up a key
// Task 1 added in all six languages and falls back to the server's own English
// text, so a code added later degrades to something readable rather than to a
// bare `settings.dataPort.…` key.

import { tOr } from './i18n'

/**
 * `directory-skipped:node_modules` → `{ code: 'directory-skipped', detail:
 * 'node_modules' }` (P-1). A plain code is itself; the split is at the FIRST
 * colon, so a detail may contain one.
 */
export function splitReasonCode(code: string): { code: string; detail?: string } {
  const at = code.indexOf(':')
  return at < 0 ? { code } : { code: code.slice(0, at), detail: code.slice(at + 1) }
}

/**
 * The row's reason as a sentence. The classed part of a code is translated in
 * its own right (`node_modules` → "Dependency folder") before it fills the
 * `{{detail}}` of the reason itself. A code with no key falls back to the
 * server's English `reason` text, naming the detail so the owner still sees
 * WHICH folder class or unit was meant.
 *
 * A label that still holds an unfilled `{{…}}` is a MISS, not a label. The bare
 * prefix `directory-skipped` is a real wire value — `DirNode.byReason` is keyed
 * on the prefix, and the reason filter accepts one — and its template needs a
 * detail that a bare prefix does not carry, so it would otherwise print
 * "Folder not searched: {{detail}}" at the owner. The same guard catches a
 * translation that lost a placeholder the English has.
 */
export function reasonLabel(reasonCode: string | undefined, fallback: string): string {
  if (!reasonCode) return fallback
  const { code, detail } = splitReasonCode(reasonCode)
  const vars = detail ? { detail: tOr(`settings.dataPort.wizard.dirClass.${detail}`, detail) } : undefined
  const out = tOr(`settings.dataPort.reason.${code}`, '', vars)
  if (!out || out.includes('{{')) return detail ? `${fallback} (${detail})` : fallback
  return out
}

export const kindLabel = (kind: string): string => tOr(`settings.dataPort.wizard.kind.${kind}`, kind)

/**
 * Tags are an open set: `legacy` and `contains-secrets` have labels, while
 * provenance tags the adapters mint (`claude-project:<slug>`, `session-part:2/7`)
 * are shown as they are — they name a real thing and translating them would
 * lose it.
 */
export const tagLabel = (tag: string): string => tOr(`settings.dataPort.wizard.tag.${tag}`, tag)

export const warningLabel = (w: string): string => tOr(`settings.dataPort.wizard.warning.${w}`, w)

export const dirClassLabel = (cls: string): string => tOr(`settings.dataPort.wizard.dirClass.${cls}`, cls)

/**
 * A scan warning. A pre-R11 server answered a plain string and a migrated scan
 * carries one as `code: 'legacy'` with the text in `params.message`; both print
 * verbatim. Anything coded is translated with its own params, falling back to
 * the English `message` the server sent.
 */
export function scanWarningText(w: { code: string; params?: Record<string, string | number>; message: string } | string): string {
  if (typeof w === 'string') return w
  return tOr(`settings.dataPort.scanWarning.${w.code}`, w.message, w.params)
}

// Part of eYssen. See LICENSE file for full copyright and licensing details.
// src/modules/design/dc-splice.ts
//
// Puts an edit back into a .dc.html file.
//
// The runtime serialises only the TEMPLATE — the <x-dc> body with <helmet>
// already removed — because that is what it parsed. Splicing rebuilds the file
// around it: the head marker, the helmet, the logic script and everything
// outside <x-dc> are preserved byte-for-byte, because an editor that reformats
// the parts you did not touch is an editor you cannot trust with a diff.
//
// Everything here is pure and synchronous, so the round trip is testable
// without a DOM.

import { decodeAttribute, parseArtboard } from './dc-template.js'

export class DcSpliceError extends Error {}

const X_DC_OPEN_RE = /<x-dc\b[^>]*>/i
const X_DC_CLOSE = '</x-dc>'
const HELMET_RE = /<helmet\b[^>]*>[\s\S]*?<\/helmet>/i
const DATA_PROPS_RE = /(\bdata-props\s*=\s*)(['"])([\s\S]*?)\2/

/**
 * Replace the template inside `<x-dc>` with `template`, keeping the helmet and
 * everything outside the element exactly as it was.
 */
export function spliceArtboardBody(source: string, template: string): string {
  const open = source.match(X_DC_OPEN_RE)
  if (!open || open.index === undefined) throw new DcSpliceError('no <x-dc> element in this artboard')
  const bodyStart = open.index + open[0].length
  const bodyEnd = source.toLowerCase().indexOf(X_DC_CLOSE, bodyStart)
  if (bodyEnd === -1) throw new DcSpliceError('unclosed <x-dc> element')

  const currentBody = source.slice(bodyStart, bodyEnd)
  const helmet = currentBody.match(HELMET_RE)?.[0] ?? ''

  const rebuilt = helmet
    ? `\n${helmet}\n${template.trim()}\n`
    : `\n${template.trim()}\n`

  const spliced = source.slice(0, bodyStart) + rebuilt + source.slice(bodyEnd)

  // Refuse to hand back something that does not read back as what we wrote.
  //
  // Parsing alone is too weak a check: a stray `</x-dc>` inside the template
  // closes the element early, and the file still parses — into a TRUNCATED
  // artboard, with the rest of the template now sitting outside the element as
  // loose markup. Comparing the round trip catches that, and any other way the
  // splice could quietly lose content.
  let readBack: string
  try {
    readBack = parseArtboard(spliced).template
  } catch (err) {
    throw new DcSpliceError(`the spliced artboard no longer parses: ${err instanceof Error ? err.message : String(err)}`)
  }
  if (readBack !== template.trim()) {
    throw new DcSpliceError(
      'the spliced artboard does not read back as what was written — the template probably closes <x-dc> early',
    )
  }
  return spliced
}

/** The three entities data-props needs, applied in the safe order. */
function encodeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/'/g, '&#39;')
}

/**
 * Write a tweak's current value back as the declared default, so saving a
 * tweak change makes it the artboard's new starting point.
 */
export function patchPropDefault(source: string, prop: string, value: unknown): string {
  const match = source.match(DATA_PROPS_RE)
  if (!match) throw new DcSpliceError('this artboard declares no data-props')

  let parsed: Record<string, any>
  try {
    parsed = JSON.parse(decodeAttribute(match[3]))
  } catch (err) {
    throw new DcSpliceError(`data-props is not valid JSON: ${err instanceof Error ? err.message : String(err)}`)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new DcSpliceError('data-props is not an object')
  }
  if (!Object.prototype.hasOwnProperty.call(parsed, prop)) {
    throw new DcSpliceError(`this artboard declares no prop named "${prop}"`)
  }

  const spec = parsed[prop]
  parsed[prop] = spec && typeof spec === 'object' && !Array.isArray(spec)
    ? { ...spec, default: value }
    : { default: value }

  // Single-quote the attribute: every example in the format assumes it, and a
  // double-quoted attribute changes which characters need escaping.
  const encoded = encodeAttribute(JSON.stringify(parsed))
  const replaced = source.replace(DATA_PROPS_RE, `${match[1]}'${encoded}'`)

  try {
    const reparsed = parseArtboard(replaced)
    if (!Object.prototype.hasOwnProperty.call(reparsed.props, prop)) {
      throw new Error(`prop "${prop}" vanished`)
    }
  } catch (err) {
    throw new DcSpliceError(`the patched artboard no longer parses: ${err instanceof Error ? err.message : String(err)}`)
  }
  return replaced
}

/** Current declared defaults, for seeding the tweak controls. */
export function readPropDefaults(source: string): Record<string, unknown> {
  const parsed = parseArtboard(source)
  const out: Record<string, unknown> = {}
  for (const [key, spec] of Object.entries(parsed.props)) {
    if (spec && typeof spec === 'object' && 'default' in spec) out[key] = (spec as any).default
  }
  return out
}

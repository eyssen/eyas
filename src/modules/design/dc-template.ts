// Part of eYssen. See LICENSE file for full copyright and licensing details.
// src/modules/design/dc-template.ts
//
// Splits a .dc.html artboard into the four things the runtime needs. Pure and
// synchronous on purpose: this half is testable without a DOM, and only the
// expansion half (which must re-run on setState) lives inside the iframe.
//
// Shape being parsed:
//
//   <head> … <script src="./support.js"></script> </head>     ← runtime marker
//   <x-dc>
//     <helmet><style>…</style></helmet>                        ← document CSS
//     …template with {{holes}}, <sc-for>, <sc-if>, <dc-import>…
//   </x-dc>
//   <script data-dc-script data-props='{…}'>
//     class Component extends DCLogic { renderVals() { … } }
//   </script>

export interface PropSpec {
  editor?: 'text' | 'color' | 'int' | 'float' | 'range' | 'boolean' | 'enum' | null
  default?: unknown
  options?: unknown[]
  min?: number
  max?: number
  step?: number
  unit?: string
  section?: string
  tsType?: string
}

export interface ParsedArtboard {
  /** Contents of <helmet>, verbatim — usually a <style> block. */
  helmet: string
  /** The template inside <x-dc>, with <helmet> removed. */
  template: string
  /** Parsed data-props, or {} when there is no logic script. */
  props: Record<string, PropSpec>
  /** The body of <script data-dc-script>, or null for a static artboard. */
  logic: string | null
  /** `$preview` size hint, when data-props declares one. */
  preview?: { width?: number; height?: number }
}

export class DcParseError extends Error {}

const HELMET_RE = /<helmet\b[^>]*>([\s\S]*?)<\/helmet>/i
const X_DC_RE = /<x-dc\b[^>]*>([\s\S]*?)<\/x-dc>/i
const LOGIC_RE = /<script\b([^>]*\bdata-dc-script\b[^>]*)>([\s\S]*?)<\/script>/i
const DATA_PROPS_RE = /\bdata-props\s*=\s*(['"])([\s\S]*?)\1/

/**
 * data-props is a normal HTML attribute, so entities decode BEFORE the JSON
 * parse. The format's own guidance names exactly three that matter; decoding
 * more would corrupt legitimate content.
 */
export function decodeAttribute(value: string): string {
  return value
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

export function parseArtboard(source: string): ParsedArtboard {
  const xdc = source.match(X_DC_RE)
  if (!xdc) throw new DcParseError('no <x-dc> root element')

  let body = xdc[1]
  const helmetMatch = body.match(HELMET_RE)
  const helmet = helmetMatch ? helmetMatch[1] : ''
  if (helmetMatch) body = body.replace(HELMET_RE, '')

  // The logic script sits OUTSIDE <x-dc>, so search the whole file.
  const logicMatch = source.match(LOGIC_RE)
  let props: Record<string, PropSpec> = {}
  let logic: string | null = null
  let preview: ParsedArtboard['preview']

  if (logicMatch) {
    const attrs = logicMatch[1] ?? ''
    const inner = logicMatch[2] ?? ''
    if (!inner.trim()) {
      throw new DcParseError('empty <script data-dc-script> — omit it entirely for a static artboard')
    }
    logic = inner

    const rawProps = attrs.match(DATA_PROPS_RE)
    if (rawProps) {
      let parsed: unknown
      try {
        parsed = JSON.parse(decodeAttribute(rawProps[2]))
      } catch (e) {
        throw new DcParseError(`data-props is not valid JSON after entity decoding: ${e instanceof Error ? e.message : String(e)}`)
      }
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const record = parsed as Record<string, unknown>
        const dollarPreview = record['$preview']
        if (dollarPreview && typeof dollarPreview === 'object') {
          const p = dollarPreview as Record<string, unknown>
          preview = {
            ...(typeof p.width === 'number' ? { width: p.width } : {}),
            ...(typeof p.height === 'number' ? { height: p.height } : {}),
          }
        }
        for (const [key, value] of Object.entries(record)) {
          if (key.startsWith('$')) continue
          props[key] = (value && typeof value === 'object' ? value : {}) as PropSpec
        }
      }
    }
  }

  return { helmet, template: body.trim(), props, logic, ...(preview ? { preview } : {}) }
}

/** Default values for every declared prop, used to seed the first render. */
export function defaultProps(props: Record<string, PropSpec>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, spec] of Object.entries(props)) {
    if (spec && 'default' in spec) out[key] = spec.default
  }
  return out
}

/**
 * Props that surface as tweak chips: the ones with a real editor. `null` means
 * "callback or object", which is deliberately not editable.
 */
export function tweakableProps(props: Record<string, PropSpec>): string[] {
  return Object.entries(props)
    .filter(([, spec]) => spec && spec.editor !== null && spec.editor !== undefined)
    .map(([key]) => key)
}

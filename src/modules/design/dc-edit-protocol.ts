// Part of eYssen. See LICENSE file for full copyright and licensing details.
// src/modules/design/dc-edit-protocol.ts
//
// The message contract between the app and an artboard's sandboxed iframe.
//
// It exists because the iframe has `sandbox="allow-scripts"` and NO
// `allow-same-origin` — the only reason executing AI-authored JavaScript is
// acceptable — which means the app cannot touch the artboard's DOM. Every
// editing gesture crosses postMessage.
//
// Trust: messages arrive from an opaque origin ("null") and are exactly as
// untrusted as the artboard itself. The app verifies the source window,
// validates every message against the guards below, and never renders or
// executes message content outside the sandbox. The worst a hostile artboard
// can do is rewrite its own source — which is what an editor is for.

/** Stable index assigned to each template element at parse time. */
export type SourceIndex = number

// ─── iframe → app ─────────────────────────────────────────────────────────

export interface DcHeightMessage {
  type: 'dc:height'
  height: number
}

export interface DcSelectionMessage {
  type: 'dc:selected'
  index: SourceIndex
  tag: string
  /** Inline style declarations, as authored. */
  styles: Record<string, string>
  /** Text content when the element holds a single text node, for inline editing. */
  text?: string
  /** True when the element's text is a {{hole}} — bound text is not editable in place. */
  bound?: boolean
}

export interface DcSourceMessage {
  type: 'dc:source'
  /** The serialised <x-dc> body after the edit. */
  body: string
  /** Echoed so the app can keep the selection across the re-render. */
  index: SourceIndex | null
}

export interface DcErrorMessage {
  type: 'dc:error'
  message: string
}

export type DcOutboundMessage = DcHeightMessage | DcSelectionMessage | DcSourceMessage | DcErrorMessage

// ─── app → iframe ─────────────────────────────────────────────────────────

export interface DcSelectCommand {
  type: 'dc:select'
  index: SourceIndex | null
}

export interface DcSetStyleCommand {
  type: 'dc:setStyle'
  index: SourceIndex
  /** A null value removes the declaration. */
  styles: Record<string, string | null>
}

export interface DcSetTextCommand {
  type: 'dc:setText'
  index: SourceIndex
  text: string
}

export interface DcSetPropsCommand {
  type: 'dc:setProps'
  props: Record<string, unknown>
}

/** Turn the click-to-select overlay off so an interactive artboard's own handlers fire. */
export interface DcSetModeCommand {
  type: 'dc:setMode'
  mode: 'edit' | 'interact'
}

export type DcInboundMessage =
  | DcSelectCommand | DcSetStyleCommand | DcSetTextCommand | DcSetPropsCommand | DcSetModeCommand

// ─── guards ───────────────────────────────────────────────────────────────
//
// Strict on purpose: a hostile artboard can post anything, and the app acts on
// what it receives.

function isRecordOfStrings(v: unknown): v is Record<string, string> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
    && Object.values(v as Record<string, unknown>).every((x) => typeof x === 'string')
}

export function isDcOutboundMessage(value: unknown): value is DcOutboundMessage {
  if (!value || typeof value !== 'object') return false
  const m = value as Record<string, unknown>
  switch (m.type) {
    case 'dc:height':
      return typeof m.height === 'number' && Number.isFinite(m.height) && m.height >= 0
    case 'dc:selected':
      return Number.isInteger(m.index) && (m.index as number) >= 0
        && typeof m.tag === 'string' && m.tag.length > 0 && m.tag.length <= 40
        && isRecordOfStrings(m.styles)
        && (m.text === undefined || typeof m.text === 'string')
        && (m.bound === undefined || typeof m.bound === 'boolean')
    case 'dc:source':
      return typeof m.body === 'string'
        && (m.index === null || (Number.isInteger(m.index) && (m.index as number) >= 0))
    case 'dc:error':
      return typeof m.message === 'string'
    default:
      return false
  }
}

/** Attribute a message to the artboard's own frame — any window can postMessage. */
export function isFromFrame(event: { source: unknown }, frame: { contentWindow: unknown } | null): boolean {
  return !!frame && event.source === frame.contentWindow
}

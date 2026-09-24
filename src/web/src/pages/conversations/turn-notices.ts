// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// The chat stream's generic notices (shared/chat-stream.ts NoticeSchema): a
// non-fatal note the chat route sends with a turn — for example that the
// model could not see the images of the conversation — localized as
// conversations.notice.<code> with the notice's params. A notice arrives as a
// `notice` frame while the turn streams and is stored with the reply
// (TurnMeta.notices), so it stays under the turn after a reload.

import { tOr } from './i18n'

/** One notice as the stream and the stored reply carry it. */
export interface TurnNotice {
  code: string
  params?: Record<string, string | number>
}

const PARAM_KEY = /^[A-Za-z][A-Za-z0-9_]*$/

/**
 * A notice from the wire, or null when it is not one: a code and optional
 * flat string/number params. Anything else is dropped, never shown raw.
 */
export function parseTurnNotice(value: unknown): TurnNotice | null {
  if (!value || typeof value !== 'object') return null
  const { code, params } = value as { code?: unknown; params?: unknown }
  if (typeof code !== 'string' || !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(code)) return null
  if (params === undefined || params === null) return { code }
  if (typeof params !== 'object' || Array.isArray(params)) return null
  const clean: Record<string, string | number> = {}
  for (const [key, v] of Object.entries(params as Record<string, unknown>)) {
    if (!PARAM_KEY.test(key)) return null
    if (typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v))) clean[key] = v
    else return null
  }
  return { code, params: clean }
}

/** The notices stored with a reply (its turnMeta), parsed; [] when it has none. */
export function noticesOf(turnMeta: unknown): TurnNotice[] {
  const list = (turnMeta as { notices?: unknown } | null | undefined)?.notices
  if (!Array.isArray(list)) return []
  return list.map(parseTurnNotice).filter((n): n is TurnNotice => n !== null)
}

/**
 * The localized text of a notice (conversations.notice.<code>: every
 * NoticeCode — contextCompacted, imagesNotVisible, cliSandboxUnavailable,
 * folderRefused —
 * has one in all six locales), or null for a code this build has no text for
 * (it is not shown: a raw code would mean nothing to the reader).
 */
export function noticeText(notice: TurnNotice): string | null {
  const text = tOr(`conversations.notice.${notice.code}`, '', notice.params)
  return text.trim() ? text : null
}

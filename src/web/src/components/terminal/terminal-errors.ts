// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// What the terminal panel says when a terminal cannot open or its socket is
// refused, in the active language. A refusal of the terminal right (manage
// OpenCode: the owner's and an admin's by default) gets its own reason, from
// the HTTP 403 of POST /opencode/sessions or the socket's `forbidden` frame.

import { t } from '@/pages/opencode/i18n'

/** POST /opencode/sessions failed: a 403 is the terminal right; anything else says what the server said. */
export function terminalOpenErrorText(err: unknown): string {
  const status = err && typeof err === 'object' ? (err as { status?: unknown }).status : undefined
  if (status === 403) return t('opencode.terminal.forbidden')
  return err instanceof Error ? err.message : String(err)
}

/** An `error` frame from the terminal socket. */
export function terminalFrameErrorText(frame: { code?: unknown; message?: unknown }): string {
  if (frame.code === 'forbidden') return t('opencode.terminal.forbidden')
  return typeof frame.message === 'string' ? frame.message : t('opencode.terminal.socketError')
}

/** The socket failed without a frame (network, refused upgrade). */
export function terminalSocketErrorText(): string {
  return t('opencode.terminal.socketError')
}

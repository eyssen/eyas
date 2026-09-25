// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// What the signed-in user may do with OpenCode, as the server's own CASL
// check answers it (GET /opencode/access). The web never decides by role name:
// a control is shown only when the server would let its user use it. While the
// answer loads, and on any error (no read right, the module not loaded), the
// answer is no.

import { useApi } from '@/hooks/use-api'

export interface OpencodeAccess {
  /** Open an interactive terminal (OpenCode TUI or shell): manage OpenCode. */
  terminal: boolean
  /** Change the OpenCode settings: manage OpenCode. */
  settings: boolean
}

const NONE: OpencodeAccess = { terminal: false, settings: false }

/** The server's answer as booleans; anything that is not exactly `true` is no. */
export function parseOpencodeAccess(raw: unknown): OpencodeAccess {
  if (!raw || typeof raw !== 'object') return NONE
  const rec = raw as Record<string, unknown>
  return { terminal: rec.terminal === true, settings: rec.settings === true }
}

export function useOpencodeAccess(): OpencodeAccess {
  const { data, error } = useApi<unknown>('/opencode/access')
  return error ? NONE : parseOpencodeAccess(data)
}

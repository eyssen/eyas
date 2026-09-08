// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// ONE classifier for provider errors. The reauth healer must reload credentials
// on a genuine auth failure (401/403) but must NOT reload on a transient
// rate-limit (429) or overload (529) — reloading on every overload spike would
// hammer the provider and mask the real problem. Single source of truth so the
// healer (Cap 4), the channel-health monitor (Cap 2), and run recovery (Cap 3)
// all agree on what "auth failure" means.

export type AuthErrorKind = 'auth' | 'rate-limit' | 'overload' | 'other'

export interface AuthErrorClassification {
  kind: AuthErrorKind
  isAuth: boolean
  status?: number
}

function extractStatus(e: any): number | undefined {
  if (typeof e === 'number') return e
  if (!e || typeof e !== 'object') return undefined
  if (typeof e.status === 'number') return e.status
  if (typeof e.statusCode === 'number') return e.statusCode
  if (e.response && typeof e.response.status === 'number') return e.response.status
  return undefined
}

function fromStatus(status: number): AuthErrorClassification {
  if (status === 401 || status === 403) return { kind: 'auth', isAuth: true, status }
  if (status === 429) return { kind: 'rate-limit', isAuth: false, status }
  if (status === 529) return { kind: 'overload', isAuth: false, status }
  return { kind: 'other', isAuth: false, status }
}

const AUTH_RE =
  /\b401\b|\b403\b|unauthorized|forbidden|invalid[ _]api[ _]key|authentication_error|auth(?:entication)? failed|permission_error/
const RATE_RE = /rate[ _]limit|too many requests|\b429\b/
const OVERLOAD_RE = /overloaded|\b529\b/

export function classifyAuthError(e: unknown): AuthErrorClassification {
  const status = extractStatus(e)
  if (status !== undefined) return fromStatus(status)

  const msg = (e instanceof Error ? e.message : typeof e === 'string' ? e : '').toLowerCase()
  if (!msg) return { kind: 'other', isAuth: false }
  if (AUTH_RE.test(msg)) return { kind: 'auth', isAuth: true }
  if (RATE_RE.test(msg)) return { kind: 'rate-limit', isAuth: false }
  if (OVERLOAD_RE.test(msg)) return { kind: 'overload', isAuth: false }
  return { kind: 'other', isAuth: false }
}

/** Convenience: true only for genuine auth failures (401/403 / auth-worded errors). */
export function isAuthError(e: unknown): boolean {
  return classifyAuthError(e).isAuth
}

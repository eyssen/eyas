// Part of eYssen. See LICENSE file for full copyright and licensing details.

/**
 * Remotely-managed Cloudflare tunnel tokens are a single base64 JSON blob
 * starting with `eyJ` (`{"a": account, "t": tunnel id, "s": secret}`).
 * A three-part JWT is also accepted if Cloudflare ever issues one.
 */
const COMPACT_RE = /eyJ[A-Za-z0-9+/=_-]{40,}/
const JWT_RE = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Pull a tunnel token out of whatever the operator pasted: raw token,
 * quoted token, or a full `cloudflared … --token eyJ…` / `service install eyJ…`
 * command. Strips BOM / zero-width / wrapping quotes.
 */
export function sanitizeTunnelToken(raw: string): string {
  let s = (raw ?? '')
    .replace(/[\u200B-\u200D\uFEFF\u00A0]/g, '')
    .replace(/[^\S\n]+/g, ' ')
    .trim()
  if (!s) return ''

  const fromFlag = s.match(/--token(?:=|\s+)(['"]?)(eyJ[A-Za-z0-9+/=._-]+)\1/)
  if (fromFlag?.[2]) return fromFlag[2]

  const fromInstall = s.match(/service\s+install\s+(['"]?)(eyJ[A-Za-z0-9+/=._-]+)\1/i)
  if (fromInstall?.[2]) return fromInstall[2]

  const quoted = s.match(/^(['"])(eyJ[A-Za-z0-9+/=._-]+)\1$/)
  if (quoted?.[2]) return quoted[2]

  const compact = s.match(COMPACT_RE)
  if (compact && (s.startsWith('eyJ') || s.includes(' '))) return compact[0]

  const jwt = s.match(JWT_RE)
  if (jwt && (s.startsWith('eyJ') || s.includes(' '))) return jwt[0]

  return s.replace(/^['"]|['"]$/g, '').trim()
}

export function isCloudflareTunnelToken(token: string): boolean {
  if (!token.startsWith('eyJ') || token.length < 40) return false
  if (JWT_RE.test(token)) return true
  if (!COMPACT_RE.test(token)) return false
  try {
    const json = JSON.parse(Buffer.from(token, 'base64').toString('utf8')) as {
      a?: unknown
      t?: unknown
      s?: unknown
    }
    return Boolean(json && (json.a || json.t || json.s))
  } catch {
    return true
  }
}

export function assertTunnelToken(raw: string): string {
  const token = sanitizeTunnelToken(raw)
  if (!token) {
    throw new Error(
      'Tunnel token is required. In Cloudflare: Networks → Tunnels → your tunnel → Add a replica → copy the eyJ… token.',
    )
  }
  if (UUID_RE.test(token)) {
    throw new Error(
      'That looks like a tunnel ID, not a token. Open the tunnel → Add a replica, and copy the eyJ… string from the install command.',
    )
  }
  if (!isCloudflareTunnelToken(token)) {
    throw new Error(
      'That is not a Cloudflare tunnel token. Open the tunnel → Add a replica, paste the install command or only the eyJ… part after --token.',
    )
  }
  return token
}

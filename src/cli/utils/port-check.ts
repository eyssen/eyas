// Part of eYssen. See LICENSE file for full copyright and licensing details.

/**
 * Probe a host:port and classify who answers — EYAS health, foreign HTTP, or free.
 */

export type PortProbeResult =
  | { status: 'free' }
  | { status: 'eyas'; version?: string; baseUrl: string }
  | { status: 'foreign'; baseUrl: string; httpStatus: number; hint: string }
  | { status: 'error'; message: string }

function looksLikeEyasHealth(body: unknown): body is { status?: string; version?: string } {
  if (!body || typeof body !== 'object') return false
  const o = body as Record<string, unknown>
  // EYAS health: { status: 'ok', version, timestamp }
  return o.status === 'ok' && (typeof o.version === 'string' || typeof o.timestamp === 'string')
}

export async function probeEyasPort(
  host: string,
  port: number,
  timeoutMs = 2000,
): Promise<PortProbeResult> {
  const bindHost = host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host
  const baseUrl = `http://${bindHost}:${port}`
  const url = `${baseUrl}/api/v1/health`

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
    let body: unknown
    try {
      body = await res.json()
    } catch {
      body = null
    }

    if (res.ok && looksLikeEyasHealth(body)) {
      return {
        status: 'eyas',
        version: typeof (body as any).version === 'string' ? (body as any).version : undefined,
        baseUrl,
      }
    }

    // Something answered but it is not EYAS health
    const msg =
      body && typeof body === 'object' && 'message' in body
        ? String((body as any).message)
        : res.statusText
    let hint = `HTTP ${res.status}${msg ? ` (${msg})` : ''}`
    if (res.status === 401 && typeof msg === 'string' && /unauthorized/i.test(msg)) {
      hint +=
        ' — often Grafana or another dashboard on this port (EYAS health is public and would return 200)'
    }
    return { status: 'foreign', baseUrl, httpStatus: res.status, hint }
  } catch (err: any) {
    const code = err?.cause?.code ?? err?.code
    if (
      code === 'ECONNREFUSED' ||
      code === 'ENOTFOUND' ||
      /ECONNREFUSED|fetch failed|Unable to connect/i.test(String(err?.message ?? err))
    ) {
      return { status: 'free' }
    }
    return { status: 'error', message: err instanceof Error ? err.message : String(err) }
  }
}

// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { spawn, execFileSync, type ChildProcess } from 'child_process'
import { existsSync, mkdirSync } from 'fs'
import { dirname, join } from 'path'
import type { IngressProvider, IngressStatus } from '../types.js'
import { assertTunnelToken } from '../tunnel-token.js'

const START_WAIT_MS = 20_000
const REGISTERED_RE = /Registered tunnel connection/i
const METRICS_RE = /Starting metrics server on (127\.0\.0\.1|\[::1\]):(\d+)/i

export function resolveCloudflaredBinary(): string {
  const fromEnv = process.env.CLOUDFLARED_PATH?.trim()
  if (fromEnv) {
    if (!existsSync(fromEnv)) {
      throw new Error(`cloudflared not found at CLOUDFLARED_PATH=${fromEnv}`)
    }
    return fromEnv
  }
  const candidates = [
    '/opt/homebrew/bin/cloudflared',
    '/usr/local/bin/cloudflared',
    '/usr/bin/cloudflared',
  ]
  for (const p of candidates) {
    if (existsSync(p)) return p
  }
  try {
    const found = execFileSync('which', ['cloudflared'], {
      encoding: 'utf8',
      timeout: 3000,
    }).trim()
    if (found && existsSync(found)) return found
  } catch {
    /* not on PATH */
  }
  throw new Error(
    'cloudflared not found. Install Cloudflare Tunnel and keep cloudflared on PATH (or set CLOUDFLARED_PATH).',
  )
}

export function normalizePublicHostname(raw?: string): string | undefined {
  let h = raw?.trim()
  if (!h) return undefined
  if (h.includes('@')) {
    throw new Error(
      'Hostname looks like an email. Use a DNS name such as jarvis-krisz.eyssen.ai (dot, not @).',
    )
  }
  h = h.replace(/^https?:\/\//i, '').replace(/\/+$/, '')
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(h)) {
    throw new Error(`Invalid public hostname: ${h}`)
  }
  return h
}

export function hostnameToUrl(hostname?: string): string | undefined {
  const h = normalizePublicHostname(hostname)
  return h ? `https://${h}` : undefined
}

export function createCloudflareProvider(): IngressProvider {
  let child: ChildProcess | null = null
  let tunnelUrl: string | undefined
  let hostname: string | undefined
  let connectedAt: string | null = null
  let lastError: string | null = null
  let registered = false
  let metricsBase: string | null = null
  let pollTimer: ReturnType<typeof setInterval> | null = null

  function snapshot(): IngressStatus {
    const running = child !== null && child.exitCode === null
    return {
      running,
      active: running && registered,
      url: tunnelUrl,
      hostname,
      connectedAt: running && registered ? connectedAt : null,
      lastError,
    }
  }

  function markRegistered() {
    if (registered) return
    registered = true
    connectedAt = new Date().toISOString()
    lastError = null
  }

  function stopPoller() {
    if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
  }

  function startPoller() {
    stopPoller()
    pollTimer = setInterval(() => {
      void probeReady()
    }, 3000)
  }

  async function probeReady(): Promise<boolean> {
    if (!metricsBase) return false
    try {
      const res = await fetch(`${metricsBase}/ready`, {
        signal: AbortSignal.timeout(800),
      })
      const body = (await res.json()) as { readyConnections?: number }
      if ((body.readyConnections ?? 0) > 0) {
        markRegistered()
        return true
      }
    } catch {
      /* metrics not up yet */
    }
    return false
  }

  function ingestLog(output: string) {
    const quick = output.match(/https?:\/\/[^\s]+\.trycloudflare\.com/)
    if (quick) tunnelUrl = quick[0]
    const metrics = output.match(METRICS_RE)
    if (metrics) metricsBase = `http://${metrics[1]}:${metrics[2]}`
    if (REGISTERED_RE.test(output)) markRegistered()
  }

  return {
    id: 'cloudflare',

    async start(config) {
      if (child && child.exitCode === null) {
        throw new Error('Cloudflare tunnel is already running')
      }

      const token = assertTunnelToken(config.token ?? '')

      const bin = resolveCloudflaredBinary()
      hostname = normalizePublicHostname(config.hostname)
      tunnelUrl = hostname ? `https://${hostname}` : undefined
      lastError = null
      connectedAt = null
      registered = false
      metricsBase = null

      const logDir = join('data', 'ingress')
      mkdirSync(logDir, { recursive: true })
      const logFile = join(logDir, 'cloudflared.log')
      // Token via env so it is not visible in `ps`. Let cloudflared pick QUIC/http2.
      const args = ['tunnel', '--logfile', logFile, '--no-autoupdate', '--edge-ip-version', '4', 'run']

      await new Promise<void>((resolve, reject) => {
        let settled = false
        const stderrChunks: string[] = []

        const fail = (message: string) => {
          if (settled) return
          settled = true
          stopPoller()
          lastError = message
          registered = false
          if (child && child.exitCode === null) {
            try {
              child.kill('SIGTERM')
            } catch {
              /* ignore */
            }
          }
          child = null
          connectedAt = null
          reject(new Error(message))
        }

        const succeed = () => {
          if (settled) return
          settled = true
          resolve()
        }

        try {
          child = spawn(bin, args, {
            stdio: ['ignore', 'pipe', 'pipe'],
            env: { ...process.env, TUNNEL_TOKEN: token },
          })
        } catch (err) {
          fail(err instanceof Error ? err.message : String(err))
          return
        }

        child.on('error', (err) => {
          fail(err.message)
        })

        const onChunk = (data: Buffer) => {
          const output = data.toString()
          stderrChunks.push(output)
          ingestLog(output)
          if (registered) succeed()
        }
        child.stderr?.on('data', onChunk)
        child.stdout?.on('data', onChunk)

        child.on('exit', (code) => {
          stopPoller()
          child = null
          connectedAt = null
          registered = false
          const tail = stderrChunks.join('').trim().slice(-800)
          const message = tail
            ? `cloudflared exited (code ${code ?? 'null'}): ${tail}`
            : `cloudflared exited (code ${code ?? 'null'})`
          if (!settled) fail(message)
          else lastError = message
        })

        startPoller()

        setTimeout(() => {
          if (settled) return
          if (!child || child.exitCode !== null) return
          if (registered) {
            succeed()
            return
          }
          const hint = stderrChunks.join('\n')
          const registerLine = hint
            .split('\n')
            .reverse()
            .find((l) => /register/i.test(l) && /(ERR|error)/i.test(l))
          lastError =
            registerLine?.replace(/^.*?(ERR|error)/i, 'cloudflared').trim() ||
            'cloudflared reached Cloudflare but registerConnection failed. Recreate the tunnel (Overview → delete Jarvis → Create), add published route jarvis-krisz.eyssen.ai → http://127.0.0.1:3100, paste the new eyJ… token, Stop, Start.'
          succeed()
        }, START_WAIT_MS)
      })

      return snapshot()
    },

    async stop() {
      stopPoller()
      registered = false
      metricsBase = null
      if (child) {
        const current = child
        child = null
        connectedAt = null
        current.kill('SIGTERM')
      }
    },

    getStatus() {
      return snapshot()
    },
  }
}

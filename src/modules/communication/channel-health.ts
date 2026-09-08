// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Channel health watchdog (Cap 2). A bot's polling loop fails transiently
// (network blip / 5xx / rate-limit → degraded, keep going) or fatally (401 bad
// token, or 409 conflict from a second poller → broken, operator must act).
// Fatal failures alert ONCE (not on every retry) and re-arm on recovery.
//
// In-process only — no table/tick of its own (it reuses Cap 1's reconcile tick
// and the bot's bot.catch handler as the signal source).

import { classifyAuthError } from '@shared/classify-auth-error.js'

export type ChannelHealthStatus = 'healthy' | 'degraded' | 'fatal'

export interface ChannelHealthState {
  status: ChannelHealthStatus
  lastError?: string
  lastErrorAt?: string
  fatalReason?: 'auth' | 'conflict'
}

export interface ChannelHealthDeps {
  now?: () => Date
  onAlert?: (channelId: string, state: ChannelHealthState) => void
}

export interface ChannelHealth {
  record(channelId: string, err: unknown): void
  recordOk(channelId: string): void
  get(channelId: string): ChannelHealthState
  list(): Record<string, ChannelHealthState>
}

const HEALTHY: ChannelHealthState = { status: 'healthy' }

/** Telegram surfaces codes on `error_code`; other channels on status/statusCode. */
function classifyChannelError(err: any): { fatal: boolean; reason?: 'auth' | 'conflict' } {
  const code = err?.error_code ?? err?.status ?? err?.statusCode
  if (code === 409) return { fatal: true, reason: 'conflict' }
  if (code === 401 || code === 403) return { fatal: true, reason: 'auth' }
  if (classifyAuthError(err).isAuth) return { fatal: true, reason: 'auth' } // message-based fallback
  return { fatal: false }
}

function errMsg(err: any): string {
  if (err instanceof Error) return err.message
  return err?.description ?? err?.message ?? `error (code ${err?.error_code ?? err?.status ?? '?'})`
}

export function createChannelHealth(deps: ChannelHealthDeps = {}): ChannelHealth {
  const now = deps.now ?? (() => new Date())
  const states = new Map<string, ChannelHealthState>()
  const alerted = new Set<string>()

  function record(channelId: string, err: unknown): void {
    const c = classifyChannelError(err)
    const state: ChannelHealthState = {
      status: c.fatal ? 'fatal' : 'degraded',
      lastError: errMsg(err),
      lastErrorAt: now().toISOString(),
      fatalReason: c.reason,
    }
    states.set(channelId, state)
    if (c.fatal && !alerted.has(channelId)) {
      alerted.add(channelId)
      deps.onAlert?.(channelId, state)
    }
  }

  function recordOk(channelId: string): void {
    states.set(channelId, { status: 'healthy' })
    alerted.delete(channelId)
  }

  function get(channelId: string): ChannelHealthState {
    return states.get(channelId) ?? HEALTHY
  }

  function list(): Record<string, ChannelHealthState> {
    return Object.fromEntries(states.entries())
  }

  return { record, recordOk, get, list }
}

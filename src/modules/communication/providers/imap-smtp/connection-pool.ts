// Part of eYssen. See LICENSE file for full copyright and licensing details.

/**
 * Per-account connection reuse for the IMAP/SMTP provider.
 *
 * We avoid a hard dependency on `imapflow` / `nodemailer`: the host adapter
 * (`submodules/email/adapter.ts`) already dynamically imports them. These
 * helpers cache open clients keyed by `host:port:user` so repeated polls
 * don't pay the TLS + IMAP LOGIN cost each time.
 *
 * Entries expire after {@link IdleTimeoutMs} of inactivity and are closed.
 */

import type { Logger } from 'pino'

export interface ImapCredentials {
  host: string
  port: number
  user: string
  pass: string
  secure?: boolean
}

export interface SmtpCredentials {
  host: string
  port: number
  user: string
  pass: string
  secure?: boolean
}

const IdleTimeoutMs = 30 * 60 * 1000

// We intentionally keep the client/transport types opaque (any) — their
// concrete shape comes from optional peer deps.
interface PooledEntry<T> {
  client: T
  lastUsed: number
  timer: ReturnType<typeof setTimeout> | undefined
}

export class ImapConnectionPool {
  private readonly entries = new Map<string, PooledEntry<unknown>>()
  constructor(
    private readonly logger: Logger,
    private readonly connect: (creds: ImapCredentials) => Promise<unknown>,
    private readonly disconnect: (client: unknown) => Promise<void>,
    private readonly idleMs: number = IdleTimeoutMs,
  ) {}

  async acquire(creds: ImapCredentials): Promise<unknown> {
    const key = `${creds.host}:${creds.port}:${creds.user}`
    const existing = this.entries.get(key)
    if (existing) {
      existing.lastUsed = Date.now()
      this.rearm(key, existing)
      return existing.client
    }
    const client = await this.connect(creds)
    const entry: PooledEntry<unknown> = {
      client,
      lastUsed: Date.now(),
      timer: undefined,
    }
    this.entries.set(key, entry)
    this.rearm(key, entry)
    this.logger.debug({ host: creds.host, user: creds.user }, 'IMAP connection pooled')
    return client
  }

  async close(host: string, port: number, user: string): Promise<void> {
    const key = `${host}:${port}:${user}`
    await this.closeByKey(key)
  }

  async closeAll(): Promise<void> {
    const keys = Array.from(this.entries.keys())
    for (const k of keys) await this.closeByKey(k)
  }

  private async closeByKey(key: string): Promise<void> {
    const entry = this.entries.get(key)
    if (!entry) return
    this.entries.delete(key)
    if (entry.timer) clearTimeout(entry.timer)
    try { await this.disconnect(entry.client) }
    catch (err) { this.logger.debug({ err }, 'IMAP disconnect error (ignored)') }
  }

  private rearm(key: string, entry: PooledEntry<unknown>): void {
    if (entry.timer) clearTimeout(entry.timer)
    entry.timer = setTimeout(() => {
      void this.closeByKey(key)
    }, this.idleMs)
    // Allow the process to exit even if the pool timer is pending.
    const t = entry.timer as unknown as { unref?: () => void }
    t?.unref?.()
  }
}

export class SmtpTransportPool {
  private readonly entries = new Map<string, PooledEntry<unknown>>()
  constructor(
    private readonly logger: Logger,
    private readonly connect: (creds: SmtpCredentials) => Promise<unknown>,
    private readonly disconnect: (transport: unknown) => Promise<void>,
    private readonly idleMs: number = IdleTimeoutMs,
  ) {}

  async acquire(creds: SmtpCredentials): Promise<unknown> {
    const key = `${creds.host}:${creds.port}:${creds.user}`
    const existing = this.entries.get(key)
    if (existing) {
      existing.lastUsed = Date.now()
      this.rearm(key, existing)
      return existing.client
    }
    const transport = await this.connect(creds)
    const entry: PooledEntry<unknown> = {
      client: transport,
      lastUsed: Date.now(),
      timer: undefined,
    }
    this.entries.set(key, entry)
    this.rearm(key, entry)
    this.logger.debug({ host: creds.host, user: creds.user }, 'SMTP transport pooled')
    return transport
  }

  async closeAll(): Promise<void> {
    const keys = Array.from(this.entries.keys())
    for (const k of keys) {
      const entry = this.entries.get(k)
      if (!entry) continue
      this.entries.delete(k)
      if (entry.timer) clearTimeout(entry.timer)
      try { await this.disconnect(entry.client) }
      catch (err) { this.logger.debug({ err }, 'SMTP close error (ignored)') }
    }
  }

  private rearm(key: string, entry: PooledEntry<unknown>): void {
    if (entry.timer) clearTimeout(entry.timer)
    entry.timer = setTimeout(() => {
      const ent = this.entries.get(key)
      if (!ent) return
      this.entries.delete(key)
      this.disconnect(ent.client).catch(err =>
        this.logger.debug({ err }, 'SMTP idle close error (ignored)'))
    }, this.idleMs)
    const t = entry.timer as unknown as { unref?: () => void }
    t?.unref?.()
  }
}

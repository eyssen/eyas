// Part of eYssen. See LICENSE file for full copyright and licensing details.

/**
 * Gmail history-list based listener.
 *
 * Instead of webhook + Google Cloud Pub/Sub (users.watch), we poll
 * /history.list every `pollIntervalMs`. This removes the external Pub/Sub
 * dependency (EYAS is self-hosted) and keeps the listener stateless except for
 * the persisted `startHistoryId` in ctx.secrets.
 *
 * Flow:
 *   1. On first run, call /profile to obtain the current historyId and persist it.
 *      No messages are delivered for this first cycle.
 *   2. On every subsequent tick, call /history.list?startHistoryId=<saved>&historyTypes=messageAdded,
 *      page through results, fetch the full message for each added id, convert to
 *      InboundEmail, and invoke the handler.
 *   3. Persist the latest historyId returned by the API (or the highest id seen).
 *
 * Robustness:
 *   - Gmail may return 404 if the historyId is too old; the caller should reseed
 *     from /profile when that happens. We surface this via `reseedHistoryId()`.
 *   - Duplicates are possible when pagination/backfill overlaps; the handler is
 *     expected to de-dupe by provider message id downstream.
 */

import type { Logger } from 'pino'
import type { InboundEmail } from '../email-common/types.js'
import type { GmailClient } from './gmail-client.js'
import { gmailMessageToInbound } from './mime-to-inbound.js'
import type { SecretsStore } from './types.js'

export interface GmailListenerOptions {
  client: GmailClient
  secrets: SecretsStore
  historyIdSecretKey: string
  onMessage: (m: InboundEmail) => void | Promise<void>
  pollIntervalMs?: number
  logger?: Logger
  /** Injected timer hooks for tests */
  setIntervalImpl?: (fn: () => void, ms: number) => unknown
  clearIntervalImpl?: (handle: unknown) => void
}

export class GmailListener {
  private readonly client: GmailClient
  private readonly secrets: SecretsStore
  private readonly key: string
  private readonly onMessage: (m: InboundEmail) => void | Promise<void>
  private readonly pollIntervalMs: number
  private readonly logger?: Logger
  private readonly setIntervalImpl: (fn: () => void, ms: number) => unknown
  private readonly clearIntervalImpl: (handle: unknown) => void
  private handle: unknown = null
  private running = false

  constructor(opts: GmailListenerOptions) {
    this.client = opts.client
    this.secrets = opts.secrets
    this.key = opts.historyIdSecretKey
    this.onMessage = opts.onMessage
    this.pollIntervalMs = opts.pollIntervalMs ?? 60_000
    this.logger = opts.logger
    this.setIntervalImpl = opts.setIntervalImpl ?? ((fn, ms) => setInterval(fn, ms))
    this.clearIntervalImpl = opts.clearIntervalImpl ?? ((h) => clearInterval(h as ReturnType<typeof setInterval>))
  }

  async start(): Promise<() => Promise<void>> {
    if (this.running) throw new Error('Gmail listener already running')
    // Ensure we have a seed historyId
    const seed = await this.secrets.get(this.key)
    if (!seed) await this.reseedHistoryId()
    this.running = true

    // Run a tick immediately — tests that call stop() right after start() should
    // not miss the first poll. We swallow errors so the interval keeps running.
    void this.tick().catch((err) => this.logger?.warn({ err }, 'Gmail listener: initial tick failed'))

    this.handle = this.setIntervalImpl(() => {
      void this.tick().catch((err) => this.logger?.warn({ err }, 'Gmail listener: tick failed'))
    }, this.pollIntervalMs)

    return async () => this.stop()
  }

  async stop(): Promise<void> {
    if (!this.running) return
    if (this.handle != null) this.clearIntervalImpl(this.handle)
    this.handle = null
    this.running = false
  }

  /** Seed the listener by reading the current historyId from the user's profile. */
  async reseedHistoryId(): Promise<string> {
    const profile = await this.client.getProfile()
    const historyId = profile.historyId
    if (!historyId) throw new Error('Gmail listener: profile did not return a historyId')
    await this.secrets.set(this.key, historyId)
    this.logger?.debug({ historyId }, 'Gmail listener: seeded historyId')
    return historyId
  }

  async tick(): Promise<void> {
    const startHistoryId = await this.secrets.get(this.key)
    if (!startHistoryId) {
      await this.reseedHistoryId()
      return
    }

    const seen = new Set<string>()
    let pageToken: string | undefined
    let latestHistoryId = startHistoryId

    for (;;) {
      const page = await this.client.listHistory({
        startHistoryId,
        pageToken,
        historyTypes: ['messageAdded'],
      })
      if (page.historyId && BigInt(page.historyId) > BigInt(latestHistoryId)) {
        latestHistoryId = page.historyId
      }
      for (const entry of page.history ?? []) {
        if (entry.id && BigInt(entry.id) > BigInt(latestHistoryId)) latestHistoryId = entry.id
        for (const added of entry.messagesAdded ?? []) {
          const id = added.message.id
          if (!id || seen.has(id)) continue
          seen.add(id)
          try {
            const raw = await this.client.getMessage(id, 'full')
            const inbound = gmailMessageToInbound(raw)
            await this.onMessage(inbound)
          } catch (err) {
            this.logger?.warn({ err, id }, 'Gmail listener: failed to fetch/handle message')
          }
        }
      }
      if (!page.nextPageToken) break
      pageToken = page.nextPageToken
    }

    if (latestHistoryId !== startHistoryId) {
      await this.secrets.set(this.key, latestHistoryId)
    }
  }
}

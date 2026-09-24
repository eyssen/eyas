// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { InboundEmail } from '../email-common/types.js'
import type { GraphClient } from './graph-client.js'
import { mimeToInbound } from './mime-to-inbound.js'
import {
  DEFAULT_POLL_INTERVAL_MS,
  GraphDeltaResponse,
  LoggerLike,
  SECRETS_KEY_DELTA_LINK,
  SecretsLike,
} from './types.js'

export interface DeltaListenerOptions {
  graph: GraphClient
  secrets: SecretsLike
  logger?: LoggerLike
  /** Polling interval (ms). Default 60 s. */
  pollIntervalMs?: number
  /** Attachment size cap passed to mimeToInbound. */
  maxAttachmentSizeBytes?: number
  /** Injectable timer primitives (for tests with fake timers). */
  timers?: {
    setTimeout: (fn: () => void, ms: number) => unknown
    clearTimeout: (h: unknown) => void
  }
}

/**
 * Delta listener for /me/mailFolders/Inbox/messages/delta.
 *
 * Lifecycle:
 *  1. On first start, fetch a full delta (no stored link) and persist the
 *     resulting @odata.deltaLink.
 *  2. On each subsequent tick, request the stored delta link. Messages that
 *     arrived since the last tick are returned.
 *  3. The delta link is persisted after every successful cycle.
 *  4. stop() cancels the next scheduled tick.
 */
export class DeltaListener {
  private readonly graph: GraphClient
  private readonly secrets: SecretsLike
  private readonly logger: LoggerLike | undefined
  private readonly pollIntervalMs: number
  private readonly maxAttachmentSizeBytes: number | undefined
  private readonly timers: {
    setTimeout: (fn: () => void, ms: number) => unknown
    clearTimeout: (h: unknown) => void
  }

  private stopped = false
  private pendingTimer: unknown = null

  constructor(opts: DeltaListenerOptions) {
    this.graph = opts.graph
    this.secrets = opts.secrets
    this.logger = opts.logger
    this.pollIntervalMs = opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
    this.maxAttachmentSizeBytes = opts.maxAttachmentSizeBytes
    this.timers = opts.timers ?? {
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    }
  }

  /**
   * Start the polling loop. Returns a stop() function. The first cycle runs
   * immediately so callers get new mail without waiting for the first tick.
   */
  async start(onMessage: (m: InboundEmail) => void | Promise<void>): Promise<() => Promise<void>> {
    this.stopped = false
    await this.cycleSafely(onMessage)
    this.scheduleNext(onMessage)
    return async () => {
      this.stopped = true
      if (this.pendingTimer !== null) {
        this.timers.clearTimeout(this.pendingTimer)
        this.pendingTimer = null
      }
    }
  }

  private scheduleNext(onMessage: (m: InboundEmail) => void | Promise<void>): void {
    if (this.stopped) return
    this.pendingTimer = this.timers.setTimeout(() => {
      this.pendingTimer = null
      if (this.stopped) return
      void this.cycleSafely(onMessage).finally(() => this.scheduleNext(onMessage))
    }, this.pollIntervalMs)
  }

  private async cycleSafely(
    onMessage: (m: InboundEmail) => void | Promise<void>,
  ): Promise<void> {
    try {
      await this.cycle(onMessage)
    } catch (e) {
      this.logger?.warn({ err: (e as Error).message }, 'DeltaListener cycle failed')
    }
  }

  /**
   * One delta-query iteration.
   *
   * Follows @odata.nextLink pagination; the final page provides
   * @odata.deltaLink which is persisted for the next tick.
   */
  async cycle(onMessage: (m: InboundEmail) => void | Promise<void>): Promise<void> {
    const storedDeltaLink = await this.secrets.get(SECRETS_KEY_DELTA_LINK)

    let response: GraphDeltaResponse
    if (storedDeltaLink) {
      response = await this.graph.request<GraphDeltaResponse>({
        method: 'GET',
        path: '',
        absoluteUrl: storedDeltaLink,
      })
    } else {
      response = await this.graph.request<GraphDeltaResponse>({
        method: 'GET',
        path: '/me/mailFolders/Inbox/messages/delta',
      })
    }

    let deltaLink: string | undefined
    // Follow nextLink pages; Graph only returns deltaLink on the final page.
    // eslint-disable-next-line no-constant-condition
    while (true) {
      for (const raw of response.value ?? []) {
        try {
          const inbound = mimeToInbound(raw, {
            maxAttachmentSizeBytes: this.maxAttachmentSizeBytes,
          })
          if (raw.hasAttachments && (raw.attachments?.length ?? 0) > inbound.attachments.length) {
            this.logger?.warn(
              { messageId: inbound.id },
              'Some attachments exceeded size cap and were skipped',
            )
          }
          await onMessage(inbound)
        } catch (e) {
          this.logger?.warn(
            { err: (e as Error).message, messageId: raw.id },
            'Failed to process message',
          )
        }
      }
      const nextLink = response['@odata.nextLink']
      const dLink = response['@odata.deltaLink']
      if (dLink) {
        deltaLink = dLink
        break
      }
      if (!nextLink) break
      response = await this.graph.request<GraphDeltaResponse>({
        method: 'GET',
        path: '',
        absoluteUrl: nextLink,
      })
    }

    if (deltaLink) {
      await this.secrets.set(SECRETS_KEY_DELTA_LINK, deltaLink)
    }
  }
}

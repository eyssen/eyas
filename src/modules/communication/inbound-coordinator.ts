// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Durable, at-least-once inbound coordinator for every channel.
//
// A channel provider hands each inbound message to enqueue(), which persists it
// with a UNIQUE(source, provider_message_id) dedup key — this row, not the bus
// emit, is the at-least-once guarantee. deliverPending() (called immediately and
// again from a leader-gated reconcile tick) drains pending rows: it find-or-
// creates ONE conversation per (source, channel, sender), persists the inbound
// user message exactly once (wrapped as untrusted), runs the bound agent, and
// replies on the channel. Failures back off via the shared recovery primitive
// and finally dead-letter. An in-process reply-guard drops the bot's own
// messages and reply echoes so a channel that re-delivers bot output can't loop.

import { sql } from 'drizzle-orm'
import type { Logger } from 'pino'
import { decideRecovery } from '@shared/backoff.js'
import { wrapUntrusted } from '@shared/untrusted.js'

export interface InboundMessage {
  source: string
  providerMessageId: string
  channelId: string
  senderId: string
  senderName?: string
  content: string
  attachments?: unknown
  replyToId?: string
  receivedAt: string
  /** EYAS connector id (multi-instance); optional for legacy rows. */
  connectorId?: string
}

export interface InboundEventRow {
  id: number
  source: string
  provider_message_id: string
  channel_id: string
  sender_id: string
  sender_name: string | null
  content: string
  attachments: string | null
  reply_to_id: string | null
  received_at: string
  status: 'pending' | 'delivered' | 'dead' | 'skipped'
  attempts: number
  next_attempt_at: string | null
  conversation_id: string | null
  last_error: string | null
  delivered_at: string | null
  connector_id?: string | null
}

export interface ChannelBinding {
  agentId: string | null
  mode: string
}

export interface InboundCoordinatorDeps {
  db: any
  logger: Logger
  /** Resolve the agent + conversation mode bound to a channel (from channel_configs). */
  resolveBinding(input: { source: string; channelId: string; connectorId?: string }): ChannelBinding
  /** Create a conversation for a newly-seen (source, channel, sender); returns its id. */
  createConversation(input: {
    source: string
    channelId: string
    senderId: string
    senderName?: string
    agentId: string | null
    mode: string
    connectorId?: string
  }): string
  /** Append a message to a conversation. */
  addMessage(conversationId: string, role: 'user' | 'assistant', content: string): void
  /** Run the bound agent for a conversation; returns the reply text to send (or null). */
  runAgent(input: {
    conversationId: string
    agentId: string | null
    mode: string
    signal?: AbortSignal
  }): Promise<{ replyText: string | null }>
  /** Send a reply back on the originating channel. */
  reply(msg: InboundMessage, text: string): Promise<void>
  /** True when the message originates from our own bot (provider self id). */
  isSelf?(msg: InboundMessage): boolean
  now?: () => Date
  maxAttempts?: number
  baseBackoffMs?: number
  capBackoffMs?: number
  batchLimit?: number
  echoCacheSize?: number
  signal?: AbortSignal
}

export interface InboundCoordinator {
  enqueue(msg: InboundMessage): { accepted: boolean }
  deliverPending(): Promise<number>
  list(opts?: { status?: string; limit?: number }): InboundEventRow[]
  get(id: number): InboundEventRow | null
  retry(id: number): boolean
}

export function createInboundTables(db: any): void {
  db.run(sql`CREATE TABLE IF NOT EXISTS channel_inbound_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL,
    provider_message_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    sender_id TEXT NOT NULL,
    sender_name TEXT,
    content TEXT NOT NULL,
    attachments TEXT,
    reply_to_id TEXT,
    received_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','delivered','dead','skipped')),
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TEXT,
    conversation_id TEXT,
    last_error TEXT,
    delivered_at TEXT,
    UNIQUE (source, provider_message_id)
  )`)
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_channel_inbound_due ON channel_inbound_events(status, next_attempt_at)`)
  try { db.run(sql.raw(`ALTER TABLE channel_inbound_events ADD COLUMN connector_id TEXT`)) } catch { /* exists */ }

  db.run(sql`CREATE TABLE IF NOT EXISTS channel_conversations (
    source TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    channel_sender_id TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (source, channel_id, channel_sender_id)
  )`)
  try { db.run(sql.raw(`ALTER TABLE channel_conversations ADD COLUMN connector_id TEXT`)) } catch { /* exists */ }
}

const iso = (d: Date) => d.toISOString()
const echoKey = (source: string, channelId: string, text: string) => `${source}:${channelId}:${text.trim()}`

/** Telegram-style slash commands that start a new channel thread (`/new`, `/start`, `/new@bot`). */
export function isNewConversationCommand(content: string): boolean {
  return /^\/(new|start)(?:@\S+)?(?:\s|$)/i.test(content.trim())
}

const NEW_CONVERSATION_REPLY = 'Started a new conversation. Send a message to begin.'

export function createInboundCoordinator(deps: InboundCoordinatorDeps): InboundCoordinator {
  const { db, logger } = deps
  const now = deps.now ?? (() => new Date())
  const maxAttempts = deps.maxAttempts ?? 5
  const baseBackoffMs = deps.baseBackoffMs ?? 30_000
  const capBackoffMs = deps.capBackoffMs ?? 3_600_000
  const batchLimit = deps.batchLimit ?? 50
  const echoCacheSize = deps.echoCacheSize ?? 256
  const isSelf = deps.isSelf ?? (() => false)

  // Reply-guard: bounded set of replies we recently SENT, to drop their echoes.
  const recentSent = new Set<string>()
  const recentSentOrder: string[] = []
  function rememberSent(msg: InboundMessage, text: string) {
    const key = echoKey(msg.source, msg.channelId, text)
    if (recentSent.has(key)) return
    recentSent.add(key)
    recentSentOrder.push(key)
    while (recentSentOrder.length > echoCacheSize) {
      const old = recentSentOrder.shift()
      if (old) recentSent.delete(old)
    }
  }
  const isEcho = (msg: InboundMessage) => recentSent.has(echoKey(msg.source, msg.channelId, msg.content))

  function enqueue(msg: InboundMessage): { accepted: boolean } {
    db.run(sql`INSERT OR IGNORE INTO channel_inbound_events
      (source, provider_message_id, channel_id, sender_id, sender_name, content, attachments, reply_to_id, received_at, status, attempts, next_attempt_at, connector_id)
      VALUES (${msg.source}, ${msg.providerMessageId}, ${msg.channelId}, ${msg.senderId}, ${msg.senderName ?? null},
              ${msg.content}, ${msg.attachments ? JSON.stringify(msg.attachments) : null}, ${msg.replyToId ?? null},
              ${msg.receivedAt}, 'pending', 0, ${msg.receivedAt}, ${msg.connectorId ?? null})`)
    const changed = (db.all(sql`SELECT changes() AS c`) as Array<{ c: number }>)[0]?.c ?? 0
    return { accepted: changed > 0 }
  }

  function rowToMsg(row: InboundEventRow): InboundMessage {
    return {
      source: row.source,
      providerMessageId: row.provider_message_id,
      channelId: row.channel_id,
      senderId: row.sender_id,
      senderName: row.sender_name ?? undefined,
      content: row.content,
      attachments: row.attachments ? JSON.parse(row.attachments) : undefined,
      replyToId: row.reply_to_id ?? undefined,
      receivedAt: row.received_at,
      connectorId: row.connector_id ?? undefined,
    }
  }

  /** Include connector so multi-instance peers don't share conversation threads. */
  function convMapChannelId(msg: InboundMessage): string {
    return msg.connectorId ? `${msg.connectorId}::${msg.channelId}` : msg.channelId
  }

  function ensureConversation(msg: InboundMessage, binding: ChannelBinding): string {
    const mapId = convMapChannelId(msg)
    const existing = db.all(
      sql`SELECT conversation_id FROM channel_conversations
          WHERE source=${msg.source} AND channel_id=${mapId} AND channel_sender_id=${msg.senderId}`
    ) as Array<{ conversation_id: string }>
    if (existing[0]) return existing[0].conversation_id

    const conversationId = deps.createConversation({
      source: msg.source,
      channelId: msg.channelId,
      senderId: msg.senderId,
      senderName: msg.senderName,
      agentId: binding.agentId,
      mode: binding.mode,
      connectorId: msg.connectorId,
    })
    db.run(
      sql`INSERT OR IGNORE INTO channel_conversations (source, channel_id, channel_sender_id, conversation_id, created_at, connector_id)
          VALUES (${msg.source}, ${mapId}, ${msg.senderId}, ${conversationId}, ${iso(now())}, ${msg.connectorId ?? null})`
    )
    const row = (db.all(
      sql`SELECT conversation_id FROM channel_conversations
          WHERE source=${msg.source} AND channel_id=${mapId} AND channel_sender_id=${msg.senderId}`
    ) as Array<{ conversation_id: string }>)[0]
    return row.conversation_id
  }

  async function processRow(row: InboundEventRow): Promise<void> {
    const msg = rowToMsg(row)

    if (isSelf(msg) || isEcho(msg)) {
      db.run(sql`UPDATE channel_inbound_events SET status='skipped', delivered_at=${iso(now())} WHERE id=${row.id}`)
      return
    }

    if (isNewConversationCommand(msg.content)) {
      const mapId = convMapChannelId(msg)
      db.run(
        sql`DELETE FROM channel_conversations
            WHERE source=${msg.source} AND channel_id=${mapId} AND channel_sender_id=${msg.senderId}`,
      )
      await deps.reply(msg, NEW_CONVERSATION_REPLY)
      db.run(sql`UPDATE channel_inbound_events SET status='skipped', delivered_at=${iso(now())} WHERE id=${row.id}`)
      return
    }

    try {
      const binding = deps.resolveBinding({
        source: msg.source,
        channelId: msg.channelId,
        connectorId: msg.connectorId,
      })

      // Phase A (once): create/link the conversation and persist the user
      // message. conversation_id on the row marks it done, so a retry never
      // re-sends the user message.
      let conversationId = row.conversation_id
      if (!conversationId) {
        conversationId = ensureConversation(msg, binding)
        deps.addMessage(conversationId, 'user', wrapUntrusted(msg.content, { source: msg.source }))
        db.run(sql`UPDATE channel_inbound_events SET conversation_id=${conversationId} WHERE id=${row.id}`)
      }

      // Phase B (each attempt): run the bound agent and reply. Unbound channels
      // record the message but do not auto-run (no message loss).
      if (binding.agentId) {
        const { replyText } = await deps.runAgent({
          conversationId,
          agentId: binding.agentId,
          mode: binding.mode,
          signal: deps.signal,
        })
        if (replyText) {
          rememberSent(msg, replyText)
          await deps.reply(msg, replyText)
        }
      }

      db.run(
        sql`UPDATE channel_inbound_events SET status='delivered', conversation_id=${conversationId}, delivered_at=${iso(now())}, last_error=NULL WHERE id=${row.id}`
      )
    } catch (err: any) {
      const message = err?.message ?? String(err)
      const decision = decideRecovery({ attempts: row.attempts, maxAttempts, baseMs: baseBackoffMs, capMs: capBackoffMs })
      if (decision.action === 'dead') {
        db.run(sql`UPDATE channel_inbound_events SET status='dead', attempts=${decision.attempts}, last_error=${message} WHERE id=${row.id}`)
        logger.warn({ id: row.id, attempts: decision.attempts }, 'Inbound event dead-lettered')
      } else {
        const nextAt = iso(new Date(now().getTime() + decision.delayMs))
        db.run(
          sql`UPDATE channel_inbound_events SET attempts=${decision.attempts}, next_attempt_at=${nextAt}, last_error=${message} WHERE id=${row.id}`
        )
        logger.debug({ id: row.id, attempts: decision.attempts, nextAt }, 'Inbound event rescheduled')
      }
    }
  }

  async function deliverPending(): Promise<number> {
    const nowIso = iso(now())
    const rows = db.all(
      sql`SELECT * FROM channel_inbound_events
          WHERE status='pending' AND (next_attempt_at IS NULL OR next_attempt_at <= ${nowIso})
          ORDER BY id ASC LIMIT ${batchLimit}`
    ) as InboundEventRow[]
    for (const row of rows) {
      await processRow(row)
    }
    return rows.length
  }

  function list(opts: { status?: string; limit?: number } = {}): InboundEventRow[] {
    const limit = opts.limit ?? 200
    if (opts.status) {
      return db.all(
        sql`SELECT * FROM channel_inbound_events WHERE status=${opts.status} ORDER BY id DESC LIMIT ${limit}`
      ) as InboundEventRow[]
    }
    return db.all(sql`SELECT * FROM channel_inbound_events ORDER BY id DESC LIMIT ${limit}`) as InboundEventRow[]
  }

  function get(id: number): InboundEventRow | null {
    const rows = db.all(sql`SELECT * FROM channel_inbound_events WHERE id=${id}`) as InboundEventRow[]
    return rows[0] ?? null
  }

  function retry(id: number): boolean {
    if (!get(id)) return false
    db.run(
      sql`UPDATE channel_inbound_events SET status='pending', attempts=0, next_attempt_at=${iso(now())}, last_error=NULL WHERE id=${id}`
    )
    return true
  }

  return { enqueue, deliverPending, list, get, retry }
}

// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'
import type { ToolImplementation } from '../types.js'

/**
 * Email L2 loop: draft → human approve → send.
 *
 * Drafts live in `email_drafts` (local SQLite). Send only via `email_send_draft`
 * after status=approved (or explicit operator approval through the security gate).
 * Money/legal topics should never auto-approve — classifier safety floor + red send.
 */

export interface EmailToolsWiring {
  getDb: () => any
  getCommunication: () => any
  bus?: { emit: (type: string, payload: unknown) => void }
}

export function ensureEmailDraftTables(db: any): void {
  db.run(sql`CREATE TABLE IF NOT EXISTS email_drafts (
    id TEXT PRIMARY KEY,
    channel_id TEXT,
    to_addr TEXT NOT NULL,
    subject TEXT NOT NULL,
    body TEXT NOT NULL,
    in_reply_to TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    created_by TEXT,
    conversation_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    sent_at TEXT,
    error TEXT
  )`)
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_email_drafts_status ON email_drafts(status)`)
}

function id(): string {
  return `edraft_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export function createEmailTools(wiring: EmailToolsWiring): ToolImplementation[] {
  const db = () => {
    const d = wiring.getDb()
    ensureEmailDraftTables(d)
    return d
  }

  return [
    {
      name: 'email_create_draft',
      description:
        'Create an email draft for human review. Does NOT send. Use email_send_draft only after approval.',
      category: 'communication',
      riskTier: 'yellow',
      inputSchema: {
        type: 'object',
        properties: {
          to: { type: 'string', description: 'Recipient email' },
          subject: { type: 'string' },
          body: { type: 'string' },
          channelId: { type: 'string', description: 'Optional channel instance id' },
          inReplyTo: { type: 'string', description: 'Optional message-id being replied to' },
          conversationId: { type: 'string' },
        },
        required: ['to', 'subject', 'body'],
      },
      execute: async (input, ctx) => {
        const d = db()
        const draftId = id()
        const now = new Date().toISOString()
        d.run(sql`INSERT INTO email_drafts (id, channel_id, to_addr, subject, body, in_reply_to, status, created_by, conversation_id, created_at, updated_at)
          VALUES (${draftId}, ${input.channelId ?? null}, ${input.to}, ${input.subject}, ${input.body},
                  ${input.inReplyTo ?? null}, 'pending', ${ctx?.agentId ?? ctx?.userId ?? 'agent'},
                  ${input.conversationId ?? ctx?.conversationId ?? null}, ${now}, ${now})`)
        wiring.bus?.emit('email.draft_created', { draftId, to: input.to, subject: input.subject })
        return {
          draftId,
          status: 'pending',
          message: 'Draft saved. Operator must approve before email_send_draft.',
        }
      },
    },
    {
      name: 'email_list_drafts',
      description: 'List email drafts by status (pending|approved|sent|rejected).',
      category: 'communication',
      riskTier: 'green',
      inputSchema: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['pending', 'approved', 'sent', 'rejected', 'all'] },
          limit: { type: 'number' },
        },
      },
      execute: async (input) => {
        const d = db()
        const status = (input.status as string) || 'pending'
        const limit = (input.limit as number) ?? 20
        const rows =
          status === 'all'
            ? (d.all(sql`SELECT * FROM email_drafts ORDER BY created_at DESC LIMIT ${limit}`) as any[])
            : (d.all(sql`SELECT * FROM email_drafts WHERE status = ${status} ORDER BY created_at DESC LIMIT ${limit}`) as any[])
        return {
          drafts: rows.map((r) => ({
            id: r.id,
            to: r.to_addr,
            subject: r.subject,
            bodyPreview: String(r.body).slice(0, 200),
            status: r.status,
            createdAt: r.created_at,
          })),
        }
      },
    },
    {
      name: 'email_approve_draft',
      description: 'Mark a draft as approved (operator/agent with rights). Required before send.',
      category: 'communication',
      riskTier: 'yellow',
      requiresApproval: true,
      inputSchema: {
        type: 'object',
        properties: {
          draftId: { type: 'string' },
        },
        required: ['draftId'],
      },
      execute: async (input) => {
        const d = db()
        const now = new Date().toISOString()
        const rows = d.all(sql`SELECT * FROM email_drafts WHERE id = ${input.draftId as string}`) as any[]
        const row = rows[0]
        if (!row) return { error: 'Draft not found' }
        if (row.status === 'sent') return { error: 'Draft already sent' }
        d.run(sql`UPDATE email_drafts SET status = 'approved', updated_at = ${now} WHERE id = ${input.draftId as string}`)
        return { draftId: input.draftId, status: 'approved' }
      },
    },
    {
      name: 'email_send_draft',
      description:
        'Send an APPROVED email draft via the configured email channel. Refuses pending/rejected drafts. Never auto-sends money/legal without approval path.',
      category: 'communication',
      riskTier: 'red',
      requiresApproval: true,
      inputSchema: {
        type: 'object',
        properties: {
          draftId: { type: 'string' },
        },
        required: ['draftId'],
      },
      execute: async (input) => {
        const d = db()
        const drafts = d.all(sql`SELECT * FROM email_drafts WHERE id = ${input.draftId as string}`) as any[]
        const draft = drafts[0]
        if (!draft) return { error: 'Draft not found' }
        if (draft.status !== 'approved') {
          return { error: `Draft status is '${draft.status}' — must be 'approved' before send` }
        }

        const comm = wiring.getCommunication()
        const router = comm?.router
        if (!router?.send && !comm?.send) {
          // Fallback: mark as sent in dry-run mode when no channel is wired (tests).
          const now = new Date().toISOString()
          d.run(sql`UPDATE email_drafts SET status = 'sent', sent_at = ${now}, updated_at = ${now}, error = ${'no channel — dry-run'} WHERE id = ${draft.id}`)
          return { ok: true, dryRun: true, draftId: draft.id, message: 'No email channel — draft marked sent (dry-run)' }
        }

        try {
          const channelId = draft.channel_id
          const content = {
            text: draft.body,
            subject: draft.subject,
            to: draft.to_addr,
          }
          if (channelId && router?.send) {
            await router.send(channelId, content)
          } else if (comm?.send) {
            await comm.send(content)
          }
          const now = new Date().toISOString()
          d.run(sql`UPDATE email_drafts SET status = 'sent', sent_at = ${now}, updated_at = ${now} WHERE id = ${draft.id}`)
          wiring.bus?.emit('email.draft_sent', { draftId: draft.id, to: draft.to_addr })
          return { ok: true, draftId: draft.id, status: 'sent' }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          const now = new Date().toISOString()
          d.run(sql`UPDATE email_drafts SET error = ${message}, updated_at = ${now} WHERE id = ${draft.id}`)
          return { error: message }
        }
      },
    },
  ]
}

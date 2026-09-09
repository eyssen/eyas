// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Outbound Telegram ping when a yellow/red tool is waiting on a human.
// Resolve the chat from the conversation's channel mapping, else from approved
// Telegram pairings. Buttons call the existing autonomy decide() path so the
// parked-run resume (autonomy:approval-resolved) keeps working. Never include
// raw tool args in the ping.

import { sql } from 'drizzle-orm'
import type { Logger } from 'pino'
import type { ChannelContent } from './types.js'

export interface ApprovalPingNotice {
  id: number
  toolName: string | null
  reason: string | null
  conversationId: string | null
}

export interface ApprovalPingCallback {
  chatId: string
  senderId: string
  data: string
}

export interface ApprovalLike {
  id: number
  toolName: string | null
  reason: string | null
  conversationId: string | null
  status: string
  inputJson?: string | null
}

export interface ApprovalPingDeps {
  db: any
  logger: Logger
  listApprovedTelegramChats(): string[]
  sendTelegram(chatId: string, content: ChannelContent): Promise<void>
  getApproval(id: number): ApprovalLike | null
  decide(id: number, status: 'approved' | 'rejected', actor: string): { ok: boolean; status?: string }
  emitResolved(payload: { approvalId: number; status: 'approved' | 'rejected'; decidedBy: string }): void
}

export interface ApprovalPing {
  notify(notice: ApprovalPingNotice): Promise<void>
  handleCallback(input: ApprovalPingCallback): Promise<{ ok: boolean; text: string }>
}

const CALLBACK_RE = /^appr:(\d+):(y|n)$/

export function parseApprovalCallback(data: string): { approvalId: number; status: 'approved' | 'rejected' } | null {
  const m = CALLBACK_RE.exec(data)
  if (!m) return null
  return { approvalId: Number(m[1]), status: m[2] === 'y' ? 'approved' : 'rejected' }
}

/** `telegram::123` (multi-instance map key) → `123`; bare chat ids pass through. */
export function telegramChatIdFromMap(channelId: string): string {
  const idx = channelId.lastIndexOf('::')
  return idx >= 0 ? channelId.slice(idx + 2) : channelId
}

function unique(ids: string[]): string[] {
  return [...new Set(ids.filter(Boolean))]
}

export function createApprovalPing(deps: ApprovalPingDeps): ApprovalPing {
  function chatsForConversation(conversationId: string | null): string[] {
    if (conversationId) {
      const rows = deps.db.all(
        sql`SELECT source, channel_id FROM channel_conversations WHERE conversation_id=${conversationId}`,
      ) as Array<{ source: string; channel_id: string }>
      const mapped = rows
        .filter((r) => r.source === 'telegram')
        .map((r) => telegramChatIdFromMap(r.channel_id))
      if (mapped.length) return unique(mapped)
    }
    return unique(deps.listApprovedTelegramChats())
  }

  async function notify(notice: ApprovalPingNotice): Promise<void> {
    const chats = chatsForConversation(notice.conversationId)
    if (!chats.length) return

    const tool = notice.toolName ?? 'tool'
    const reason = notice.reason ?? 'Approval required'
    const text = `⚠️ Approval needed\n\nTool: ${tool}\n${reason}`
    const content: ChannelContent = {
      text,
      actions: [
        { label: 'Approve', action: `appr:${notice.id}:y` },
        { label: 'Deny', action: `appr:${notice.id}:n` },
      ],
    }
    for (const chatId of chats) {
      try {
        await deps.sendTelegram(chatId, content)
      } catch (err) {
        deps.logger.warn({ err, chatId, approvalId: notice.id }, 'Telegram approval ping failed')
      }
    }
  }

  async function handleCallback(input: ApprovalPingCallback): Promise<{ ok: boolean; text: string }> {
    const parsed = parseApprovalCallback(input.data)
    if (!parsed) return { ok: false, text: 'Unknown action' }

    const row = deps.getApproval(parsed.approvalId)
    if (!row) return { ok: false, text: 'Approval not found' }
    if (row.status !== 'pending') return { ok: false, text: `Already ${row.status}` }

    const actor = `telegram:${input.senderId}`
    const res = deps.decide(parsed.approvalId, parsed.status, actor)
    if (!res.ok) return { ok: false, text: `Already ${res.status ?? row.status}` }

    deps.emitResolved({ approvalId: parsed.approvalId, status: parsed.status, decidedBy: actor })
    return {
      ok: true,
      text: parsed.status === 'approved' ? 'Approved' : 'Denied',
    }
  }

  return { notify, handleCallback }
}

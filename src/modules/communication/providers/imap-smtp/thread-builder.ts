// Part of eYssen. See LICENSE file for full copyright and licensing details.

/**
 * Simplified JWZ-style thread builder.
 *
 * Each inbound message has a Message-ID, optional In-Reply-To, and optional
 * References. We build a union-find of message-ids so every reply chain ends
 * up in the same thread.
 *
 * {@link ThreadIndex} is intended to be kept in memory by the router session
 * for the lifetime of the poll cycle; persistence (if needed) is the caller's
 * responsibility.
 */

import type { EmailThread } from './types.js'

export interface ThreadInput {
  messageId: string
  inReplyTo?: string
  references?: string[]
  /** Fallback grouping key (normalised subject). */
  normalisedSubject?: string
  /** ms since epoch — used for ordering inside a thread. */
  receivedAt?: number
}

export class ThreadIndex {
  private parent = new Map<string, string>()
  private received = new Map<string, number>()
  private subjectThread = new Map<string, string>()
  private order = new Map<string, number>()
  private nextSeq = 0

  /** Return the thread id for a message (creates the thread if new). */
  add(input: ThreadInput): string {
    const id = input.messageId
    if (!this.parent.has(id)) {
      this.parent.set(id, id)
      this.order.set(id, this.nextSeq++)
    }
    if (input.receivedAt !== undefined) this.received.set(id, input.receivedAt)

    const refs = [
      ...(input.references ?? []),
      ...(input.inReplyTo ? [input.inReplyTo] : []),
    ].filter(Boolean)

    for (const ref of refs) {
      if (!this.parent.has(ref)) {
        this.parent.set(ref, ref)
        this.order.set(ref, this.nextSeq++)
      }
      this.union(id, ref)
    }

    // Subject-based fallback: same normalised subject → same thread.
    if (refs.length === 0 && input.normalisedSubject) {
      const key = input.normalisedSubject
      const existing = this.subjectThread.get(key)
      if (existing) this.union(id, existing)
      else this.subjectThread.set(key, id)
    }
    return this.find(id)
  }

  /** All messages in the thread containing `messageId`, ordered by receivedAt. */
  threadOf(messageId: string): EmailThread | null {
    if (!this.parent.has(messageId)) return null
    const root = this.find(messageId)
    const members: { id: string; t: number }[] = []
    for (const id of this.parent.keys()) {
      if (this.find(id) === root) {
        members.push({ id, t: this.received.get(id) ?? 0 })
      }
    }
    members.sort((a, b) => a.t - b.t || a.id.localeCompare(b.id))
    return {
      threadId: root,
      messageIds: members.map(m => m.id),
    }
  }

  /** All known threads, sorted by first-message timestamp. */
  allThreads(): EmailThread[] {
    const seen = new Set<string>()
    const out: EmailThread[] = []
    for (const id of this.parent.keys()) {
      const root = this.find(id)
      if (seen.has(root)) continue
      seen.add(root)
      const t = this.threadOf(id)
      if (t) out.push(t)
    }
    return out
  }

  clear(): void {
    this.parent.clear()
    this.received.clear()
    this.subjectThread.clear()
    this.order.clear()
    this.nextSeq = 0
  }

  // ---------- union-find ----------

  private find(id: string): string {
    let cur = id
    let parent = this.parent.get(cur)
    while (parent && parent !== cur) {
      const grand = this.parent.get(parent) ?? parent
      this.parent.set(cur, grand)
      cur = parent
      parent = grand
    }
    return cur
  }

  private union(a: string, b: string): void {
    const ra = this.find(a)
    const rb = this.find(b)
    if (ra === rb) return
    // Prefer the earlier-seen id as root so the thread's id is stable
    // across the insertion order in which references arrive.
    const oa = this.order.get(ra) ?? 0
    const ob = this.order.get(rb) ?? 0
    if (oa <= ob) this.parent.set(rb, ra)
    else this.parent.set(ra, rb)
  }
}

/**
 * Normalise a subject for subject-based fallback threading.
 * Strips `Re:`, `Fwd:`, `Fw:`, `Vá:` (Hungarian "reply"), `Továbbítás:`
 * and whitespace, case-insensitively.
 */
export function normalizeSubject(subject: string | undefined): string {
  if (!subject) return ''
  let s = subject.trim()
  const prefixes = /^((re|fwd|fw|aw|sv|vá|vas|továbbítás|tovabbitas)\s*:\s*)+/i
  s = s.replace(prefixes, '')
  return s.toLowerCase().replace(/\s+/g, ' ').trim()
}

/**
 * One-shot convenience: build all threads from a list of messages.
 */
export function buildThreads(messages: ThreadInput[]): EmailThread[] {
  const idx = new ThreadIndex()
  for (const m of messages) idx.add(m)
  return idx.allThreads()
}

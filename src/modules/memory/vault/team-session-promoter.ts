// Part of eYssen. See LICENSE file for full copyright and licensing details.

/**
 * Promotes a completed team session's findings/decisions to a durable vault note.
 *
 * Rationale: team memory lives in `team_memory` tied to an ephemeral session id.
 * Once the session ends, high-value findings/decisions should persist somewhere
 * retrievable by future conversations — i.e., the semantic vault. This promoter
 * groups entries by category, writes a single markdown note, and returns the
 * path so the caller can add it to the session's completion record.
 *
 * The findings and decisions are model-authored durable text, so each entry
 * passes the same poison gate arbitration uses (v2/model-write-gate.ts): an
 * instruction-shaped entry is left out (logged, never silent), and when none
 * is left nothing is written. The note carries frontmatter `origin`
 * {by:'team', conversationId}: the indexer stores it as 'derived', never as
 * the owner's own words.
 */

import type { Logger } from 'pino'
import type { VaultService } from './vault-service.js'
import type { VaultIndexer } from './vault-indexer.js'
import type { VaultFrontmatter } from '../types.js'
import { AUTO_CONSOLIDATED_TAG } from './vault-trust.js'
import { admitModelAuthoredText } from '../v2/model-write-gate.js'

interface MinimalSession {
  id: string
  parentConversationId: string
  createdAt: string
  completedAt: string | null
}

interface MinimalMemoryEntry {
  key: string
  value: string
  layer: string
  category: string
  authorAgentId: string | null
  createdAt: string
}

export interface TeamSessionPromoterDeps {
  vault: VaultService
  indexer: VaultIndexer
  logger?: Logger
}

function slugify(text: string): string {
  return text.toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 50) || 'team-session'
}

function parseValue(raw: string): string {
  try {
    const parsed = JSON.parse(raw)
    if (typeof parsed === 'string') return parsed
    return JSON.stringify(parsed, null, 2)
  } catch {
    return raw
  }
}

export function createTeamSessionPromoter(deps: TeamSessionPromoterDeps) {
  return {
    promote(session: MinimalSession, entries: MinimalMemoryEntry[]): { path: string } | null {
      // Only promote if there's something of lasting value (findings/decisions).
      const valuable = entries.filter(e => e.category === 'finding' || e.category === 'decision')
      const keep: MinimalMemoryEntry[] = []
      const refused: string[] = []
      for (const entry of valuable) {
        const verdict = admitModelAuthoredText(entry.key, parseValue(entry.value))
        if (verdict.admitted) keep.push(entry)
        else refused.push(verdict.pattern)
      }
      if (refused.length > 0) {
        // The families only, never the text: the text is what was refused.
        deps.logger?.warn(
          { session: session.id, refused: refused.length, kept: keep.length, patterns: refused },
          'team session promotion: the poison gate refused instruction-shaped entries',
        )
      }
      if (keep.length === 0) return null

      const today = new Date().toISOString().slice(0, 10)
      const relPath = `projects/team-sessions/${today}-${slugify(session.parentConversationId)}-${session.id.slice(0, 8)}.md`

      const byCategory = new Map<string, MinimalMemoryEntry[]>()
      for (const e of keep) {
        const arr = byCategory.get(e.category) ?? []
        arr.push(e)
        byCategory.set(e.category, arr)
      }

      const sections: string[] = []
      for (const [cat, items] of byCategory) {
        sections.push(`## ${cat.charAt(0).toUpperCase() + cat.slice(1)}s\n`)
        for (const item of items) {
          const author = item.authorAgentId ?? 'system'
          sections.push(`### ${item.key}`)
          sections.push(`*${author}*  \n`)
          sections.push(parseValue(item.value))
          sections.push('')
        }
      }

      const frontmatter: VaultFrontmatter = {
        title: `Team session ${session.id.slice(0, 8)} — ${session.parentConversationId}`,
        tags: ['team-session', AUTO_CONSOLIDATED_TAG],
        tier: 'semantic',
        links: [],
        created: today,
        updated: today,
        origin: { by: 'team', conversationId: session.parentConversationId },
      }

      const body =
        `# Team session summary\n\n` +
        `- Session: \`${session.id}\`\n` +
        `- Conversation: \`${session.parentConversationId}\`\n` +
        `- Started: ${session.createdAt}\n` +
        `- Completed: ${session.completedAt ?? '(in progress)'}\n\n` +
        sections.join('\n')

      try {
        deps.vault.write(relPath, frontmatter, body)
        deps.indexer.indexAll()
        deps.logger?.info({ path: relPath, session: session.id, entries: keep.length }, 'team session promoted to vault')
        return { path: relPath }
      } catch (err) {
        deps.logger?.warn({ err: String(err), path: relPath }, 'team session promotion failed')
        return null
      }
    },
  }
}

export type TeamSessionPromoter = ReturnType<typeof createTeamSessionPromoter>

// Part of eYssen. See LICENSE file for full copyright and licensing details.

/**
 * LLM-backed semantic promoter for the sleep-time consolidator.
 *
 * Phase 2 of the consolidator clusters recurring episodic memories; this
 * promoter turns each cluster into a canonical vault note by:
 *   1. Asking the model gateway (summary tier) to distil the members.
 *   2. Deriving a slug + path under `data/vault/semantic/auto/`.
 *   3. Writing the markdown file with frontmatter + back-reference links.
 *
 * Returns null when anything fails — the consolidator falls back to
 * invalidate-only so nothing is silently lost.
 */

import type { Logger } from 'pino'
import type { ModelGateway } from '@modules/model/types'
import type { DecisionEngine } from '@modules/model/routing/decision-engine'
import type { VaultService } from '../vault/vault-service.js'
import type { VaultIndexer } from '../vault/vault-indexer.js'
import type { EpisodicMemory, VaultFrontmatter } from '../types.js'
import type { ConsolidatorSemanticPromoterPort } from './types.js'

export interface SemanticPromoterDeps {
  gateway: ModelGateway
  decisionEngine?: DecisionEngine
  vault: VaultService
  indexer: VaultIndexer
  logger?: Logger
}

const MAX_MEMBERS_IN_PROMPT = 20
const MAX_CONTENT_CHARS = 1500

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 60)
    || 'cluster'
}

function buildPrompt(members: EpisodicMemory[]): { system: string; user: string } {
  const sample = members.slice(0, MAX_MEMBERS_IN_PROMPT)
    .map((m, i) => `(${i + 1}) [${m.sourceType}] ${m.content.slice(0, MAX_CONTENT_CHARS)}`)
    .join('\n\n')
  return {
    system:
      `You are an archival librarian consolidating repeated user memories into a single semantic note. ` +
      `Produce a short canonical title (max 10 words) and a concise markdown body (200-400 words) that captures the stable knowledge. ` +
      `Use ## headings for sub-topics. Do not invent facts. Return JSON only: {"title":"...","body":"..."}.`,
    user:
      `These ${members.length} episodic memories share a recurring pattern. ` +
      `Summarise them into one canonical semantic note.\n\n${sample}`,
  }
}

/**
 * Extract text from a gateway response. ModelResponse.content is a
 * ContentBlock[] array (no `.text` field), so join the text blocks — the same
 * way the reflection summariser does (memory/index.ts). A plain `.text` string
 * (some fakes/providers) is honoured as a fallback.
 */
function extractResponseText(resp: any): string {
  if (Array.isArray(resp?.content)) {
    return resp.content.map((b: any) => (b?.type === 'text' ? b.text : '')).join('\n')
  }
  if (typeof resp?.text === 'string') return resp.text
  return String(resp?.content ?? '')
}

function parseLlmJson(raw: string): { title: string; body: string } | null {
  // Strip code fences if the model wraps the JSON.
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim()
  try {
    const parsed = JSON.parse(cleaned)
    if (typeof parsed?.title !== 'string' || typeof parsed?.body !== 'string') return null
    if (parsed.title.trim().length === 0 || parsed.body.trim().length < 50) return null
    return { title: parsed.title.trim(), body: parsed.body.trim() }
  } catch {
    return null
  }
}

export function createSemanticPromoter(deps: SemanticPromoterDeps): ConsolidatorSemanticPromoterPort {
  const { gateway, decisionEngine, vault, indexer, logger } = deps

  return {
    async promoteCluster(members) {
      if (members.length === 0) return null

      // Resolve model for the 'heartbeat' routing tier (sleep-time, background work).
      let provider: string | undefined
      let model: string | undefined
      try {
        const resolved = decisionEngine?.resolveForTier('heartbeat')
        if (resolved) { provider = resolved.provider; model = resolved.model }
      } catch { /* decision engine not configured — fall back to gateway defaults */ }

      const { system, user } = buildPrompt(members)

      let raw: string
      try {
        const resp = await gateway.complete({
          provider, model,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          maxTokens: 800,
          temperature: 0.2,
        } as any)
        raw = extractResponseText(resp)
      } catch (err) {
        logger?.warn({ err: String(err) }, 'semantic-promoter: gateway.complete failed')
        return null
      }

      const parsed = parseLlmJson(raw)
      if (!parsed) {
        logger?.warn({ raw: raw.slice(0, 200) }, 'semantic-promoter: LLM output was not parseable JSON')
        return null
      }

      const today = new Date().toISOString().slice(0, 10)
      const relPath = `semantic/auto/${today}-${slugify(parsed.title)}-${Date.now().toString(36)}.md`

      const frontmatter: VaultFrontmatter = {
        title: parsed.title,
        tags: ['auto-consolidated', 'semantic'],
        tier: 'semantic',
        links: [],
        created: today,
        updated: today,
      }

      // Back-reference body — helps the reviewer audit provenance.
      const sources = members.slice(0, 20).map(m => `- ep:${m.id} (${m.sourceType}, salience ${m.salience.toFixed(2)})`).join('\n')
      const bodyWithFooter = `${parsed.body}\n\n---\n## Provenance\n\nConsolidated from ${members.length} episodic memories:\n${sources}\n`

      try {
        vault.write(relPath, frontmatter, bodyWithFooter)
        indexer.indexAll()
        logger?.info({ path: relPath, members: members.length }, 'semantic-promoter: wrote vault note')
        return { path: relPath }
      } catch (err) {
        logger?.warn({ err: String(err), path: relPath }, 'semantic-promoter: vault write failed')
        return null
      }
    },
  }
}

export type SemanticPromoter = ReturnType<typeof createSemanticPromoter>

// Part of eYssen. See LICENSE file for full copyright and licensing details.

/**
 * LLM-backed semantic promoter for the sleep-time consolidator.
 *
 * Phase 2 of the consolidator clusters recurring episodic memories; this
 * promoter turns each cluster into a canonical vault note by:
 *   1. Asking the background model service (purpose 'consolidation') to
 *      distil the members — an API provider or a CLI that runs isolated,
 *      never a gateway-chosen provider, so no provider-native memory can be
 *      laundered into the vault.
 *   2. Deriving a slug + path under `semantic/auto/` in the vault (`<data dir>/vault`).
 *   3. Writing the markdown file with frontmatter + back-reference links.
 *
 * The summary is model-authored durable text, so it passes the same poison
 * gate arbitration uses (v2/model-write-gate.ts) before it is written, and the
 * note carries frontmatter `origin` {by:'consolidation', provider, model}: the
 * indexer stores it as 'derived', never as the owner's own words.
 *
 * Returns null when anything fails, no eligible model exists or the gate
 * refuses the summary — the consolidator then keeps the cluster (nothing is
 * invalidated), so nothing is silently lost and a later run can still promote
 * it.
 */

import type { Logger } from 'pino'
import type { AuxiliaryModelService } from '@modules/model/auxiliary'
import type { VaultService } from '../vault/vault-service.js'
import type { VaultIndexer } from '../vault/vault-indexer.js'
import type { EpisodicMemory, VaultFrontmatter, VaultNoteOrigin } from '../types.js'
import type { ConsolidatorSemanticPromoterPort } from './types.js'
import { hasSecretsTag, SECRETS_TAG } from '../memory-index.js'
import { AUTO_CONSOLIDATED_TAG } from '../vault/vault-trust.js'
import { admitModelAuthoredText } from '../v2/model-write-gate.js'

export interface SemanticPromoterDeps {
  /**
   * The background model service, read on every promotion (wire it as a
   * getter): module registration order is not guaranteed, so a by-value read
   * could stay undefined.
   */
  readonly aux: Pick<AuxiliaryModelService, 'complete'> | undefined
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
  const { vault, indexer, logger } = deps

  return {
    async promoteCluster(members) {
      if (members.length === 0) return null

      const aux = deps.aux
      if (!aux) return null

      const { system, user } = buildPrompt(members)
      const result = await aux.complete({
        purpose: 'consolidation',
        system,
        user,
        maxTokens: 800,
        temperature: 0.2,
      })
      if (!result.ok) {
        if (result.reason === 'error' || result.reason === 'empty') {
          logger?.warn({ reason: result.reason, error: result.error?.message }, 'semantic-promoter: model call failed')
        } else {
          logger?.debug({ reason: result.reason }, 'semantic-promoter: no eligible model, cluster kept')
        }
        return null
      }
      const raw = result.text

      const parsed = parseLlmJson(raw)
      if (!parsed) {
        logger?.warn({ raw: raw.slice(0, 200) }, 'semantic-promoter: LLM output was not parseable JSON')
        return null
      }

      // An instruction-shaped summary is never written. The families only,
      // never the text: the text is what was refused.
      const verdict = admitModelAuthoredText(parsed.title, parsed.body)
      if (!verdict.admitted) {
        logger?.warn(
          { level: verdict.level, pattern: verdict.pattern, members: members.length, provider: result.provider },
          'semantic-promoter: the poison gate refused the summary; cluster kept, nothing written',
        )
        return null
      }
      const origin: VaultNoteOrigin = { by: 'consolidation', provider: result.provider }
      if (result.model) origin.model = result.model

      const today = new Date().toISOString().slice(0, 10)
      const relPath = `semantic/auto/${today}-${slugify(parsed.title)}-${Date.now().toString(36)}.md`

      const frontmatter: VaultFrontmatter = {
        title: parsed.title,
        // D-7 / P-19 — reachable only with memory.recall.includeSecrets on
        // (the consolidator drops flagged rows before clustering otherwise).
        // The summary of a flagged cluster is itself flagged: laundering it
        // into an untagged note would make the recall gate one-way.
        tags: [AUTO_CONSOLIDATED_TAG, 'semantic', ...(members.some((m) => hasSecretsTag(m.tags)) ? [SECRETS_TAG] : [])],
        tier: 'semantic',
        links: [],
        created: today,
        updated: today,
        origin,
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

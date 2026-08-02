// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { runCheapModelPass } from '@modules/model/cheap-pass.js'
import type { CheapModelPassContext } from '@modules/model/cheap-pass.js'
import { buildClassifySystemPrompt, buildClassifyUserPrompt } from '../prompts/classify.js'
import type { ClassifyItem, ScanCandidate, SourceProfile } from '../types.js'
import { extractJson } from './parse-json.js'

const VALID_TARGETS = new Set([
  'episodic',
  'vault.semantic',
  'vault.procedural',
  'skill',
  'workspace.agents',
  'workspace.soul',
  'workspace.identity',
  'workspace.tools',
  'workspace.memory',
  'none',
])

const VALID_KINDS = new Set([
  'memory',
  'skill',
  'rule',
  'identity',
  'knowledge',
  'noise',
  'unknown',
])

function sanitizeItems(raw: unknown): ClassifyItem[] {
  if (!Array.isArray(raw)) return []
  const out: ClassifyItem[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const id = typeof o.id === 'string' ? o.id : null
    if (!id) continue
    const action = o.action === 'skip' ? 'skip' : 'import'
    const kind = VALID_KINDS.has(String(o.kind)) ? (o.kind as ClassifyItem['kind']) : 'unknown'
    const target = VALID_TARGETS.has(String(o.target))
      ? (o.target as ClassifyItem['target'])
      : 'none'
    out.push({
      id,
      action: action === 'import' && target === 'none' ? 'skip' : action,
      kind,
      target,
      title: typeof o.title === 'string' ? o.title : null,
      confidence: typeof o.confidence === 'number' ? Math.min(1, Math.max(0, o.confidence)) : 0.5,
      reason: typeof o.reason === 'string' ? o.reason : '',
      pii_risk: o.pii_risk === 'likely' || o.pii_risk === 'possible' ? o.pii_risk : 'none',
    })
  }
  return out
}

function heuristicFallback(candidates: ScanCandidate[]): ClassifyItem[] {
  return candidates.map((c) => ({
    id: c.id,
    action: c.selectedByDefault && c.target !== 'none' && c.kind !== 'noise' ? 'import' : 'skip',
    kind: c.kind,
    target: c.target,
    title: c.title,
    confidence: c.confidence,
    reason: c.reason,
    pii_risk: c.kind === 'noise' && c.reason.includes('secret') ? 'likely' : 'none',
  }))
}

/** Batch-classify candidates with cheap model; fail-open to heuristics. */
export async function classifyCandidates(
  ctx: CheapModelPassContext,
  sourceProfile: SourceProfile,
  candidates: ScanCandidate[],
  instructions?: string | null,
): Promise<Map<string, ClassifyItem>> {
  const map = new Map<string, ClassifyItem>()
  if (candidates.length === 0) return map

  const batchSize = 8
  for (let i = 0; i < candidates.length; i += batchSize) {
    const batch = candidates.slice(i, i + batchSize)
    const fallback = JSON.stringify(heuristicFallback(batch))
    const raw = await runCheapModelPass(ctx, {
      system: buildClassifySystemPrompt(),
      user: buildClassifyUserPrompt(
        sourceProfile,
        batch.map((c) => ({
          id: c.id,
          path: c.relativePath,
          text: c.content ?? c.preview,
        })),
        instructions,
      ),
      maxTokens: 2000,
      temperature: 0.2,
      fallback,
    })
    const parsed = extractJson<unknown>(raw)
    const items = sanitizeItems(parsed)
    if (items.length === 0) {
      for (const h of heuristicFallback(batch)) map.set(h.id, h)
    } else {
      for (const item of items) map.set(item.id, item)
      // Fill missing with heuristics
      for (const c of batch) {
        if (!map.has(c.id)) {
          map.set(c.id, heuristicFallback([c])[0]!)
        }
      }
    }
  }
  return map
}

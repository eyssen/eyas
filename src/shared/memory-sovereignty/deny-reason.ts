// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { PathViolation } from './path-policy.js'
import { SEARCH_SCOPE_CODE, searchScopeTag, type SearchScopeTarget } from './search-scope-code.js'

/** What a refused search would have reached, as the tag names it. */
export function searchScopeTarget(violation: Pick<PathViolation, 'kind' | 'rule'>): SearchScopeTarget {
  if (violation.kind === 'foreign-memory') return 'foreign-memory'
  if (violation.kind === 'provider-home') return 'provider-home'
  return violation.rule === 'other-workspace' ? 'other-workspace' : 'eyas-data'
}

/**
 * A search refused for what lies below its folder: the CLI's own search cannot
 * be told to leave the protected place out, so the model is asked to search a
 * narrower folder. Tagged (search-scope-code.ts) so the UI can explain it in
 * the viewer's language.
 */
function searchScopeReason(violation: Pick<PathViolation, 'kind' | 'label' | 'rule'>): string {
  const target = searchScopeTarget(violation)
  const what = target === 'foreign-memory'
    ? `memory outside EYAS (${violation.label})`
    : target === 'provider-home'
      ? `${violation.label}, which only EYAS reads and writes`
      : target === 'other-workspace'
        ? "another conversation's workspace"
        : `EYAS's data directory${violation.label && violation.label !== 'data directory' ? ` (${violation.label})` : ''}, which only EYAS reads and writes`
  const memory = target === 'foreign-memory' ? '; for memory use memory_search / memory_expand from EYAS' : ''
  return `Search too broad ${searchScopeTag(target)}: the folder searched contains ${what}, and this tool cannot leave it out — search a narrower folder that does not contain it${memory}`
}

/**
 * What the model is told when the memory-sovereignty policy refuses a path.
 * One wording for every channel that answers from the policy — the security
 * gate's deterministic checkpoint and Claude Code's PreToolUse hook when no
 * gate is wired. The label is a short English name, never the path or a
 * secret. The memory tools are named as EYAS's: on Grok a bare memory_search
 * would be the CLI's own tool.
 */
export function memoryPathReason(violation: Pick<PathViolation, 'kind' | 'label' | 'rule' | 'searchRoot'>): string {
  if (violation.searchRoot) return searchScopeReason(violation)
  if (violation.kind === 'foreign-memory') {
    return `Memory outside EYAS (${violation.label}) — use memory_search / memory_expand from EYAS`
  }
  if (violation.kind === 'provider-home') return `${violation.label} is read and written only by EYAS`
  if (violation.rule === 'other-workspace') {
    return `Not this conversation's workspace (${violation.label}) — work in this conversation's folders`
  }
  return `EYAS data directory (${violation.label}) is read and written only by EYAS`
}

const MEMORY_PATH_FAIL_CLOSED_PREFIX = 'Memory-path policy could not check this call (fail-closed)'

/** The refusal when the policy itself could not judge a call (fail-closed). */
export function memoryPathFailClosedReason(err: unknown): string {
  return `${MEMORY_PATH_FAIL_CLOSED_PREFIX}: ${err instanceof Error ? err.message : String(err)}`
}

/**
 * Fragments of which every memory-path refusal reason carries one, and no
 * other deterministic gate reason any — how the Security page counts the
 * policy's refusals in security_events (decision 'deny', checkpoint
 * 'deterministic'). Kept in step with the two functions above by a test.
 */
export const MEMORY_PATH_REASON_MARKERS: readonly string[] = [
  'Memory outside EYAS (',
  ' is read and written only by EYAS',
  "Not this conversation's workspace (",
  MEMORY_PATH_FAIL_CLOSED_PREFIX,
  `[${SEARCH_SCOPE_CODE}:`,
]

/** True for a reason text written by the memory-path policy (a refusal). */
export function isMemoryPathReason(reason: unknown): boolean {
  return typeof reason === 'string' && MEMORY_PATH_REASON_MARKERS.some((m) => reason.includes(m))
}

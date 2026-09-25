// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// The machine-readable tag of a "search too broad" refusal. The memory-path
// policy refuses a CLI's own search (Grep, Glob, a recursive shell command)
// whose folder CONTAINS a place only EYAS may read; the refusal text the model
// gets carries this tag, and the web reads it back to show a translated
// explanation on the tool row.
//
// No imports: the web imports this file (relative path), like chat-stream.ts.

/** The code of the refusal, as it appears inside the tag. */
export const SEARCH_SCOPE_CODE = 'memory-path:search-scope'

/** What the refused search would have reached. */
export const SEARCH_SCOPE_TARGETS = ['foreign-memory', 'eyas-data', 'provider-home', 'other-workspace'] as const
export type SearchScopeTarget = typeof SEARCH_SCOPE_TARGETS[number]

/** The tag written into the refusal text: `[memory-path:search-scope:<target>]`. */
export function searchScopeTag(target: SearchScopeTarget): string {
  return `[${SEARCH_SCOPE_CODE}:${target}]`
}

const TAG_RE = /\[memory-path:search-scope:([a-z-]+)\]/

/** The target named by a refusal text's tag, or null when the text carries none. */
export function parseSearchScopeTag(text: unknown): SearchScopeTarget | null {
  if (typeof text !== 'string' || text.length === 0) return null
  const match = TAG_RE.exec(text)
  if (!match) return null
  const target = match[1] as SearchScopeTarget
  return (SEARCH_SCOPE_TARGETS as readonly string[]).includes(target) ? target : null
}

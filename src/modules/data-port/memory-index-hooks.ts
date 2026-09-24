// Part of eYssen. See LICENSE file for full copyright and licensing details.

export interface IndexEntry { hooks: string[]; section: string | null }

export function isMemoryIndexBasename(relativePath: string): boolean {
  const base = relativePath.replace(/\\/g, '/').split('/').pop() ?? relativePath
  return base.toLowerCase() === 'memory.md'
}

function keyOf(link: string): string {
  return link.trim().replace(/^\.\//, '').split('/').pop()!.replace(/\.md$/i, '')
}

/**
 * `- [hook](file.md) · [hook](other.md)` and `- [[file]] — hook` lines under `##` sections.
 * Every hook is kept; a file linked twice gets both. On a multi-`[[link]]` line, a single
 * trailing gloss (`— note`) after the last link is shared with every earlier link on that
 * line that has no alias (`[[x|Alias]]`) or gloss of its own.
 */
export function parseMemoryIndex(markdown: string): { entries: Map<string, IndexEntry>; count: number } {
  const entries = new Map<string, IndexEntry>()
  let section: string | null = null
  let count = 0
  const add = (key: string, hook: string) => {
    if (!key) return
    const e = entries.get(key) ?? { hooks: [], section }
    if (hook && !e.hooks.includes(hook)) e.hooks.push(hook)
    if (!entries.has(key)) entries.set(key, e)
    count++
  }
  for (const rawLine of markdown.split('\n')) {
    const line = rawLine.trim()
    const h = line.match(/^#{2,6}\s+(.+)$/)
    if (h) { section = h[1].trim(); continue }
    for (const m of line.matchAll(/\[([^\]]+)\]\(([^)\s]+\.md)\)/g)) add(keyOf(m[2]), m[1].trim())
    const wikiMatches = [...line.matchAll(/\[\[([^\]|#]+)(?:\|([^\]]*))?\]\]\s*(?:[—–-]\s*(.+?))?(?=\s*(?:·|\[\[|$))/g)]
    const trailingGloss = wikiMatches.length ? wikiMatches[wikiMatches.length - 1][3] : undefined
    for (const m of wikiMatches) {
      add(keyOf(m[1]), (m[3] ?? m[2] ?? trailingGloss ?? '').trim())
    }
  }
  return { entries, count }
}

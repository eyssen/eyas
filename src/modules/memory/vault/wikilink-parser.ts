// Part of eYssen. See LICENSE file for full copyright and licensing details.

/**
 * Obsidian-compatible wikilink parser.
 *
 * Supported forms:
 *   [[note]]                         basic link
 *   [[note|display]]                 aliased display text
 *   [[note#heading]]                 link to a heading anchor
 *   [[note^block-id]]                link to a block reference
 *   [[note#heading|display]]         heading + alias
 *   ![[image.png]]                   embed (displayed inline by Obsidian)
 *   ![[note#heading]]                transclusion embed
 */

export type WikilinkKind = 'link' | 'embed'

export interface ExtractedWikilink {
  targetId: string
  displayText: string
  context: string
  anchor?: string
  blockId?: string
  kind: WikilinkKind
}

const WIKILINK_REGEX = /(!?)\[\[([^\]]+)\]\]/g

function parseTarget(inner: string): { target: string; anchor?: string; blockId?: string; display?: string } {
  const pipeIdx = inner.indexOf('|')
  const rawTarget = pipeIdx >= 0 ? inner.slice(0, pipeIdx) : inner
  const display = pipeIdx >= 0 ? inner.slice(pipeIdx + 1).trim() : undefined

  const caretIdx = rawTarget.indexOf('^')
  if (caretIdx >= 0) {
    return {
      target: rawTarget.slice(0, caretIdx).trim(),
      blockId: rawTarget.slice(caretIdx + 1).trim(),
      display,
    }
  }
  const hashIdx = rawTarget.indexOf('#')
  if (hashIdx >= 0) {
    return {
      target: rawTarget.slice(0, hashIdx).trim(),
      anchor: rawTarget.slice(hashIdx + 1).trim(),
      display,
    }
  }
  return { target: rawTarget.trim(), display }
}

export function extractWikilinks(text: string): ExtractedWikilink[] {
  const results: ExtractedWikilink[] = []
  WIKILINK_REGEX.lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = WIKILINK_REGEX.exec(text)) !== null) {
    const isEmbed = match[1] === '!'
    const inner = match[2]
    if (!inner || inner.length === 0) continue

    const { target, anchor, blockId, display } = parseTarget(inner)
    if (target.length === 0) continue

    const start = Math.max(0, match.index - 30)
    const end = Math.min(text.length, match.index + match[0].length + 30)

    results.push({
      targetId: target,
      displayText: display ?? target,
      context: text.slice(start, end).trim(),
      anchor,
      blockId,
      kind: isEmbed ? 'embed' : 'link',
    })
  }

  return results
}

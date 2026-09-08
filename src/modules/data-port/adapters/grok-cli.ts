// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { classifyPath, hasAssistantMarker, posix } from '../scanners/heuristics.js'
import { readSourceNote } from '../source-frontmatter.js'
import type { ProviderAdapter, SourceNote } from './types.js'

const MARKER = '.grok/'

const inGrokTree = (p: string): boolean => p.startsWith(MARKER) || p.includes(`/${MARKER}`)

/** Everything below the marker directory, so one set of anchored rules serves a
 *  scan of the tree's parent and a scan rooted inside it alike. */
const belowMarker = (p: string): string => (inGrokTree(p) ? p.slice(p.indexOf(MARKER) + MARKER.length) : p)

const PROJECT_INDEX = /^memory\/[^/]+\/memory\.md$/

/**
 * `memory/<project>/sessions/<YYYY-MM-DD>-<slug>-<id8>.md`, with or without the
 * `.grok/` marker in front: `read` is handed the candidate's root-relative path,
 * which a scan rooted inside the tree strips the marker from, and a strict
 * pattern would silently hand back an unenriched note for the very same file.
 * Case-insensitive for the same reason on a case-preserving filesystem.
 */
const SESSION_SUMMARY = /(^|\/)(?:\.grok\/)?memory\/([^/]+)\/sessions\/([^/]+)\.md$/i

/** `- **Date:** 2026-09-05 14:32 UTC` — the summary header the CLI writes. */
const DATE_LINE = /^\s*-\s*\*\*Date:\*\*\s*(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})/m

export const grokCliAdapter: ProviderAdapter = {
  id: 'grok-cli',
  rootHints: ['~/.grok', '~/.grok/memory', '~/.grok/memory/<project>/sessions'],
  detect: (paths) => (paths.map(posix).some(inGrokTree) ? 0.85 : 0),
  classify: (rel, head, ctx) => {
    const p = posix(rel)
    const inTree = inGrokTree(p)
    // Picking Grok in the wizard is a claim on the tree: a scan rooted inside
    // `~/.grok` keeps no marker segment, and the pick is then the only thing
    // that says whose files these are. Never over another assistant's tree.
    const claimed = ctx?.profile === 'grok-cli' && !hasAssistantMarker(p)
    if (!inTree && !claimed) return null
    const cp = belowMarker(p)
    if (PROJECT_INDEX.test(cp)) {
      return {
        kind: 'index',
        target: 'vault.semantic',
        confidence: 0.9,
        reason: 'Per-project memory index — imported as one note',
        reasonCode: 'memory-index',
        selectedByDefault: true,
      }
    }
    if (inTree) return classifyPath(rel, head, 'grok-cli')
    // Under a profile-only claim the scan root may be anything at all, so only
    // the memory tree — the shape that is unmistakably Grok's — is answered for,
    // and it is shown the path a scan of the parent would have produced. Every
    // other file is left to the adapters behind this one.
    return cp.startsWith('memory/') ? classifyPath(`${MARKER}${cp}`, head, 'grok-cli') : null
  },
  read: (rel, raw, _unit, times = {}): SourceNote => {
    const text = raw.toString('utf-8')
    const note = readSourceNote(rel, text, times)
    const m = SESSION_SUMMARY.exec(rel.replace(/\\/g, '/'))
    if (!m) return note

    const project = m[2]
    const stem = m[3]
    const idMatch = /-([0-9a-f]{8})$/i.exec(stem)
    const sessionId = idMatch ? idMatch[1] : null

    // The body's own Date line is authoritative; then the date the file is named
    // after; only then the filesystem, which says when the file was copied.
    const dateLine = DATE_LINE.exec(text)
    const nameDay = /^(\d{4}-\d{2}-\d{2})/.exec(stem)
    const sessionDate = dateLine
      ? `${dateLine[1]}T${dateLine[2]}:${dateLine[3]}:00.000Z`
      : nameDay
        ? `${nameDay[1]}T00:00:00.000Z`
        : (times.mtime ?? null)

    const title = stem
      .replace(/^\d{4}-\d{2}-\d{2}-/, '')
      .replace(/-[0-9a-f]{8}$/i, '')
      .replace(/-/g, ' ')
      .trim()

    const projectTag = `grok-project:${project}`
    return {
      ...note,
      title: title || note.title,
      tags: note.tags.includes(projectTag) ? note.tags : [...note.tags, projectTag],
      sessionId: note.sessionId ?? sessionId,
      sessionDate: note.sessionDate ?? sessionDate,
    }
  },
}

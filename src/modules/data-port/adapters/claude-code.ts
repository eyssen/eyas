// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { classifyPath, hasAssistantMarker, posix } from '../scanners/heuristics.js'
import { jsonlTranscriptUnit } from './chat-export.js'
import { CLAUDE_TOOL_RESULT_RE, CLAUDE_TRANSCRIPT_RE, claudeTranscriptFacts } from './transcript-paths.js'
import type { AdapterHint, ProviderAdapter } from './types.js'

const MARKER = '.claude/'

/** Anchored on a real path segment: `xyz.claude/` is not `.claude/`. */
const inClaudeTree = (p: string): boolean => p.startsWith(MARKER) || p.includes(`/${MARKER}`)

/** Everything below the marker directory, so one set of anchored rules serves a
 *  scan of the tree's parent and a scan rooted inside it alike. */
const belowMarker = (p: string): string => (inClaudeTree(p) ? p.slice(p.indexOf(MARKER) + MARKER.length) : p)

const AUTO_MEMORY = /^(projects\/[^/]+\/)?memory\/[^/]+\.md$/

/**
 * A memory folder the tool left behind when it moved its notes elsewhere. The
 * notes are still the owner's, so they are imported like any other auto-memory
 * note and tagged `legacy` (R11.3).
 */
const LEGACY_MEMORY = /^(projects\/[^/]+\/)?(memory\.local-backup[^/]*|memory\.old)\/[^/]+\.(md|bak)$/

const COMMAND = /^commands\/[^/]+\.md$/

/**
 * A scan rooted INSIDE `.claude/projects/<slug>` keeps no marker segment in its
 * paths, so a session transcript arrives as a bare `<id>.jsonl` at depth 0. It
 * is claimed only under an explicit `claude-code` pick, which is a claim on the
 * tree — the same reasoning the Codex adapter uses for a scan rooted in
 * `~/.codex`, and without the pick it would take every repo's data file.
 */
const BARE_TRANSCRIPT = /^[^/]+\.jsonl$/

const TRANSCRIPT_REASON = 'Claude Code transcript (JSONL)'

const TRANSCRIPT_HINT: AdapterHint = {
  kind: 'session',
  target: 'episodic',
  confidence: 0.8,
  reason: TRANSCRIPT_REASON,
  reasonCode: 'transcript',
  selectedByDefault: true,
}

/** Tool output written beside a session: the session's output, not its conversation (P-5). */
const TOOL_RESULT_HINT: AdapterHint = {
  kind: 'session',
  target: 'episodic',
  confidence: 0.6,
  reason: 'Tool output saved beside a Claude Code session',
  reasonCode: 'session-artifact',
  selectedByDefault: false,
}

/**
 * The auto-memory tree has no frontmatter contract — a note there is a note
 * because of where it lives, so it is classified by path, not by content.
 */
function autoMemoryHint(p: string): AdapterHint {
  const base = p.split('/').pop() ?? p
  if (base === 'memory.md') {
    return {
      kind: 'index',
      target: 'vault.semantic',
      confidence: 0.95,
      reason: 'Claude Code memory index',
      reasonCode: 'memory-index',
      selectedByDefault: true,
    }
  }
  return {
    kind: 'memory',
    target: 'vault.semantic',
    confidence: 0.9,
    reason: 'Claude Code auto-memory note',
    reasonCode: 'memory-note',
    selectedByDefault: true,
  }
}

export const claudeCodeAdapter: ProviderAdapter = {
  id: 'claude-code',
  rootHints: ['~/.claude', '~/.claude/projects/<project>/memory', '~/.claude/skills', '~/.claude/agents'],
  detect: (paths) => {
    const l = paths.map(posix)
    if (l.some((p) => p === 'claude.md' || inClaudeTree(p))) return 0.9
    return 0
  },
  classify: (rel, head, ctx) => {
    const p = posix(rel)
    const inTree = inClaudeTree(p) || p === 'claude.md'
    // Picking Claude Code in the wizard is a claim on the tree: a scan rooted
    // inside `~/.claude` may keep no marker segment at all, and the owner's
    // choice is then the only thing that says whose files these are. It never
    // overrides a path that names another assistant's tree.
    const claimed = ctx?.profile === 'claude-code' && !hasAssistantMarker(p)
    if (!inTree && !claimed) return null
    const cp = belowMarker(p)
    if (CLAUDE_TRANSCRIPT_RE.test(cp) || (claimed && BARE_TRANSCRIPT.test(cp))) return { ...TRANSCRIPT_HINT }
    if (COMMAND.test(cp)) {
      return {
        kind: 'skill',
        target: 'skill',
        confidence: 0.85,
        reason: 'Slash command — imported as a skill',
        reasonCode: 'slash-command',
        selectedByDefault: true,
      }
    }
    if (CLAUDE_TOOL_RESULT_RE.test(cp)) return { ...TOOL_RESULT_HINT }
    if (AUTO_MEMORY.test(cp)) return autoMemoryHint(cp)
    if (LEGACY_MEMORY.test(cp)) return { ...autoMemoryHint(cp), tags: ['legacy'] }
    // Under a profile-only claim the scan root may be anything at all, so a file
    // matching none of the shapes above is left to the other adapters — the same
    // rule the Codex adapter follows.
    return inTree ? classifyPath(rel, head, 'claude-code') : null
  },
  /**
   * Transcripts only; every other file stays whole. Expansion is asked of the
   * adapter that CLAIMED the file (G3), so the matcher need not prove the tree
   * is Claude's a second time — which is what lets a rooted scan, whose paths
   * carry no marker, still expand its transcripts.
   *
   * A sub-agent or workflow transcript is a session of its own (P-5): it keeps
   * its own row and says which session ran it, rather than disappearing into the
   * parent's note.
   */
  expand: (rel, raw, _sourcePath, opts) => {
    const p = posix(rel)
    if (!p.endsWith('.jsonl')) return []
    const units = jsonlTranscriptUnit(rel, raw, TRANSCRIPT_REASON, opts)
    const facts = claudeTranscriptFacts(belowMarker(p))
    if (!facts) return units
    return units.map((unit) => ({
      ...unit,
      tags: [
        ...(unit.tags ?? []),
        `claude-project:${facts.project}`,
        ...(facts.subagent ? ['subagent', `parent-session:${facts.parentSession}`] : []),
        ...(facts.workflow ? [`workflow:${facts.workflow}`] : []),
      ],
      data: {
        ...unit.data,
        project: facts.project,
        parentSession: facts.parentSession,
        workflow: facts.workflow,
        subagent: facts.subagent,
      },
    }))
  },
}

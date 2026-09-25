// Part of eYssen. See LICENSE file for full copyright and licensing details.
// One place for the provider transcript path shapes, so chat-export's refusal
// list and the provider adapters' claims cannot drift.

/** Below the `.claude/` marker. Groups: slug, parent session, workflow id, file stem. */
export const CLAUDE_TRANSCRIPT_RE =
  /^projects\/([^/]+)\/(?:([^/]+)\/subagents\/(?:workflows\/([^/]+)\/)?)?([^/]+)\.jsonl$/
/** Segment-anchored. Groups: project (when present), transcript id, file stem. */
export const CURSOR_TRANSCRIPT_RE =
  /(?:^|\/)(?:projects\/([^/]+)\/)?agent-transcripts\/(?:([^/]+)\/)?(?:(subagents)\/)?([^/]+)\.jsonl$/
/** `rollout-<day>T<hh>-<mm>-<ss>-<id>.jsonl`. Groups: day, hh, mm, ss, id. */
export const CODEX_ROLLOUT_RE = /rollout-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-([^/]+)\.jsonl$/
/** Tool output saved beside a session — output, not memory (P-5). */
export const CLAUDE_TOOL_RESULT_RE = /^projects\/[^/]+\/[^/]+\/tool-results\/[^/]+\.txt$/

/**
 * What a Claude Code transcript path says about itself: which project it belongs
 * to, and — for a sub-agent or workflow transcript — which session ran it. A
 * sub-agent transcript is a session of its own (P-5), so the facts travel as
 * tags rather than folding its turns into the parent's note.
 */
export function claudeTranscriptFacts(
  belowMarker: string,
): { project: string; parentSession: string | null; workflow: string | null; subagent: boolean } | null {
  const m = CLAUDE_TRANSCRIPT_RE.exec(belowMarker)
  if (!m) return null
  return { project: m[1]!, parentSession: m[2] ?? null, workflow: m[3] ?? null, subagent: Boolean(m[2]) }
}

/** The same facts for a Cursor agent transcript, with or without a session directory. */
export function cursorTranscriptFacts(
  rel: string,
): { project: string | null; parentSession: string | null; subagent: boolean } | null {
  const m = CURSOR_TRANSCRIPT_RE.exec(rel)
  if (!m) return null
  const subagent = Boolean(m[3])
  return { project: m[1] ?? null, parentSession: subagent ? (m[2] ?? null) : null, subagent }
}

/** Everything chat-export must refuse so the provider adapters keep their own transcripts. */
export const PROVIDER_TRANSCRIPTS: RegExp[] = [
  /(^|\/)\.claude\/projects\/.+\.jsonl$/,
  /(^|\/)agent-transcripts\/.+\.jsonl$/,
  /(^|\/)\.codex\/.*rollout-.*\.jsonl$/,
  // A scan rooted inside ~/.codex keeps no marker directory in its paths.
  /(^|\/)sessions\/.*rollout-.*\.jsonl$/,
]

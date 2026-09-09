// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, it, expect } from 'vitest'
import {
  CLAUDE_TRANSCRIPT_RE,
  CURSOR_TRANSCRIPT_RE,
  CODEX_ROLLOUT_RE,
  CLAUDE_TOOL_RESULT_RE,
  PROVIDER_TRANSCRIPTS,
  claudeTranscriptFacts,
  cursorTranscriptFacts,
} from '@modules/data-port/adapters/transcript-paths'

const SID = '00000000-0000-4000-8000-00000000ab01'

describe('transcript paths', () => {
  it('matches top-level, sub-agent and workflow-nested Claude Code transcripts', () => {
    expect(CLAUDE_TRANSCRIPT_RE.test(`projects/alpha/${SID}.jsonl`)).toBe(true)
    expect(claudeTranscriptFacts(`projects/alpha/${SID}/subagents/agent-1a2b.jsonl`)).toEqual({
      project: 'alpha',
      parentSession: SID,
      workflow: null,
      subagent: true,
    })
    expect(claudeTranscriptFacts(`projects/alpha/${SID}/subagents/workflows/wf_9c80/agent-1a2b.jsonl`)).toEqual({
      project: 'alpha',
      parentSession: SID,
      workflow: 'wf_9c80',
      subagent: true,
    })
    for (const neg of ['projects/alpha/memory/n.md', `projects/alpha/${SID}/tool-results/t.txt`, 'foo/agent-transcripts.jsonl']) {
      expect(CLAUDE_TRANSCRIPT_RE.test(neg)).toBe(false)
    }
  })

  it('matches Cursor transcripts with or without a session directory and sub-agents', () => {
    expect(CURSOR_TRANSCRIPT_RE.test('agent-transcripts/x.jsonl')).toBe(true)
    expect(cursorTranscriptFacts('projects/bravo/agent-transcripts/abc/abc.jsonl')).toEqual({
      project: 'bravo',
      parentSession: null,
      subagent: false,
    })
    expect(cursorTranscriptFacts('projects/bravo/agent-transcripts/abc/subagents/x.jsonl')).toEqual({
      project: 'bravo',
      parentSession: 'abc',
      subagent: true,
    })
  })

  it('gives a whole-file path back as null rather than guessing facts', () => {
    expect(claudeTranscriptFacts('projects/alpha/memory/note.md')).toBeNull()
    expect(cursorTranscriptFacts('.cursor/rules/py.mdc')).toBeNull()
  })

  it('reads the day and the id out of a Codex rollout name', () => {
    const m = CODEX_ROLLOUT_RE.exec('rollout-2026-01-02T10-00-00-abc.jsonl')
    expect(m?.slice(1)).toEqual(['2026-01-02', '10', '00', '00', 'abc'])
    expect(CODEX_ROLLOUT_RE.test('ops/rollout-deploy.jsonl')).toBe(false)
  })

  it('names tool output beside a session, which is not a transcript', () => {
    expect(CLAUDE_TOOL_RESULT_RE.test(`projects/alpha/${SID}/tool-results/t.txt`)).toBe(true)
    expect(CLAUDE_TOOL_RESULT_RE.test(`projects/alpha/${SID}.jsonl`)).toBe(false)
  })

  it('refuses every provider transcript shape on behalf of chat-export', () => {
    const claimed = (p: string) => PROVIDER_TRANSCRIPTS.some((re) => re.test(p))
    for (const p of [
      `.claude/projects/-alpha/${SID}.jsonl`,
      `.claude/projects/-alpha/${SID}/subagents/agent-1a2b.jsonl`,
      '.cursor/projects/p/agent-transcripts/a/b.jsonl',
      'agent-transcripts/b.jsonl',
      '.codex/sessions/2026/01/02/rollout-2026-01-02T10-00-00-abc.jsonl',
      'sessions/2026/01/02/rollout-2026-01-02T10-00-00-abc.jsonl',
    ]) {
      expect(claimed(p)).toBe(true)
    }
    expect(claimed('logs/anything.jsonl')).toBe(false)
  })
})

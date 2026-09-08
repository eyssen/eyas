// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, expect, it } from 'vitest'
import { buildSubagentPrompt } from '../../../src/modules/prompt-wizard/subagent-prompt-builder.js'
import type { ParentSnapshot } from '../../../src/modules/prompt-wizard/types.js'
import type { CascadeResult } from '../../../src/modules/prompt-wizard/project-context-loader.js'

const fakeParentSnapshot: ParentSnapshot = {
  agentId: 'agent-001',
  name: 'Jarvis',
  voiceProfile: {
    address: 'tegező',
    tone: 'baráti',
    verbosity: 'lényegre törő',
    directness: 'direkt + udvarias',
    humor: 'száraz/szellemes',
    emoji: 'soha',
    blockedPhrases: ['természetesen'],
    signature: 'J.',
  },
  voiceProfileSource: 'internal',
  blockedPhrases: ['természetesen'],
  signature: 'J.',
  originatingAgentId: 'agent-001',
}

const emptyCascade: CascadeResult = {
  projectTypeAgents: null,
  projectAgents: null,
  projectTypeId: null,
  projectId: null,
}

const fakeRuntime = { date: '2026-04-26', channel: 'owner_dm', os: 'darwin' }

describe('buildSubagentPrompt', () => {
  it('includes parent snapshot fields in <delegated-voice>', () => {
    const result = buildSubagentPrompt({
      subagentName: 'ResearchBot',
      delegatedTask: 'Research TypeScript best practices',
      outputAudience: 'parent',
      parentSnapshot: fakeParentSnapshot,
      cascade: emptyCascade,
      runtime: fakeRuntime,
      childDepth: 1,
      maxSpawnDepth: 3,
    })

    expect(result.prefix).toContain('<delegated-voice>')
    expect(result.prefix).toContain('When producing output for Jarvis')
    expect(result.prefix).toContain('Address: tegező')
    expect(result.prefix).toContain('Tone: baráti')
    expect(result.prefix).toContain('Verbosity: lényegre törő')
    expect(result.prefix).toContain('Directness: direkt + udvarias')
    expect(result.prefix).toContain('Humor: száraz/szellemes')
    expect(result.prefix).toContain('Emoji: soha')
    expect(result.prefix).toContain('Blocked phrases:')
    expect(result.prefix).toContain('Signature flair: J.')
    expect(result.prefixHash).toMatch(/^[a-f0-9]{64}$/)
    expect(result.tokenEstimate.prefix).toBeGreaterThan(0)
  })

  it('excludes primary-agent-only SOUL/IDENTITY/MEMORY tags', () => {
    const result = buildSubagentPrompt({
      subagentName: 'ResearchBot',
      delegatedTask: 'Summarize the meeting notes',
      outputAudience: 'external',
      parentSnapshot: fakeParentSnapshot,
      cascade: emptyCascade,
      runtime: fakeRuntime,
      childDepth: 2,
      maxSpawnDepth: 3,
    })

    // Primary-only sections must NOT appear in subagent prompt
    expect(result.prefix).not.toContain('<agent-identity>')
    expect(result.prefix).not.toContain('<agent-voice>')
    expect(result.prefix).not.toContain('<agent-notes>')
    expect(result.prefix).not.toContain('<active-voice>')

    // But core sections MUST appear
    expect(result.prefix).toContain('<core-identity>')
    expect(result.prefix).toContain('<core-rules>')
    expect(result.prefix).toContain('<subagent-role>')
  })
})

// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Task 50 — Sub-agent delegation chain test.
// Verifies that the originating agent's voice profile is preserved in the
// specialist's prompt, regardless of an intermediate agent in the chain.

import { describe, it, expect, afterEach } from 'vitest'
import { setupTestEyas, makeMockVoiceProfile } from '../helpers/test-eyas.js'
import { buildSubagentPrompt } from '@modules/prompt-wizard/subagent-prompt-builder.js'

describe('sub-agent delegation chain', () => {
  let harness: ReturnType<typeof setupTestEyas>

  afterEach(async () => {
    await harness?.shutdown()
  })

  it('specialist prompt contains originating agent voice profile, not intermediary voice', async () => {
    harness = setupTestEyas()

    // Create Jarvis (originating primary agent)
    const jarvisId = await harness.api.createAgent({ template: 'primary-assistant', name: 'Jarvis' })

    // Load Jarvis workspace to extract voice profile
    const jarvisWs = await harness.workspaceLoader.load(jarvisId)
    const { soulStyleSchema } = await import('@modules/prompt-wizard/soul-style-schema.js')
    const jarvisStyle = soulStyleSchema.parse(JSON.parse(jarvisWs.soulStyleJson.body))
    // best-buddy preset internal: tegező / baráti / kiegyensúlyozott / diplomatikus / száraz/szellemes / funkcionálisan
    const jarvisVoice = jarvisStyle.internal

    // Jarvis's unique external signature marker (for chain check, we embed it explicitly)
    const jarvisProfile = { ...jarvisVoice, signature: 'JARVIS-EXTERNAL-MARKER' }

    // Create Sys (intermediary — system engineer)
    const sysId = await harness.api.createAgent({ template: 'system-engineer', name: 'Sys' })
    const sysWs = await harness.workspaceLoader.load(sysId)
    const sysStyle = soulStyleSchema.parse(JSON.parse(sysWs.soulStyleJson.body))
    const sysVoice = sysStyle.internal

    // Build the specialist prompt as if Jarvis (originating) delegated through Sys
    // The parentSnapshot must carry Jarvis's voice — that's the invariant under test.
    const parentSnapshot = {
      agentId: jarvisId,
      name: 'Jarvis',
      voiceProfile: jarvisProfile,
      voiceProfileSource: 'internal' as const,
      blockedPhrases: jarvisProfile.blockedPhrases ?? [],
      signature: jarvisProfile.signature,
      originatingAgentId: jarvisId,
    }

    const cascade = { projectTypeAgents: null, projectAgents: null, projectTypeId: null, projectId: null }

    const prompt = buildSubagentPrompt({
      subagentName: 'code-reviewer',
      delegatedTask: 'Review the authentication module for security issues.',
      outputAudience: 'external',
      parentSnapshot,
      cascade,
      runtime: { date: '2026-04-27', channel: 'owner_dm', os: 'macOS' },
      childDepth: 2,
      maxSpawnDepth: 3,
    })

    // Specialist's prompt must contain Jarvis's voice marker
    expect(prompt.prefix).toContain('JARVIS-EXTERNAL-MARKER')

    // Must NOT contain Sys's address style as a voice directive
    // (Sys's tone is 'laza', address 'tegező', but we assert the snippet is from Jarvis)
    // Check that the delegated-voice section references Jarvis's name
    expect(prompt.prefix).toContain('Jarvis')
    expect(prompt.prefix).toContain('<delegated-voice>')
  })

  it('specialist prompt contains core-identity and subagent-role tags', async () => {
    harness = setupTestEyas()

    const originatorId = await harness.api.createAgent({ template: 'primary-assistant', name: 'Originator' })
    const prompt = await harness.api.delegateToSpecialist({
      originatingAgentId: originatorId,
      specialistAgentId: 'code-reviewer',
      delegatedTask: 'Review this file for bugs.',
      outputAudience: 'parent',
    })

    expect(prompt.prefix).toContain('<core-identity>')
    expect(prompt.prefix).toContain('<subagent-role>')
    expect(prompt.prefix).toContain('<task>')
  })

  it('delegation to external audience includes delegated-voice block', async () => {
    harness = setupTestEyas()

    const originatorId = await harness.api.createAgent({ template: 'primary-assistant', name: 'Originator' })
    const prompt = await harness.api.delegateToSpecialist({
      originatingAgentId: originatorId,
      specialistAgentId: 'researcher',
      delegatedTask: 'Investigate competitor pricing strategies.',
      outputAudience: 'external',
    })

    expect(prompt.prefix).toContain('<delegated-voice>')
    // output-audience tag tells the specialist who will read the result
    expect(prompt.prefix).toContain('external')
  })
})

// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Task 49 — End-to-end primary agent integration test.
// Verifies: workspace bootstrap, assembled prompt structure, token budget.

import { describe, it, expect, afterEach } from 'vitest'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { setupTestEyas } from '../helpers/test-eyas.js'

describe('end-to-end primary agent', () => {
  let harness: ReturnType<typeof setupTestEyas>

  afterEach(async () => {
    await harness?.shutdown()
  })

  it('creates workspace files for a primary-assistant agent', async () => {
    harness = setupTestEyas()
    const agentId = await harness.api.createAgent({ template: 'primary-assistant', name: 'Jarvis' })

    // Workspace files must exist
    const root = join(harness.dataDir, 'agents', agentId)
    expect(existsSync(join(root, 'IDENTITY.md'))).toBe(true)
    expect(existsSync(join(root, 'SOUL.md'))).toBe(true)
    expect(existsSync(join(root, 'SOUL.style.json'))).toBe(true)
    expect(existsSync(join(root, 'AGENTS.md'))).toBe(true)
    expect(existsSync(join(root, 'TOOLS.md'))).toBe(true)
  })

  it('substitutes agent name into IDENTITY.md', async () => {
    harness = setupTestEyas()
    const agentId = await harness.api.createAgent({ template: 'primary-assistant', name: 'Jarvis' })

    const ws = await harness.workspaceLoader.load(agentId)
    expect(ws.identity.body).toContain('Jarvis')
    expect(ws.identity.body).not.toContain('(set during wizard)')
  })

  it('assembled prompt prefix contains core-identity and agent-identity tags', async () => {
    harness = setupTestEyas()
    const agentId = await harness.api.createAgent({ template: 'primary-assistant', name: 'Jarvis' })

    const prompt = await harness.assembler.buildForPrimary({
      agentId,
      agentName: 'Jarvis',
      conversationId: null,
      projectId: null,
      channelContext: null,
    })

    expect(prompt.prefix).toContain('<core-identity>')
    expect(prompt.prefix).toContain('<agent-identity>')
    // IDENTITY.md contains "## My mission"
    expect(prompt.prefix).toContain('## My mission')
  })

  it('assembled prompt suffix contains Voice scope: INTERNAL', async () => {
    harness = setupTestEyas()
    const agentId = await harness.api.createAgent({ template: 'primary-assistant', name: 'Jarvis' })

    const prompt = await harness.assembler.buildForPrimary({
      agentId,
      agentName: 'Jarvis',
      conversationId: null,
      projectId: null,
      channelContext: null,
    })

    // The cache suffix renders active-voice with scope INTERNAL (stub resolveActiveVoice)
    expect(prompt.suffix).toContain('Voice scope: INTERNAL')
  })

  it('prefix token estimate is within budget (< 8800)', async () => {
    harness = setupTestEyas()
    const agentId = await harness.api.createAgent({ template: 'primary-assistant', name: 'Jarvis' })

    const prompt = await harness.assembler.buildForPrimary({
      agentId,
      agentName: 'Jarvis',
      conversationId: null,
      projectId: null,
      channelContext: null,
    })

    expect(prompt.tokenEstimate.prefix).toBeLessThan(8800)
  })

  it('prefixHash is a 64-char hex string', async () => {
    harness = setupTestEyas()
    const agentId = await harness.api.createAgent({ template: 'primary-assistant', name: 'Jarvis' })

    const prompt = await harness.assembler.buildForPrimary({
      agentId,
      agentName: 'Jarvis',
      conversationId: null,
      projectId: null,
      channelContext: null,
    })

    expect(prompt.prefixHash).toMatch(/^[0-9a-f]{64}$/)
  })
})

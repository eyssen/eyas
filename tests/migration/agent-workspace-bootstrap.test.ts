// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdir, rm, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { bootstrapAgentWorkspace } from '../../scripts/lib/agent-workspace-bootstrap.js'
import type { SplitResult } from '../../scripts/lib/legacy-prompt-splitter.js'

let dataDir: string

const baseSplit: SplitResult = {
  identityMission: 'Help the owner manage daily tasks.',
  identityProactiveDuties: '- Daily standup\n- Inbox triage',
  identityEscalation: 'Escalate billing decisions to the owner.',
  agentsRules: '## Rules\n\nAlways confirm destructive actions.',
  confidence: 'high',
}

beforeEach(async () => {
  dataDir = join(tmpdir(), `eyas-bootstrap-${randomUUID()}`)
  await mkdir(dataDir, { recursive: true })
})

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true })
})

describe('bootstrapAgentWorkspace', () => {
  it('writes IDENTITY.md, AGENTS.md, TOOLS.md, MEMORY.md for a specialist (no SOUL)', async () => {
    await bootstrapAgentWorkspace({
      dataDir,
      agentId: 'planner',
      agentName: 'Planner',
      tier: 'specialist',
      split: baseSplit,
    })

    const root = join(dataDir, 'agents', 'planner')
    const identity = await readFile(join(root, 'IDENTITY.md'), 'utf8')
    expect(identity).toContain('# IDENTITY')
    expect(identity).toContain('**Name:** Planner')
    expect(identity).toContain('Help the owner manage daily tasks.')
    expect(identity).toContain('Daily standup')

    const agents = await readFile(join(root, 'AGENTS.md'), 'utf8')
    expect(agents).toContain('Always confirm destructive actions')

    expect(existsSync(join(root, 'TOOLS.md'))).toBe(true)
    expect(existsSync(join(root, 'MEMORY.md'))).toBe(true)
    expect(existsSync(join(root, 'SOUL.md'))).toBe(false)
    expect(existsSync(join(root, 'SOUL.style.json'))).toBe(false)
  })

  it('writes SOUL.md and SOUL.style.json for a primary-tier agent', async () => {
    await bootstrapAgentWorkspace({
      dataDir,
      agentId: 'jarvis',
      agentName: 'Jarvis',
      tier: 'primary',
      split: baseSplit,
    })

    const root = join(dataDir, 'agents', 'jarvis')
    expect(existsSync(join(root, 'SOUL.md'))).toBe(true)
    expect(existsSync(join(root, 'SOUL.style.json'))).toBe(true)

    const styleJson = await readFile(join(root, 'SOUL.style.json'), 'utf8')
    const style = JSON.parse(styleJson)
    expect(style.version).toBe(1)
    expect(style.preset.internal).toBe('best-buddy')
    expect(style.preset.external).toBe('diplomata')
  })

  it('writes empty AGENTS.md when split has no agentsRules', async () => {
    await bootstrapAgentWorkspace({
      dataDir,
      agentId: 'minimal',
      agentName: 'Minimal',
      tier: 'specialist',
      split: { ...baseSplit, agentsRules: '' },
    })

    // The writer always injects frontmatter; an "empty body" still produces
    // the YAML header block. Assert that the body portion (after the second
    // `---\n\n`) is empty, not the whole file.
    const agents = await readFile(join(dataDir, 'agents', 'minimal', 'AGENTS.md'), 'utf8')
    const body = agents.replace(/^---\n[\s\S]*?\n---\n\n?/, '')
    expect(body).toBe('')
  })

  it('honors custom internal/external preset overrides for primary tier', async () => {
    await bootstrapAgentWorkspace({
      dataDir,
      agentId: 'coach-bot',
      agentName: 'Coach',
      tier: 'team',
      split: baseSplit,
      internalPreset: 'coach',
      externalPreset: 'jarvis',
    })

    const styleJson = await readFile(join(dataDir, 'agents', 'coach-bot', 'SOUL.style.json'), 'utf8')
    const style = JSON.parse(styleJson)
    expect(style.preset.internal).toBe('coach')
    expect(style.preset.external).toBe('jarvis')
  })
})

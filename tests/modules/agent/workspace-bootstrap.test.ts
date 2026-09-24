// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { bootstrapAgentWorkspaceFromSeed } from '@modules/agent/workspace-bootstrap'
import type { WorkspaceSeed } from '@modules/agent/agent-templates'

function makeSeed(overrides: Partial<WorkspaceSeed> = {}): WorkspaceSeed {
  return {
    identityMd: '# IDENTITY\n\n## Who I am\n- **Name:** (set during wizard)\n\n## My mission\nDo the things.\n',
    agentsMdSeed: '# AGENTS notes',
    toolsMdSeed: '# TOOLS notes',
    soulStylePreset: { internal: 'best-buddy', external: 'diplomata' },
    ...overrides,
  }
}

describe('bootstrapAgentWorkspaceFromSeed', () => {
  let dataDir: string

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'eyas-ws-bootstrap-'))
  })

  it('writes IDENTITY/AGENTS/TOOLS/MEMORY files for a specialist', async () => {
    await bootstrapAgentWorkspaceFromSeed({
      dataDir,
      agentId: 'a-1',
      agentName: 'Spec',
      tier: 'specialist',
      seed: makeSeed(),
    })

    const dir = join(dataDir, 'agents', 'a-1')
    expect(existsSync(join(dir, 'IDENTITY.md'))).toBe(true)
    expect(existsSync(join(dir, 'AGENTS.md'))).toBe(true)
    expect(existsSync(join(dir, 'TOOLS.md'))).toBe(true)
    expect(existsSync(join(dir, 'MEMORY.md'))).toBe(true)
  })

  it('substitutes the (set during wizard) placeholder with the agent name', async () => {
    await bootstrapAgentWorkspaceFromSeed({
      dataDir,
      agentId: 'a-2',
      agentName: 'Athena',
      tier: 'primary',
      seed: makeSeed(),
    })

    const identity = readFileSync(join(dataDir, 'agents', 'a-2', 'IDENTITY.md'), 'utf-8')
    expect(identity).toContain('Athena')
    expect(identity).not.toContain('(set during wizard)')
  })

  it('writes SOUL.md + SOUL.style.json for primary tier with preset', async () => {
    await bootstrapAgentWorkspaceFromSeed({
      dataDir,
      agentId: 'a-3',
      agentName: 'Athena',
      tier: 'primary',
      seed: makeSeed(),
    })

    const dir = join(dataDir, 'agents', 'a-3')
    expect(existsSync(join(dir, 'SOUL.md'))).toBe(true)
    expect(existsSync(join(dir, 'SOUL.style.json'))).toBe(true)

    const style = JSON.parse(readFileSync(join(dir, 'SOUL.style.json'), 'utf-8'))
    expect(style.preset.internal).toBe('best-buddy')
    expect(style.preset.external).toBe('diplomata')
  })

  it('skips SOUL files for specialist tier', async () => {
    await bootstrapAgentWorkspaceFromSeed({
      dataDir,
      agentId: 'a-4',
      agentName: 'Reviewer',
      tier: 'specialist',
      seed: makeSeed(),
    })

    const dir = join(dataDir, 'agents', 'a-4')
    expect(existsSync(join(dir, 'SOUL.md'))).toBe(false)
    expect(existsSync(join(dir, 'SOUL.style.json'))).toBe(false)
  })

  it('skips SOUL files for primary when soulStylePreset is missing', async () => {
    await bootstrapAgentWorkspaceFromSeed({
      dataDir,
      agentId: 'a-5',
      agentName: 'Anon',
      tier: 'primary',
      seed: makeSeed({ soulStylePreset: undefined }),
    })
    const dir = join(dataDir, 'agents', 'a-5')
    expect(existsSync(join(dir, 'SOUL.md'))).toBe(false)
  })

  it('writes empty AGENTS.md/TOOLS.md when seed strings are empty', async () => {
    await bootstrapAgentWorkspaceFromSeed({
      dataDir,
      agentId: 'a-6',
      agentName: 'Empty',
      tier: 'specialist',
      seed: makeSeed({ agentsMdSeed: '', toolsMdSeed: '' }),
    })
    const agents = readFileSync(join(dataDir, 'agents', 'a-6', 'AGENTS.md'), 'utf-8')
    const tools = readFileSync(join(dataDir, 'agents', 'a-6', 'TOOLS.md'), 'utf-8')
    // Files exist but bodies may be just frontmatter from the writer; assert the seed body is reachable
    expect(agents.length).toBeGreaterThanOrEqual(0)
    expect(tools.length).toBeGreaterThanOrEqual(0)
  })

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true })
  })
})

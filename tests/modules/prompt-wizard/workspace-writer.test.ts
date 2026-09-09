import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createWorkspaceWriter } from '../../../src/modules/prompt-wizard/workspace-writer.js'

describe('workspace-writer', () => {
  let dataDir: string
  beforeEach(() => { dataDir = mkdtempSync(join(tmpdir(), 'eyas-wsw-')) })
  afterEach(() => { rmSync(dataDir, { recursive: true, force: true }) })

  it('creates workspace dirs and writes a file with frontmatter', async () => {
    const writer = createWorkspaceWriter({ dataDir, now: () => new Date('2026-04-26T14:00:00Z') })
    await writer.write({ agentId: 'jarvis', file: 'AGENTS.md', body: '# Notes\n- one\n' })
    const written = readFileSync(join(dataDir, 'agents', 'jarvis', 'AGENTS.md'), 'utf8')
    expect(written).toMatch(/schema: eyas\.workspace\.v1/)
    expect(written).toMatch(/agentId: jarvis/)
    expect(written).toMatch(/# Notes/)
  })

  it('snapshots prior content before overwrite', async () => {
    const writer = createWorkspaceWriter({ dataDir, now: () => new Date('2026-04-26T14:00:00Z') })
    await writer.write({ agentId: 'jarvis', file: 'AGENTS.md', body: 'v1' })
    await writer.write({ agentId: 'jarvis', file: 'AGENTS.md', body: 'v2' })
    const histDir = join(dataDir, 'agents', 'jarvis', '.history')
    const entries = readdirSync(histDir)
    const snap = entries.find((e) => e.startsWith('AGENTS.md.'))
    expect(snap).toBeDefined()
    const snapContent = readFileSync(join(histDir, snap!), 'utf8')
    expect(snapContent).toContain('v1')
  })

  it('caps history snapshots at the configured limit', async () => {
    let counter = 0
    const writer = createWorkspaceWriter({
      dataDir,
      now: () => new Date(2026, 0, 1, 12, 0, counter++),  // unique timestamps
      historyCap: 5,
    })
    for (let i = 0; i < 8; i++) {
      await writer.write({ agentId: 'jarvis', file: 'AGENTS.md', body: `v${i}` })
    }
    const histDir = join(dataDir, 'agents', 'jarvis', '.history')
    const snaps = readdirSync(histDir).filter((e) => e.startsWith('AGENTS.md.'))
    expect(snaps.length).toBeLessThanOrEqual(5)
  })

  it('writes JSON files without frontmatter', async () => {
    const writer = createWorkspaceWriter({ dataDir, now: () => new Date('2026-04-26T14:00:00Z') })
    await writer.write({ agentId: 'jarvis', file: 'SOUL.style.json', body: JSON.stringify({ version: 1 }) })
    const written = readFileSync(join(dataDir, 'agents', 'jarvis', 'SOUL.style.json'), 'utf8')
    expect(written.startsWith('---')).toBe(false)
    expect(JSON.parse(written)).toEqual({ version: 1 })
  })
})

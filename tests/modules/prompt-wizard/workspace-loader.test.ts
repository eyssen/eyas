import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createWorkspaceLoader } from '../../../src/modules/prompt-wizard/workspace-loader.js'

describe('workspace-loader', () => {
  let dataDir: string
  beforeEach(() => { dataDir = mkdtempSync(join(tmpdir(), 'eyas-ws-')) })
  afterEach(() => { rmSync(dataDir, { recursive: true, force: true }) })

  it('loads a complete workspace', async () => {
    const id = 'jarvis'
    const root = join(dataDir, 'agents', id)
    mkdirSync(join(root, 'memory'), { recursive: true })
    writeFileSync(join(root, 'IDENTITY.md'),
      '---\nschema: eyas.workspace.v1\nagentId: jarvis\ngeneratedAt: 2026-04-26T00:00:00Z\n---\n# IDENTITY\n## Who I am\n- Name: Jarvis\n## My mission\nDo things.\n## Ongoing proactive duties\n- daily\n')
    writeFileSync(join(root, 'SOUL.md'), '# SOUL\n## [Internal Voice]\nx\n## [External Voice]\ny\n')
    writeFileSync(join(root, 'SOUL.style.json'), JSON.stringify({ version: 1, preset: { internal: 'best-buddy', external: 'diplomata' } }))
    writeFileSync(join(root, 'AGENTS.md'), '')
    writeFileSync(join(root, 'TOOLS.md'), '')
    writeFileSync(join(root, 'MEMORY.md'), '')
    writeFileSync(join(root, 'memory', '2026-04-25.md'), 'yesterday')
    writeFileSync(join(root, 'memory', '2026-04-26.md'), 'today')

    const loader = createWorkspaceLoader({ dataDir })
    const ws = await loader.load(id)
    expect(ws.agentId).toBe(id)
    expect(ws.identity.exists).toBe(true)
    expect(ws.identity.frontmatter?.agentId).toBe('jarvis')
    expect(ws.identity.body).toContain('## My mission')
    expect(ws.dailyMemory).toHaveLength(2)
    expect(ws.dailyMemory[0].name).toMatch(/2026-04-2[56]\.md/)
  })

  it('returns exists=false for missing files but does not throw', async () => {
    mkdirSync(join(dataDir, 'agents', 'empty'), { recursive: true })
    const loader = createWorkspaceLoader({ dataDir })
    const ws = await loader.load('empty')
    expect(ws.identity.exists).toBe(false)
    expect(ws.identity.body).toBe('')
    expect(ws.soulMd.exists).toBe(false)
  })

  it('truncates oversized files with a marker', async () => {
    const id = 'big'
    const root = join(dataDir, 'agents', id)
    mkdirSync(root, { recursive: true })
    const huge = 'x'.repeat(20_000)
    writeFileSync(join(root, 'AGENTS.md'), huge)

    const loader = createWorkspaceLoader({ dataDir, maxBytesPerFile: 12_000 })
    const ws = await loader.load(id)
    expect(ws.agentsMd.truncated).toBe(true)
    expect(ws.agentsMd.body.length).toBeLessThanOrEqual(12_500)
    expect(ws.agentsMd.body).toMatch(/\[truncated/i)
  })

  it('caches reads until invalidated', async () => {
    const id = 'cache-test'
    const root = join(dataDir, 'agents', id)
    mkdirSync(root, { recursive: true })
    writeFileSync(join(root, 'AGENTS.md'), 'first')
    const loader = createWorkspaceLoader({ dataDir })
    const a = await loader.load(id)
    writeFileSync(join(root, 'AGENTS.md'), 'second')
    const b = await loader.load(id)  // returns cached
    expect(b.agentsMd.body).toBe(a.agentsMd.body)
    loader.invalidate(id)
    const c = await loader.load(id)
    expect(c.agentsMd.body).toBe('second')
  })
})

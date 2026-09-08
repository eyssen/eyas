import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createWorkspaceWriter } from '../../../src/modules/prompt-wizard/workspace-writer.js'
import { createSoulPipeline } from '../../../src/modules/prompt-wizard/soul-pipeline.js'
import { defaultStyleForAgent } from '../../../src/modules/prompt-wizard/soul-presets.js'

describe('soul-pipeline', () => {
  let dataDir: string
  beforeEach(() => { dataDir = mkdtempSync(join(tmpdir(), 'eyas-soul-pipe-')) })
  afterEach(() => { rmSync(dataDir, { recursive: true, force: true }) })

  it('saveStyle writes both SOUL.style.json and SOUL.md', async () => {
    const writer = createWorkspaceWriter({ dataDir, now: () => new Date('2026-04-26T10:00:00Z') })
    const pipeline = createSoulPipeline({ writer })
    const style = defaultStyleForAgent('jarvis', 'diplomata')
    await pipeline.saveStyle('jarvis-id', 'Jarvis', style)

    const jsonPath = join(dataDir, 'agents', 'jarvis-id', 'SOUL.style.json')
    const mdPath = join(dataDir, 'agents', 'jarvis-id', 'SOUL.md')
    expect(existsSync(jsonPath)).toBe(true)
    expect(existsSync(mdPath)).toBe(true)
    const md = readFileSync(mdPath, 'utf8')
    expect(md).toContain('# SOUL — Jarvis voice')
    expect(md).toContain('## [Internal Voice]')
    expect(md).toContain('## [External Voice]')
  })

  it('JSON round-trips: saveStyle output parses back to the same style', async () => {
    const writer = createWorkspaceWriter({ dataDir, now: () => new Date() })
    const pipeline = createSoulPipeline({ writer })
    const style = defaultStyleForAgent('best-buddy', 'standup')
    await pipeline.saveStyle('agent-x', 'Agent X', style)

    const json = readFileSync(join(dataDir, 'agents', 'agent-x', 'SOUL.style.json'), 'utf8')
    expect(json.startsWith('---')).toBe(false) // no frontmatter for JSON
    const parsed = JSON.parse(json)
    expect(parsed.preset.internal).toBe('best-buddy')
    expect(parsed.preset.external).toBe('standup')
    expect(parsed.internal.address).toBe('tegező')
  })

  it('saveStyle throws on invalid style (Zod validation)', async () => {
    const writer = createWorkspaceWriter({ dataDir, now: () => new Date() })
    const pipeline = createSoulPipeline({ writer })
    const bad = {
      version: 1,
      preset: { internal: 'jarvis', external: 'jarvis' },
      internal: { address: 'kontextus-érzékeny' }, // not allowed in internal
      external: {},
    } as never
    await expect(pipeline.saveStyle('x', 'X', bad)).rejects.toThrow()
  })

  it('rerender updates only SOUL.md, not the JSON', async () => {
    const writer = createWorkspaceWriter({ dataDir, now: () => new Date() })
    const pipeline = createSoulPipeline({ writer })
    const style = defaultStyleForAgent('jarvis', 'jarvis')
    await pipeline.saveStyle('a', 'A', style)
    const jsonPath = join(dataDir, 'agents', 'a', 'SOUL.style.json')
    const jsonBefore = readFileSync(jsonPath, 'utf8')

    await pipeline.rerender('a', 'NewName', style)

    const md = readFileSync(join(dataDir, 'agents', 'a', 'SOUL.md'), 'utf8')
    expect(md).toContain('NewName voice')

    const jsonAfter = readFileSync(jsonPath, 'utf8')
    expect(jsonAfter).toBe(jsonBefore) // JSON untouched
  })
})

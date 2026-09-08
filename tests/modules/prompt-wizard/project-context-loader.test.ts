// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { createProjectContextLoader } from '../../../src/modules/prompt-wizard/project-context-loader.js'

function makeFrontmatter(agentId: string): string {
  return `---\nschema: agents-md\nagentId: ${agentId}\ngeneratedAt: 2026-04-26T00:00:00.000Z\n---\n\n`
}

async function writeAgentsFile(filePath: string, content: string): Promise<void> {
  await mkdir(join(filePath, '..'), { recursive: true })
  await writeFile(filePath, content, 'utf8')
}

describe('createProjectContextLoader', () => {
  let dataDir: string

  beforeEach(async () => {
    dataDir = join(tmpdir(), `project-context-loader-test-${randomUUID()}`)
    await mkdir(dataDir, { recursive: true })
  })

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true })
  })

  it('no project returns nulls', async () => {
    const loader = createProjectContextLoader({
      dataDir,
      resolveProjectType: async () => null,
    })

    const result = await loader.cascade({ projectId: null })

    expect(result.projectTypeAgents).toBeNull()
    expect(result.projectAgents).toBeNull()
    expect(result.projectTypeId).toBeNull()
    expect(result.projectId).toBeNull()
  })

  it('project-only loads agent file when no project type exists', async () => {
    const projectId = 'proj-alpha'
    const body = '# Project Alpha Agents\nSome instructions here.'
    const filePath = join(dataDir, 'projects', projectId, 'AGENTS.md')
    await writeAgentsFile(filePath, makeFrontmatter('project') + body)

    const loader = createProjectContextLoader({
      dataDir,
      resolveProjectType: async () => null,
    })

    const result = await loader.cascade({ projectId })

    expect(result.projectId).toBe(projectId)
    expect(result.projectTypeId).toBeNull()
    expect(result.projectTypeAgents).toBeNull()
    expect(result.projectAgents).toBe(body)
  })

  it('project + type loads both with frontmatter stripped', async () => {
    const projectId = 'proj-beta'
    const typeId = 'type-dev'
    const projectBody = '# Project Beta\nProject-level instructions.'
    const typeBody = '# Dev Type\nType-level instructions.'

    const projectFilePath = join(dataDir, 'projects', projectId, 'AGENTS.md')
    const typeFilePath = join(dataDir, 'project-types', typeId, 'AGENTS.md')

    await writeAgentsFile(projectFilePath, makeFrontmatter('project') + `+ ${projectBody}`)
    await writeAgentsFile(typeFilePath, makeFrontmatter('type') + typeBody)

    const loader = createProjectContextLoader({
      dataDir,
      resolveProjectType: async () => ({ id: typeId }),
    })

    const result = await loader.cascade({ projectId })

    expect(result.projectId).toBe(projectId)
    expect(result.projectTypeId).toBe(typeId)
    expect(result.projectAgents).toBe(projectBody)
    expect(result.projectTypeAgents).toBe(typeBody)
  })

  it('plus prefix keeps type and strips the plus from project', async () => {
    const projectId = 'proj-extend'
    const typeId = 'type-a'
    const typeBody = 'Type brief. Never copy the closed edition.'
    const projectFile = '+ Bravo is pod-only; code is local.'

    await writeAgentsFile(join(dataDir, 'projects', projectId, 'AGENTS.md'), makeFrontmatter('project') + projectFile)
    await writeAgentsFile(join(dataDir, 'project-types', typeId, 'AGENTS.md'), makeFrontmatter('type') + typeBody)

    const loader = createProjectContextLoader({
      dataDir,
      resolveProjectType: async () => ({ id: typeId }),
    })

    const result = await loader.cascade({ projectId })

    expect(result.projectTypeAgents).toBe(typeBody)
    expect(result.projectAgents).toBe('Bravo is pod-only; code is local.')
  })

  it('override (no plus) drops type-level content', async () => {
    const projectId = 'proj-override'
    const typeId = 'type-a'
    const typeBody = 'Type-level only — must not reach the model.'
    const projectBody = 'Project override brief'

    await writeAgentsFile(join(dataDir, 'projects', projectId, 'AGENTS.md'), makeFrontmatter('project') + projectBody)
    await writeAgentsFile(join(dataDir, 'project-types', typeId, 'AGENTS.md'), makeFrontmatter('type') + typeBody)

    const loader = createProjectContextLoader({
      dataDir,
      resolveProjectType: async () => ({ id: typeId }),
    })

    const result = await loader.cascade({ projectId })

    expect(result.projectTypeAgents).toBeNull()
    expect(result.projectAgents).toBe(projectBody)
  })

  it('empty project inherits type only', async () => {
    const projectId = 'proj-empty'
    const typeId = 'type-a'
    const typeBody = 'Type brief only.'

    await writeAgentsFile(join(dataDir, 'project-types', typeId, 'AGENTS.md'), makeFrontmatter('type') + typeBody)

    const loader = createProjectContextLoader({
      dataDir,
      resolveProjectType: async () => ({ id: typeId }),
    })

    const result = await loader.cascade({ projectId })

    expect(result.projectTypeAgents).toBe(typeBody)
    expect(result.projectAgents).toBeNull()
  })

  it('reads DB prompt when AGENTS.md is missing', async () => {
    const projectId = 'alpha'
    const typeId = 'type-a'
    const typePrompt = 'Type brief, indexer, no closed-edition copy.'
    const projectPrompt = '+ Unlike bravo, code is local; the pod is diagnosis only.'

    const loader = createProjectContextLoader({
      dataDir,
      resolveProjectType: async () => ({ id: typeId }),
      resolveTypePrompt: async () => typePrompt,
      resolveProjectPrompt: async () => projectPrompt,
    })

    const result = await loader.cascade({ projectId })

    expect(result.projectTypeId).toBe(typeId)
    expect(result.projectTypeAgents).toBe(typePrompt)
    expect(result.projectAgents).toBe('Unlike bravo, code is local; the pod is diagnosis only.')
  })

  it('non-empty DB prompt wins over a stale AGENTS.md file', async () => {
    const projectId = 'alpha'
    const typeId = 'type-a'
    await writeAgentsFile(
      join(dataDir, 'projects', projectId, 'AGENTS.md'),
      makeFrontmatter('project') + 'stale file content that must not appear',
    )

    const loader = createProjectContextLoader({
      dataDir,
      resolveProjectType: async () => ({ id: typeId }),
      resolveTypePrompt: async () => 'type from db',
      resolveProjectPrompt: async () => '+ from the form',
    })

    const result = await loader.cascade({ projectId })

    expect(result.projectTypeAgents).toBe('type from db')
    expect(result.projectAgents).toBe('from the form')
    expect(result.projectAgents).not.toContain('stale file')
  })

  it('falls back to the file when the DB prompt is empty', async () => {
    const projectId = 'handwritten'
    const typeId = 'type-a'
    const fileBody = '+ handwritten project notes'
    await writeAgentsFile(join(dataDir, 'projects', projectId, 'AGENTS.md'), makeFrontmatter('project') + fileBody)
    await writeAgentsFile(join(dataDir, 'project-types', typeId, 'AGENTS.md'), makeFrontmatter('type') + 'type file')

    const loader = createProjectContextLoader({
      dataDir,
      resolveProjectType: async () => ({ id: typeId }),
      resolveTypePrompt: async () => '',
      resolveProjectPrompt: async () => null,
    })

    const result = await loader.cascade({ projectId })

    expect(result.projectTypeAgents).toBe('type file')
    expect(result.projectAgents).toBe('handwritten project notes')
  })

  it('oversized cascade truncates type-level first', async () => {
    const projectId = 'proj-gamma'
    const typeId = 'type-large'

    // Project-level: ~5000 chars. "+" so both sources stay in the cascade
    // (without it the project would override and type would never truncate).
    const projectBody = '# Project Gamma\n' + 'x'.repeat(4980)
    // Type-level: ~10000 chars
    const typeBody = '# Type Large\n' + 'y'.repeat(9980)

    // Combined = ~15000 chars, cap = 3000 * 4 = 12000 chars
    expect(projectBody.length + typeBody.length).toBeGreaterThan(12000)

    const projectFilePath = join(dataDir, 'projects', projectId, 'AGENTS.md')
    const typeFilePath = join(dataDir, 'project-types', typeId, 'AGENTS.md')

    await writeAgentsFile(projectFilePath, makeFrontmatter('project') + `+ ${projectBody}`)
    await writeAgentsFile(typeFilePath, makeFrontmatter('type') + typeBody)

    const loader = createProjectContextLoader({
      dataDir,
      resolveProjectType: async () => ({ id: typeId }),
    })

    const result = await loader.cascade({ projectId })

    // Project-level content stays intact
    expect(result.projectAgents).toBe(projectBody)
    expect(result.projectAgents!.length).toBe(projectBody.length)

    // Type-level content is truncated and ends with the marker
    expect(result.projectTypeAgents).not.toBeNull()
    expect(result.projectTypeAgents!.endsWith('[truncated — cascade budget]')).toBe(true)
    expect(result.projectTypeAgents!.length).toBeLessThan(typeBody.length)
  })
})

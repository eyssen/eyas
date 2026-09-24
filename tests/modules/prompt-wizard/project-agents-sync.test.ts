// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { mkdir, rm } from 'node:fs/promises'
import { createTestDb } from '../../helpers/test-db'
import { createProjectTypeService } from '@modules/board/services/project-type-service'
import { createProjectService } from '@modules/board/services/project-service'
import { projectAgentsPath, projectTypeAgentsPath } from '@modules/prompt-wizard/workspace-paths.js'
import { syncMissingProjectAgentsFiles } from '@modules/prompt-wizard/project-agents-sync.js'
import { writeFileSync, mkdirSync } from 'node:fs'

const testDb = createTestDb('project-agents-sync')

describe('project form save materializes AGENTS.md', () => {
  let dataDir: string
  let db: ReturnType<typeof testDb.open>

  beforeEach(async () => {
    dataDir = join(tmpdir(), `project-agents-sync-${randomUUID()}`)
    await mkdir(dataDir, { recursive: true })
    db = testDb.open()
  })

  afterEach(async () => {
    testDb.cleanup()
    await rm(dataDir, { recursive: true, force: true })
  })

  it('writes type and project AGENTS.md from the prompt field', () => {
    const types = createProjectTypeService(db, { dataDir })
    const projects = createProjectService(db, types, { dataDir })
    const type = types.create({ name: 'Type A', prompt: 'Type brief. Never copy the closed edition.' })
    const project = projects.create({
      name: 'Alpha',
      typeId: type.id,
      prompt: '+ Unlike bravo, code is local; the pod is diagnosis only.',
    })

    const typePath = projectTypeAgentsPath(type.id, dataDir)
    const projectPath = projectAgentsPath(project.id, dataDir)
    expect(readFileSync(typePath, 'utf8')).toBe('Type brief. Never copy the closed edition.')
    expect(readFileSync(projectPath, 'utf8')).toBe('+ Unlike bravo, code is local; the pod is diagnosis only.')
  })

  it('clears the project AGENTS.md when the form prompt is emptied', () => {
    const types = createProjectTypeService(db, { dataDir })
    const projects = createProjectService(db, types, { dataDir })
    const type = types.create({ name: 'Type A', prompt: 'Type brief' })
    const project = projects.create({ name: 'Alpha', typeId: type.id, prompt: '+ extra' })
    const projectPath = projectAgentsPath(project.id, dataDir)
    expect(existsSync(projectPath)).toBe(true)

    projects.update(project.id, { prompt: '' })
    expect(existsSync(projectPath)).toBe(false)
  })

  it('syncs seed prompts into missing files without clobbering an existing file', () => {
    mkdirSync(join(dataDir, 'projects', 'handwritten'), { recursive: true })
    const existing = join(dataDir, 'projects', 'handwritten', 'AGENTS.md')
    writeFileSync(existing, 'do not touch', 'utf8')

    syncMissingProjectAgentsFiles(
      dataDir,
      [{ id: 'general', prompt: 'General type brief' }],
      [
        { id: 'general-general', prompt: 'Default home brief' },
        { id: 'handwritten', prompt: 'from db' },
      ],
    )

    expect(readFileSync(projectTypeAgentsPath('general', dataDir), 'utf8')).toBe('General type brief')
    expect(readFileSync(projectAgentsPath('general-general', dataDir), 'utf8')).toBe('Default home brief')
    expect(readFileSync(existing, 'utf8')).toBe('do not touch')
  })
})

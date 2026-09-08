// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pino from 'pino'
import { createTestDb } from '../../helpers/test-db'
import { createStudioTables } from '@modules/studio/schema'
import { createStudioGateway } from '@modules/studio/gateway'
import { createFakeStudioEngine } from '@modules/studio/fake-engine'

describe('studio gateway', () => {
  let db: any
  let cleanup: () => void
  let root: string

  beforeEach(() => {
    const t = createTestDb('studio-gateway')
    db = t.open()
    cleanup = t.cleanup
    createStudioTables(db)
    root = mkdtempSync(join(tmpdir(), 'studio-gw-'))
  })

  afterEach(() => {
    cleanup()
    rmSync(root, { recursive: true, force: true })
  })

  it('creates, writes, lints, and renders through a fake engine then ingests', async () => {
    const ingested: string[] = []
    const gw = createStudioGateway({
      db,
      logger: pino({ enabled: false }),
      projectsRoot: root,
      ingest: async (job) => {
        ingested.push(job.outputPath ?? '')
        return { ...job, documentIds: ['doc-1'] }
      },
    })
    gw.registerEngine(createFakeStudioEngine({ id: 'hyperframes' }))

    const project = await gw.createProject({ engineId: 'hyperframes', title: 'Demo', conversationId: 'c1' })
    expect(existsSync(join(project.dir, 'index.html'))).toBe(true)
    expect(readFileSync(join(project.dir, 'index.html'), 'utf8')).toContain('Demo')

    const written = await gw.writeFile(project.id, 'index.html', '<div class="clip" data-composition-id="main" data-start="0" data-duration="1"></div>')
    expect(written.bytes).toBeGreaterThan(0)

    const lint = await gw.lint(project.id)
    expect(lint.ok).toBe(true)

    const job = await gw.render({ projectId: project.id, conversationId: 'c1', userId: 'u1' })
    expect(job.status).toBe('completed')
    expect(job.documentIds).toEqual(['doc-1'])
    expect(ingested).toHaveLength(1)
    expect(gw.listJobs({ conversationId: 'c1' }).map((j) => j.id)).toEqual([job.id])
  })

  it('fails closed when the engine is missing', async () => {
    const gw = createStudioGateway({
      db,
      logger: pino({ enabled: false }),
      projectsRoot: root,
    })
    await expect(gw.createProject({ engineId: 'hyperframes', title: 'X' })).rejects.toThrow(/not available/)
  })
})

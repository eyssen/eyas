// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pino from 'pino'
import { createTestDb } from '../../helpers/test-db'
import { createStudioTables } from '@modules/studio/schema'
import { createStudioGateway } from '@modules/studio/gateway'
import { createFakeStudioEngine } from '@modules/studio/fake-engine'
import { createVideoUseTools } from '@modules/studio/submodules/videouse/tools'
import type { ToolContext, ToolImplementation } from '@modules/tools/types'

const ctx: ToolContext = {
  conversationId: 'c1',
  userId: 'u1',
  logger: pino({ enabled: false }),
}

function byName(list: ToolImplementation[], name: string): ToolImplementation {
  const found = list.find((t) => t.name === name)
  if (!found) throw new Error(`no tool named ${name}`)
  return found
}

describe('videouse tools', () => {
  let db: any
  let cleanup: () => void
  let root: string

  beforeEach(() => {
    const t = createTestDb('videouse-tools')
    db = t.open()
    cleanup = t.cleanup
    createStudioTables(db)
    root = mkdtempSync(join(tmpdir(), 'videouse-tools-'))
  })

  afterEach(() => {
    cleanup()
    rmSync(root, { recursive: true, force: true })
  })

  it('registers ten tools with expected risk tiers', () => {
    const tools = createVideoUseTools({ getGateway: () => undefined })
    expect(tools.map((t) => t.name)).toEqual([
      'videouse_status',
      'videouse_create',
      'videouse_ingest',
      'videouse_inventory',
      'videouse_transcribe',
      'videouse_pack',
      'videouse_write',
      'videouse_lint',
      'videouse_render',
      'videouse_list',
    ])
    expect(byName(tools, 'videouse_status').riskTier).toBe('green')
    expect(byName(tools, 'videouse_render').riskTier).toBe('yellow')
    expect(byName(tools, 'videouse_transcribe').riskTier).toBe('yellow')
  })

  it('create/write/render/list round-trip through a fake engine', async () => {
    const gw = createStudioGateway({
      db,
      logger: pino({ enabled: false }),
      projectsRoot: root,
    })
    gw.registerEngine(createFakeStudioEngine({ id: 'videouse' }))
    const tools = createVideoUseTools({ getGateway: () => gw })

    const created = await byName(tools, 'videouse_create').execute({ title: 'Cut' }, ctx) as { project: { id: string } }
    const written = await byName(tools, 'videouse_write').execute({
      projectId: created.project.id,
      path: 'edit/edl.json',
      content: '{"version":1,"sources":{"A":"a.mp4"},"ranges":[{"source":"A","start":0,"end":1}]}',
    }, ctx) as { path: string }
    expect(written.path).toBe('edit/edl.json')

    const rendered = await byName(tools, 'videouse_render').execute(
      { projectId: created.project.id },
      ctx,
    ) as { job: { status: string } }
    expect(rendered.job.status).toBe('completed')
  })

  it('ingest copies a local file into sources/', async () => {
    const { createVideoUseAdapter } = await import('@modules/studio/submodules/videouse/adapter.js')
    const gw = createStudioGateway({
      db,
      logger: pino({ enabled: false }),
      projectsRoot: root,
    })
    const adapter = createVideoUseAdapter({
      runner: { which: async () => '/usr/bin/ffmpeg', run: async () => ({ code: 0, stdout: '1.0', stderr: '' }) },
      logger: pino({ enabled: false }),
      getSettings: () => ({
        hyperframes: { enabled: true, cliPath: null, versionPin: '0.8.17', allowNpx: true },
        videouse: { enabled: true },
      }),
    })
    gw.registerEngine(adapter)
    const tools = createVideoUseTools({ getGateway: () => gw })
    const created = await byName(tools, 'videouse_create').execute({ title: 'Cut' }, ctx) as { project: { id: string } }
    const src = join(root, 'take.mp4')
    writeFileSync(src, 'fake')
    const ingested = await byName(tools, 'videouse_ingest').execute({
      projectId: created.project.id,
      paths: [src],
    }, ctx) as { files: string[] }
    expect(ingested.files).toEqual(['sources/take.mp4'])
  })
})

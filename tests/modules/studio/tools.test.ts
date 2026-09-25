// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pino from 'pino'
import { createTestDb } from '../../helpers/test-db'
import { createStudioTables } from '@modules/studio/schema'
import { createStudioGateway } from '@modules/studio/gateway'
import { createFakeStudioEngine } from '@modules/studio/fake-engine'
import { createHyperframesTools } from '@modules/studio/submodules/hyperframes/tools'
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

describe('hyperframes tools', () => {
  let db: any
  let cleanup: () => void
  let root: string

  beforeEach(() => {
    const t = createTestDb('studio-tools')
    db = t.open()
    cleanup = t.cleanup
    createStudioTables(db)
    root = mkdtempSync(join(tmpdir(), 'studio-tools-'))
  })

  afterEach(() => {
    cleanup()
    rmSync(root, { recursive: true, force: true })
  })

  it('registers six custom tools with render/create/write yellow', () => {
    const tools = createHyperframesTools({ getGateway: () => undefined })
    expect(tools.map((t) => t.name)).toEqual([
      'hyperframes_status',
      'hyperframes_create',
      'hyperframes_write',
      'hyperframes_lint',
      'hyperframes_render',
      'hyperframes_list',
    ])
    expect(byName(tools, 'hyperframes_status').riskTier).toBe('green')
    expect(byName(tools, 'hyperframes_create').riskTier).toBe('yellow')
    expect(byName(tools, 'hyperframes_write').riskTier).toBe('yellow')
    expect(byName(tools, 'hyperframes_lint').riskTier).toBe('green')
    expect(byName(tools, 'hyperframes_render').riskTier).toBe('yellow')
    expect(byName(tools, 'hyperframes_list').riskTier).toBe('green')
  })

  it('create/write/render/list round-trip through the gateway', async () => {
    const gw = createStudioGateway({
      db,
      logger: pino({ enabled: false }),
      projectsRoot: root,
    })
    gw.registerEngine(createFakeStudioEngine({ id: 'hyperframes' }))
    const tools = createHyperframesTools({ getGateway: () => gw })

    const created = await byName(tools, 'hyperframes_create').execute({ title: 'Demo' }, ctx) as { project: { id: string } }
    expect(created.project.id).toBeTruthy()

    const written = await byName(tools, 'hyperframes_write').execute({
      projectId: created.project.id,
      path: 'index.html',
      content: '<div id="stage" data-composition-id="main" data-start="0" data-duration="1"><h1 class="clip" data-start="0" data-duration="1">Hi</h1></div>',
    }, ctx) as { path: string }
    expect(written.path).toBe('index.html')

    const rendered = await byName(tools, 'hyperframes_render').execute(
      { projectId: created.project.id },
      ctx,
    ) as { job: { status: string; conversationId: string | null } }
    expect(rendered.job.status).toBe('completed')
    expect(rendered.job.conversationId).toBe('c1')

    const listed = await byName(tools, 'hyperframes_list').execute({}, ctx) as { projects: unknown[]; jobs: unknown[] }
    expect(listed.projects).toHaveLength(1)
    expect(listed.jobs).toHaveLength(1)
  })

  it('returns not-ready when the gateway is missing', async () => {
    const tools = createHyperframesTools({ getGateway: () => undefined })
    expect(await byName(tools, 'hyperframes_status').execute({}, ctx)).toEqual({
      error: 'Studio module not ready yet — try again shortly',
    })
  })

  it('write rejects path escape via the tool', async () => {
    const gw = createStudioGateway({
      db,
      logger: pino({ enabled: false }),
      projectsRoot: root,
    })
    gw.registerEngine(createFakeStudioEngine({ id: 'hyperframes' }))
    const tools = createHyperframesTools({ getGateway: () => gw })
    const created = await byName(tools, 'hyperframes_create').execute({ title: 'Demo' }, ctx) as { project: { id: string } }
    const result = await byName(tools, 'hyperframes_write').execute({
      projectId: created.project.id,
      path: '../escape.html',
      content: 'nope',
    }, ctx)
    expect(result).toEqual({ error: expect.stringMatching(/escapes|relative/) })
  })
})

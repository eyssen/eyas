// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import pino from 'pino'
import { createTestDb } from '../../helpers/test-db'
import { createMediaTables } from '@modules/media/schema'
import { createMediaGateway } from '@modules/media/gateway'
import { createFakeMediaProvider } from '@modules/media/fake-provider'
import { defaultMediaSettings } from '@modules/media/routing'
import { createMediaTools } from '@modules/media/tools'
import type { MediaGateway } from '@modules/media/types'
import type { ToolContext, ToolImplementation } from '@modules/tools/types'

const EMPTY =
  'No media provider configured for this kind. Open /media and connect Magnific, Higgsfield, or fal.'

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

function makeTools(gateway: MediaGateway | undefined) {
  return createMediaTools({
    getGateway: () => gateway,
    getSettings: () => defaultMediaSettings(),
    sumCredits: () => 0,
  })
}

describe('createMediaTools', () => {
  let db: any
  let cleanup: () => void

  beforeEach(() => {
    const t = createTestDb('media-tools')
    db = t.open()
    cleanup = t.cleanup
    createMediaTables(db)
  })

  afterEach(() => cleanup())

  it('registers five custom tools with generate/wait yellow and the rest green', () => {
    const tools = makeTools(undefined)
    expect(tools.map((t) => t.name)).toEqual([
      'media_generate',
      'media_wait',
      'media_catalog',
      'media_balance',
      'media_history',
    ])
    expect(byName(tools, 'media_generate')).toMatchObject({ category: 'custom', riskTier: 'yellow' })
    expect(byName(tools, 'media_wait')).toMatchObject({ category: 'custom', riskTier: 'yellow' })
    expect(byName(tools, 'media_catalog')).toMatchObject({ category: 'custom', riskTier: 'green' })
    expect(byName(tools, 'media_balance')).toMatchObject({ category: 'custom', riskTier: 'green' })
    expect(byName(tools, 'media_history')).toMatchObject({ category: 'custom', riskTier: 'green' })
  })

  it('generate with a fake provider via the gateway returns jobs', async () => {
    const gw = createMediaGateway({ db, logger: pino({ enabled: false }) })
    gw.registerProvider(createFakeMediaProvider({ id: 'fake' }))
    const tools = makeTools(gw)

    const result = await byName(tools, 'media_generate').execute(
      { kind: 'image', prompt: 'a lamp' },
      ctx,
    ) as { jobs?: Array<{ id: string; providerId: string; status: string; conversationId: string | null }> }

    expect(result.jobs).toHaveLength(1)
    expect(result.jobs![0]!.id).toBeTruthy()
    expect(result.jobs![0]!.providerId).toBe('fake')
    expect(result.jobs![0]!.status).toBe('completed')
    expect(result.jobs![0]!.conversationId).toBe('c1')
    expect(gw.listJobs({ conversationId: 'c1' }).map((j) => j.id)).toEqual([result.jobs![0]!.id])
  })

  it('generate returns the empty-provider error string when none are configured', async () => {
    const emptyGw = createMediaGateway({ db, logger: pino({ enabled: false }) })
    const fromEmpty = await byName(makeTools(emptyGw), 'media_generate').execute(
      { kind: 'image', prompt: 'a lamp' },
      ctx,
    )
    expect(fromEmpty).toEqual({ error: EMPTY })

    const fromMissing = await byName(makeTools(undefined), 'media_generate').execute(
      { kind: 'image', prompt: 'a lamp' },
      ctx,
    )
    expect(fromMissing).toEqual({ error: EMPTY })
  })

  it('generate returns the empty-provider error string for an unconfigured pin', async () => {
    const gw = createMediaGateway({ db, logger: pino({ enabled: false }) })
    gw.registerProvider(createFakeMediaProvider({ id: 'fake' }))
    const result = await byName(makeTools(gw), 'media_generate').execute(
      { kind: 'image', prompt: 'a lamp', provider: 'magnific' },
      ctx,
    )
    expect(result).toEqual({ error: EMPTY })
  })

  it('wait returns the completed job without throwing', async () => {
    const gw = createMediaGateway({ db, logger: pino({ enabled: false }) })
    gw.registerProvider(createFakeMediaProvider({ id: 'fake' }))
    const tools = makeTools(gw)
    const generated = await byName(tools, 'media_generate').execute(
      { kind: 'image', prompt: 'a lamp' },
      ctx,
    ) as { jobs: Array<{ id: string }> }
    const waited = await byName(tools, 'media_wait').execute(
      { jobId: generated.jobs[0]!.id },
      ctx,
    ) as { job: { id: string; status: string } }
    expect(waited.job.id).toBe(generated.jobs[0]!.id)
    expect(waited.job.status).toBe('completed')
  })
})

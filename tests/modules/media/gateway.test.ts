// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTestDb } from '../../helpers/test-db'
import { createMediaTables } from '@modules/media/schema'
import { createMediaGateway } from '@modules/media/gateway'
import { createFakeMediaProvider } from '@modules/media/fake-provider'
import pino from 'pino'

describe('MediaGateway', () => {
  let db: any
  let cleanup: () => void

  beforeEach(() => {
    const t = createTestDb('media-gateway')
    db = t.open()
    cleanup = t.cleanup
    createMediaTables(db)
  })

  afterEach(() => cleanup())

  it('lists nothing until a provider is registered', () => {
    const gw = createMediaGateway({ db, logger: pino({ enabled: false }) })
    expect(gw.listProviders()).toEqual([])
  })

  it('generate persists a job and listJobs({ since }) returns it', async () => {
    const gw = createMediaGateway({ db, logger: pino({ enabled: false }) })
    gw.registerProvider(createFakeMediaProvider({ id: 'fake' }))
    const before = Date.now() - 1000
    const job = await gw.generate({
      providerId: 'fake',
      kind: 'image',
      prompt: 'a lamp',
      conversationId: 'c1',
    })
    expect(job.id).toBeTruthy()
    expect(job.providerId).toBe('fake')
    const listed = gw.listJobs({ conversationId: 'c1', since: before })
    expect(listed.map((j) => j.id)).toContain(job.id)
    expect(gw.listJobs({ conversationId: 'c1', since: Date.now() + 60_000 })).toEqual([])
  })

  it('generate throws when the provider is missing', async () => {
    const gw = createMediaGateway({ db, logger: pino({ enabled: false }) })
    await expect(gw.generate({ providerId: 'nope', kind: 'image', prompt: 'x' }))
      .rejects.toThrow(/nope/)
  })
})

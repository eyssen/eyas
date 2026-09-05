// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// The wiring is extracted from memory/index.ts onStart (same reason as
// reflection-job.ts) so the real code runs here against fakes.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { sql } from 'drizzle-orm'
import { wireL0Capture, type L0WireConfig } from '@modules/memory/v2/wire'
import { captureUnit, pendingUnits, resetIngestBridge } from '@modules/memory/v2/ingest-bridge'
import * as zstd from '@shared/zstd'
import { FLUSH_JOB_NAME, FLUSH_HANDLER_KEY } from '@modules/memory/v2/flush-job'
import { makeV2Db, makeUnit, silentLogger } from './helpers'

type Handler = (data: unknown) => Promise<void>

function fakeBus() {
  const handlers = new Map<string, Handler[]>()
  return {
    on: vi.fn((subject: string, handler: Handler) => {
      handlers.set(subject, [...(handlers.get(subject) ?? []), handler])
      return { subject, id: 'x', unsubscribe() {} }
    }),
    emit: async (subject: string, data: unknown) => { for (const h of handlers.get(subject) ?? []) await h(data) },
  }
}
function fakeScheduler() {
  const handlers = new Map<string, () => Promise<unknown>>()
  return {
    registerHandler: (name: string, fn: () => Promise<unknown>) => { handlers.set(name, fn) },
    list: () => [] as Array<{ name?: string }>,
    create: vi.fn(),
    handlers,
  }
}
const config = (over: Partial<L0WireConfig> = {}): L0WireConfig => ({ enabled: true, toolResultMaxBytes: 8_192, idleFlushMinutes: 30, chunkTokens: 8_000, captureToolResults: false, ...over })

beforeEach(() => resetIngestBridge())

describe('wireL0Capture', () => {
  it('attaches the bridge (draining early units), registers the sweep, and flushes on task close and closed-stage moves', async () => {
    const { db, caps } = makeV2Db()
    db.run(sql`CREATE TABLE stages (id TEXT PRIMARY KEY, is_closed INTEGER NOT NULL DEFAULT 0)`)
    db.run(sql`INSERT INTO stages VALUES ('open', 0), ('done', 1)`)
    const early = makeUnit({ conversationId: 'conv-early' })
    captureUnit(early)
    const bus = fakeBus()
    const scheduler = fakeScheduler()

    const ingest = await wireL0Capture({ db, caps, logger: silentLogger, instanceId: 'inst-test', config: () => config(), bus, scheduler })
    expect(ingest).not.toBeNull()
    expect(pendingUnits()).toBe(0)
    expect(ingest!.bufferedUnits()).toBe(1)
    expect(scheduler.handlers.has(FLUSH_HANDLER_KEY)).toBe(true)
    expect(scheduler.create).toHaveBeenCalledWith(expect.objectContaining({ name: FLUSH_JOB_NAME }))

    const flushed = vi.fn()
    ingest!.onFlushed(flushed)
    await bus.emit('eyas.conversations.closed', { conversationId: 'conv-early', status: 'archived' })
    expect(flushed).toHaveBeenCalledWith('conv-early', 'close')

    captureUnit(makeUnit({ conversationId: 'conv-stage' }))
    await bus.emit('eyas.conversations.stage_changed', { conversationId: 'conv-stage', fromStageId: 'open', toStageId: 'open' })
    expect(ingest!.bufferedUnits()).toBe(1)
    await bus.emit('eyas.conversations.stage_changed', { conversationId: 'conv-stage', fromStageId: 'open', toStageId: 'done' })
    expect(flushed).toHaveBeenCalledWith('conv-stage', 'close')
    expect((db.all(sql`SELECT COUNT(*) AS c FROM memory_raw`) as any[])[0].c).toBe(2)
  })

  it('returns null and disables the bridge when memory.l0.enabled is false', async () => {
    const { db, caps } = makeV2Db()
    captureUnit(makeUnit())
    const ingest = await wireL0Capture({ db, caps, logger: silentLogger, instanceId: 'inst-test', config: () => config({ enabled: false }) })
    expect(ingest).toBeNull()
    expect(pendingUnits()).toBe(0)
    captureUnit(makeUnit())
    expect(pendingUnits()).toBe(0)
  })

  it('disables the bridge when no zstd tier is available, instead of buffering forever', async () => {
    const { db, caps } = makeV2Db()
    const boom = new Error('no zstd backend available')
    const spy = vi.spyOn(zstd, 'initZstd').mockRejectedValueOnce(boom as never)
    try {
      const ingest = await wireL0Capture({ db, caps, logger: silentLogger, instanceId: 'inst-test', config: () => config() })
      expect(ingest).toBeNull()
      // Not merely "not attached" — actively disabled, so the hooks that keep
      // calling captureUnit do not fill a queue nothing will ever drain.
      captureUnit(makeUnit())
      expect(pendingUnits()).toBe(0)
    } finally {
      spy.mockRestore()
    }
  })

  it('warns at boot when tool-result capture is on, and stays quiet when it is off', async () => {
    const { db, caps } = makeV2Db()
    const loud = { ...silentLogger, warn: vi.fn() }
    await wireL0Capture({ db, caps, logger: loud as any, instanceId: 'inst-test', config: () => config({ captureToolResults: true }) })
    expect(loud.warn).toHaveBeenCalledWith(expect.stringContaining('captureToolResults is ON'))

    resetIngestBridge()
    const quiet = { ...silentLogger, warn: vi.fn() }
    await wireL0Capture({ db, caps, logger: quiet as any, instanceId: 'inst-test', config: () => config() })
    expect(quiet.warn).not.toHaveBeenCalled()
  })

  it('works without a bus or a scheduler (explicit and idle flush only)', async () => {
    const { db, caps } = makeV2Db()
    const ingest = await wireL0Capture({ db, caps, logger: silentLogger, instanceId: 'inst-test', config: () => config() })
    expect(ingest).not.toBeNull()
    captureUnit(makeUnit())
    expect(ingest!.flushConversation('conv-1', 'manual').rawRows).toBe(1)
  })
})

describe('memory/index.ts wiring (source contract)', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/modules/memory/index.ts'), 'utf-8')
  it('calls wireL0Capture in onStart and publishes ctx.memoryIngest', () => {
    expect(source).toMatch(/wireL0Capture\(/)
    expect(source).toMatch(/\.memoryIngest = /)
  })
  it('flushes the buffers on stop', () => {
    expect(source).toMatch(/memoryIngest\?\.flushAll\('manual'\)/)
  })
})

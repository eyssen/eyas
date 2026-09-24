// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// The loader orders modules by hard dependencies only: conversations, tools
// and event-store persist on both sides of memory's onStart. The bridge is
// what makes a message captured BEFORE memory exists reach L0 anyway.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  captureUnit, attachIngest, detachIngest, pendingUnits, droppedUnits,
  disableIngestBridge, resetIngestBridge, BRIDGE_MAX_PENDING,
} from '@modules/memory/v2/ingest-bridge'
import { makeUnit } from './helpers'

function fakeIngest() {
  return {
    enqueue: vi.fn(),
    flushConversation: vi.fn(),
    sweepIdle: vi.fn(() => 0),
    onFlushed: vi.fn(),
    flushAll: vi.fn(() => 0),
    bufferedUnits: vi.fn(() => 0),
  }
}

beforeEach(() => resetIngestBridge())

describe('ingest bridge', () => {
  it('buffers units captured before memory starts and drains them, in order, on attach', () => {
    const a = makeUnit({ content: 'first' })
    const b = makeUnit({ content: 'second' })
    captureUnit(a)
    captureUnit(b)
    expect(pendingUnits()).toBe(2)

    const ingest = fakeIngest()
    const logger = { warn: vi.fn(), info: vi.fn() }
    attachIngest(ingest as any, logger)

    expect(pendingUnits()).toBe(0)
    expect(ingest.enqueue.mock.calls.map((c) => c[0].id)).toEqual([a.id, b.id])
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('forwards directly once attached', () => {
    const ingest = fakeIngest()
    attachIngest(ingest as any)
    const u = makeUnit()
    captureUnit(u)
    expect(pendingUnits()).toBe(0)
    expect(ingest.enqueue).toHaveBeenCalledWith(u)
  })

  it('drops the oldest unit past the cap, counts the drops, and warns ONCE at attach', () => {
    const first = makeUnit({ content: 'oldest' })
    captureUnit(first)
    for (let i = 0; i < BRIDGE_MAX_PENDING; i++) captureUnit(makeUnit({ content: `u${i}` }))
    expect(pendingUnits()).toBe(BRIDGE_MAX_PENDING)
    expect(droppedUnits()).toBe(1)

    const ingest = fakeIngest()
    const logger = { warn: vi.fn(), info: vi.fn() }
    attachIngest(ingest as any, logger)
    expect(ingest.enqueue.mock.calls[0][0].id).not.toBe(first.id)
    expect(logger.warn).toHaveBeenCalledTimes(1)
    expect(logger.warn.mock.calls[0][0]).toMatchObject({ dropped: 1, drained: BRIDGE_MAX_PENDING })
    expect(droppedUnits()).toBe(0)
  })

  it('never lets an ingest error reach the persistence hook', () => {
    const ingest = fakeIngest()
    ingest.enqueue.mockImplementation(() => { throw new Error('ingest on fire') })
    attachIngest(ingest as any)
    expect(() => captureUnit(makeUnit())).not.toThrow()
  })

  it('buffers again after detach', () => {
    attachIngest(fakeIngest() as any)
    detachIngest()
    captureUnit(makeUnit())
    expect(pendingUnits()).toBe(1)
  })

  it('drops everything silently when disabled by config', () => {
    captureUnit(makeUnit())
    disableIngestBridge()
    expect(pendingUnits()).toBe(0)
    captureUnit(makeUnit())
    expect(pendingUnits()).toBe(0)
  })

  it('forgets a stale drop count on disable, and counts a drain rejection even with no logger', () => {
    // A count left over from an earlier overflow must not resurface at the next
    // attach as "the buffer overflowed" for an attach that drained nothing.
    for (let i = 0; i <= BRIDGE_MAX_PENDING; i++) captureUnit(makeUnit())
    expect(droppedUnits()).toBe(1)
    disableIngestBridge()
    expect(droppedUnits()).toBe(0)
    const logger = { warn: vi.fn(), info: vi.fn() }
    attachIngest(fakeIngest() as any, logger)
    expect(logger.warn).not.toHaveBeenCalled()

    // A unit the ingest rejects while draining is lost. L0 is meant to be
    // complete, so it must be visible even when the caller passed no logger.
    resetIngestBridge()
    captureUnit(makeUnit())
    const hostile = fakeIngest()
    hostile.enqueue.mockImplementation(() => { throw new Error('ingest on fire') })
    attachIngest(hostile as any)
    expect(droppedUnits()).toBe(1)

    // Detaching forgets it too, for the same reason disabling does — otherwise
    // a rejection from this cycle inflates the NEXT attach's overflow report.
    detachIngest()
    expect(droppedUnits()).toBe(0)
    for (let i = 0; i <= BRIDGE_MAX_PENDING; i++) captureUnit(makeUnit())
    const logger2 = { warn: vi.fn(), info: vi.fn() }
    attachIngest(fakeIngest() as any, logger2)
    expect(logger2.warn.mock.calls[0][0]).toMatchObject({ dropped: 1, rejected: 0, drained: BRIDGE_MAX_PENDING })
  })
})

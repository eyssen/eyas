// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// The ONE subscription this plan adds to p1b's wire.ts: every committed
// flush runs an extraction; the engine flag only decides whether it skips.

import { describe, it, expect, beforeEach } from 'vitest'
import { wireL0Capture, type L0WireConfig } from '@modules/memory/v2/wire'
import { captureUnit, resetIngestBridge } from '@modules/memory/v2/ingest-bridge'
import { makeV2Db, makeUnit, silentLogger } from './helpers'
import { count } from './extract-helpers'

const config = (over: Partial<L0WireConfig> = {}): L0WireConfig =>
  ({ enabled: true, toolResultMaxBytes: 8_192, idleFlushMinutes: 30, chunkTokens: 8_000, captureToolResults: false, engine: 'v2', extractInLegacy: true, ...over })
const content = 'Customer: Werth Kft\nWe decided to ship the invoice module on Friday.'

beforeEach(() => resetIngestBridge())

describe('wireL0Capture → runExtraction', () => {
  it('every committed flush triggers an extraction run', async () => {
    const { db, caps } = makeV2Db()
    const ingest = await wireL0Capture({ db, caps, logger: silentLogger, instanceId: 'inst-test', config: () => config() })
    captureUnit(makeUnit({ conversationId: 'conv-w', content }))
    ingest!.flushConversation('conv-w', 'manual')
    expect(count(db, 'memory_raw', `conversation_id = 'conv-w'`)).toBe(1)
    expect(count(db, 'memory_run', `run_type = 'extraction' AND conversation_id = 'conv-w' AND status IN ('ok', 'partial')`)).toBe(1)
    expect(count(db, 'memory_gist', `scope_id = 'conv-w' AND is_current = 1`)).toBe(1)
    expect(count(db, 'memory_fact', `subject = 'customer'`)).toBe(1)
  })

  it('engine=legacy with extractInLegacy=false still lands the flush in L0 but skips extraction (with a run row)', async () => {
    const { db, caps } = makeV2Db()
    const ingest = await wireL0Capture({ db, caps, logger: silentLogger, instanceId: 'inst-test', config: () => config({ engine: 'legacy', extractInLegacy: false }) })
    captureUnit(makeUnit({ conversationId: 'conv-w', content }))
    ingest!.flushConversation('conv-w', 'manual')
    expect(count(db, 'memory_raw', `conversation_id = 'conv-w'`)).toBe(1)
    expect(count(db, 'memory_gist')).toBe(0)
    expect(count(db, 'memory_run', `run_type = 'extraction' AND status = 'skipped'`)).toBe(1)
  })

  it('the two new config fields are optional: absent means legacy engine with extraction on', async () => {
    const { db, caps } = makeV2Db()
    const minimal: L0WireConfig = { enabled: true, toolResultMaxBytes: 8_192, idleFlushMinutes: 30, chunkTokens: 8_000, captureToolResults: false }
    const ingest = await wireL0Capture({ db, caps, logger: silentLogger, instanceId: 'inst-test', config: () => minimal })
    captureUnit(makeUnit({ conversationId: 'conv-w', content }))
    ingest!.flushConversation('conv-w', 'manual')
    expect(count(db, 'memory_gist', `scope_id = 'conv-w'`)).toBe(1)
  })
})

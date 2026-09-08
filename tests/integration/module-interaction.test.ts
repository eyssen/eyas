import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createTestDb } from '../helpers/test-db'
import { createLocalBus } from '@core/bus/local-bus'
import { createAuditService, type AuditService, type LogEntryInput } from '@modules/audit/service'
import { createAuditTables } from '@modules/audit/schema'
import { createNotificationRouter, type NotificationRouter } from '@modules/notifications/router'
import { createNotificationTables } from '@modules/notifications/schema'
import { createTraceCollector, type TraceCollector } from '@modules/observability/trace-collector'
import { createObservabilityTables } from '@modules/observability/schema'
import { createRegexScanner } from '@modules/privacy/scanners/regex-scanner'
import { applyPolicy } from '@modules/privacy/policy-engine'
import type { EyasBus } from '@core/bus/types'
import pino from 'pino'

const logger = pino({ level: 'silent' })
const testDb = createTestDb('integration-module')
let db: ReturnType<typeof testDb.open>
let bus: EyasBus

beforeEach(() => {
  db = testDb.open()
  bus = createLocalBus()
})
afterEach(() => testDb.cleanup())

describe('Module Interactions', () => {
  it('audit module logs bus events', async () => {
    createAuditTables(db)
    const audit = createAuditService(db)

    // Wire bus to audit: any event on eyas.audit.* gets logged
    bus.on('eyas.audit.log', async (data) => {
      audit.log(data as LogEntryInput)
    })

    // Emit an audit event via bus
    bus.emit('eyas.audit.log', {
      action: 'user.login',
      module: 'auth',
      target: 'user-1',
      result: 'success',
    })

    // Bus handlers are async — wait a tick
    await new Promise((r) => setTimeout(r, 50))

    const { entries, total } = audit.query({ module: 'auth' })
    expect(total).toBe(1)
    expect(entries[0].action).toBe('user.login')
    expect(entries[0].target).toBe('user-1')
    expect(entries[0].result).toBe('success')
  })

  it('notification router dispatches on eyas.notify', async () => {
    createNotificationTables(db)
    const router = createNotificationRouter({ db, logger })

    // Start the built-in bus listener
    router.startBusListener(bus)

    // Emit a notification event
    bus.emit('eyas.notify', {
      event: 'task.assigned',
      severity: 'info',
      userId: 'user-1',
      title: 'New task assigned',
      body: 'You have been assigned to Task #42',
    })

    // Wait for async processing
    await new Promise((r) => setTimeout(r, 100))

    const notifications = router.list('user-1')
    expect(notifications.length).toBe(1)
    expect(notifications[0].event).toBe('task.assigned')
    expect(notifications[0].title).toBe('New task assigned')
    expect(notifications[0].severity).toBe('info')
  })

  it('audit + notification cross-module: audit event triggers notification', async () => {
    createAuditTables(db)
    createNotificationTables(db)

    const audit = createAuditService(db)
    const router = createNotificationRouter({ db, logger })
    router.startBusListener(bus)

    // Wire: when audit logs a denied action, emit a notification
    bus.on('eyas.audit.log', async (data) => {
      const input = data as LogEntryInput
      const entry = audit.log(input)
      if (entry.result === 'denied') {
        bus.emit('eyas.notify', {
          event: 'security.denied',
          severity: 'warning',
          userId: input.userId ?? 'system',
          title: `Access denied: ${input.action}`,
          body: `Module: ${input.module}, Target: ${input.target}`,
        })
      }
    })

    // Emit a denied audit event
    bus.emit('eyas.audit.log', {
      action: 'secret.read',
      module: 'secrets',
      userId: 'user-2',
      target: 'api-key-42',
      result: 'denied',
    })

    await new Promise((r) => setTimeout(r, 100))

    // Verify audit entry was created
    const { entries } = audit.query({ module: 'secrets' })
    expect(entries.length).toBe(1)
    expect(entries[0].result).toBe('denied')

    // Verify notification was created from the cross-module flow
    const notifications = router.list('user-2')
    expect(notifications.length).toBe(1)
    expect(notifications[0].event).toBe('security.denied')
    expect(notifications[0].title).toContain('secret.read')
  })

  it('privacy scanner detects PII in text', async () => {
    const scanner = createRegexScanner()

    const text = 'Szia, az email-em: test@example.com, TAJ: 123-456-789'
    const matches = await scanner.scan(text)

    // Should detect email and TAJ number
    const email = matches.find((m) => m.type === 'email')
    expect(email).toBeDefined()
    expect(email!.value).toBe('test@example.com')

    const taj = matches.find((m) => m.type === 'taj_number')
    expect(taj).toBeDefined()
    expect(taj!.value).toBe('123-456-789')
  })

  it('privacy scanner + policy engine blocks sensitive data', async () => {
    const scanner = createRegexScanner()

    const text = 'IBAN: HU42 1234 5678 1234 5678 1234 5678'
    const matches = await scanner.scan(text)

    // Apply a blocking rule for IBAN
    const result = applyPolicy(text, matches, [
      { pattern: 'iban', action: 'block' },
    ])

    expect(result.blocked).toBe(true)
    expect(result.reason).toContain('iban')
  })

  it('observability trace collector records model calls', () => {
    createObservabilityTables(db)
    const collector = createTraceCollector(db)

    const trace = collector.insert({
      requestId: 'req-001',
      conversationId: 'conv-1',
      agentSessionId: null,
      model: 'claude-sonnet-4-20250514',
      provider: 'anthropic',
      memoryTiersUsed: 'working,episodic',
      contextTokens: 1500,
      systemPromptTokens: 200,
      toolDefinitions: JSON.stringify(['web_search', 'file_read']),
      toolCalls: JSON.stringify([{ name: 'web_search', id: 'tc-1' }]),
      toolCallCount: 1,
      outputTokens: 800,
      costUsd: 0.016,
      latencyMs: 1200,
      qualityScoreAuto: null,
      qualityScoreUser: null,
      evaluatorModel: null,
      error: null,
      compositionId: null,
    })

    expect(trace.id).toBeDefined()
    expect(trace.model).toBe('claude-sonnet-4-20250514')

    // Retrieve it back
    const fetched = collector.getById(trace.id)
    expect(fetched).not.toBeNull()
    expect(fetched!.provider).toBe('anthropic')
    expect(fetched!.contextTokens).toBe(1500)
    expect(fetched!.toolCallCount).toBe(1)
    expect(fetched!.costUsd).toBeCloseTo(0.016, 3)
  })

  it('bus event propagation: multiple subscribers receive the same event', async () => {
    const received: string[] = []

    bus.on('eyas.test.broadcast', async () => {
      received.push('subscriber-1')
    })
    bus.on('eyas.test.broadcast', async () => {
      received.push('subscriber-2')
    })
    bus.on('eyas.test.broadcast', async () => {
      received.push('subscriber-3')
    })

    bus.emit('eyas.test.broadcast', { msg: 'hello' })
    await new Promise((r) => setTimeout(r, 50))

    expect(received).toHaveLength(3)
    expect(received).toContain('subscriber-1')
    expect(received).toContain('subscriber-2')
    expect(received).toContain('subscriber-3')
  })

  it('bus subscription can be unsubscribed', async () => {
    let callCount = 0

    const sub = bus.on('eyas.test.unsub', async () => {
      callCount++
    })

    bus.emit('eyas.test.unsub', {})
    await new Promise((r) => setTimeout(r, 50))
    expect(callCount).toBe(1)

    // Unsubscribe and emit again
    sub.unsubscribe()
    bus.emit('eyas.test.unsub', {})
    await new Promise((r) => setTimeout(r, 50))
    expect(callCount).toBe(1) // Should not have incremented
  })
})

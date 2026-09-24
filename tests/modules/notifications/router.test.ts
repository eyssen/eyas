import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createTestDb } from '../../helpers/test-db'
import { sql } from 'drizzle-orm'
import {
  createNotificationRouter,
  matchEventPattern,
  isInQuietHours,
  createRateLimiter,
  type NotificationChannel,
  type NotificationPayload,
  type Severity,
} from '@modules/notifications/router'
import { createNotificationTables } from '@modules/notifications/schema'

// ─── Test DB Setup ────────────────────────────────────

const testDb = createTestDb('notifications')
let db: ReturnType<typeof testDb.open>

beforeEach(() => {
  db = testDb.open()
  createNotificationTables(db as any)
})
afterEach(() => testDb.cleanup())

function createMockLogger() {
  return {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: () => createMockLogger(),
  } as any
}

function createMockChannel(id: string, sendResult = true): NotificationChannel & { calls: NotificationPayload[] } {
  const calls: NotificationPayload[] = []
  return {
    id,
    calls,
    async send(_userId: string, payload: NotificationPayload): Promise<boolean> {
      calls.push(payload)
      return sendResult
    },
  }
}

function insertPreference(userId: string, eventPattern: string, channel: string, minSeverity: Severity = 'info', quietHours: any = null) {
  const qh = quietHours ? JSON.stringify(quietHours) : null
  ;(db as any).run(
    sql`INSERT INTO notification_preferences (user_id, event_pattern, channel, min_severity, quiet_hours)
        VALUES (${userId}, ${eventPattern}, ${channel}, ${minSeverity}, ${qh})`
  )
}

// ─── matchEventPattern ────────────────────────────────

describe('matchEventPattern', () => {
  it('matches exact events', () => {
    expect(matchEventPattern('budget.warning', 'budget.warning')).toBe(true)
  })

  it('wildcard * matches any event', () => {
    expect(matchEventPattern('*', 'anything')).toBe(true)
    expect(matchEventPattern('*', 'budget.warning')).toBe(true)
  })

  it('segment wildcard matches single segment', () => {
    expect(matchEventPattern('budget.*', 'budget.warning')).toBe(true)
    expect(matchEventPattern('budget.*', 'budget.exceeded')).toBe(true)
  })

  it('does not match different segment count', () => {
    expect(matchEventPattern('budget.*', 'budget.foo.bar')).toBe(false)
  })

  it('does not match different prefix', () => {
    expect(matchEventPattern('agent.*', 'budget.warning')).toBe(false)
  })

  it('matches multi-segment wildcards', () => {
    expect(matchEventPattern('*.team.*', 'agent.team.completed')).toBe(true)
    expect(matchEventPattern('*.team.*', 'agent.team.failed')).toBe(true)
  })
})

// ─── isInQuietHours ───────────────────────────────────

describe('isInQuietHours', () => {
  it('returns false when no quiet hours', () => {
    expect(isInQuietHours(null)).toBe(false)
  })

  it('detects time within same-day range', () => {
    const qh = { from: '09:00', to: '17:00' }
    expect(isInQuietHours(qh, new Date('2026-01-01T12:00:00'))).toBe(true)
    expect(isInQuietHours(qh, new Date('2026-01-01T08:00:00'))).toBe(false)
    expect(isInQuietHours(qh, new Date('2026-01-01T18:00:00'))).toBe(false)
  })

  it('handles overnight range (e.g. 22:00 - 07:00)', () => {
    const qh = { from: '22:00', to: '07:00' }
    expect(isInQuietHours(qh, new Date('2026-01-01T23:00:00'))).toBe(true)
    expect(isInQuietHours(qh, new Date('2026-01-01T03:00:00'))).toBe(true)
    expect(isInQuietHours(qh, new Date('2026-01-01T12:00:00'))).toBe(false)
  })
})

// ─── Rate Limiter ─────────────────────────────────────

describe('createRateLimiter', () => {
  it('allows up to maxPerHour notifications', () => {
    const limiter = createRateLimiter(3)
    expect(limiter.check('user1')).toBe(true)
    limiter.record('user1')
    expect(limiter.check('user1')).toBe(true)
    limiter.record('user1')
    expect(limiter.check('user1')).toBe(true)
    limiter.record('user1')
    expect(limiter.check('user1')).toBe(false) // 4th blocked
  })

  it('tracks users independently', () => {
    const limiter = createRateLimiter(1)
    limiter.record('user1')
    expect(limiter.check('user1')).toBe(false)
    expect(limiter.check('user2')).toBe(true) // separate user
  })
})

// ─── NotificationRouter ──────────────────────────────

describe('NotificationRouter', () => {
  describe('preference matching', () => {
    it('dispatches to channels matching event pattern', async () => {
      const logger = createMockLogger()
      const router = createNotificationRouter({ db: db as any, logger })
      const webChannel = createMockChannel('web')
      router.registerChannel(webChannel)

      insertPreference('user1', 'budget.*', 'web', 'info')

      await router.notify({
        event: 'budget.warning',
        severity: 'warning',
        userId: 'user1',
        title: 'Budget warning',
      })

      expect(webChannel.calls).toHaveLength(1)
      expect(webChannel.calls[0].title).toBe('Budget warning')
    })

    it('does not dispatch to non-matching patterns', async () => {
      const logger = createMockLogger()
      const router = createNotificationRouter({ db: db as any, logger })
      const webChannel = createMockChannel('web')
      router.registerChannel(webChannel)

      insertPreference('user1', 'agent.*', 'web', 'info')

      await router.notify({
        event: 'budget.warning',
        severity: 'warning',
        userId: 'user1',
        title: 'Budget warning',
      })

      expect(webChannel.calls).toHaveLength(0)
    })

    it('dispatches to wildcard pattern', async () => {
      const logger = createMockLogger()
      const router = createNotificationRouter({ db: db as any, logger })
      const webChannel = createMockChannel('web')
      router.registerChannel(webChannel)

      insertPreference('user1', '*', 'web', 'info')

      await router.notify({
        event: 'any.event',
        severity: 'info',
        userId: 'user1',
        title: 'Test',
      })

      expect(webChannel.calls).toHaveLength(1)
    })
  })

  describe('severity filtering', () => {
    it('skips channels below min_severity', async () => {
      const logger = createMockLogger()
      const router = createNotificationRouter({ db: db as any, logger })
      const webChannel = createMockChannel('web')
      router.registerChannel(webChannel)

      insertPreference('user1', '*', 'web', 'error') // only error+

      await router.notify({
        event: 'budget.warning',
        severity: 'info',
        userId: 'user1',
        title: 'Low severity',
      })

      expect(webChannel.calls).toHaveLength(0)
    })

    it('sends when severity meets threshold', async () => {
      const logger = createMockLogger()
      const router = createNotificationRouter({ db: db as any, logger })
      const webChannel = createMockChannel('web')
      router.registerChannel(webChannel)

      insertPreference('user1', '*', 'web', 'warning')

      await router.notify({
        event: 'budget.exceeded',
        severity: 'error',
        userId: 'user1',
        title: 'Over budget',
      })

      expect(webChannel.calls).toHaveLength(1)
    })
  })

  describe('rate limiting', () => {
    it('rate-limits after max notifications per hour', async () => {
      const logger = createMockLogger()
      const router = createNotificationRouter({ db: db as any, logger, rateLimit: 2 })
      const webChannel = createMockChannel('web')
      router.registerChannel(webChannel)

      insertPreference('user1', '*', 'web', 'info')

      await router.notify({ event: 'test.a', severity: 'info', userId: 'user1', title: 'A' })
      await router.notify({ event: 'test.b', severity: 'info', userId: 'user1', title: 'B' })
      await router.notify({ event: 'test.c', severity: 'info', userId: 'user1', title: 'C' }) // rate limited

      expect(webChannel.calls).toHaveLength(2)
      // But all 3 are stored in DB
      const all = router.list('user1')
      expect(all).toHaveLength(3)
    })
  })

  describe('notification storage and read', () => {
    it('stores notifications and counts unread', async () => {
      const logger = createMockLogger()
      const router = createNotificationRouter({ db: db as any, logger })
      const webChannel = createMockChannel('web')
      router.registerChannel(webChannel)

      insertPreference('user1', '*', 'web', 'info')

      await router.notify({ event: 'test.a', severity: 'info', userId: 'user1', title: 'A' })
      await router.notify({ event: 'test.b', severity: 'info', userId: 'user1', title: 'B' })

      expect(router.countUnread('user1')).toBe(2)
      expect(router.list('user1')).toHaveLength(2)
    })

    it('marks notification as read', async () => {
      const logger = createMockLogger()
      const router = createNotificationRouter({ db: db as any, logger })
      insertPreference('user1', '*', 'web', 'info')

      const id = await router.notify({ event: 'test.a', severity: 'info', userId: 'user1', title: 'A' })
      expect(router.countUnread('user1')).toBe(1)

      router.markRead(id)
      expect(router.countUnread('user1')).toBe(0)
    })

    it('marks all as read', async () => {
      const logger = createMockLogger()
      const router = createNotificationRouter({ db: db as any, logger })
      insertPreference('user1', '*', 'web', 'info')

      await router.notify({ event: 'test.a', severity: 'info', userId: 'user1', title: 'A' })
      await router.notify({ event: 'test.b', severity: 'info', userId: 'user1', title: 'B' })
      expect(router.countUnread('user1')).toBe(2)

      router.markAllRead('user1')
      expect(router.countUnread('user1')).toBe(0)
    })

    it('filters unread only', async () => {
      const logger = createMockLogger()
      const router = createNotificationRouter({ db: db as any, logger })
      insertPreference('user1', '*', 'web', 'info')

      const id = await router.notify({ event: 'test.a', severity: 'info', userId: 'user1', title: 'A' })
      await router.notify({ event: 'test.b', severity: 'info', userId: 'user1', title: 'B' })
      router.markRead(id)

      const unread = router.list('user1', { unreadOnly: true })
      expect(unread).toHaveLength(1)
      expect(unread[0].title).toBe('B')
    })
  })

  describe('preferences CRUD', () => {
    it('gets and sets preferences', () => {
      const logger = createMockLogger()
      const router = createNotificationRouter({ db: db as any, logger })

      router.setPreference({
        userId: 'user1',
        eventPattern: 'budget.*',
        channel: 'web',
        minSeverity: 'warning',
        quietHours: { from: '22:00', to: '07:00' },
      })

      const prefs = router.getPreferences('user1')
      expect(prefs).toHaveLength(1)
      expect(prefs[0].eventPattern).toBe('budget.*')
      expect(prefs[0].minSeverity).toBe('warning')
      expect(prefs[0].quietHours).toEqual({ from: '22:00', to: '07:00' })
    })

    it('deletes a preference', () => {
      const logger = createMockLogger()
      const router = createNotificationRouter({ db: db as any, logger })

      router.setPreference({
        userId: 'user1',
        eventPattern: '*',
        channel: 'web',
        minSeverity: 'info',
        quietHours: null,
      })

      expect(router.getPreferences('user1')).toHaveLength(1)
      router.deletePreference('user1', '*', 'web')
      expect(router.getPreferences('user1')).toHaveLength(0)
    })
  })

  describe('multi-channel dispatch', () => {
    it('dispatches to multiple channels', async () => {
      const logger = createMockLogger()
      const router = createNotificationRouter({ db: db as any, logger })
      const webChannel = createMockChannel('web')
      const telegramChannel = createMockChannel('telegram')
      router.registerChannel(webChannel)
      router.registerChannel(telegramChannel)

      insertPreference('user1', '*', 'web', 'info')
      insertPreference('user1', '*', 'telegram', 'warning')

      await router.notify({
        event: 'budget.exceeded',
        severity: 'error',
        userId: 'user1',
        title: 'Over budget',
      })

      expect(webChannel.calls).toHaveLength(1)
      expect(telegramChannel.calls).toHaveLength(1)
    })

    it('records channels_sent in stored notification', async () => {
      const logger = createMockLogger()
      const router = createNotificationRouter({ db: db as any, logger })
      const webChannel = createMockChannel('web')
      router.registerChannel(webChannel)

      insertPreference('user1', '*', 'web', 'info')

      await router.notify({
        event: 'test.a',
        severity: 'info',
        userId: 'user1',
        title: 'Test',
      })

      const all = router.list('user1')
      expect(all).toHaveLength(1)
      expect(JSON.parse(all[0].channelsSent!)).toContain('web')
    })
  })
})

import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { createMemoryDb } from '../../helpers/test-db'
import { createLocalBus } from '@core/bus/local-bus'
import { auditModule } from '@modules/audit/index'

const noopLogger = { info() {}, warn() {}, error() {}, debug() {} }

describe('audit module — bus-originated entries carry the real subject (F0)', () => {
  it('records action/module from the emitted subject, not "unknown"', async () => {
    const db = createMemoryDb()
    const ctx = { db, bus: createLocalBus(), http: new Hono(), logger: noopLogger } as any
    await auditModule.onRegister!(ctx)
    await auditModule.onStart!(ctx)
    ctx.bus.emit('eyas.board.task.created', { userId: 'u1', id: 'task-1' })
    await new Promise((r) => setTimeout(r, 20))
    const rows = db.all(sql`SELECT action, module, user_id FROM audit_entries ORDER BY id DESC LIMIT 1`) as any[]
    expect(rows[0].action).toBe('board.task.created')
    expect(rows[0].module).toBe('board')
    expect(rows[0].user_id).toBe('u1')
  })
})

// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, it, expect, beforeEach } from 'vitest'
import { createMemoryDb } from '../../helpers/test-db'
import { createHomeTables } from '@modules/home/schema'
import { createLayoutService } from '@modules/home/layout-service'

let db: ReturnType<typeof createMemoryDb>
let service: ReturnType<typeof createLayoutService>

beforeEach(() => {
  db = createMemoryDb()
  createHomeTables(db)
  service = createLayoutService(db)
})

describe('layout persistence', () => {
  it('returns null when the user has never customised (factory default applies)', () => {
    expect(service.get('user-1', 'lg')).toBeNull()
  })

  it('round-trips items including per-widget config', () => {
    service.save('user-1', 'lg', [
      { i: 'board.summary#1', x: 0, y: 0, w: 4, h: 3, config: { projectId: 'proj-7' } },
    ])
    const row = service.get('user-1', 'lg')
    expect(row?.items[0].config).toEqual({ projectId: 'proj-7' })
    expect(row?.baseVersion).toBe(0)
  })

  it('keeps breakpoints independent', () => {
    service.save('user-1', 'lg', [{ i: 'cost.summary#1', x: 0, y: 0, w: 3, h: 2 }])
    expect(service.get('user-1', 'md')).toBeNull()
  })

  it('reset deletes the row so the user follows the factory default again', () => {
    service.save('user-1', 'lg', [{ i: 'cost.summary#1', x: 0, y: 0, w: 3, h: 2 }])
    service.reset('user-1', 'lg')
    expect(service.get('user-1', 'lg')).toBeNull()
  })

  it('does not leak one user layout into another', () => {
    service.save('user-1', 'lg', [{ i: 'cost.summary#1', x: 0, y: 0, w: 3, h: 2 }])
    expect(service.get('user-2', 'lg')).toBeNull()
  })
})

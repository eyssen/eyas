import { describe, it, expect } from 'vitest'
import { resolveOdooConnectionId } from '@modules/odoo/connection-resolve'

/**
 * Fixture ids are fictive (plan item 22.3 / constraint 17).
 * Project alpha has a default (instance) connection and a separate ticket connection.
 */
const ALPHA = {
  defaultConnectionId: 'conn-alpha-db',
  ticketConnectionId: 'conn-alpha-tickets',
}

describe('resolveOdooConnectionId', () => {
  it('routes odoo_execute without connectionId to the project default connection', () => {
    expect(
      resolveOdooConnectionId({
        toolName: 'odoo_execute',
        project: ALPHA,
      }),
    ).toBe('conn-alpha-db')
  })

  it('routes odoo_get_task to the ticket connection, not the project default', () => {
    expect(
      resolveOdooConnectionId({
        toolName: 'odoo_get_task',
        project: ALPHA,
      }),
    ).toBe('conn-alpha-tickets')
  })

  it('lets an explicit connectionId win over both project fields', () => {
    expect(
      resolveOdooConnectionId({
        toolName: 'odoo_execute',
        explicitConnectionId: 'conn-override',
        project: ALPHA,
      }),
    ).toBe('conn-override')
    expect(
      resolveOdooConnectionId({
        toolName: 'odoo_get_task',
        explicitConnectionId: 'conn-override',
        project: ALPHA,
      }),
    ).toBe('conn-override')
  })

  it('falls ticket tools back to the project default when ticketConnectionId is unset', () => {
    expect(
      resolveOdooConnectionId({
        toolName: 'odoo_get_task',
        project: { defaultConnectionId: 'conn-alpha-db', ticketConnectionId: null },
      }),
    ).toBe('conn-alpha-db')
  })

  it('does not send odoo_execute to the ticket connection', () => {
    expect(
      resolveOdooConnectionId({
        toolName: 'odoo_execute',
        project: { defaultConnectionId: null, ticketConnectionId: 'conn-alpha-tickets' },
      }),
    ).toBeNull()
  })

  it('returns null with no project and no explicit id (caller may use global secrets)', () => {
    expect(resolveOdooConnectionId({ toolName: 'odoo_execute' })).toBeNull()
    expect(resolveOdooConnectionId({ toolName: 'odoo_get_task', project: null })).toBeNull()
  })
})

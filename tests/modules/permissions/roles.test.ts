import { describe, it, expect } from 'vitest'
import { buildAbilityForRole } from '@modules/permissions/roles'
import { createPermissionRegistry } from '@modules/permissions/registry'

describe('buildAbilityForRole', () => {
  it('owner can manage everything', () => {
    const registry = createPermissionRegistry()
    const ability = buildAbilityForRole('owner', registry)
    expect(ability.can('manage', 'all')).toBe(true)
    expect(ability.can('delete', 'anything')).toBe(true)
  })

  it('guest can only read by default', () => {
    const registry = createPermissionRegistry()
    registry.registerSubject('task', {
      actions: ['create', 'read', 'update', 'delete'],
      defaults: { guest: ['read'] },
    })
    const ability = buildAbilityForRole('guest', registry)
    expect(ability.can('read', 'task')).toBe(true)
    expect(ability.can('create', 'task')).toBe(false)
    expect(ability.can('delete', 'task')).toBe(false)
  })

  it('admin gets default permissions from registered subjects', () => {
    const registry = createPermissionRegistry()
    registry.registerSubject('task', {
      actions: ['create', 'read', 'update', 'delete'],
      defaults: {
        admin: ['create', 'read', 'update', 'delete'],
        agent: ['read'],
      },
    })
    const ability = buildAbilityForRole('admin', registry)
    expect(ability.can('create', 'task')).toBe(true)
    expect(ability.can('delete', 'task')).toBe(true)
  })

  it('agent only gets explicitly registered permissions', () => {
    const registry = createPermissionRegistry()
    registry.registerSubject('task', {
      actions: ['create', 'read', 'update', 'delete'],
      defaults: { agent: ['read'] },
    })
    const ability = buildAbilityForRole('agent', registry)
    expect(ability.can('read', 'task')).toBe(true)
    expect(ability.can('create', 'task')).toBe(false)
    expect(ability.can('update', 'task')).toBe(false)
  })

  it('handles no registered subjects gracefully', () => {
    const registry = createPermissionRegistry()
    const ability = buildAbilityForRole('user', registry)
    // user with no registered subjects — can manage own 'User' subject (system default)
    expect(ability.can('read', 'User')).toBe(true)
    expect(ability.can('update', 'User')).toBe(true)
  })

  it('admin can manage users (system default)', () => {
    const registry = createPermissionRegistry()
    const ability = buildAbilityForRole('admin', registry)
    expect(ability.can('create', 'User')).toBe(true)
    expect(ability.can('read', 'User')).toBe(true)
    expect(ability.can('update', 'User')).toBe(true)
    expect(ability.can('delete', 'User')).toBe(true)
  })

  // The tool executor is a CASL choke point: every caller must hold
  // `execute Tool` or its calls are denied. A signed-in user driving a
  // conversation is a legitimate tool caller; a guest is not.
  it('user can execute tools, guest cannot', () => {
    const registry = createPermissionRegistry()
    expect(buildAbilityForRole('user', registry).can('execute', 'Tool')).toBe(true)
    expect(buildAbilityForRole('guest', registry).can('execute', 'Tool')).toBe(false)
  })
})

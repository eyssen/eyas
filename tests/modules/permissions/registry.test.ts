import { describe, it, expect } from 'vitest'
import { createPermissionRegistry } from '@modules/permissions/registry'

describe('PermissionRegistry', () => {
  it('registers a subject with actions', () => {
    const registry = createPermissionRegistry()
    registry.registerSubject('task', {
      actions: ['create', 'read', 'update', 'delete'],
    })
    const subjects = registry.getRegisteredSubjects()
    expect(subjects).toHaveLength(1)
    expect(subjects[0].subject).toBe('task')
    expect(subjects[0].actions).toEqual(['create', 'read', 'update', 'delete'])
  })

  it('registers a subject with role defaults', () => {
    const registry = createPermissionRegistry()
    registry.registerSubject('task', {
      actions: ['create', 'read', 'update', 'delete'],
      defaults: {
        admin: ['create', 'read', 'update', 'delete'],
        user: ['create', 'read'],
        agent: ['read'],
        guest: ['read'],
      },
    })
    const subjects = registry.getRegisteredSubjects()
    expect(subjects[0].defaults?.admin).toEqual(['create', 'read', 'update', 'delete'])
    expect(subjects[0].defaults?.agent).toEqual(['read'])
  })

  it('rejects duplicate subject registration', () => {
    const registry = createPermissionRegistry()
    registry.registerSubject('task', { actions: ['read'] })
    expect(() => registry.registerSubject('task', { actions: ['read'] }))
      .toThrow('Subject "task" is already registered')
  })

  it('rejects actions in defaults that are not in the actions list', () => {
    const registry = createPermissionRegistry()
    expect(() => registry.registerSubject('task', {
      actions: ['read'],
      defaults: { admin: ['read', 'write'] },
    })).toThrow('Unknown action "write" for subject "task"')
  })

  it('returns empty array when no subjects registered', () => {
    const registry = createPermissionRegistry()
    expect(registry.getRegisteredSubjects()).toEqual([])
  })
})

import { describe, it, expect } from 'vitest'
import {
  ROLES,
  ROLE_HIERARCHY,
  type RoleId,
  type ActionLevel,
  isRoleAtLeast,
} from '@modules/permissions/types'

describe('permission types', () => {
  it('defines all five roles', () => {
    expect(ROLES).toEqual(['owner', 'admin', 'user', 'agent', 'guest'])
  })

  it('defines role hierarchy with numeric levels', () => {
    expect(ROLE_HIERARCHY.owner).toBeGreaterThan(ROLE_HIERARCHY.admin)
    expect(ROLE_HIERARCHY.admin).toBeGreaterThan(ROLE_HIERARCHY.user)
    expect(ROLE_HIERARCHY.user).toBeGreaterThan(ROLE_HIERARCHY.agent)
    expect(ROLE_HIERARCHY.agent).toBeGreaterThan(ROLE_HIERARCHY.guest)
  })

  describe('isRoleAtLeast', () => {
    it('owner is at least admin', () => {
      expect(isRoleAtLeast('owner', 'admin')).toBe(true)
    })

    it('guest is not at least user', () => {
      expect(isRoleAtLeast('guest', 'user')).toBe(false)
    })

    it('role is at least itself', () => {
      expect(isRoleAtLeast('admin', 'admin')).toBe(true)
    })
  })
})

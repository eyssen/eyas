// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach } from 'vitest'
import { buildAbilityForRole } from '@modules/permissions/roles'
import { createPermissionRegistry } from '@modules/permissions/registry'
import { SUBJECTS } from '@modules/permissions/types'
import type { PermissionRegistry } from '@modules/permissions/registry'

describe('buildAbilityForRole', () => {
  let registry: PermissionRegistry

  beforeEach(() => {
    registry = createPermissionRegistry()
  })

  describe('owner role', () => {
    it('can manage all subjects', () => {
      const ability = buildAbilityForRole('owner', registry)
      expect(ability.can('manage', 'all')).toBe(true)
      for (const subject of SUBJECTS) {
        expect(ability.can('create', subject)).toBe(true)
        expect(ability.can('read', subject)).toBe(true)
        expect(ability.can('update', subject)).toBe(true)
        expect(ability.can('delete', subject)).toBe(true)
      }
    })
  })

  describe('admin role', () => {
    it('can manage users', () => {
      const ability = buildAbilityForRole('admin', registry)
      expect(ability.can('create', 'User')).toBe(true)
      expect(ability.can('read', 'User')).toBe(true)
      expect(ability.can('update', 'User')).toBe(true)
      expect(ability.can('delete', 'User')).toBe(true)
    })

    it('can manage sessions and api keys', () => {
      const ability = buildAbilityForRole('admin', registry)
      expect(ability.can('manage', 'Session')).toBe(true)
      expect(ability.can('manage', 'ApiKey')).toBe(true)
    })

    it('can manage projects, agents, skills', () => {
      const ability = buildAbilityForRole('admin', registry)
      expect(ability.can('manage', 'Project')).toBe(true)
      expect(ability.can('manage', 'ProjectType')).toBe(true)
      expect(ability.can('manage', 'Stage')).toBe(true)
      expect(ability.can('manage', 'Agent')).toBe(true)
      expect(ability.can('manage', 'Skill')).toBe(true)
    })

    it('can manage documents and knowledge', () => {
      const ability = buildAbilityForRole('admin', registry)
      expect(ability.can('manage', 'Document')).toBe(true)
      expect(ability.can('manage', 'KnowledgeSpace')).toBe(true)
      expect(ability.can('manage', 'KnowledgePage')).toBe(true)
    })

    it('can manage tags, activities, scheduler', () => {
      const ability = buildAbilityForRole('admin', registry)
      expect(ability.can('manage', 'Tag')).toBe(true)
      expect(ability.can('manage', 'Activity')).toBe(true)
      expect(ability.can('manage', 'Scheduler')).toBe(true)
    })

    it('can read secrets, audit, modules, notifications', () => {
      const ability = buildAbilityForRole('admin', registry)
      expect(ability.can('read', 'Secret')).toBe(true)
      expect(ability.can('read', 'Module')).toBe(true)
      expect(ability.can('read', 'Audit')).toBe(true)
      expect(ability.can('read', 'Notification')).toBe(true)
    })

    it('can manage conversations and messages', () => {
      const ability = buildAbilityForRole('admin', registry)
      expect(ability.can('manage', 'Conversation')).toBe(true)
      expect(ability.can('manage', 'ConversationMessage')).toBe(true)
    })

    it('cannot manage secrets (only read)', () => {
      const ability = buildAbilityForRole('admin', registry)
      expect(ability.can('create', 'Secret')).toBe(true)
      expect(ability.can('delete', 'Secret')).toBe(true)
    })
  })

  describe('user role', () => {
    it('can CRUD conversations and messages', () => {
      const ability = buildAbilityForRole('user', registry)
      expect(ability.can('create', 'Conversation')).toBe(true)
      expect(ability.can('read', 'Conversation')).toBe(true)
      expect(ability.can('update', 'Conversation')).toBe(true)
      expect(ability.can('delete', 'Conversation')).toBe(true)
      expect(ability.can('create', 'ConversationMessage')).toBe(true)
      expect(ability.can('read', 'ConversationMessage')).toBe(true)
    })

    it('can read projects, stages, agents, skills', () => {
      const ability = buildAbilityForRole('user', registry)
      expect(ability.can('read', 'Project')).toBe(true)
      expect(ability.can('read', 'ProjectType')).toBe(true)
      expect(ability.can('read', 'Stage')).toBe(true)
      expect(ability.can('read', 'Agent')).toBe(true)
      expect(ability.can('read', 'Skill')).toBe(true)
    })

    it('can manage documents and knowledge pages', () => {
      const ability = buildAbilityForRole('user', registry)
      expect(ability.can('create', 'Document')).toBe(true)
      expect(ability.can('read', 'Document')).toBe(true)
      expect(ability.can('update', 'Document')).toBe(true)
      expect(ability.can('delete', 'Document')).toBe(true)
      expect(ability.can('create', 'KnowledgePage')).toBe(true)
      expect(ability.can('read', 'KnowledgePage')).toBe(true)
      expect(ability.can('update', 'KnowledgePage')).toBe(true)
      expect(ability.can('delete', 'KnowledgePage')).toBe(true)
    })

    it('can read tags and search', () => {
      const ability = buildAbilityForRole('user', registry)
      expect(ability.can('read', 'Tag')).toBe(true)
      expect(ability.can('read', 'SearchSource')).toBe(true)
    })

    it('can manage activities', () => {
      const ability = buildAbilityForRole('user', registry)
      expect(ability.can('create', 'Activity')).toBe(true)
      expect(ability.can('read', 'Activity')).toBe(true)
      expect(ability.can('update', 'Activity')).toBe(true)
    })

    it('can read and create memory', () => {
      const ability = buildAbilityForRole('user', registry)
      expect(ability.can('read', 'MemoryEntry')).toBe(true)
      expect(ability.can('create', 'MemoryEntry')).toBe(true)
    })

    it('can manage own user profile', () => {
      const ability = buildAbilityForRole('user', registry)
      expect(ability.can('read', 'User')).toBe(true)
      expect(ability.can('update', 'User')).toBe(true)
    })

    it('cannot manage other users', () => {
      const ability = buildAbilityForRole('user', registry)
      expect(ability.can('create', 'User')).toBe(false)
      expect(ability.can('delete', 'User')).toBe(false)
    })

    it('cannot manage modules or scheduler', () => {
      const ability = buildAbilityForRole('user', registry)
      expect(ability.can('manage', 'Module')).toBe(false)
      expect(ability.can('manage', 'Scheduler')).toBe(false)
    })

    it('can read and manage notifications', () => {
      const ability = buildAbilityForRole('user', registry)
      expect(ability.can('read', 'Notification')).toBe(true)
      expect(ability.can('update', 'Notification')).toBe(true)
    })

    it('can manage chatter messages', () => {
      const ability = buildAbilityForRole('user', registry)
      expect(ability.can('create', 'ChatterMessage')).toBe(true)
      expect(ability.can('read', 'ChatterMessage')).toBe(true)
    })

    it('can read knowledge spaces', () => {
      const ability = buildAbilityForRole('user', registry)
      expect(ability.can('read', 'KnowledgeSpace')).toBe(true)
    })

    it('can manage api keys', () => {
      const ability = buildAbilityForRole('user', registry)
      expect(ability.can('create', 'ApiKey')).toBe(true)
      expect(ability.can('read', 'ApiKey')).toBe(true)
      expect(ability.can('delete', 'ApiKey')).toBe(true)
    })

    it('can read and manage secrets (own scope)', () => {
      const ability = buildAbilityForRole('user', registry)
      expect(ability.can('read', 'Secret')).toBe(true)
      expect(ability.can('create', 'Secret')).toBe(true)
      expect(ability.can('delete', 'Secret')).toBe(true)
    })
  })

  describe('agent role', () => {
    it('can create, read, update conversations', () => {
      const ability = buildAbilityForRole('agent', registry)
      expect(ability.can('create', 'Conversation')).toBe(true)
      expect(ability.can('read', 'Conversation')).toBe(true)
      expect(ability.can('update', 'Conversation')).toBe(true)
      expect(ability.can('delete', 'Conversation')).toBe(false)
    })

    it('can execute tools', () => {
      const ability = buildAbilityForRole('agent', registry)
      expect(ability.can('execute', 'Tool')).toBe(true)
      expect(ability.can('read', 'Tool')).toBe(true)
    })

    it('can read skills, memory, documents, knowledge', () => {
      const ability = buildAbilityForRole('agent', registry)
      expect(ability.can('read', 'Skill')).toBe(true)
      expect(ability.can('read', 'MemoryEntry')).toBe(true)
      expect(ability.can('read', 'Document')).toBe(true)
      expect(ability.can('read', 'KnowledgePage')).toBe(true)
      expect(ability.can('read', 'KnowledgeSpace')).toBe(true)
    })

    it('can create memory entries', () => {
      const ability = buildAbilityForRole('agent', registry)
      expect(ability.can('create', 'MemoryEntry')).toBe(true)
    })

    it('can create conversation messages', () => {
      const ability = buildAbilityForRole('agent', registry)
      expect(ability.can('create', 'ConversationMessage')).toBe(true)
      expect(ability.can('read', 'ConversationMessage')).toBe(true)
    })

    it('cannot manage users or modules', () => {
      const ability = buildAbilityForRole('agent', registry)
      expect(ability.can('create', 'User')).toBe(false)
      expect(ability.can('manage', 'Module')).toBe(false)
      expect(ability.can('manage', 'Scheduler')).toBe(false)
    })

    it('can read agents and search', () => {
      const ability = buildAbilityForRole('agent', registry)
      expect(ability.can('read', 'Agent')).toBe(true)
      expect(ability.can('read', 'SearchSource')).toBe(true)
    })
  })

  describe('guest role', () => {
    it('can only read conversations, projects, knowledge pages', () => {
      const ability = buildAbilityForRole('guest', registry)
      expect(ability.can('read', 'Conversation')).toBe(true)
      expect(ability.can('read', 'Project')).toBe(true)
      expect(ability.can('read', 'ProjectType')).toBe(true)
      expect(ability.can('read', 'KnowledgePage')).toBe(true)
      expect(ability.can('read', 'KnowledgeSpace')).toBe(true)
    })

    it('cannot create or modify anything', () => {
      const ability = buildAbilityForRole('guest', registry)
      expect(ability.can('create', 'Conversation')).toBe(false)
      expect(ability.can('update', 'Conversation')).toBe(false)
      expect(ability.can('delete', 'Conversation')).toBe(false)
      expect(ability.can('create', 'User')).toBe(false)
      expect(ability.can('create', 'Document')).toBe(false)
      expect(ability.can('create', 'KnowledgePage')).toBe(false)
    })

    it('cannot access secrets, tools, or agents', () => {
      const ability = buildAbilityForRole('guest', registry)
      expect(ability.can('read', 'Secret')).toBe(false)
      expect(ability.can('execute', 'Tool')).toBe(false)
      expect(ability.can('read', 'Agent')).toBe(false)
    })
  })

  describe('module-registered subjects', () => {
    it('applies module-registered defaults to roles', () => {
      registry.registerSubject('CustomSubject', {
        actions: ['read', 'create'],
        defaults: {
          user: ['read', 'create'],
          guest: ['read'],
        },
      })

      const userAbility = buildAbilityForRole('user', registry)
      expect(userAbility.can('read', 'CustomSubject')).toBe(true)
      expect(userAbility.can('create', 'CustomSubject')).toBe(true)

      const guestAbility = buildAbilityForRole('guest', registry)
      expect(guestAbility.can('read', 'CustomSubject')).toBe(true)
      expect(guestAbility.can('create', 'CustomSubject')).toBe(false)
    })

    it('owner can manage all including module-registered subjects', () => {
      registry.registerSubject('CustomSubject', {
        actions: ['read', 'create', 'delete'],
      })

      const ability = buildAbilityForRole('owner', registry)
      expect(ability.can('manage', 'CustomSubject')).toBe(true)
    })
  })
})

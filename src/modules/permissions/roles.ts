import { AbilityBuilder, PureAbility } from '@casl/ability'
import type { PermissionRegistry } from './registry.js'
import type { RoleId } from './types.js'

export type AppAbility = PureAbility<[string, string]>

export function buildAbilityForRole(role: RoleId, registry: PermissionRegistry): AppAbility {
  const { can, build } = new AbilityBuilder<AppAbility>(PureAbility)

  // Owner: unrestricted
  if (role === 'owner') {
    can('manage', 'all')
    return build()
  }

  // ─── Admin ──────────────────────────────────────────────
  if (role === 'admin') {
    // User management
    can('manage', 'User')
    can('manage', 'Session')
    can('manage', 'ApiKey')

    // Content management
    can('manage', 'Conversation')
    can('manage', 'ConversationMessage')
    can('manage', 'Project')
    can('manage', 'ProjectType')
    can('manage', 'Stage')
    can('manage', 'Agent')
    can('manage', 'AgentSession')
    can('manage', 'Skill')
    can('manage', 'Document')
    can('manage', 'KnowledgeSpace')
    can('manage', 'KnowledgePage')
    can('manage', 'Tag')
    can('manage', 'Activity')
    can('manage', 'ChatterMessage')
    can('manage', 'Scheduler')
    can('manage', 'Prompt')
    can('manage', 'Tool')
    can('manage', 'Model')
    can('manage', 'Hand')
    can('manage', 'DataPort')

    // Secrets: full access for admin
    can('read', 'Secret')
    can('create', 'Secret')
    can('delete', 'Secret')

    // Read-only for system internals
    can('read', 'Module')
    can('read', 'Audit')
    can('read', 'Notification')
    can('update', 'Notification')
    can('read', 'MemoryEntry')
    can('create', 'MemoryEntry')
    can('update', 'MemoryEntry')
    can('read', 'SearchSource')
    can('manage', 'SearchSource')
    can('read', 'SecurityEvent')
    can('read', 'SelfLearning')
    can('read', 'ProactiveAssistant')
    can('manage', 'ProactiveAssistant')
  }

  // ─── User ───────────────────────────────────────────────
  if (role === 'user') {
    // Own profile
    can('read', 'User')
    can('update', 'User')

    // API keys (own)
    can('create', 'ApiKey')
    can('read', 'ApiKey')
    can('delete', 'ApiKey')

    // Conversations: full CRUD (own)
    can('create', 'Conversation')
    can('read', 'Conversation')
    can('update', 'Conversation')
    can('delete', 'Conversation')
    can('create', 'ConversationMessage')
    can('read', 'ConversationMessage')

    // Board: read projects/stages, no management
    can('read', 'Project')
    can('read', 'ProjectType')
    can('read', 'Stage')

    // Agents & skills: read-only
    can('read', 'Agent')
    can('read', 'Skill')

    // Documents: full CRUD
    can('create', 'Document')
    can('read', 'Document')
    can('update', 'Document')
    can('delete', 'Document')

    // Knowledge: read spaces, CRUD pages
    can('read', 'KnowledgeSpace')
    can('create', 'KnowledgePage')
    can('read', 'KnowledgePage')
    can('update', 'KnowledgePage')
    can('delete', 'KnowledgePage')

    // Tags: read
    can('read', 'Tag')
    can('create', 'Tag')
    can('update', 'Tag')

    // Activities: manage
    can('create', 'Activity')
    can('read', 'Activity')
    can('update', 'Activity')

    // Chatter
    can('create', 'ChatterMessage')
    can('read', 'ChatterMessage')

    // Notifications
    can('read', 'Notification')
    can('update', 'Notification')

    // Memory: read + create
    can('read', 'MemoryEntry')
    can('create', 'MemoryEntry')
    can('update', 'MemoryEntry')

    // Search: read
    can('read', 'SearchSource')

    // Secrets (own scope)
    can('read', 'Secret')
    can('create', 'Secret')
    can('delete', 'Secret')

    // Model: read providers/models, use complete/stream
    can('read', 'Model')
    can('use', 'Model')

    // Prompts: read
    can('read', 'Prompt')

    // Tools: read + execute. The executor is a CASL choke point, so without
    // 'execute' a signed-in user's own conversation could not call any tool.
    can('read', 'Tool')
    can('execute', 'Tool')

    // Data import (memory/skills from prior systems) + proposal approve/reject
    can('read', 'DataPort')
    can('create', 'DataPort')
    can('update', 'DataPort')
  }

  // ─── Agent ──────────────────────────────────────────────
  if (role === 'agent') {
    // Own profile
    can('read', 'User')
    can('update', 'User')

    // API keys (own)
    can('create', 'ApiKey')
    can('read', 'ApiKey')
    can('delete', 'ApiKey')

    // Conversations: create, read, update (no delete)
    can('create', 'Conversation')
    can('read', 'Conversation')
    can('update', 'Conversation')
    can('create', 'ConversationMessage')
    can('read', 'ConversationMessage')

    // Tools: execute + read
    can('execute', 'Tool')
    can('read', 'Tool')

    // Skills: read
    can('read', 'Skill')

    // Memory: read + create
    can('read', 'MemoryEntry')
    can('create', 'MemoryEntry')

    // Documents: read
    can('read', 'Document')

    // Knowledge: read
    can('read', 'KnowledgePage')
    can('read', 'KnowledgeSpace')

    // Agents: read
    can('read', 'Agent')
    can('read', 'AgentSession')

    // Search: read
    can('read', 'SearchSource')

    // Projects: read
    can('read', 'Project')
    can('read', 'ProjectType')
    can('read', 'Stage')

    // Chatter: read + create
    can('read', 'ChatterMessage')
    can('create', 'ChatterMessage')

    // Activities: read + create
    can('read', 'Activity')
    can('create', 'Activity')

    // Model: use
    can('read', 'Model')
    can('use', 'Model')

    // Hand: read + create + delete (user can manage own devices)
    can('read', 'Hand')
    can('create', 'Hand')
    can('delete', 'Hand')
  }

  // ─── Guest ──────────────────────────────────────────────
  if (role === 'guest') {
    can('read', 'Conversation')
    can('read', 'ConversationMessage')
    can('read', 'Project')
    can('read', 'ProjectType')
    can('read', 'KnowledgePage')
    can('read', 'KnowledgeSpace')
    can('read', 'User')
  }

  // Module-registered subjects (dynamic extensions)
  for (const reg of registry.getRegisteredSubjects()) {
    const roleDefaults = reg.defaults?.[role]
    if (roleDefaults) {
      for (const action of roleDefaults) {
        can(action, reg.subject)
      }
    }
  }

  return build()
}

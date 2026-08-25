export const ROLES = ['owner', 'admin', 'user', 'agent', 'guest'] as const
export type RoleId = typeof ROLES[number]

export const ROLE_HIERARCHY: Record<RoleId, number> = {
  owner: 50,
  admin: 40,
  user: 30,
  agent: 20,
  guest: 10,
}

// All CASL subjects used across the system
export const SUBJECTS = [
  'Conversation',
  'ConversationMessage',
  'Project',
  'ProjectType',
  'Stage',
  'User',
  'Session',
  'ApiKey',
  'Secret',
  'Module',
  'Agent',
  'AgentSession',
  'Tool',
  'Skill',
  'Document',
  'KnowledgePage',
  'KnowledgeSpace',
  'MemoryEntry',
  'SearchSource',
  'Tag',
  'Activity',
  'ChatterMessage',
  'Notification',
  'Audit',
  'Scheduler',
  'Prompt',
  'SecurityEvent',
  'SelfLearning',
  'ProactiveAssistant',
  'Model',
  'Hand',
  'DataPort',
] as const

export type Subject = typeof SUBJECTS[number]

export type ActionLevel = 'auto' | 'ask' | 'ask_always'

export interface SubjectRegistration {
  subject: string
  actions: string[]
  fields?: string[]
  defaults?: Partial<Record<RoleId, string[]>>
}

export function isRoleAtLeast(role: RoleId, minimum: RoleId): boolean {
  return ROLE_HIERARCHY[role] >= ROLE_HIERARCHY[minimum]
}

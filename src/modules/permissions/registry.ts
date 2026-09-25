import type { RoleId, SubjectRegistration } from './types.js'

export interface PermissionRegistry {
  registerSubject(subject: string, config: {
    actions: string[]
    fields?: string[]
    defaults?: Partial<Record<RoleId, string[]>>
  }): void
  getRegisteredSubjects(): SubjectRegistration[]
}

export function createPermissionRegistry(): PermissionRegistry {
  const subjects = new Map<string, SubjectRegistration>()

  return {
    registerSubject(subject, config) {
      if (subjects.has(subject)) {
        throw new Error(`Subject "${subject}" is already registered`)
      }
      const actionSet = new Set(config.actions)
      if (config.defaults) {
        for (const [role, actions] of Object.entries(config.defaults)) {
          for (const action of actions) {
            if (!actionSet.has(action)) {
              throw new Error(`Unknown action "${action}" for subject "${subject}" (role: ${role})`)
            }
          }
        }
      }
      subjects.set(subject, {
        subject,
        actions: config.actions,
        fields: config.fields,
        defaults: config.defaults,
      })
    },

    getRegisteredSubjects() {
      return Array.from(subjects.values())
    },
  }
}

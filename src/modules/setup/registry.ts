import { sql } from 'drizzle-orm'
import type { SetupRegistry, SetupStepDefinition, SetupStep } from './types.js'

export function createSetupRegistry(db: any): SetupRegistry {
  const definitions = new Map<string, SetupStepDefinition>()
  const states = new Map<string, { status: 'pending' | 'completed' | 'skipped'; completedAt: string | null }>()
  let completeCache: boolean | null = null

  function loadStateFromDb(id: string) {
    const rows = db.all(sql`SELECT * FROM setup_steps WHERE id = ${id}`) as any[]
    if (rows[0]) {
      states.set(id, { status: rows[0].status, completedAt: rows[0].completed_at })
    }
  }

  function persistState(id: string, status: string, data: Record<string, unknown> | null) {
    const now = status === 'pending' ? null : new Date().toISOString()
    const jsonData = data ? JSON.stringify(data) : null
    db.run(sql`INSERT OR REPLACE INTO setup_steps (id, status, data, completed_at) VALUES (${id}, ${status}, ${jsonData}, ${now})`)
  }

  function invalidateCache() {
    completeCache = null
  }

  function stripPasswords(definition: SetupStepDefinition, data: Record<string, unknown>): Record<string, unknown> {
    const passwordFields = new Set(definition.fields.filter(f => f.type === 'password').map(f => f.name))
    const sanitized: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(data)) {
      if (!passwordFields.has(key)) {
        sanitized[key] = value
      }
    }
    return sanitized
  }

  return {
    registerStep(step) {
      if (definitions.has(step.id)) {
        throw new Error(`Setup step "${step.id}" is already registered`)
      }
      definitions.set(step.id, step)
      loadStateFromDb(step.id)
      if (!states.has(step.id)) {
        states.set(step.id, { status: 'pending', completedAt: null })
      }
      invalidateCache()
    },

    getSteps(): SetupStep[] {
      return Array.from(definitions.values())
        .sort((a, b) => a.order - b.order)
        .map(def => {
          const state = states.get(def.id) ?? { status: 'pending' as const, completedAt: null }
          return {
            id: def.id, module: def.module, title: def.title, description: def.description,
            required: def.required, order: def.order, fields: def.fields,
            status: state.status, completedAt: state.completedAt,
          }
        })
    },

    getStep(id) {
      const def = definitions.get(id)
      if (!def) return undefined
      const state = states.get(id) ?? { status: 'pending' as const, completedAt: null }
      return {
        id: def.id, module: def.module, title: def.title, description: def.description,
        required: def.required, order: def.order, fields: def.fields,
        status: state.status, completedAt: state.completedAt,
      }
    },

    isComplete() {
      if (completeCache !== null) return completeCache
      const result = Array.from(definitions.values())
        .filter(d => d.required)
        .every(d => {
          const state = states.get(d.id)
          return state?.status === 'completed'
        })
      completeCache = result
      return result
    },

    async completeStep(id, data) {
      const def = definitions.get(id)
      if (!def) throw new Error(`Setup step "${id}" not found`)
      await def.onComplete(data)
      const sanitized = stripPasswords(def, data)
      states.set(id, { status: 'completed', completedAt: new Date().toISOString() })
      persistState(id, 'completed', sanitized)
      invalidateCache()
    },

    async skipStep(id) {
      const def = definitions.get(id)
      if (!def) throw new Error(`Setup step "${id}" not found`)
      if (def.required) throw new Error(`Setup step "${id}" is required and cannot be skipped`)
      states.set(id, { status: 'skipped', completedAt: new Date().toISOString() })
      persistState(id, 'skipped', null)
      invalidateCache()
    },
  }
}

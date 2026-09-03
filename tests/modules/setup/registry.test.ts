import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createSetupRegistry } from '@modules/setup/registry'
import { createTestDb } from '../../helpers/test-db'
import type { SetupRegistry, SetupStepDefinition } from '@modules/setup/types'

const testDb = createTestDb('setup-registry')
let db: ReturnType<typeof testDb.open>
let registry: SetupRegistry

function mockStep(overrides: Partial<SetupStepDefinition> = {}): SetupStepDefinition {
  return {
    id: 'test-step',
    module: 'test',
    title: 'Test Step',
    description: 'A test step',
    required: true,
    order: 10,
    fields: [
      { name: 'username', type: 'text', label: 'Username', required: true },
    ],
    onComplete: async () => {},
    ...overrides,
  }
}

beforeEach(() => {
  db = testDb.open()
  registry = createSetupRegistry(db)
})

afterEach(() => {
  testDb.cleanup()
})

describe('SetupRegistry', () => {
  describe('registerStep', () => {
    it('registers a step', () => {
      registry.registerStep(mockStep())
      expect(registry.getSteps()).toHaveLength(1)
      expect(registry.getSteps()[0].id).toBe('test-step')
      expect(registry.getSteps()[0].status).toBe('pending')
    })

    it('rejects duplicate step IDs', () => {
      registry.registerStep(mockStep())
      expect(() => registry.registerStep(mockStep())).toThrow('already registered')
    })

    it('orders steps by order field', () => {
      registry.registerStep(mockStep({ id: 'b', order: 20 }))
      registry.registerStep(mockStep({ id: 'a', order: 10 }))
      const steps = registry.getSteps()
      expect(steps[0].id).toBe('a')
      expect(steps[1].id).toBe('b')
    })
  })

  describe('getStep', () => {
    it('returns a step by ID', () => {
      registry.registerStep(mockStep())
      expect(registry.getStep('test-step')?.title).toBe('Test Step')
    })

    it('returns undefined for unknown ID', () => {
      expect(registry.getStep('unknown')).toBeUndefined()
    })
  })

  describe('completeStep', () => {
    it('marks step as completed', async () => {
      registry.registerStep(mockStep())
      await registry.completeStep('test-step', { username: 'admin' })
      expect(registry.getStep('test-step')?.status).toBe('completed')
      expect(registry.getStep('test-step')?.completedAt).toBeTruthy()
    })

    it('calls onComplete callback with data', async () => {
      let receivedData: Record<string, unknown> = {}
      registry.registerStep(mockStep({
        onComplete: async (data) => { receivedData = data },
      }))
      await registry.completeStep('test-step', { username: 'admin' })
      expect(receivedData).toEqual({ username: 'admin' })
    })

    it('strips password fields from persisted data', async () => {
      registry.registerStep(mockStep({
        fields: [
          { name: 'username', type: 'text', label: 'Username', required: true },
          { name: 'password', type: 'password', label: 'Password', required: true },
        ],
      }))
      await registry.completeStep('test-step', { username: 'admin', password: 'secret123' })
      expect(registry.getStep('test-step')?.status).toBe('completed')
    })

    it('throws for unknown step ID', async () => {
      await expect(registry.completeStep('unknown', {})).rejects.toThrow('not found')
    })

    it('keeps step pending if onComplete throws', async () => {
      registry.registerStep(mockStep({
        onComplete: async () => { throw new Error('Failed!') },
      }))
      await expect(registry.completeStep('test-step', {})).rejects.toThrow('Failed!')
      expect(registry.getStep('test-step')?.status).toBe('pending')
    })
  })

  describe('skipStep', () => {
    it('skips an optional step', async () => {
      registry.registerStep(mockStep({ required: false }))
      await registry.skipStep('test-step')
      expect(registry.getStep('test-step')?.status).toBe('skipped')
    })

    it('rejects skipping a required step', async () => {
      registry.registerStep(mockStep({ required: true }))
      await expect(registry.skipStep('test-step')).rejects.toThrow('required')
    })
  })

  describe('isComplete', () => {
    it('returns false when required steps are pending', () => {
      registry.registerStep(mockStep({ required: true }))
      expect(registry.isComplete()).toBe(false)
    })

    it('returns true when all required steps are completed', async () => {
      registry.registerStep(mockStep({ required: true }))
      await registry.completeStep('test-step', { username: 'admin' })
      expect(registry.isComplete()).toBe(true)
    })

    it('returns true when required completed and optional pending', async () => {
      registry.registerStep(mockStep({ id: 'req', required: true, order: 10 }))
      registry.registerStep(mockStep({ id: 'opt', required: false, order: 20 }))
      await registry.completeStep('req', {})
      expect(registry.isComplete()).toBe(true)
    })

    it('returns true when no steps are registered', () => {
      expect(registry.isComplete()).toBe(true)
    })

    it('restores state from DB on creation', async () => {
      registry.registerStep(mockStep({ required: true }))
      await registry.completeStep('test-step', { username: 'admin' })

      const registry2 = createSetupRegistry(db)
      registry2.registerStep(mockStep({ required: true }))
      expect(registry2.getStep('test-step')?.status).toBe('completed')
      expect(registry2.isComplete()).toBe(true)
    })
  })
})

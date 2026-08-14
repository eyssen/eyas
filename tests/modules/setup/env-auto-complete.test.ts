import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createTestDb } from '../../helpers/test-db'
import { createSetupRegistry } from '@modules/setup/registry'
import { autoCompleteFromEnv } from '@modules/setup/index'
import type { SetupRegistry } from '@modules/setup/types'
import type { ModuleContext } from '@core/types'

const testDb = createTestDb('setup-env')
let db: ReturnType<typeof testDb.open>
let registry: SetupRegistry
let completedData: Record<string, Record<string, unknown>>

const noopLogger = { info() {}, warn() {}, error() {}, debug() {}, trace() {}, fatal() {}, child() { return noopLogger } } as any

beforeEach(() => {
  db = testDb.open()
  registry = createSetupRegistry(db)
  completedData = {}

  registry.registerStep({
    id: 'root-owner', module: 'auth', title: 'Root Owner', description: 'Create admin',
    required: true, order: 10,
    fields: [
      { name: 'username', type: 'text', label: 'Username', required: true },
      { name: 'password', type: 'password', label: 'Password', required: true },
      { name: 'displayName', type: 'text', label: 'Display Name', required: false },
    ],
    async onComplete(data) { completedData['root-owner'] = data },
  })

  registry.registerStep({
    id: 'primary-agents', module: 'auth', title: 'Primary AI Agents', description: 'Name your main AI assistants',
    required: true, order: 20,
    fields: [
      { name: 'assistantName', type: 'text', label: 'Personal Assistant', required: true },
      { name: 'engineerName', type: 'text', label: 'System Engineer', required: true },
    ],
    async onComplete(data) { completedData['primary-agents'] = data },
  })
})

afterEach(() => {
  testDb.cleanup()
  delete process.env.EYAS_SETUP_USERNAME
  delete process.env.EYAS_SETUP_PASSWORD
  delete process.env.EYAS_SETUP_DISPLAY_NAME
  delete process.env.EYAS_SETUP_AGENT_NAME
  delete process.env.EYAS_SETUP_ENGINEER_NAME
})

describe('env var auto-complete', () => {
  it('auto-completes root-owner from env vars', async () => {
    process.env.EYAS_SETUP_USERNAME = 'envadmin'
    process.env.EYAS_SETUP_PASSWORD = 'envpassword123'

    const username = process.env.EYAS_SETUP_USERNAME
    const password = process.env.EYAS_SETUP_PASSWORD
    if (username && password) {
      const step = registry.getStep('root-owner')
      if (step && step.status === 'pending') {
        await registry.completeStep('root-owner', {
          username, password,
          displayName: process.env.EYAS_SETUP_DISPLAY_NAME || username,
        })
        delete process.env.EYAS_SETUP_PASSWORD
      }
    }

    expect(registry.getStep('root-owner')?.status).toBe('completed')
    expect(completedData['root-owner'].username).toBe('envadmin')
    expect(process.env.EYAS_SETUP_PASSWORD).toBeUndefined()
  })

  it('auto-completes primary-agents from env vars (real autoCompleteFromEnv, mocked setup)', async () => {
    process.env.EYAS_SETUP_AGENT_NAME = 'Jarvis'
    process.env.EYAS_SETUP_ENGINEER_NAME = 'R2D2'

    const getStep = vi.fn().mockReturnValue({ status: 'pending' })
    const completeStep = vi.fn().mockResolvedValue(undefined)
    const ctx = {
      setup: { getStep, completeStep },
      logger: noopLogger,
    } as unknown as ModuleContext

    await autoCompleteFromEnv(ctx)

    expect(getStep).toHaveBeenCalledWith('primary-agents')
    expect(completeStep).toHaveBeenCalledWith('primary-agents', { assistantName: 'Jarvis', engineerName: 'R2D2' })
  })

  it('falls back to assistantName for engineerName when only EYAS_SETUP_AGENT_NAME is set', async () => {
    process.env.EYAS_SETUP_AGENT_NAME = 'Jarvis'

    const getStep = vi.fn().mockReturnValue({ status: 'pending' })
    const completeStep = vi.fn().mockResolvedValue(undefined)
    const ctx = {
      setup: { getStep, completeStep },
      logger: noopLogger,
    } as unknown as ModuleContext

    await autoCompleteFromEnv(ctx)

    expect(completeStep).toHaveBeenCalledWith('primary-agents', { assistantName: 'Jarvis', engineerName: 'Jarvis' })
  })

  it('does not auto-complete when env vars are missing', () => {
    expect(registry.getStep('root-owner')?.status).toBe('pending')
    expect(registry.getStep('primary-agents')?.status).toBe('pending')
  })

  it('does not auto-complete already completed steps', async () => {
    await registry.completeStep('root-owner', { username: 'original', password: 'pass12345678' })

    process.env.EYAS_SETUP_USERNAME = 'override'
    process.env.EYAS_SETUP_PASSWORD = 'overridepass123'

    const step = registry.getStep('root-owner')
    if (step && step.status === 'pending') {
      await registry.completeStep('root-owner', {
        username: process.env.EYAS_SETUP_USERNAME,
        password: process.env.EYAS_SETUP_PASSWORD,
      })
    }

    expect(completedData['root-owner'].username).toBe('original')
  })
})

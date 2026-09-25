import { describe, it, expect, vi } from 'vitest'
import { ModuleLoader } from '@core/module-loader'
import type { EyasModule, ModuleContext } from '@core/types'

function createMockModule(overrides: Partial<EyasModule> = {}): EyasModule {
  return {
    id: 'test-module',
    name: 'Test Module',
    version: '1.0.0',
    type: 'core',
    description: 'A test module',
    dependencies: [],
    onRegister: vi.fn(),
    onStart: vi.fn(),
    onStop: vi.fn(),
    ...overrides,
  }
}

const mockContext = {} as ModuleContext

describe('ModuleLoader', () => {
  it('registers a module', () => {
    const loader = new ModuleLoader()
    loader.register(createMockModule())
    expect(loader.hasModule('test-module')).toBe(true)
  })

  it('rejects duplicate module IDs', () => {
    const loader = new ModuleLoader()
    loader.register(createMockModule())
    expect(() => loader.register(createMockModule())).toThrow('already registered')
  })

  it('resolves dependencies in order', () => {
    const loader = new ModuleLoader()
    loader.register(createMockModule({ id: 'a', dependencies: ['b'] }))
    loader.register(createMockModule({ id: 'b', dependencies: [] }))
    const order = loader.resolveDependencies()
    expect(order.indexOf('b')).toBeLessThan(order.indexOf('a'))
  })

  it('detects circular dependencies', () => {
    const loader = new ModuleLoader()
    loader.register(createMockModule({ id: 'a', dependencies: ['b'] }))
    loader.register(createMockModule({ id: 'b', dependencies: ['a'] }))
    expect(() => loader.resolveDependencies()).toThrow('Circular')
  })

  it('filters disabled modules', () => {
    const loader = new ModuleLoader()
    loader.register(createMockModule({ id: 'enabled-mod' }))
    loader.register(createMockModule({ id: 'disabled-mod' }))
    const active = loader.getActiveModules(['disabled-mod'])
    expect(active).toHaveLength(1)
    expect(active[0].id).toBe('enabled-mod')
  })

  it('calls lifecycle hooks in order', async () => {
    const loader = new ModuleLoader()
    const callOrder: string[] = []
    const mod = createMockModule({
      onRegister: vi.fn(async () => { callOrder.push('register') }),
      onStart: vi.fn(async () => { callOrder.push('start') }),
    })
    loader.register(mod)
    await loader.startAll(mockContext, [])
    expect(callOrder).toEqual(['register', 'start'])
  })
})

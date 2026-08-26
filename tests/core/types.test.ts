import { describe, it, expect } from 'vitest'
import type {
  EyasModule,
  SubmoduleManifest,
  FrontendManifest,
  ModuleContext,
  EyasConfig,
  EyasBus,
} from '@core/types'

describe('Core Types', () => {
  it('EyasModule interface is structurally valid', () => {
    const mod: EyasModule = {
      id: 'test-module',
      name: 'Test Module',
      version: '1.0.0',
      type: 'core',
      description: 'A test module',
      dependencies: [],
      onRegister: async () => {},
      onStart: async () => {},
      onStop: async () => {},
    }
    expect(mod.id).toBe('test-module')
    expect(mod.type).toBe('core')
  })

  it('SubmoduleManifest has correct shape', () => {
    const sub: SubmoduleManifest = {
      id: 'claude-api',
      name: 'Claude API Provider',
      parentModule: 'model',
      enabled: true,
    }
    expect(sub.parentModule).toBe('model')
    expect(sub.enabled).toBe(true)
  })

  it('FrontendManifest supports pages and widgets', () => {
    const manifest: FrontendManifest = {
      pages: [{ id: 'board', path: '/board', title: 'Board', icon: 'kanban', order: 1 }],
      widgets: [{ id: 'board-summary', titleKey: 'home.widget.board-summary.title' }],
    }
    expect(manifest.pages).toHaveLength(1)
    expect(manifest.widgets).toHaveLength(1)
  })
})

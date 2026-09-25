// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, it, expect } from 'vitest'
import { ModuleLoader, buildModuleList } from '@core/module-loader'
import type { EyasModule } from '@core/types'

function stubModule(id: string, widgets?: { id: string; titleKey: string }[]): EyasModule {
  return {
    id, name: id, version: '1.0.0', type: 'core', description: id,
    dependencies: [],
    frontend: widgets ? { widgets } : undefined,
    async onRegister() {}, async onStart() {}, async onStop() {},
  }
}

describe('buildModuleList — the projection ctx.listModules() serves', () => {
  it('returns id + frontend manifest + enabled flag, dropping lifecycle hooks', () => {
    const loader = new ModuleLoader()
    loader.register(stubModule('scheduler', [{ id: 'scheduler.upcoming', titleKey: 'home.widget.schedule.title' }]))
    loader.register(stubModule('audit'))

    const listed = buildModuleList(loader, [])

    expect(listed.map((m) => m.id).sort()).toEqual(['audit', 'scheduler'])
    expect(listed.find((m) => m.id === 'scheduler')?.frontend?.widgets?.[0].titleKey)
      .toBe('home.widget.schedule.title')
    // All modules should be enabled when not in disabled list
    expect(listed.every((m) => m.enabled)).toBe(true)
    // The projection must not leak callable module internals to the catalogue.
    expect(listed[0]).not.toHaveProperty('onStart')
  })

  it('marks disabled modules with enabled: false in the list', () => {
    const loader = new ModuleLoader()
    loader.register(stubModule('scheduler', [{ id: 'scheduler.upcoming', titleKey: 'k' }]))
    loader.register(stubModule('audit'))
    const listed = buildModuleList(loader, ['scheduler'])

    expect(listed.map((m) => m.id).sort()).toEqual(['audit', 'scheduler'])
    const scheduler = listed.find((m) => m.id === 'scheduler')
    expect(scheduler?.enabled).toBe(false)
    const audit = listed.find((m) => m.id === 'audit')
    expect(audit?.enabled).toBe(true)
  })
})

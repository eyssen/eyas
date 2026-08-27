// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, it, expect } from 'vitest'
import { buildCatalogue } from '@modules/home/catalogue'

const modules = [
  { id: 'scheduler', frontend: { widgets: [{ id: 'scheduler.upcoming', titleKey: 'home.widget.schedule.title' }] }, enabled: true },
  { id: 'costops',   frontend: { widgets: [{ id: 'costops.summary', titleKey: 'home.widget.cost.title', capability: 'Cost' }] }, enabled: true },
  { id: 'audit',     frontend: undefined, enabled: true },
  { id: 'disabled',  frontend: { widgets: [{ id: 'disabled.widget', titleKey: 'home.widget.disabled.title' }] }, enabled: false },
]

describe('widget catalogue', () => {
  it('lists declared widgets with their owning module', () => {
    const { widgets } = buildCatalogue(modules, () => true)
    expect(widgets.map((w) => w.id).sort()).toEqual(['costops.summary', 'disabled.widget', 'scheduler.upcoming'])
    expect(widgets.find((w) => w.id === 'costops.summary')?.module).toBe('costops')
  })

  it('marks a widget unavailable when CASL denies its capability, but still lists it', () => {
    const { widgets } = buildCatalogue(modules, (cap) => cap !== 'Cost')
    const cost = widgets.find((w) => w.id === 'costops.summary')
    expect(cost?.available).toBe(false)
    expect(cost?.reason).toBe('forbidden')
  })

  it('marks a widget unavailable with module_disabled reason when its module is disabled', () => {
    const { widgets } = buildCatalogue(modules, () => true)
    const disabled = widgets.find((w) => w.id === 'disabled.widget')
    expect(disabled?.available).toBe(false)
    expect(disabled?.reason).toBe('module_disabled')
  })

  it('prefers module_disabled reason over forbidden when both apply', () => {
    const modulesWithCapReq = [
      { id: 'disabled', frontend: { widgets: [{ id: 'disabled.widget', titleKey: 'home.widget.disabled.title', capability: 'Cost' }] }, enabled: false },
    ]
    const { widgets } = buildCatalogue(modulesWithCapReq, (cap) => cap !== 'Cost')
    const entry = widgets.find((w) => w.id === 'disabled.widget')
    expect(entry?.available).toBe(false)
    expect(entry?.reason).toBe('module_disabled')
  })

  it('omits nothing for modules without widgets', () => {
    const { widgets } = buildCatalogue(modules, () => true)
    expect(widgets.some((w) => w.module === 'audit')).toBe(false)
  })
})

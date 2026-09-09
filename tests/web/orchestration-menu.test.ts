// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { nextFieldsOnMenuPick } from '../../src/web/src/pages/conversations/orchestration-menu-utils'

describe('nextFieldsOnMenuPick', () => {
  it('keeps the current orchestration when God Mode is picked', () => {
    expect(nextFieldsOnMenuPick('god', { orchestration: 'deep', godMode: false })).toEqual({
      orchestration: 'deep',
      godMode: true,
    })
    expect(nextFieldsOnMenuPick('god', { orchestration: 'solo', godMode: false })).toEqual({
      orchestration: 'solo',
      godMode: true,
    })
  })

  it('leaves orchestration unchanged if God Mode is already on', () => {
    expect(nextFieldsOnMenuPick('god', { orchestration: 'auto', godMode: true })).toEqual({
      orchestration: 'auto',
      godMode: true,
    })
  })

  it('clears godMode when Solo is picked', () => {
    expect(nextFieldsOnMenuPick('solo', { orchestration: 'deep', godMode: true })).toEqual({
      orchestration: 'solo',
      godMode: false,
    })
  })

  it('clears godMode when Auto or Deep is picked', () => {
    expect(nextFieldsOnMenuPick('auto', { orchestration: 'solo', godMode: true })).toEqual({
      orchestration: 'auto',
      godMode: false,
    })
    expect(nextFieldsOnMenuPick('deep', { orchestration: 'auto', godMode: true })).toEqual({
      orchestration: 'deep',
      godMode: false,
    })
  })
})

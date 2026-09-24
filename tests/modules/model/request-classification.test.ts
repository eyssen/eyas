// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { isAutonomousRequest } from '@modules/model/permission-bridge.js'

describe('isAutonomousRequest — fail-closed classification (F0)', () => {
  it('treats absent/empty metadata as autonomous (strictest)', () => {
    expect(isAutonomousRequest(undefined)).toBe(true)
    expect(isAutonomousRequest({})).toBe(true)
  })
  it('origin interactive → non-autonomous', () => {
    expect(isAutonomousRequest({ origin: 'interactive' })).toBe(false)
  })
  it('team session is always autonomous, even on an interactive conversation', () => {
    expect(isAutonomousRequest({ origin: 'interactive', teamSessionId: 'ts1' })).toBe(true)
  })
  it('channel: managed maps non-autonomous, autonomous mode maps autonomous', () => {
    expect(isAutonomousRequest({ origin: 'channel', autonomous: false })).toBe(false)
    expect(isAutonomousRequest({ origin: 'channel', autonomous: true })).toBe(true)
  })
  it('unattended origins can NEVER opt out via autonomous:false', () => {
    for (const origin of ['scheduled', 'pipeline', 'delegation', 'team'] as const) {
      expect(isAutonomousRequest({ origin, autonomous: false })).toBe(true)
    }
  })
  it('explicit autonomous:true wins over an interactive origin', () => {
    expect(isAutonomousRequest({ origin: 'interactive', autonomous: true })).toBe(true)
  })
})

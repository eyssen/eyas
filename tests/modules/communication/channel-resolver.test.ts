// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, expect, it } from 'vitest'
import { resolveScope } from '../../../src/modules/communication/channel-resolver.js'

describe('resolveScope (Rule B)', () => {
  it('owner DM → internal', () => {
    expect(resolveScope({ channelType: 'web', conversationKind: 'owner-dm', participants: [{ id: 'u1', type: 'owner' }], origin: 'inbound' }).scope).toBe('internal')
  })
  it('owner + team-member group → internal', () => {
    const r = resolveScope({ channelType: 'telegram', conversationKind: 'group', participants: [{ id: 'u1', type: 'owner' }, { id: 't1', type: 'team-member' }], origin: 'inbound' })
    expect(r.scope).toBe('internal')
  })
  it('owner + known-contact → external', () => {
    expect(resolveScope({ channelType: 'email', conversationKind: 'group', participants: [{ id: 'u1', type: 'owner' }, { id: 'c1', type: 'known-contact' }], origin: 'inbound' }).scope).toBe('external')
  })
  it('owner + unknown-external → external', () => {
    expect(resolveScope({ channelType: 'telegram', conversationKind: 'group', participants: [{ id: 'u1', type: 'owner' }, { id: 'x1', type: 'unknown-external' }], origin: 'inbound' }).scope).toBe('external')
  })
  it('group all team-members + owner → internal', () => {
    expect(resolveScope({ channelType: 'slack', conversationKind: 'group', participants: [{ id: 'u1', type: 'owner' }, { id: 't1', type: 'team-member' }, { id: 't2', type: 'team-member' }], origin: 'inbound' }).scope).toBe('internal')
  })
  it('group with mixed externals → external with count in reason', () => {
    const r = resolveScope({ channelType: 'telegram', conversationKind: 'group', participants: [{ id: 'u1', type: 'owner' }, { id: 't1', type: 'team-member' }, { id: 'c1', type: 'known-contact' }, { id: 'x1', type: 'unknown-external' }], origin: 'inbound' })
    expect(r.scope).toBe('external')
    expect(r.reason).toMatch(/2 external/)
  })
  it('outbound-proactive single owner → internal', () => {
    expect(resolveScope({ channelType: 'web', conversationKind: 'owner-dm', participants: [{ id: 'u1', type: 'owner' }], origin: 'outbound-proactive' }).scope).toBe('internal')
  })
  it('broadcast to externals → external', () => {
    expect(resolveScope({ channelType: 'email', conversationKind: 'broadcast', participants: [{ id: 'x1', type: 'unknown-external' }], origin: 'outbound-proactive' }).scope).toBe('external')
  })
})

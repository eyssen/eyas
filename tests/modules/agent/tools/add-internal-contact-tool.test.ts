// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, expect, it, vi } from 'vitest'
import { createAddInternalContactTool } from '../../../../src/modules/agent/tools/add-internal-contact-tool.js'
import type { InternalContact, InternalContactsRegistry } from '../../../../src/modules/communication/internal-contacts-registry.js'

function makeRegistry(): { registry: InternalContactsRegistry; addSpy: ReturnType<typeof vi.fn> } {
  const addSpy = vi.fn(async (input: Parameters<InternalContactsRegistry['add']>[0]): Promise<InternalContact> => ({
    id: 'ic_test_1',
    identifier: input.identifier,
    channelType: input.channelType,
    displayName: input.displayName,
    role: input.role,
    notes: input.notes ?? null,
    addedAt: '2026-04-26T00:00:00Z',
    addedBy: input.addedBy,
  }))
  return {
    registry: {
      add: addSpy,
      remove: vi.fn(async () => false),
      lookup: vi.fn(async () => null),
      list: vi.fn(async () => []),
      isInternal: vi.fn(async () => false),
    },
    addSpy,
  }
}

describe('add_internal_contact tool', () => {
  it('adds the contact when owner approves', async () => {
    const { registry, addSpy } = makeRegistry()
    const tool = createAddInternalContactTool({
      registry,
      ownerUserId: () => 'owner-1',
      ownerConfirm: vi.fn(async () => true),
    })

    const result = await tool.invoke('agent-x', {
      identifier: 'tg-12345',
      channelType: 'telegram',
      displayName: 'Anna',
      notes: 'Designer',
    })

    expect(result).toEqual({ ok: true, contactId: 'ic_test_1' })
    expect(addSpy).toHaveBeenCalledWith({
      identifier: 'tg-12345',
      channelType: 'telegram',
      displayName: 'Anna',
      role: 'team-member',
      notes: 'Designer',
      addedBy: 'owner-1',
    })
  })

  it('returns failure and skips registry when owner declines', async () => {
    const { registry, addSpy } = makeRegistry()
    const ownerConfirm = vi.fn(async () => false)
    const tool = createAddInternalContactTool({
      registry,
      ownerUserId: () => 'owner-1',
      ownerConfirm,
    })

    const result = await tool.invoke('agent-x', {
      identifier: 'tg-99',
      channelType: 'telegram',
      displayName: 'Bob',
    })

    expect(result).toEqual({ ok: false, reason: 'owner declined' })
    expect(ownerConfirm).toHaveBeenCalledOnce()
    expect(addSpy).not.toHaveBeenCalled()
  })

  it('forwards channelType + role=team-member to the registry', async () => {
    const { registry, addSpy } = makeRegistry()
    const tool = createAddInternalContactTool({
      registry,
      ownerUserId: () => 'owner-2',
      ownerConfirm: vi.fn(async () => true),
    })

    await tool.invoke('agent-y', {
      identifier: 'alice@example.com',
      channelType: 'email',
      displayName: 'Krisz',
    })

    const call = addSpy.mock.calls[0][0]
    expect(call.channelType).toBe('email')
    expect(call.role).toBe('team-member')
    expect(call.notes).toBeUndefined()
    expect(call.addedBy).toBe('owner-2')
  })
})

// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { z } from 'zod'
import type { InternalContactsRegistry } from '../../communication/internal-contacts-registry.js'

export const addInternalContactInputSchema = z.object({
  identifier: z.string().min(1),
  channelType: z.enum(['web', 'telegram', 'email', 'odoo-chatter', 'hand-companion', 'slack', 'discord']),
  displayName: z.string().min(1).max(100),
  notes: z.string().max(500).optional(),
})

export type AddInternalContactInput = z.infer<typeof addInternalContactInputSchema>

export interface AddInternalContactDeps {
  registry: InternalContactsRegistry
  ownerUserId: () => string
  ownerConfirm: (input: { identifier: string; displayName: string }) => Promise<boolean>
}

export function createAddInternalContactTool(deps: AddInternalContactDeps) {
  return {
    name: 'add_internal_contact',
    description: 'Mark a contact as internal (team-member). Owner must confirm before the change applies.',
    inputSchema: addInternalContactInputSchema,
    async invoke(_agentId: string, input: AddInternalContactInput): Promise<{ ok: true; contactId: string } | { ok: false; reason: string }> {
      const ok = await deps.ownerConfirm({ identifier: input.identifier, displayName: input.displayName })
      if (!ok) return { ok: false, reason: 'owner declined' }
      const contact = await deps.registry.add({
        identifier: input.identifier,
        channelType: input.channelType,
        displayName: input.displayName,
        role: 'team-member',
        notes: input.notes,
        addedBy: deps.ownerUserId(),
      })
      return { ok: true, contactId: contact.id }
    },
  }
}

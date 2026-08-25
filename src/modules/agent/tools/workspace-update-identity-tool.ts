// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { z } from 'zod'
import type { WorkspaceLoader } from '../../prompt-wizard/workspace-loader.js'
import type { WorkspaceWriter } from '../../prompt-wizard/workspace-writer.js'
import type { NotificationRouter } from '../../notifications/router.js'
import type { IdentityUpdateRateLimit } from './identity-update-rate-limit.js'

const SECTIONS = ['Who I am', 'My mission', 'Ongoing proactive duties', 'When to escalate', 'When to refuse'] as const

export const workspaceUpdateIdentityInputSchema = z.object({
  section: z.enum(SECTIONS),
  newContent: z.string().max(2000),
  reasoning: z.string().min(20).max(500),
})

export type WorkspaceUpdateIdentityInput = z.infer<typeof workspaceUpdateIdentityInputSchema>

export interface WorkspaceUpdateIdentityDeps {
  loader: WorkspaceLoader
  writer: WorkspaceWriter
  notifications: NotificationRouter
  audit: (entry: { agentId: string; action: string; section: string; reasoning: string }) => Promise<void>
  identitySelfUpdateEnabled: () => boolean
  ownerUserId: () => string
  agentName: (agentId: string) => Promise<string>
  rateLimit: IdentityUpdateRateLimit
}

function replaceSection(content: string, sectionTitle: string, newBody: string): string {
  const heading = `## ${sectionTitle}`
  const idx = content.indexOf(heading)
  if (idx === -1) {
    return content.trimEnd() + `\n\n${heading}\n${newBody}\n`
  }
  const after = content.slice(idx + heading.length)
  const nextIdx = after.search(/\n## /)
  const before = content.slice(0, idx)
  const tail = nextIdx === -1 ? '' : after.slice(nextIdx)
  return `${before}${heading}\n${newBody}\n${tail}`
}

function makeDiff(oldContent: string, newContent: string, section: string): string {
  return `--- ${section} (before)\n+++ ${section} (after)\n${oldContent.slice(0, 200)}...\n→\n${newContent.slice(0, 200)}...`
}

export function createWorkspaceUpdateIdentityTool(deps: WorkspaceUpdateIdentityDeps) {
  return {
    name: 'workspace_update_identity',
    description: 'Update your own IDENTITY.md (mission, proactive duties, escalation rules). User will be notified with a diff.',
    inputSchema: workspaceUpdateIdentityInputSchema,
    async invoke(agentId: string, input: WorkspaceUpdateIdentityInput): Promise<{ ok: true } | { ok: false; reason: string }> {
      if (!deps.identitySelfUpdateEnabled()) {
        return { ok: false, reason: 'identity self-update disabled by config; use forge_propose_identity_change instead' }
      }
      if (!deps.rateLimit.check(agentId)) {
        return { ok: false, reason: 'rate limited (max 3 IDENTITY changes per day)' }
      }
      const ws = await deps.loader.load(agentId)
      const oldBody = ws.identity.body
      const newBody = replaceSection(oldBody, input.section, input.newContent)
      await deps.writer.write({ agentId, file: 'IDENTITY.md', body: newBody })
      deps.loader.invalidate(agentId)
      deps.rateLimit.record(agentId)
      await deps.audit({ agentId, action: 'identity_update', section: input.section, reasoning: input.reasoning })
      const agentName = await deps.agentName(agentId)
      await deps.notifications.notify({
        event: 'agent.identity_changed',
        severity: 'info',
        userId: deps.ownerUserId(),
        title: `${agentName} updated their IDENTITY.md`,
        body: `Section: ${input.section}\nReason: ${input.reasoning}`,
        data: {
          agentId,
          section: input.section,
          diff: makeDiff(oldBody, newBody, input.section),
          actions: [
            { label: 'Approve (no-op)', action: 'ack' },
            { label: 'Revert', action: 'revert', payload: { agentId, snapshot: oldBody } },
          ],
        },
      })
      return { ok: true }
    },
  }
}

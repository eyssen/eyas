// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { z } from 'zod'
import type { WorkspaceLoader } from '../../prompt-wizard/workspace-loader.js'
import type { WorkspaceWriter } from '../../prompt-wizard/workspace-writer.js'

// MEMORY.md is deliberately NOT a target: models never write memory (core rule
// 8). The workspace MEMORY.md is the owner's own note file.
export const workspaceEditInputSchema = z.object({
  file: z.enum(['AGENTS.md', 'TOOLS.md']),
  oldString: z.string(),
  newString: z.string(),
})

export type WorkspaceEditInput = z.infer<typeof workspaceEditInputSchema>

export interface WorkspaceEditDeps {
  loader: WorkspaceLoader
  writer: WorkspaceWriter
  audit: (entry: { agentId: string; action: string; file: string }) => Promise<void>
}

export function createWorkspaceEditTool(deps: WorkspaceEditDeps) {
  return {
    name: 'workspace_edit',
    description:
      'Edit existing content in your own workspace file (AGENTS.md or TOOLS.md) by exact string replacement. Not for memory — EYAS records memory automatically.',
    inputSchema: workspaceEditInputSchema,
    async invoke(
      agentId: string,
      input: WorkspaceEditInput,
    ): Promise<{ ok: true } | { ok: false; reason: string }> {
      // Re-validate here too: a caller that bypasses the executor must not reach
      // MEMORY.md through the two-way file pick below.
      input = workspaceEditInputSchema.parse(input)
      const ws = await deps.loader.load(agentId)
      const file = input.file === 'AGENTS.md' ? ws.agentsMd : ws.toolsMd
      if (!file.body.includes(input.oldString)) return { ok: false, reason: 'oldString not found' }
      const occurrences = file.body.split(input.oldString).length - 1
      if (occurrences > 1)
        return { ok: false, reason: `oldString appears ${occurrences} times — must be unique` }
      const next = file.body.replace(input.oldString, input.newString)
      await deps.writer.write({ agentId, file: input.file, body: next })
      deps.loader.invalidate(agentId)
      await deps.audit({ agentId, action: 'workspace_edit', file: input.file })
      return { ok: true }
    },
  }
}

// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { z } from 'zod'
import type { WorkspaceLoader } from '../../prompt-wizard/workspace-loader.js'
import type { WorkspaceWriter } from '../../prompt-wizard/workspace-writer.js'
import type { AgentWorkspace } from '../../prompt-wizard/workspace-types.js'

export const workspaceAppendInputSchema = z.object({
  file: z.union([
    z.enum(['AGENTS.md', 'TOOLS.md', 'MEMORY.md']),
    z.string().regex(/^memory\/\d{4}-\d{2}-\d{2}\.md$/),
  ]),
  content: z.string().max(8000),
  section: z.string().optional(),
})

export type WorkspaceAppendInput = z.infer<typeof workspaceAppendInputSchema>

export interface WorkspaceAppendDeps {
  loader: WorkspaceLoader
  writer: WorkspaceWriter
  audit: (entry: { agentId: string; action: string; file: string; bytesAdded: number }) => Promise<void>
}

export function createWorkspaceAppendTool(deps: WorkspaceAppendDeps) {
  return {
    name: 'workspace_append',
    description:
      'Append content to your own workspace file (AGENTS.md, TOOLS.md, MEMORY.md, or memory/YYYY-MM-DD.md).',
    inputSchema: workspaceAppendInputSchema,
    async invoke(
      agentId: string,
      input: WorkspaceAppendInput,
    ): Promise<{ ok: true; bytesAdded: number }> {
      const ws = await deps.loader.load(agentId)
      const current = pickFile(ws, input.file).body
      const section = input.section ? `\n\n## ${input.section}\n` : '\n\n'
      const next = current + section + input.content
      await deps.writer.write({ agentId, file: input.file, body: next })
      deps.loader.invalidate(agentId)
      await deps.audit({
        agentId,
        action: 'workspace_append',
        file: input.file,
        bytesAdded: input.content.length,
      })
      return { ok: true, bytesAdded: input.content.length }
    },
  }
}

function pickFile(ws: AgentWorkspace, file: string) {
  switch (file) {
    case 'AGENTS.md':
      return ws.agentsMd
    case 'TOOLS.md':
      return ws.toolsMd
    case 'MEMORY.md':
      return ws.memoryMd
    default:
      if (file.startsWith('memory/'))
        return ws.dailyMemory.find((d) => d.name === file) ?? ({ body: '' } as never)
      throw new Error(`unsupported file: ${file}`)
  }
}

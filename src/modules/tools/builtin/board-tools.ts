// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { ToolImplementation } from '../types.js'

export interface BoardToolDeps {
  /** Resolves `ctx.board` — `{ projectTypes, projects, stages, tags }`. */
  getBoard: () => any
  /** Resolves `ctx.conversations`. */
  getConversations: () => any
}

export function createBoardTools(deps: BoardToolDeps): ToolImplementation[] {
  return [
    {
      name: 'list_projects',
      description: 'List all projects on the board. Returns each project id, name, description and type.',
      category: 'board',
      riskTier: 'green',
      inputSchema: {
        type: 'object',
        properties: {},
        required: [],
      },
      execute: async () => {
        const board = deps.getBoard()
        if (!board?.projects) return { error: 'Board module not ready yet — try again shortly' }

        const projects = board.projects.list().map((p: any) => ({
          id: p.id,
          name: p.name,
          description: p.description,
          typeId: p.typeId,
        }))
        return { projects }
      },
    },
    {
      name: 'move_to_stage',
      description: 'Move a conversation to a different stage within its project. Used for workflow progression.',
      category: 'board',
      riskTier: 'yellow',
      inputSchema: {
        type: 'object',
        properties: {
          conversationId: { type: 'string', description: 'The conversation to move' },
          stageId: { type: 'string', description: 'The target stage ID' },
        },
        required: ['conversationId', 'stageId'],
      },
      execute: async (input) => {
        const board = deps.getBoard()
        const conversations = deps.getConversations()
        if (!board?.stages || !conversations) {
          return { error: 'Board module not ready yet — try again shortly' }
        }

        const conversationId = input.conversationId as string
        const stageId = input.stageId as string

        const conversation = conversations.get(conversationId)
        if (!conversation) return { error: `Conversation not found: ${conversationId}` }
        const stage = board.stages.get(stageId)
        if (!stage) return { error: `Stage not found: ${stageId}` }

        // Routed through the conversation service on purpose — that is what
        // emits `eyas.conversations.stage_changed`, which drives the document
        // retention lifecycle and the board stage automation. A direct UPDATE
        // would move the row and silently skip both.
        conversations.update(conversationId, { stageId })

        return { moved: true, conversationId, stageId, stageName: stage.name }
      },
    },
  ]
}

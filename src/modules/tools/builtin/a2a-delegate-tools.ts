// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { ToolImplementation } from '../types.js'
import { createA2AClient } from '@modules/communication/submodules/a2a/client.js'

export function createA2ADelegateTools(): ToolImplementation[] {
  const client = createA2AClient()

  return [
    {
      name: 'a2a_discover',
      description: 'Discover a remote A2A agent by fetching its agent card. Returns the agent name, skills, and capabilities.',
      category: 'communication',
      riskTier: 'green',
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Base URL of the remote agent (e.g. https://agent.example.com)' },
        },
        required: ['url'],
      },
      execute: async (input) => {
        const card = await client.discover(input.url as string)
        return { agentCard: card }
      },
    },
    {
      name: 'a2a_delegate',
      description: 'Delegate a task to a remote A2A agent. Returns the task ID and initial status for polling.',
      category: 'communication',
      riskTier: 'yellow',
      inputSchema: {
        type: 'object',
        properties: {
          agentUrl: { type: 'string', description: 'Base URL of the remote A2A agent' },
          description: { type: 'string', description: 'Task description to send to the remote agent' },
          skill: { type: 'string', description: 'Optional skill ID to target on the remote agent' },
        },
        required: ['agentUrl', 'description'],
      },
      execute: async (input) => {
        const task = await client.sendTask(
          input.agentUrl as string,
          input.description as string,
          input.skill as string | undefined,
        )
        return { task }
      },
    },
    {
      name: 'a2a_task_status',
      description: 'Check the status of a previously delegated A2A task.',
      category: 'communication',
      riskTier: 'green',
      inputSchema: {
        type: 'object',
        properties: {
          agentUrl: { type: 'string', description: 'Base URL of the remote A2A agent' },
          taskId: { type: 'string', description: 'Task ID returned by a2a_delegate' },
        },
        required: ['agentUrl', 'taskId'],
      },
      execute: async (input) => {
        const task = await client.getTaskStatus(input.agentUrl as string, input.taskId as string)
        return { task }
      },
    },
    {
      name: 'a2a_cancel_task',
      description: 'Cancel a running A2A task on a remote agent.',
      category: 'communication',
      riskTier: 'yellow',
      inputSchema: {
        type: 'object',
        properties: {
          agentUrl: { type: 'string', description: 'Base URL of the remote A2A agent' },
          taskId: { type: 'string', description: 'Task ID to cancel' },
        },
        required: ['agentUrl', 'taskId'],
      },
      execute: async (input) => {
        await client.cancelTask(input.agentUrl as string, input.taskId as string)
        return { cancelled: true }
      },
    },
  ]
}

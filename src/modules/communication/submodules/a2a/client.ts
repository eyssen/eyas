// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { AgentCard, A2ATask, A2AResponse } from './types.js'

export interface A2AClientOptions {
  /** Bearer token for authenticating with remote agents */
  bearerToken?: string
  /** Request timeout in milliseconds (default: 30000) */
  timeoutMs?: number
}

export interface A2AClient {
  /** Fetch the agent card from a remote A2A endpoint */
  discover(url: string): Promise<AgentCard>
  /** Send a task to a remote A2A agent */
  sendTask(agentUrl: string, description: string, skill?: string): Promise<A2ATask>
  /** Check the status of a remote task */
  getTaskStatus(agentUrl: string, taskId: string): Promise<A2ATask>
  /** Cancel a remote task */
  cancelTask(agentUrl: string, taskId: string): Promise<void>
}

export function createA2AClient(options?: A2AClientOptions): A2AClient {
  const timeout = options?.timeoutMs ?? 30_000
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (options?.bearerToken) {
    headers['Authorization'] = `Bearer ${options.bearerToken}`
  }

  async function rpcCall(agentUrl: string, method: string, params: Record<string, unknown>): Promise<A2AResponse> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeout)
    try {
      const res = await fetch(`${agentUrl}/api/v1/a2a`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params }),
        signal: controller.signal,
      })
      const json = await res.json() as A2AResponse
      if (json.error) {
        throw new Error(`A2A RPC error ${json.error.code}: ${json.error.message}`)
      }
      return json
    } finally {
      clearTimeout(timer)
    }
  }

  return {
    async discover(url: string): Promise<AgentCard> {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeout)
      try {
        const res = await fetch(`${url}/.well-known/agent-card.json`, {
          headers: options?.bearerToken ? { Authorization: `Bearer ${options.bearerToken}` } : {},
          signal: controller.signal,
        })
        if (!res.ok) {
          throw new Error(`Failed to discover agent at ${url}: ${res.status}`)
        }
        return await res.json() as AgentCard
      } finally {
        clearTimeout(timer)
      }
    },

    async sendTask(agentUrl: string, description: string, skill?: string): Promise<A2ATask> {
      const response = await rpcCall(agentUrl, 'tasks/send', { description, ...(skill ? { skill } : {}) })
      return response.result as A2ATask
    },

    async getTaskStatus(agentUrl: string, taskId: string): Promise<A2ATask> {
      const response = await rpcCall(agentUrl, 'tasks/get', { taskId })
      return response.result as A2ATask
    },

    async cancelTask(agentUrl: string, taskId: string): Promise<void> {
      await rpcCall(agentUrl, 'tasks/cancel', { taskId })
    },
  }
}

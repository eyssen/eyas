// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { api } from '@/lib/api'

export interface WorkspaceFile {
  exists: boolean
  body: string
}

export interface WorkspaceSnapshot {
  filename: string
  timestamp: string
  size: number
}

export async function loadWorkspaceFile(agentId: string, file: string): Promise<WorkspaceFile> {
  return api.get<WorkspaceFile>(`/agents/${agentId}/workspace/${encodeURIComponent(file)}`)
}

export async function saveWorkspaceFile(agentId: string, file: string, body: string): Promise<void> {
  await api.put(`/agents/${agentId}/workspace/${encodeURIComponent(file)}`, { body })
}

export async function loadWorkspaceHistory(agentId: string, file: string): Promise<WorkspaceSnapshot[]> {
  const result = await api.get<WorkspaceSnapshot[]>(
    `/agents/${agentId}/workspace/${encodeURIComponent(file)}/history`
  )
  return Array.isArray(result) ? result : []
}

export async function restoreWorkspaceSnapshot(agentId: string, file: string, snapshot: string): Promise<void> {
  await api.post(`/agents/${agentId}/workspace/${encodeURIComponent(file)}/restore`, { snapshot })
}

// src/modules/prompt-wizard/workspace-paths.ts
import { join } from 'node:path'

const AGENT_ID_PATTERN = /^[a-z0-9_-]+$/i
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

function assertSafeAgentId(agentId: string): void {
  if (!AGENT_ID_PATTERN.test(agentId)) throw new Error(`invalid agent id: ${agentId}`)
}

export function resolveWorkspaceRoot(agentId: string, dataDir: string): string {
  assertSafeAgentId(agentId)
  return join(dataDir, 'agents', agentId)
}

export function resolveWorkspaceFile(agentId: string, fileName: string, dataDir: string): string {
  return join(resolveWorkspaceRoot(agentId, dataDir), fileName)
}

export function dailyMemoryPath(agentId: string, isoDate: string, dataDir: string): string {
  if (!ISO_DATE_PATTERN.test(isoDate)) throw new Error(`invalid date: ${isoDate}`)
  const [, m, d] = isoDate.split('-').map(Number)
  if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31)) throw new Error(`invalid date: ${isoDate}`)
  return join(resolveWorkspaceRoot(agentId, dataDir), 'memory', `${isoDate}.md`)
}

export function projectAgentsPath(projectId: string, dataDir: string): string {
  if (!AGENT_ID_PATTERN.test(projectId)) throw new Error(`invalid project id: ${projectId}`)
  return join(dataDir, 'projects', projectId, 'AGENTS.md')
}

export function projectTypeAgentsPath(typeId: string, dataDir: string): string {
  if (!AGENT_ID_PATTERN.test(typeId)) throw new Error(`invalid project type id: ${typeId}`)
  return join(dataDir, 'project-types', typeId, 'AGENTS.md')
}

export function historyPath(agentId: string, fileName: string, isoTimestamp: string, dataDir: string): string {
  const safeTs = isoTimestamp.replace(/:/g, '-').replace(/\.\d+Z?$/, '')
  return join(resolveWorkspaceRoot(agentId, dataDir), '.history', `${fileName}.${safeTs}.md`)
}

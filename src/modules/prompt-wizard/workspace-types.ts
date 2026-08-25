// src/modules/prompt-wizard/workspace-types.ts

export type WorkspaceFileName =
  | 'IDENTITY.md'
  | 'SOUL.md'
  | 'SOUL.style.json'
  | 'AGENTS.md'
  | 'TOOLS.md'
  | 'MEMORY.md'

export interface WorkspaceFrontmatter {
  schema: string                  // e.g. 'eyas.workspace.v1'
  agentId: string
  generatedAt: string             // ISO 8601
  [key: string]: unknown
}

export interface WorkspaceFile {
  name: WorkspaceFileName | string  // string allows memory/YYYY-MM-DD.md
  path: string
  exists: boolean
  frontmatter: WorkspaceFrontmatter | null
  body: string
  byteSize: number
  truncated: boolean
}

export interface AgentWorkspace {
  agentId: string
  rootPath: string
  identity: WorkspaceFile
  soulMd: WorkspaceFile
  soulStyleJson: WorkspaceFile
  agentsMd: WorkspaceFile
  toolsMd: WorkspaceFile
  memoryMd: WorkspaceFile
  dailyMemory: WorkspaceFile[]
}

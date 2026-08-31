// Part of eYssen. See LICENSE file for full copyright and licensing details.

export type SourceProfile =
  | 'claude-code'
  | 'cursor'
  | 'obsidian'
  | 'generic-md'
  | 'chat-export'
  | 'eyas-export'
  | 'auto'

export type CandidateKind =
  | 'memory'
  | 'skill'
  | 'rule'
  | 'identity'
  | 'knowledge'
  | 'noise'
  | 'unknown'

export type CandidateTarget =
  | 'episodic'
  | 'vault.semantic'
  | 'vault.procedural'
  | 'skill'
  | 'workspace.agents'
  | 'workspace.soul'
  | 'workspace.identity'
  | 'workspace.tools'
  | 'workspace.memory'
  | 'none'

export type JobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
export type ProposalStatus = 'pending' | 'approved' | 'rejected'

export interface ScanCandidate {
  id: string
  relativePath: string
  kind: CandidateKind
  target: CandidateTarget
  title: string
  preview: string
  bytes: number
  confidence: number
  reason: string
  selectedByDefault: boolean
  /** Full text kept server-side for the job; not always returned to client. */
  content?: string
}

export interface ScanResult {
  scanId: string
  sourceProfile: SourceProfile
  detectedProfile: SourceProfile
  rootPath: string
  /** Optional free-text guidance from the user about what to look for. */
  instructions: string | null
  candidates: ScanCandidate[]
  stats: {
    filesScanned: number
    filesSkipped: number
    totalBytes: number
  }
  warnings: string[]
}

export interface ImportJobSelection {
  candidateId: string
  /** Override target if user changed it in the wizard. */
  target?: CandidateTarget
}

export interface ImportJobStats {
  processed: number
  applied: number
  skipped: number
  proposals: number
  errors: number
  byKind: Record<string, number>
}

export interface ImportJob {
  id: string
  status: JobStatus
  sourceProfile: SourceProfile
  scanId: string
  /** Optional free-text guidance carried from the wizard into AI classify/transform. */
  instructions: string | null
  phase: string
  progress: number
  stats: ImportJobStats
  error: string | null
  createdAt: string
  updatedAt: string
  finishedAt: string | null
}

export interface WorkspaceProposal {
  id: string
  jobId: string
  agentId: string
  workspaceFile: string
  title: string
  proposedBody: string
  existingBody: string | null
  status: ProposalStatus
  createdAt: string
  resolvedAt: string | null
}

export interface ClassifyItem {
  id: string
  action: 'import' | 'skip'
  kind: CandidateKind
  target: CandidateTarget
  title: string | null
  confidence: number
  reason: string
  pii_risk: 'none' | 'possible' | 'likely'
}

export type ImportedNoteKind = 'user' | 'feedback' | 'domain' | 'project' | 'reference'

export interface MemoryTransformResult {
  skip?: boolean
  /** Vault frontmatter kind. Undeclared notes must be `reference`, never `user`. */
  kind: ImportedNoteKind
  title: string
  body: string
  tags: string[]
  links: string[]
  salience: number
  summary_one_line: string
}

export interface SkillTransformResult {
  name: string
  description: string
  trigger_patterns: string[]
  capabilities: string[]
  content: string
  skill_type: 'knowledge' | 'tool' | 'integration'
}

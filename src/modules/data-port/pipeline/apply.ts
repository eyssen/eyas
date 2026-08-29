// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { generateId } from '@shared/crypto'
import { OWN_SKILLS_CATEGORY, IMPORT_TAGS } from '../constants.js'
import type {
  CandidateTarget,
  MemoryTransformResult,
  SkillTransformResult,
  SourceProfile,
} from '../types.js'

export interface ApplyDeps {
  episodic?: {
    create: (input: {
      content: string
      sourceType: 'system' | 'extraction' | 'user' | 'conversation'
      sourceId?: string
      tags?: string[]
    }) => { id: string }
  }
  vault?: {
    write: (path: string, frontmatter: Record<string, unknown>, content: string) => void
    exists: (path: string) => boolean
  }
  indexer?: { indexAll: () => number }
  skills?: {
    create: (input: {
      name: string
      description?: string
      category?: string
      triggerPatterns?: string[]
      capabilities?: string[]
      content: string
      skillType?: 'knowledge' | 'tool' | 'integration'
    }) => { id: string }
  }
  createProposal: (input: {
    jobId: string
    agentId: string
    workspaceFile: string
    title: string
    proposedBody: string
    existingBody: string | null
  }) => string
  readWorkspaceFile?: (agentId: string, file: string) => string | null
  resolveDefaultAgentId: () => string | null
  logger?: { info?: (o: unknown, m?: string) => void; warn?: (o: unknown, m?: string) => void }
}

function slugify(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || generateId().slice(0, 8)
}

function baseTags(sourceProfile: SourceProfile, jobId: string): string[] {
  return [
    IMPORT_TAGS.imported,
    `${IMPORT_TAGS.sourcePrefix}${sourceProfile}`,
    `${IMPORT_TAGS.jobPrefix}${jobId}`,
  ]
}

function workspaceFileForTarget(target: CandidateTarget): string | null {
  switch (target) {
    case 'workspace.agents':
      return 'AGENTS.md'
    case 'workspace.soul':
      return 'SOUL.md'
    case 'workspace.identity':
      return 'IDENTITY.md'
    case 'workspace.tools':
      return 'TOOLS.md'
    case 'workspace.memory':
      return 'MEMORY.md'
    default:
      return null
  }
}

export type ApplyResult =
  | { status: 'applied'; kind: string; ref: string }
  | { status: 'proposal'; proposalId: string; workspaceFile: string }
  | { status: 'skipped'; reason: string }
  | { status: 'error'; error: string }

export async function applyMemoryItem(
  deps: ApplyDeps,
  input: {
    jobId: string
    sourceProfile: SourceProfile
    target: CandidateTarget
    transformed: MemoryTransformResult
  },
): Promise<ApplyResult> {
  const tags = [...baseTags(input.sourceProfile, input.jobId), ...input.transformed.tags]
  const uniqueTags = [...new Set(tags.map((t) => t.trim()).filter(Boolean))]

  try {
    if (input.target === 'episodic') {
      if (!deps.episodic) return { status: 'skipped', reason: 'episodic service unavailable' }
      const mem = deps.episodic.create({
        content: input.transformed.body,
        sourceType: 'system',
        sourceId: `import:${input.jobId}`,
        tags: uniqueTags,
      })
      return { status: 'applied', kind: 'episodic', ref: mem.id }
    }

    if (input.target === 'vault.semantic' || input.target === 'vault.procedural') {
      if (!deps.vault) return { status: 'skipped', reason: 'vault service unavailable' }
      const tier = input.target === 'vault.procedural' ? 'procedural' : 'semantic'
      const slug = slugify(input.transformed.title)
      let path = `${tier}/${slug}.md`
      if (deps.vault.exists(path)) {
        path = `${tier}/${slug}-${generateId().slice(0, 6)}.md`
      }
      const now = new Date().toISOString().slice(0, 10)
      deps.vault.write(
        path,
        {
          title: input.transformed.title,
          tags: uniqueTags,
          tier,
          links: input.transformed.links,
          created: now,
          updated: now,
        },
        input.transformed.body,
      )
      deps.indexer?.indexAll()
      return { status: 'applied', kind: `vault.${tier}`, ref: path }
    }

    return { status: 'skipped', reason: `unsupported memory target: ${input.target}` }
  } catch (err) {
    return { status: 'error', error: err instanceof Error ? err.message : String(err) }
  }
}

export async function applySkillItem(
  deps: ApplyDeps,
  input: {
    jobId: string
    sourceProfile: SourceProfile
    transformed: SkillTransformResult
  },
): Promise<ApplyResult> {
  if (!deps.skills) return { status: 'skipped', reason: 'skills service unavailable' }
  try {
    const skill = deps.skills.create({
      name: input.transformed.name,
      description: input.transformed.description,
      category: OWN_SKILLS_CATEGORY,
      triggerPatterns: input.transformed.trigger_patterns,
      capabilities: [
        ...input.transformed.capabilities,
        ...baseTags(input.sourceProfile, input.jobId),
      ],
      content: input.transformed.content,
      skillType: input.transformed.skill_type,
    })
    return { status: 'applied', kind: 'skill', ref: skill.id }
  } catch (err) {
    return { status: 'error', error: err instanceof Error ? err.message : String(err) }
  }
}

/** Workspace changes are always proposals — never direct merge. */
export async function applyWorkspaceProposal(
  deps: ApplyDeps,
  input: {
    jobId: string
    target: CandidateTarget
    title: string
    body: string
  },
): Promise<ApplyResult> {
  const file = workspaceFileForTarget(input.target)
  if (!file) return { status: 'skipped', reason: `not a workspace target: ${input.target}` }

  const agentId = deps.resolveDefaultAgentId()
  if (!agentId) return { status: 'skipped', reason: 'no agent available for workspace proposal' }

  try {
    const existing = deps.readWorkspaceFile?.(agentId, file) ?? null
    const proposalId = deps.createProposal({
      jobId: input.jobId,
      agentId,
      workspaceFile: file,
      title: input.title,
      proposedBody: input.body,
      existingBody: existing,
    })
    return { status: 'proposal', proposalId, workspaceFile: file }
  } catch (err) {
    return { status: 'error', error: err instanceof Error ? err.message : String(err) }
  }
}

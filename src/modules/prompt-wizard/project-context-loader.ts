// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { projectAgentsPath, projectTypeAgentsPath } from './workspace-paths.js'
import { stripFrontmatter } from './frontmatter.js'
import { resolvePromptSources } from '@modules/board/services/prompt-service.js'

export interface ProjectContextLoaderDeps {
  dataDir: string
  resolveProjectType: (projectId: string) => Promise<{ id: string } | null>
  /** DB `projects.prompt`. Non-empty wins over a sibling AGENTS.md. */
  resolveProjectPrompt?: (projectId: string) => Promise<string | null>
  /** DB `project_types.prompt`. Non-empty wins over a sibling AGENTS.md. */
  resolveTypePrompt?: (typeId: string) => Promise<string | null>
}

export interface CascadeRequest {
  projectId?: string | null
}

export interface CascadeResult {
  projectTypeAgents: string | null
  projectAgents: string | null
  projectTypeId: string | null
  projectId: string | null
}

const PROJECT_CASCADE_TOTAL_CAP = 3000  // tokens approximated as char/4
const APPROX_TOKEN_CHARS = 4

function clip(content: string, maxChars: number): { content: string; truncated: boolean } {
  if (content.length <= maxChars) return { content, truncated: false }
  return { content: content.slice(0, maxChars) + '\n\n[truncated — cascade budget]', truncated: true }
}

export function createProjectContextLoader(deps: ProjectContextLoaderDeps) {
  async function readIfExists(path: string): Promise<string | null> {
    if (!existsSync(path)) return null
    const buf = await readFile(path, 'utf8')
    return stripFrontmatter(buf)
  }

  function firstNonEmpty(...values: Array<string | null | undefined>): string | null {
    for (const v of values) {
      if (v != null && v.trim() !== '') return v
    }
    return null
  }

  async function cascade(req: CascadeRequest): Promise<CascadeResult> {
    if (!req.projectId) return { projectTypeAgents: null, projectAgents: null, projectTypeId: null, projectId: null }
    const type = await deps.resolveProjectType(req.projectId)
    const fileProject = await readIfExists(projectAgentsPath(req.projectId, deps.dataDir))
    const fileType = type ? await readIfExists(projectTypeAgentsPath(type.id, deps.dataDir)) : null
    const dbProject = deps.resolveProjectPrompt ? await deps.resolveProjectPrompt(req.projectId) : null
    const dbType = type && deps.resolveTypePrompt ? await deps.resolveTypePrompt(type.id) : null

    const sources = resolvePromptSources(
      firstNonEmpty(dbType, fileType) ?? undefined,
      firstNonEmpty(dbProject, fileProject) ?? undefined,
    )
    const projectTypeAgents = sources.type
    const projectAgents = sources.project

    // Apply combined cap: project-type first to truncate (lower priority)
    const totalChars = (projectTypeAgents?.length ?? 0) + (projectAgents?.length ?? 0)
    const capChars = PROJECT_CASCADE_TOTAL_CAP * APPROX_TOKEN_CHARS
    let typeOut = projectTypeAgents
    let projOut = projectAgents
    if (totalChars > capChars) {
      // Truncate type-level first; agent-level is most specific
      const remaining = Math.max(0, capChars - (projectAgents?.length ?? 0))
      typeOut = projectTypeAgents ? clip(projectTypeAgents, remaining).content : null
    }
    return { projectTypeAgents: typeOut, projectAgents: projOut, projectTypeId: type?.id ?? null, projectId: req.projectId }
  }

  return { cascade }
}

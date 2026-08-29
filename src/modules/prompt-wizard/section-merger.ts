// Part of eYssen. See LICENSE file for full copyright and licensing details.

export interface MasterSections {
  identity: string
  coreRules: string
  personality: string
}

export interface LevelSections {
  identity?: string
  coreRules?: string
  personality?: string
  domainContext?: string
  projectContext?: string
  taskInstructions?: string
}

export interface MergeInput {
  master: MasterSections
  projectType: LevelSections
  project: LevelSections
  conversation: LevelSections
  lockedSections: string[]
}

export type ResolvedLevel = 'master' | 'project_type' | 'project' | 'conversation' | null

export interface MergeResult {
  identity: string
  coreRules: string
  personality: string
  domainContext?: string
  projectContext?: string
  taskInstructions?: string
  resolvedFrom: {
    identity: ResolvedLevel
    coreRules: ResolvedLevel
    personality: ResolvedLevel
    domainContext: ResolvedLevel
    projectContext: ResolvedLevel
    taskInstructions: ResolvedLevel
  }
}

/**
 * Apply a child level to a parent value.
 * - Empty/undefined child → inherit parent
 * - "+" prefix → extend parent (newline-separated)
 * - Otherwise → replace parent
 */
export function applyLevel(parent: string, child: string | undefined): string {
  if (!child || child.trim() === '') return parent.trim()
  const trimmed = child.trim()
  if (trimmed.startsWith('+')) {
    const extension = trimmed.slice(1).trim()
    const parentTrimmed = parent.trim()
    return parentTrimmed ? `${parentTrimmed}\n${extension}` : extension
  }
  return trimmed
}

/**
 * Merge prompt sections across all hierarchy levels with locked section enforcement.
 *
 * Cascade rules:
 * - identity, coreRules: cascade through all levels via applyLevel
 * - personality: lowest non-empty wins (project > project_type > master)
 * - domainContext: sourced from projectType only
 * - projectContext: sourced from project only
 * - taskInstructions: sourced from conversation only
 * - Locked sections always retain the master value
 */
export function mergeSections(input: MergeInput): MergeResult {
  const { master, projectType, project, conversation, lockedSections } = input
  const locked = new Set(lockedSections)

  // --- identity: cascade through levels ---
  let identity = master.identity
  let identityFrom: ResolvedLevel = 'master'

  if (!locked.has('identity')) {
    if (projectType.identity && projectType.identity.trim()) {
      identity = applyLevel(identity, projectType.identity)
      identityFrom = 'project_type'
    }
    if (project.identity && project.identity.trim()) {
      identity = applyLevel(identity, project.identity)
      identityFrom = 'project'
    }
    if (conversation.identity && conversation.identity.trim()) {
      identity = applyLevel(identity, conversation.identity)
      identityFrom = 'conversation'
    }
  }

  // --- coreRules: cascade through levels ---
  let coreRules = master.coreRules
  let coreRulesFrom: ResolvedLevel = 'master'

  if (!locked.has('coreRules')) {
    if (projectType.coreRules && projectType.coreRules.trim()) {
      coreRules = applyLevel(coreRules, projectType.coreRules)
      coreRulesFrom = 'project_type'
    }
    if (project.coreRules && project.coreRules.trim()) {
      coreRules = applyLevel(coreRules, project.coreRules)
      coreRulesFrom = 'project'
    }
    if (conversation.coreRules && conversation.coreRules.trim()) {
      coreRules = applyLevel(coreRules, conversation.coreRules)
      coreRulesFrom = 'conversation'
    }
  }

  // --- personality: lowest non-empty wins ---
  let personality = master.personality
  let personalityFrom: ResolvedLevel = 'master'

  if (!locked.has('personality')) {
    if (projectType.personality && projectType.personality.trim()) {
      personality = projectType.personality.trim()
      personalityFrom = 'project_type'
    }
    if (project.personality && project.personality.trim()) {
      personality = project.personality.trim()
      personalityFrom = 'project'
    }
  }

  // --- domainContext: from projectType only ---
  let domainContext: string | undefined
  let domainContextFrom: ResolvedLevel = null
  if (projectType.domainContext && projectType.domainContext.trim()) {
    domainContext = projectType.domainContext.trim()
    domainContextFrom = 'project_type'
  }

  // --- projectContext: from project only ---
  let projectContext: string | undefined
  let projectContextFrom: ResolvedLevel = null
  if (project.projectContext && project.projectContext.trim()) {
    projectContext = project.projectContext.trim()
    projectContextFrom = 'project'
  }

  // --- taskInstructions: from conversation only ---
  let taskInstructions: string | undefined
  let taskInstructionsFrom: ResolvedLevel = null
  if (conversation.taskInstructions && conversation.taskInstructions.trim()) {
    taskInstructions = conversation.taskInstructions.trim()
    taskInstructionsFrom = 'conversation'
  }

  return {
    identity,
    coreRules,
    personality,
    ...(domainContext !== undefined && { domainContext }),
    ...(projectContext !== undefined && { projectContext }),
    ...(taskInstructions !== undefined && { taskInstructions }),
    resolvedFrom: {
      identity: identityFrom,
      coreRules: coreRulesFrom,
      personality: personalityFrom,
      domainContext: domainContextFrom,
      projectContext: projectContextFrom,
      taskInstructions: taskInstructionsFrom,
    },
  }
}

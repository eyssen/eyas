// Part of eYssen. See LICENSE file for full copyright and licensing details.

export interface PromptSources {
  type: string | null
  project: string | null
}

/**
 * Split type + project prompts into the two prefix sources.
 * Empty/null project = inherit type. "+" prefix = keep type and the extension.
 * Anything else = override (type dropped).
 */
export function resolvePromptSources(
  typePrompt: string | undefined,
  projectPrompt: string | undefined,
): PromptSources {
  const type = typePrompt?.trim() || null
  const child = projectPrompt?.trim()
  if (!child) return { type, project: null }
  if (child.startsWith('+')) {
    const extension = child.slice(1).trim()
    return { type, project: extension || null }
  }
  return { type: null, project: child }
}

/**
 * Resolve prompt inheritance: ProjectType → Project → Conversation.
 * Empty/null = inherit parent. "+" prefix = extend parent. Other = override.
 */
export function resolvePromptChain(
  typePrompt: string | undefined,
  projectPrompt: string | undefined,
  conversationPrompt: string | undefined,
): string {
  const { type, project } = resolvePromptSources(typePrompt, projectPrompt)
  const mid = [type, project].filter(Boolean).join('\n')
  return applyLevel(mid, conversationPrompt)
}

function applyLevel(parent: string, child: string | undefined): string {
  if (!child || child.trim() === '') return parent
  const trimmed = child.trim()
  if (trimmed.startsWith('+')) {
    const extension = trimmed.slice(1).trim()
    return parent ? `${parent}\n${extension}` : extension
  }
  return trimmed
}

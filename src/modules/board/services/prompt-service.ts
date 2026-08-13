// Part of eYssen. See LICENSE file for full copyright and licensing details.

/**
 * Resolve prompt inheritance: ProjectType → Project → Conversation.
 * Empty/null = inherit parent. "+" prefix = extend parent. Other = override.
 */
export function resolvePromptChain(
  typePrompt: string | undefined,
  projectPrompt: string | undefined,
  conversationPrompt: string | undefined,
): string {
  const base = typePrompt?.trim() || ''
  const mid = applyLevel(base, projectPrompt)
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

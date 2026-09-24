// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { PromptChainInput } from './types.js'

/**
 * Assembles a prompt chain from multiple levels using XML-like sections.
 * Hierarchy: master -> project-type -> project -> conversation
 * Each level wraps its content in a semantic tag for model clarity.
 */
export function buildPromptChain(input: PromptChainInput): string {
  const sections: string[] = []

  if (input.master) {
    sections.push(`<system-identity>\n${input.master}\n</system-identity>`)
  }

  if (input.projectType) {
    sections.push(`<project-type-context>\n${input.projectType}\n</project-type-context>`)
  }

  if (input.project) {
    sections.push(`<project-context>\n${input.project}\n</project-context>`)
  }

  if (input.conversation) {
    sections.push(`<task-instructions>\n${input.conversation}\n</task-instructions>`)
  }

  return sections.join('\n\n')
}

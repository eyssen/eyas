// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { DetectedPattern } from './types.js'

function toSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 50)
}

/**
 * Generates a SKILL.md-style content string from a detected pattern.
 */
export function composeSkillContent(pattern: DetectedPattern): string {
  const slug = toSlug(pattern.title)
  const triggers = [
    pattern.title.toLowerCase(),
    ...pattern.title
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 3)
      .map((w) => `*${w}*`),
  ]
    .slice(0, 5)
    .map((t) => `  - "${t}"`)
    .join('\n')

  return `---
id: auto-${slug}
name: ${pattern.title}
description: Auto-generated skill based on ${pattern.occurrences} recurring sessions
triggers:
${triggers}
confidence: ${pattern.confidence.toFixed(2)}
auto_generated: true
---

# ${pattern.title}

## When to Use

Use this skill when the task involves: **${pattern.title}**.

This pattern was detected in ${pattern.occurrences} sessions (avg ${pattern.avgTokens} tokens each).

## Procedure

1. Identify the specific goal within "${pattern.title}"
2. Gather required context and inputs
3. Execute the standard workflow for this task type
4. Verify output meets expected criteria
5. Report results clearly

## Notes

- Auto-generated from session analysis — review and refine before heavy reliance
- Based on ${pattern.occurrences} observed sessions
- Average token usage: ${pattern.avgTokens} tokens/session
- Sample sessions: ${pattern.sampleConversationIds.slice(0, 3).join(', ')}
`
}

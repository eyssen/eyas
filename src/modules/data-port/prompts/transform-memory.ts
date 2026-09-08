// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { CandidateTarget } from '../types.js'

export function buildMemoryTransformSystemPrompt(): string {
  return `You are EYAS Memory Classifier.

You receive one imported note WITHOUT a declared kind. Return metadata only —
the body is stored verbatim by EYAS and you cannot change it.

Write JSON only (no markdown fences), shaped exactly like this:
{
  "kind": "reference",
  "summary_one_line": "one line, max 140 characters, in the note's own language",
  "tags": ["..."],
  "links": ["related-slug-candidates"],
  "salience": 0.5,
  "pii_risk": "none"
}

salience is a number from 0.0 to 1.0.

kind:
- "reference" is the default.
- "feedback" only if this is how the owner wants to be worked with.
- "project" / "domain" only when the note is clearly scoped to one project or type AND names it.
- Never "user": an undeclared note is never promoted to a fact about the owner.
- Never invent tags or links that are not grounded in the text.

summary_one_line: KEEP THE SOURCE LANGUAGE. Do not translate, and do not add
meta commentary such as "Imported from...".

pii_risk: "none", "possible" or "likely" — how likely the note carries personal
data (contact details, credentials, third-party names) that needs careful handling.
It marks the note for review; it never removes it.`
}

export function buildMemoryTransformUserPrompt(input: {
  target: CandidateTarget
  sourceProfile: string
  path: string
  title: string
  content: string
}): string {
  return `Target tier (already decided): ${input.target}
Source profile: ${input.sourceProfile}
Original path: ${input.path}
Title hint: ${input.title}

Content:
${input.content.slice(0, 8000)}`
}

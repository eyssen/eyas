// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { CandidateTarget } from '../types.js'

export function buildMemoryTransformSystemPrompt(): string {
  return `You are EYAS Memory Normalizer.

Convert one imported memory chunk into EYAS multi-tier format.

Write JSON only (no markdown fences):
{
  "title": "string",
  "body": "markdown body, concise, atomic if possible",
  "tags": ["..."],
  "links": ["related-slug-candidates"],
  "salience": 0.0-1.0,
  "summary_one_line": "..."
}

Rules for body:
- Atomic: one concept per note when possible.
- KEEP THE SOURCE LANGUAGE. Do not translate. Personal names and facts stay as written.
- Strip tool-call noise, path noise, and irrelevant timestamps unless essential.
- Keep decisions, constraints, preferences, proper names, IDs the user cares about.
- Use [[wikilink]] candidates only when a clear related concept name exists.
- Do NOT add greetings, meta commentary, or "Imported from...".
- Do NOT fabricate links or tags not grounded in content.
- Max ~400 words; if longer, summarize while preserving concrete facts.`
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

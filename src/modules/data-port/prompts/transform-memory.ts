// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { CandidateTarget } from '../types.js'

export function buildMemoryTransformSystemPrompt(): string {
  return `You are EYAS Memory Normalizer.

Convert one imported memory chunk into EYAS multi-tier format.
The source may be a home-directory dump: indexes, user-guides, and third-party
docs will still reach you. Refuse those.

Write JSON only (no markdown fences):
{
  "skip": false,
  "kind": "reference",
  "title": "string",
  "body": "markdown body, concise, atomic if possible",
  "tags": ["..."],
  "links": ["related-slug-candidates"],
  "salience": 0.0-1.0,
  "summary_one_line": "..."
}

kind (required):
- "reference" is the default for any undeclared or third-party fact.
- "feedback" only if this is how the owner wants to be worked with.
- "user" only if this is a durable fact about who the owner is. Most notes are
  NOT kind user. A MEMORY.md index, a product guide, or a repo README is never user.
- "project" / "domain" only when the note is clearly scoped to one project or type
  AND names it. Otherwise reference.
- Never invent kind user to make the note rank higher.

skip:
- true when the chunk is a MEMORY.md / one-line wikilink index, robots.txt,
  LICENSE, user-guide, or third-party source documentation. Then body may be "".

Rules for body:
- Atomic: one concept per note when possible.
- KEEP THE SOURCE LANGUAGE. Do not translate. Personal names and facts stay as written.
- Strip tool-call noise, path noise, and irrelevant timestamps unless essential.
- Keep decisions, constraints, preferences, proper names, IDs the user cares about.
- Use [[wikilink]] candidates only when a clear related concept name exists.
- Do NOT add greetings, meta commentary, or "Imported from...".
- Do NOT fabricate links or tags not grounded in content.
- Do NOT explode an index file into many notes here — skip it.
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

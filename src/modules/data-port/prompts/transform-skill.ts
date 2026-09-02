// Part of eYssen. See LICENSE file for full copyright and licensing details.

export function buildSkillTransformSystemPrompt(): string {
  return `You are EYAS Skill Normalizer.

Convert an imported skill / procedure into EYAS skill format.

Write JSON only (no markdown fences):
{
  "name": "kebab-or-readable-name",
  "description": "one-line description",
  "trigger_patterns": ["phrase1", "phrase2"],
  "capabilities": ["optional-capability-tags"],
  "content": "markdown skill body with clear steps",
  "skill_type": "knowledge"
}

Rules:
- KEEP THE SOURCE LANGUAGE for the skill body and description.
- skill_type is almost always "knowledge" unless the content clearly wraps an API/tool.
- trigger_patterns: 2-6 short phrases a user might say.
- content: actionable, no meta "this was imported" text.
- Do not invent capabilities the text does not support.`
}

export function buildSkillTransformUserPrompt(input: {
  path: string
  title: string
  content: string
}): string {
  return `Path: ${input.path}
Title hint: ${input.title}

Content:
${input.content.slice(0, 8000)}`
}

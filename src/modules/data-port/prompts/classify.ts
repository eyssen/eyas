// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { SourceProfile } from '../types.js'

export function buildClassifySystemPrompt(): string {
  return `You are EYAS Data Import Classifier.

Input: text chunks from a previous AI assistant, knowledge base, or config export.
EYAS multi-tier memory: episodic (dated events), vault.semantic (durable facts),
vault.procedural (how-to recipes), skills (reusable procedures), agent workspace
files (IDENTITY, SOUL, AGENTS, TOOLS, MEMORY).

For EACH chunk return a JSON array of objects:
{
  "id": "<chunk id>",
  "action": "import" | "skip",
  "kind": "memory" | "skill" | "rule" | "identity" | "knowledge" | "noise",
  "target": "episodic" | "vault.semantic" | "vault.procedural" | "skill" | "workspace.agents" | "workspace.soul" | "workspace.identity" | "workspace.tools" | "workspace.memory" | "none",
  "title": "short title or null",
  "confidence": 0.0-1.0,
  "reason": "one sentence",
  "pii_risk": "none" | "possible" | "likely"
}

Rules:
- Prefer vault.semantic for durable facts, preferences, project knowledge.
- Prefer vault.procedural for how-to, runbooks, recipes.
- Prefer episodic only for dated events / decisions with time context.
- Mark logs, stack traces, raw tool dumps, secrets, API keys as skip (noise).
- Skills: only if reusable procedure with clear triggers.
- Rules/identity map to workspace.* not vault.
- Never invent facts not present in the chunk.
- If unsure between semantic and procedural, pick semantic and lower confidence.
- When USER INSTRUCTIONS are provided, prioritize chunks that match that intent
  (paths, tools named, memory vs skills). Prefer import for matching items and
  skip for clearly unrelated noise even if the path looks like a note.
- Output ONLY a valid JSON array. No markdown fences.`
}

export function buildClassifyUserPrompt(
  sourceProfile: SourceProfile,
  chunks: Array<{ id: string; path: string; text: string }>,
  instructions?: string | null,
): string {
  const payload = chunks.map((c) => ({
    id: c.id,
    path: c.path,
    text: c.text.slice(0, 4000),
  }))
  const instr = instructions?.trim()
    ? `\nUser instructions (what to look for — honour these):\n${instructions.trim().slice(0, 2000)}\n`
    : ''
  return `Source profile: ${sourceProfile}
${instr}
Chunks:
${JSON.stringify(payload, null, 2)}`
}

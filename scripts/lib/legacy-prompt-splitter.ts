// Part of eYssen. See LICENSE file for full copyright and licensing details.
import type { ModelProvider, ContentBlock } from '../../src/modules/model/types.js'

export interface LegacyAgentMeta {
  id: string
  name: string
  role: string | null
  goal: string | null
  backstory: string | null
  tier: string
}

export interface SplitResult {
  identityMission: string
  identityProactiveDuties: string
  identityEscalation: string
  agentsRules: string
  confidence: 'high' | 'medium' | 'low'
}

const SPLIT_INSTRUCTION = `You are migrating a legacy agent definition. Given the agent's metadata and a freeform systemPrompt, split it into:
- identityMission: a 2-4 sentence summary of why this agent exists
- identityProactiveDuties: bullet list of recurring or scheduled responsibilities (or "(none defined)" if not present)
- identityEscalation: when to escalate vs handle silently (or "(none defined)")
- agentsRules: any custom operational rules or workflow instructions

Return ONLY a JSON object with those four fields plus a "confidence" field ('high' | 'medium' | 'low').`

export async function splitLegacySystemPrompt(
  legacy: string,
  meta: LegacyAgentMeta,
  model: ModelProvider,
  modelId: string,
): Promise<SplitResult> {
  if (!legacy.trim()) {
    return {
      identityMission: meta.goal ?? meta.role ?? 'Migrated agent — please review and define mission',
      identityProactiveDuties: '(none defined)',
      identityEscalation: '(none defined)',
      agentsRules: '',
      confidence: 'low',
    }
  }
  const response = await model.send({
    systemPrompt: {
      prefix: SPLIT_INSTRUCTION,
      suffix: '',
      reminders: [],
      cacheBoundaryHint: 0,
      prefixHash: '',
      tokenEstimate: { prefix: 0, suffix: 0, reminders: 0 },
      // One-off migration script call, off the live assembly path — no section manifest.
      sections: [],
    },
    messages: [{ role: 'user', content: `Agent metadata:\n${JSON.stringify(meta, null, 2)}\n\nLegacy systemPrompt:\n${legacy}` }],
    modelId,
  })
  const text = textFromContent(response.content)
  try {
    return JSON.parse(extractJsonBlock(text)) as SplitResult
  } catch {
    return {
      identityMission: meta.goal ?? meta.role ?? 'Migrated from legacy',
      identityProactiveDuties: '(see legacy rules below)',
      identityEscalation: '(see legacy rules below)',
      agentsRules: `## Legacy Rules\n\n${legacy}`,
      confidence: 'low',
    }
  }
}

function textFromContent(content: ContentBlock[]): string {
  return content
    .filter((b): b is Extract<ContentBlock, { type: 'text' }> => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
}

function extractJsonBlock(s: string): string {
  const fenced = s.match(/```json\s*([\s\S]*?)```/)
  if (fenced) return fenced[1]
  const obj = s.match(/\{[\s\S]*\}/)
  if (obj) return obj[0]
  return s
}

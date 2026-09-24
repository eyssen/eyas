// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// LM Studio keeps each model's reasoning setting itself, and EYAS never sends
// one to it. What LM Studio reports (GET /api/v1/models capabilities.reasoning,
// stored as metadata.runtimeReasoning) is shown here so the operator knows
// what runs; changing it happens in LM Studio.

import { t } from './i18n'

/** The reasoning setting a local runtime keeps for itself (display only). */
export interface RuntimeReasoningInfo {
  options: string[]
  default: string | null
}

interface ModelWithRuntimeReasoning {
  id: string
  name: string
  runtimeReasoning?: RuntimeReasoningInfo
}

/** One line per model that reports a default; nothing when none does. */
export function LmStudioReasoningHint({ models }: { models: ModelWithRuntimeReasoning[] }) {
  const reported = models.filter((m) => !!m.runtimeReasoning?.default)
  if (reported.length === 0) return null
  return (
    <ul className="space-y-1" data-testid="lmstudio-reasoning-hint">
      {reported.map((m) => (
        <li key={m.id} className="text-xs text-muted-foreground">
          <span className="font-mono text-[10px] text-foreground">{m.name}</span>{' '}
          {t('providers.panel.lmstudioReasoningHint', { default: m.runtimeReasoning!.default! })}
        </li>
      ))}
    </ul>
  )
}

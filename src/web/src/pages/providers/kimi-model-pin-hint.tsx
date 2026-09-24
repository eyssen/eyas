// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Kimi Code CLI takes no --model: EYAS selects the model and its thinking
// variant inside each ACP session (session/set_model), choosing from the model
// list it read from Kimi (discovery). Until that list has been read, EYAS can
// pin neither, and every Kimi turn runs the model Kimi itself is set to — the
// panel says so instead of leaving the operator to guess.

import { t } from './i18n'

interface KimiModelRow {
  /** The last successful discovery no longer offered this row. */
  missing?: boolean
  /** Effective reasoning capability as the API computes it; 'discovered'/'merged' when Kimi reported the model. */
  reasoning?: { source?: string } | null
}

/** True once EYAS has read Kimi's model list: a row the CLI still offers carries discovered facts. */
export function kimiModelsDiscovered(models: readonly KimiModelRow[]): boolean {
  return models.some((m) => !m.missing && (m.reasoning?.source === 'discovered' || m.reasoning?.source === 'merged'))
}

/** The disclosure, shown only while the model and thinking cannot be pinned. */
export function KimiModelPinHint({ models }: { models: readonly KimiModelRow[] }) {
  if (kimiModelsDiscovered(models)) return null
  return (
    <p className="text-xs text-muted-foreground" data-testid="kimi-model-unpinned">
      {t('providers.panel.kimiModelUnpinned')}
    </p>
  )
}

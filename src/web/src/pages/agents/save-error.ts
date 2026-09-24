// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// The localized text of a failed colleague save. EFFORT_UNSUPPORTED (the
// colleague's model does not offer the chosen effort rung) names the rungs it
// does offer; anything else keeps the server's text. The EffortSelect lists
// only the model's rungs and clamps on a model change, so this is the rare
// fallback (a catalog that changed between loading the page and saving).

import { ApiError } from '@/lib/api'
import { t } from './i18n'

export function agentSaveErrorText(err: unknown): string {
  if (err instanceof ApiError && err.code === 'EFFORT_UNSUPPORTED') {
    const d = err.details ?? {}
    const model = typeof d.modelId === 'string' ? d.modelId : ''
    const level = typeof d.level === 'string' ? d.level : ''
    const levels = Array.isArray(d.levels) ? d.levels.filter((l): l is string => typeof l === 'string') : []
    return levels.length === 0
      ? t('agents.detail.effortNoControl', { model })
      : t('agents.detail.effortUnsupported', { model, level, levels: levels.join(', ') })
  }
  const message = err instanceof Error ? err.message : String(err)
  return t('agents.detail.saveError', { message })
}

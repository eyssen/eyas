// Part of eYssen. See LICENSE file for full copyright and licensing details.
import type { FrontendManifest } from '@core/types'

export interface CatalogueEntry {
  id: string
  titleKey: string
  module: string
  available: boolean
  reason?: 'module_disabled' | 'forbidden'
}

/**
 * Unavailable widgets stay in the list (rendered dimmed in the drawer) so the
 * operator can see what the system COULD show if a module were enabled.
 * Disabled modules' widgets are listed with reason: 'module_disabled'.
 * CASL-denied widgets (from enabled modules) get reason: 'forbidden'.
 * If a widget's module is disabled, module_disabled takes precedence over any CASL denial.
 */
export function buildCatalogue(
  modules: Array<{ id: string; frontend?: FrontendManifest; enabled: boolean }>,
  can: (capability: string) => boolean,
): { widgets: CatalogueEntry[] } {
  const widgets: CatalogueEntry[] = []
  for (const mod of modules) {
    for (const w of mod.frontend?.widgets ?? []) {
      const moduleDisabled = !mod.enabled
      const caslDenied = w.capability && !can(w.capability)

      let available = true
      let reason: 'module_disabled' | 'forbidden' | undefined

      if (moduleDisabled) {
        available = false
        reason = 'module_disabled'
      } else if (caslDenied) {
        available = false
        reason = 'forbidden'
      }

      widgets.push({
        id: w.id,
        titleKey: w.titleKey,
        module: mod.id,
        available,
        ...(reason ? { reason } : {}),
      })
    }
  }
  return { widgets }
}

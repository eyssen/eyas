// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { cn } from '@/lib/utils'
import { t, tOr } from './i18n'

/** Mirrors the server's CatalogueEntry (home/catalogue.ts) — GET /home/widgets. */
export interface CatalogueEntry {
  id: string
  titleKey: string
  module: string
  available: boolean
  reason?: 'module_disabled' | 'forbidden'
}

interface WidgetDrawerProps {
  catalogue: CatalogueEntry[]
  /** Called with the catalogue entry's id when an available entry is activated. */
  onAdd: (widgetId: string) => void
}

/**
 * Edit-mode-only side panel listing every widget the catalogue knows about.
 * Entries from a disabled module or denied by CASL (`available: false`) stay
 * visible but dimmed and inert, per spec — the operator can see what the
 * system could show, not just what it currently does.
 */
export function WidgetDrawer({ catalogue, onAdd }: WidgetDrawerProps) {
  return (
    <aside data-testid="widget-drawer" className="glass-card w-64 shrink-0 p-4">
      <h2 className="text-sm font-semibold">{t('home.drawer.title')}</h2>
      <p className="mb-3 text-xs text-muted-foreground">{t('home.drawer.hint')}</p>
      <ul className="space-y-1">
        {catalogue.map((entry) => (
          <li key={entry.id}>
            <button
              type="button"
              data-testid={`drawer-widget-${entry.id}`}
              disabled={!entry.available}
              onClick={() => onAdd(entry.id)}
              className={cn(
                'w-full rounded px-2 py-1.5 text-left text-xs hover:bg-accent/40',
                !entry.available && 'cursor-not-allowed opacity-40 hover:bg-transparent',
              )}
            >
              {tOr(entry.titleKey, entry.id)}
              {!entry.available && (
                <span className="block text-[10px] text-muted-foreground">{t('home.drawer.unavailable')}</span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </aside>
  )
}

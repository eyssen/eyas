// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { useCallback, useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import {
  Bot,
  Brain,
  Circle,
  DatabaseBackup,
  FolderKanban,
  Globe,
  ListChecks,
  Sparkles,
  Wand2,
  X,
  Cpu,
  Radio,
} from 'lucide-react'
import { useApi } from '@/hooks/use-api'
import { Button } from '@/components/ui/button'
import { t } from './i18n'

const DISMISS_ALL_KEY = 'eyas-setup-rec-dismissed-all'
const DISMISS_ITEMS_KEY = 'eyas-setup-rec-dismissed-items'

type RecId =
  | 'models'
  | 'projects'
  | 'prompts'
  | 'agents'
  | 'channels'
  | 'search'
  | 'backup'
  | 'ingress'
  | 'autonomy'
  | 'memory'

interface SetupStatusItem {
  id: string
  done: boolean | null
}

function loadDismissedItems(): Set<string> {
  try {
    const raw = localStorage.getItem(DISMISS_ITEMS_KEY)
    if (!raw) return new Set()
    const arr = JSON.parse(raw) as string[]
    return new Set(Array.isArray(arr) ? arr : [])
  } catch {
    return new Set()
  }
}

function saveDismissedItems(ids: Set<string>) {
  localStorage.setItem(DISMISS_ITEMS_KEY, JSON.stringify([...ids]))
}

/**
 * Post-setup "configure the important things" checklist, rendered by
 * home-page.tsx as a fixed strip above the grid. Each row is driven by a
 * lightweight API probe so completed items disappear; dismiss is local-only
 * (localStorage).
 */
export default function SetupRecommendationsCard({
  'data-testid': testId,
}: {
  'data-testid'?: string
} = {}) {
  const [dismissedAll, setDismissedAll] = useState(
    () => localStorage.getItem(DISMISS_ALL_KEY) === '1',
  )
  const [dismissedItems, setDismissedItems] = useState<Set<string>>(loadDismissedItems)

  // Single cached aggregate replacing the ten separate per-check probes —
  // the server ports each check's original predicate logic (see
  // src/modules/home/routes.ts's buildSetupChecks). `done` stays a tri-state
  // (boolean | null) exactly as each useMemo above used to compute it: null
  // means "could not determine", which keeps the recommendation visible
  // (see the openRows filter below).
  const setupStatus = useApi<{ items: SetupStatusItem[] }>('/home/setup-status')

  const doneById = useMemo(() => {
    const map = new Map<string, boolean | null>()
    for (const item of setupStatus.data?.items ?? []) map.set(item.id, item.done)
    return map
  }, [setupStatus.data])

  const doneFor = useCallback(
    (id: RecId): boolean | null => {
      if (setupStatus.error || setupStatus.isLoading) return null
      return doneById.get(id) ?? null
    },
    [doneById, setupStatus.error, setupStatus.isLoading],
  )

  type Row = {
    id: RecId
    done: boolean | null
    href: string
    icon: typeof Cpu
    optional?: boolean
  }

  const rows: Row[] = useMemo(
    () => [
      { id: 'models', done: doneFor('models'), href: '/providers', icon: Cpu },
      { id: 'projects', done: doneFor('projects'), href: '/projects', icon: FolderKanban },
      { id: 'prompts', done: doneFor('prompts'), href: '/prompts', icon: Wand2 },
      { id: 'agents', done: doneFor('agents'), href: '/agents', icon: Bot },
      { id: 'channels', done: doneFor('channels'), href: '/communication', icon: Radio },
      { id: 'search', done: doneFor('search'), href: '/search-sources', icon: Brain },
      { id: 'memory', done: doneFor('memory'), href: '/memory', icon: Brain },
      { id: 'backup', done: doneFor('backup'), href: '/backup', icon: DatabaseBackup },
      { id: 'ingress', done: doneFor('ingress'), href: '/ingress', icon: Globe, optional: true },
      { id: 'autonomy', done: doneFor('autonomy'), href: '/settings', icon: Sparkles, optional: true },
    ],
    [doneFor],
  )

  const openRows = useMemo(
    () =>
      rows.filter((r) => {
        if (dismissedItems.has(r.id)) return false
        // Hide completed; keep unknown (null) as open so user still sees the recommendation
        if (r.done === true) return false
        return true
      }),
    [rows, dismissedItems],
  )

  const completedCount = rows.filter((r) => r.done === true).length
  const dismissedOpenCount = rows.filter(
    (r) => r.done !== true && dismissedItems.has(r.id),
  ).length
  const remainingCount = openRows.length
  const loading = setupStatus.isLoading

  const dismissAll = useCallback(() => {
    localStorage.setItem(DISMISS_ALL_KEY, '1')
    setDismissedAll(true)
  }, [])

  const dismissOne = useCallback((id: string) => {
    setDismissedItems((prev) => {
      const next = new Set(prev)
      next.add(id)
      saveDismissedItems(next)
      return next
    })
  }, [])

  if (dismissedAll) return null
  if (!loading && openRows.length === 0) return null

  return (
    <div data-testid={testId} className="glass-card p-4 relative mb-6">
      <button
        type="button"
        onClick={dismissAll}
        aria-label={t('home.setup.dismissAll')}
        className="absolute top-3 right-3 text-muted-foreground hover:text-foreground"
      >
        <X className="h-4 w-4" />
      </button>

      <h3 className="text-sm font-semibold mb-1 flex items-center gap-2 pr-6">
        <ListChecks className="h-4 w-4" /> {t('home.setup.title')}
      </h3>
      <p className="text-xs text-muted-foreground mb-3 pr-6">{t('home.setup.subtitle')}</p>

      {loading && openRows.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t('home.widget.loading')}</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {openRows.map((row) => {
            const Icon = row.icon
            return (
              <li
                key={row.id}
                className="flex items-center gap-2 rounded-lg bg-accent/25 hover:bg-accent/40 px-2.5 py-2 transition-colors"
              >
                <span className="text-muted-foreground shrink-0">
                  <Circle className="h-4 w-4" />
                </span>
                <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm leading-tight">
                    {t(`home.setup.item.${row.id}.title`)}
                    {row.optional && (
                      <span className="ml-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                        {t('home.setup.optional')}
                      </span>
                    )}
                  </p>
                  <p className="text-[11px] text-muted-foreground leading-snug">
                    {t(`home.setup.item.${row.id}.body`)}
                  </p>
                </div>
                <Link to={row.href as '/settings'}>
                  <Button size="sm" variant="outline" className="h-7 text-xs shrink-0">
                    {t('home.setup.configure')}
                  </Button>
                </Link>
                <button
                  type="button"
                  onClick={() => dismissOne(row.id)}
                  className="text-muted-foreground hover:text-foreground p-1 shrink-0"
                  aria-label={t('home.setup.dismissItem')}
                  title={t('home.setup.dismissItem')}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </li>
            )
          })}
        </ul>
      )}

      <p className="text-[10px] text-muted-foreground mt-3">
        {dismissedOpenCount > 0
          ? t('home.setup.progressWithHidden', {
              remaining: String(remainingCount),
              done: String(completedCount),
              total: String(rows.length),
              hidden: String(dismissedOpenCount),
            })
          : t('home.setup.progress', {
              remaining: String(remainingCount),
              done: String(completedCount),
              total: String(rows.length),
            })}
      </p>
    </div>
  )
}

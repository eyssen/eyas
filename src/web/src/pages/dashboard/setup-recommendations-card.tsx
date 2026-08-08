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

interface ProviderRow {
  id: string
  enabled?: boolean
  active?: boolean
  hasApiKey?: boolean | null
  enabledModelCount?: number
  modelCount?: number
}

interface ProjectRow {
  id: string
  name?: string
}

interface PromptTemplate {
  id: string
  level?: string
}

interface AgentRow {
  id: string
  enabled?: boolean
}

interface SearchSource {
  id: string
  path?: string
  enabled?: boolean
}

interface BackupItem {
  id: string
}

interface FeatureFlag {
  key: string
  enabled: boolean
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
 * Post-setup "configure the important things" checklist on the Home dashboard.
 * Each row is driven by a lightweight API probe so completed items disappear;
 * dismiss is local-only (localStorage).
 */
export default function SetupRecommendationsCard() {
  const [dismissedAll, setDismissedAll] = useState(
    () => localStorage.getItem(DISMISS_ALL_KEY) === '1',
  )
  const [dismissedItems, setDismissedItems] = useState<Set<string>>(loadDismissedItems)

  const providers = useApi<{ providers: ProviderRow[] }>('/model/providers')
  const projects = useApi<{ projects: ProjectRow[] }>('/projects')
  const prompts = useApi<{ templates?: PromptTemplate[]; prompts?: PromptTemplate[] }>('/prompts')
  const agents = useApi<{ agents: AgentRow[] }>('/agents')
  const sources = useApi<{ sources: SearchSource[] }>('/search/sources')
  const backups = useApi<{ backups: BackupItem[] }>('/backup/list')
  const ingress = useApi<{ status?: string; running?: boolean; enabled?: boolean }>('/ingress/status')
  const features = useApi<{ features: FeatureFlag[] }>('/autonomy/features')
  const vault = useApi<{ files?: unknown[]; entries?: unknown[]; path?: string }>('/memory/vault')
  const commSetup = useApi<{
    ready?: boolean
    connectedCount?: number
    boundConnectedCount?: number
  }>('/communication/setup/status')

  const modelsDone = useMemo(() => {
    const list = providers.data?.providers ?? []
    if (providers.error || providers.isLoading) return null
    // At least one active provider with models (or API key where required)
    return list.some((p) => {
      if (p.active === true || p.enabled === true) {
        if (p.hasApiKey === false) return false
        return (p.enabledModelCount ?? p.modelCount ?? 0) > 0 || p.hasApiKey === true || p.hasApiKey === null
      }
      return false
    })
  }, [providers.data, providers.error, providers.isLoading])

  const projectsDone = useMemo(() => {
    if (projects.error || projects.isLoading) return null
    return (projects.data?.projects?.length ?? 0) > 0
  }, [projects.data, projects.error, projects.isLoading])

  const promptsDone = useMemo(() => {
    if (prompts.error || prompts.isLoading) return null
    const templates = prompts.data?.templates ?? prompts.data?.prompts ?? []
    // Seeded master prompts count as a baseline; still recommend review if only defaults
    return templates.length > 0
  }, [prompts.data, prompts.error, prompts.isLoading])

  const agentsDone = useMemo(() => {
    if (agents.error || agents.isLoading) return null
    return (agents.data?.agents?.length ?? 0) > 0
  }, [agents.data, agents.error, agents.isLoading])

  const searchDone = useMemo(() => {
    if (sources.error || sources.isLoading) return null
    return (sources.data?.sources?.length ?? 0) > 0
  }, [sources.data, sources.error, sources.isLoading])

  const backupDone = useMemo(() => {
    if (backups.error || backups.isLoading) return null
    return (backups.data?.backups?.length ?? 0) > 0
  }, [backups.data, backups.error, backups.isLoading])

  const ingressDone = useMemo(() => {
    if (ingress.error || ingress.isLoading) return null
    const s = ingress.data
    if (!s) return false
    if (s.running === true || s.enabled === true) return true
    if (typeof s.status === 'string' && /run|active|up|connected/i.test(s.status)) return true
    // Ingress is optional — if we got a status object, treat "configured once" lightly
    return false
  }, [ingress.data, ingress.error, ingress.isLoading])

  const autonomyDone = useMemo(() => {
    if (features.error || features.isLoading) return null
    const list = features.data?.features ?? []
    // Autonomy is opt-in: "done" only when user enabled at least one, OR we never force it
    // Show as recommended until dismissed; mark done if any loop is on.
    return list.some((f) => f.enabled)
  }, [features.data, features.error, features.isLoading])

  const memoryDone = useMemo(() => {
    if (vault.error || vault.isLoading) return null
    const files = vault.data?.files ?? vault.data?.entries
    if (Array.isArray(files)) return files.length > 0
    // Nested tree: any non-empty object with keys beyond meta counts as seeded
    if (vault.data && typeof vault.data === 'object') {
      const keys = Object.keys(vault.data).filter((k) => k !== 'path' && k !== 'root')
      return keys.length > 0
    }
    return false
  }, [vault.data, vault.error, vault.isLoading])

  const channelsDone = useMemo(() => {
    if (commSetup.error || commSetup.isLoading) return null
    // Ready = at least one channel connected AND bound to an agent (primary comm path).
    if (commSetup.data?.ready === true) return true
    if ((commSetup.data?.boundConnectedCount ?? 0) > 0) return true
    return false
  }, [commSetup.data, commSetup.error, commSetup.isLoading])

  type Row = {
    id: RecId
    done: boolean | null
    href: string
    icon: typeof Cpu
    optional?: boolean
  }

  const rows: Row[] = useMemo(
    () => [
      { id: 'models', done: modelsDone, href: '/providers', icon: Cpu },
      { id: 'projects', done: projectsDone, href: '/projects', icon: FolderKanban },
      { id: 'prompts', done: promptsDone, href: '/prompts', icon: Wand2 },
      { id: 'agents', done: agentsDone, href: '/agents', icon: Bot },
      { id: 'channels', done: channelsDone, href: '/communication', icon: Radio },
      { id: 'search', done: searchDone, href: '/search-sources', icon: Brain },
      { id: 'memory', done: memoryDone, href: '/memory', icon: Brain },
      { id: 'backup', done: backupDone, href: '/backup', icon: DatabaseBackup },
      { id: 'ingress', done: ingressDone, href: '/ingress', icon: Globe, optional: true },
      { id: 'autonomy', done: autonomyDone, href: '/settings', icon: Sparkles, optional: true },
    ],
    [
      modelsDone,
      projectsDone,
      promptsDone,
      agentsDone,
      channelsDone,
      searchDone,
      memoryDone,
      backupDone,
      ingressDone,
      autonomyDone,
    ],
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
  const loading =
    providers.isLoading ||
    projects.isLoading ||
    prompts.isLoading ||
    agents.isLoading

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
    <div className="glass-card p-4 relative mb-6">
      <button
        type="button"
        onClick={dismissAll}
        aria-label={t('dashboard.setup.dismissAll')}
        className="absolute top-3 right-3 text-muted-foreground hover:text-foreground"
      >
        <X className="h-4 w-4" />
      </button>

      <h3 className="text-sm font-semibold mb-1 flex items-center gap-2 pr-6">
        <ListChecks className="h-4 w-4" /> {t('dashboard.setup.title')}
      </h3>
      <p className="text-xs text-muted-foreground mb-3 pr-6">{t('dashboard.setup.subtitle')}</p>

      {loading && openRows.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t('dashboard.loading')}</p>
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
                    {t(`dashboard.setup.item.${row.id}.title`)}
                    {row.optional && (
                      <span className="ml-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                        {t('dashboard.setup.optional')}
                      </span>
                    )}
                  </p>
                  <p className="text-[11px] text-muted-foreground leading-snug">
                    {t(`dashboard.setup.item.${row.id}.body`)}
                  </p>
                </div>
                <Link to={row.href as '/settings'}>
                  <Button size="sm" variant="outline" className="h-7 text-xs shrink-0">
                    {t('dashboard.setup.configure')}
                  </Button>
                </Link>
                <button
                  type="button"
                  onClick={() => dismissOne(row.id)}
                  className="text-muted-foreground hover:text-foreground p-1 shrink-0"
                  aria-label={t('dashboard.setup.dismissItem')}
                  title={t('dashboard.setup.dismissItem')}
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
          ? t('dashboard.setup.progressWithHidden', {
              remaining: String(remainingCount),
              done: String(completedCount),
              total: String(rows.length),
              hidden: String(dismissedOpenCount),
            })
          : t('dashboard.setup.progress', {
              remaining: String(remainingCount),
              done: String(completedCount),
              total: String(rows.length),
            })}
      </p>
    </div>
  )
}

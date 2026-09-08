// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// The first config-dependent tile: `projectId` lives on the grid item's own
// `config`, written when the tile was placed (or never, if the owner just
// dragged it on without configuring it first — see the no-config branch
// below). Split into two components rather than one early-returning
// function: `useWidgetData` (in BoardSummary) must run unconditionally per
// React's rules of hooks, so it can only be called from a component that's
// never mounted until a `projectId` actually exists.
//
// The no-config state is a real picker, not just a pointer elsewhere:
// `onConfigChange` (WidgetDef, widget-registry.ts) is this tile's write path
// back into its own grid item — the config itself already round-trips
// through the existing layout persistence (home-page.tsx's `handleConfigChange`
// -> the same debounced `PUT /home/layout` every drag/resize already uses),
// so choosing a project here needs no new endpoint. What comes back is not
// server-validated against `configSchema` — that schema is frontend-only and
// the server checks `config` structurally (plain object, 4096-byte cap; see
// home/layout-schema.ts) — so `projectId` is read defensively below rather
// than trusted. Kept the link to `/board` as a secondary escape hatch —
// the full board page has its own switcher too.
//
// A plain `<a>`, not `@tanstack/react-router`'s `<Link>`, for that secondary
// link: every widget here is unit-tested by rendering the widget component
// alone, with no `RouterProvider` in the tree. `useNavigate()` (attention/
// conversations/running-agents-widget) degrades to a harmless console
// warning without one — confirmed in task-10-report.md — but `<Link>`'s
// `useLinkProps` reads `router.isServer` unconditionally and throws
// `TypeError: null is not an object` the moment it renders outside a router,
// crashing this tile's own "needs config" test rather than just warning. A
// real `<a href="/board">` still does a full navigation to the right page;
// it just isn't a client-side transition.
import { useEffect, useState } from 'react'
import { api, ApiError } from '@/lib/api'
import { WS_TOPICS } from '@/lib/ws-topics'
import { useWidgetData } from '../use-widget-data'
import { DashboardRow } from '../widget-frame'
import { t } from '../i18n'

interface BoardStageSummary {
  id: string
  name: string
  conversations: unknown[]
}

interface BoardSummaryResponse {
  project: { id: string; name: string } | null
  stages: BoardStageSummary[]
}

interface ProjectListItem {
  id: string
  name: string
}

// Config-derived topic — resolved from the tile's config once useWidgetData
// has it, never a hand-written 'board:<id>' literal
// (tests/contracts/widgets.contract.test.ts forbids exactly that shape).
const REFRESH = {
  topics: (cfg: unknown) => [WS_TOPICS.board((cfg as { projectId: string }).projectId)],
}

export function BoardWidget({
  config,
  onConfigChange,
}: {
  config: unknown
  onConfigChange: (next: unknown) => void
}) {
  const projectId = (config as { projectId?: string } | null | undefined)?.projectId

  if (!projectId) {
    return <BoardConfigPrompt onConfigChange={onConfigChange} />
  }

  return <BoardSummary config={config} projectId={projectId} />
}

/** No `projectId` yet: fetch the project list and let the owner pick one. */
function BoardConfigPrompt({ onConfigChange }: { onConfigChange: (next: unknown) => void }) {
  // null = still loading, [] = loaded (possibly empty) — distinguishes "no
  // projects yet" from "haven't asked yet" so the list never flashes empty.
  const [projects, setProjects] = useState<ProjectListItem[] | null>(null)
  // Matches dashboard-page.tsx's `actionError` (see attention-widget.tsx for
  // the same fix) — a silently-swallowed `GET /projects` failure used to
  // leave the picker looking identical to "this owner has no projects yet",
  // with no way to tell the two apart or retry. `attempt` re-runs the fetch
  // effect so a real "fails, then a subsequent success clears it" retry path
  // exists (this load isn't a repeatable click like approve/pause/interrupt).
  const [loadError, setLoadError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    api
      .get<{ projects: ProjectListItem[] }>('/projects')
      .then((res) => {
        if (cancelled) return
        setProjects(res.projects)
        setLoadError(null)
      })
      .catch((e) => {
        if (cancelled) return
        setProjects([])
        setLoadError(e instanceof ApiError ? e.message : String(e))
      })
    return () => {
      cancelled = true
    }
  }, [attempt])

  return (
    <div data-testid="board-needs-config" className="flex flex-col gap-2 py-2">
      <p className="text-xs text-muted-foreground">{t('home.widget.board.needsConfig')}</p>
      {loadError && (
        <div
          data-testid="action-error"
          className="flex items-center justify-between gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-xs text-destructive"
        >
          <span className="min-w-0 break-words">{loadError}</span>
          <button
            type="button"
            onClick={() => setAttempt((n) => n + 1)}
            data-testid="retry-projects"
            className="shrink-0 underline"
          >
            {t('home.widget.retry')}
          </button>
        </div>
      )}
      {projects && projects.length > 0 && (
        <ul className="flex flex-col gap-0.5 -mx-1">
          {projects.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => onConfigChange({ projectId: p.id })}
                data-testid={`select-project-${p.id}`}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent/40"
              >
                <span className="min-w-0 flex-1 truncate">{p.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <a href="/board" className="text-[11px] text-primary hover:underline">
        {t('home.widget.board.openBoard')}
      </a>
    </div>
  )
}

function BoardSummary({ config, projectId }: { config: unknown; projectId: string }) {
  const { data, error, isLoading, tileRef } = useWidgetData<BoardSummaryResponse>(
    `/projects/${projectId}/board`,
    REFRESH,
    config,
  )

  const stages = data?.stages ?? []
  // See the idiom note in pulse-widget.tsx: a board whose endpoint answered
  // 500 is not a board with no stages.
  const hasError = !!error && !data
  const isEmpty = !isLoading && stages.length === 0

  return (
    <div ref={tileRef}>
      {isLoading ? (
        <p className="text-xs text-muted-foreground py-2">{t('home.widget.loading')}</p>
      ) : hasError ? (
        <p className="text-xs text-muted-foreground py-2">{t('home.widget.error')}</p>
      ) : isEmpty ? (
        <p className="text-xs text-muted-foreground py-2">{t('home.widget.board.empty')}</p>
      ) : (
        <ul className="flex flex-col gap-0.5 -mx-1">
          {stages.map((stage) => (
            <li key={stage.id}>
              <DashboardRow>
                <div className="flex min-w-0 flex-1 items-center justify-between gap-2">
                  <span className="text-sm font-medium truncate">{stage.name}</span>
                  <span className="text-[11px] tabular-nums text-muted-foreground shrink-0">
                    {stage.conversations?.length ?? 0}
                  </span>
                </div>
              </DashboardRow>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

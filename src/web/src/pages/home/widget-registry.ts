// Part of eYssen. See LICENSE file for full copyright and licensing details.
import type { FC } from 'react'
import type { LucideIcon } from 'lucide-react'
import { z, type ZodType } from 'zod'
import { Activity, AlertTriangle, CalendarClock, Gauge, Kanban, MessageSquare, Radar, Sparkles, Wallet } from 'lucide-react'
import { WS_TOPICS } from '@/lib/ws-topics'
import { AttentionWidget } from './widgets/attention-widget'
import { ConversationsWidget } from './widgets/conversations-widget'
import { RunningAgentsWidget } from './widgets/running-agents-widget'
import { BoardWidget } from './widgets/board-widget'
import { ScheduleWidget } from './widgets/schedule-widget'
import { BriefingWidget } from './widgets/briefing-widget'
import { PulseWidget } from './widgets/pulse-widget'
import { CostWidget } from './widgets/cost-widget'
import { SystemWidget } from './widgets/system-widget'

export interface WidgetDef {
  id: string
  titleKey: string
  icon: LucideIcon
  layout: { w: number; h: number; minW: number; minH: number }
  /**
   * Both fields = hybrid (Pulse); neither = load once. See spec §3.2.
   *
   * `topics` are resolved WS topic NAMES, never catalogue keys — for four of
   * the nine `WS_TOPICS` entries the key and the wire name differ (e.g.
   * `WS_TOPICS.missionControl === 'mission-control'`), so a bare key
   * type-checks but subscribes to a topic nothing ever publishes to. Always
   * produce entries from `WS_TOPICS` at the declaration/call site:
   * `WS_TOPICS.autonomy` for a static topic, or a function receiving the
   * tile's config for one that depends on it (`(cfg) => [WS_TOPICS.board(cfg.projectId)]`).
   */
  refresh: { topics?: string[] | ((config: unknown) => string[]); pollMs?: number }
  configSchema?: ZodType
  /**
   * `onConfigChange` is the tile's only write path back into its own grid
   * item — the config itself already round-trips through the existing
   * layout persistence (`item.config` -> debounced `PUT /home/layout`); this
   * callback is just what lets a Component *initiate* that write instead of
   * only ever reading a config someone else set. Every widget receives it,
   * even one with no `configSchema` — most call it never, board-widget.tsx
   * is the first that does.
   *
   * `configSchema` is NOT a server-side guarantee, and nothing here should be
   * written as if it were: it lives in this file, in the frontend bundle, and
   * the server never sees it. `PUT /home/layout` validates `config`
   * STRUCTURALLY only (a plain object, capped at 4096 bytes — see
   * home/layout-schema.ts). A Component must therefore treat the config it
   * receives as untrusted input and check it itself.
   */
  Component: FC<{ config: unknown; onConfigChange: (next: unknown) => void }>
}

/** Populated by Tasks 10-13. The contract test in widgets.contract.test.ts enforces both directions. */
export const WIDGETS: Record<string, WidgetDef> = {
  'home.pulse': {
    id: 'home.pulse',
    titleKey: 'home.widget.pulse.title',
    icon: Activity,
    layout: { w: 12, h: 2, minW: 6, minH: 2 },
    refresh: { topics: [WS_TOPICS.missionControl], pollMs: 60_000 },
    Component: PulseWidget,
  },
  'security-gate.attention': {
    id: 'security-gate.attention',
    titleKey: 'home.widget.attention.title',
    icon: AlertTriangle,
    layout: { w: 6, h: 5, minW: 3, minH: 3 },
    refresh: { topics: [WS_TOPICS.autonomy] },
    Component: AttentionWidget,
  },
  'conversations.recent': {
    id: 'conversations.recent',
    titleKey: 'home.widget.conversations.title',
    icon: MessageSquare,
    layout: { w: 4, h: 5, minW: 3, minH: 3 },
    refresh: { pollMs: 60_000 },
    Component: ConversationsWidget,
  },
  'mission-control.running': {
    id: 'mission-control.running',
    titleKey: 'home.widget.running.title',
    icon: Radar,
    layout: { w: 4, h: 5, minW: 3, minH: 3 },
    refresh: { topics: [WS_TOPICS.missionControl] },
    Component: RunningAgentsWidget,
  },
  'board.summary': {
    id: 'board.summary',
    titleKey: 'home.widget.board.title',
    icon: Kanban,
    layout: { w: 4, h: 5, minW: 3, minH: 3 },
    refresh: { topics: (cfg) => [WS_TOPICS.board((cfg as { projectId: string }).projectId)] },
    configSchema: z.object({ projectId: z.string().min(1) }),
    Component: BoardWidget,
  },
  'scheduler.upcoming': {
    id: 'scheduler.upcoming',
    titleKey: 'home.widget.schedule.title',
    icon: CalendarClock,
    layout: { w: 4, h: 5, minW: 3, minH: 3 },
    refresh: { pollMs: 60_000 },
    Component: ScheduleWidget,
  },
  'memory.briefing': {
    id: 'memory.briefing',
    titleKey: 'home.widget.briefing.title',
    icon: Sparkles,
    layout: { w: 4, h: 5, minW: 3, minH: 3 },
    refresh: { pollMs: 900_000 },
    Component: BriefingWidget,
  },
  'costops.summary': {
    id: 'costops.summary',
    titleKey: 'home.widget.cost.title',
    icon: Wallet,
    layout: { w: 3, h: 5, minW: 3, minH: 3 },
    refresh: { pollMs: 60_000 },
    Component: CostWidget,
  },
  'observability.system': {
    id: 'observability.system',
    titleKey: 'home.widget.system.title',
    icon: Gauge,
    layout: { w: 4, h: 5, minW: 3, minH: 3 },
    refresh: { pollMs: 60_000 },
    Component: SystemWidget,
  },
}

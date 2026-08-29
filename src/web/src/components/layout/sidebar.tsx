import { useEffect, useRef } from 'react'
import { Link, useLocation, useNavigate } from '@tanstack/react-router'
import { create } from 'zustand'
import {
  LayoutDashboard,
  Radar,
  SlidersHorizontal,
  Activity,
  Bot,
  KeyRound,
  Key,
  Users,
  Settings,
  MessageSquarePlus,
  KanbanSquare,
  FolderKanban,
  ChevronUp,
  Monitor,
  Search,
  BookOpen,
  Brain,
  FileText,
  Wand2,
  Shield,
  ShieldCheck,
  Clock,
  Sparkles,
  Bell,
  BellRing,
  Radio,
  ClipboardList,
  Eye,
  FlaskConical,
  ScrollText,
  Globe,
  Server,
  Mic,
  DatabaseBackup,
  Cpu,
  Image as ImageIcon,
  Lightbulb,
  Cable,
  HandMetal,
  Wrench,
  Zap,
  Puzzle,
  Hammer,
  ShieldAlert,
  Workflow,
  Plug,
  Frame,
  Clapperboard,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { api } from '@/lib/api'
import { KnowledgeSidebarTree } from '@/pages/knowledge/knowledge-sidebar-tree'
import { t } from './i18n'

const useSidebarStore = create<{
  settingsOpen: boolean; toggle: () => void; open: () => void
  knowledgeOpen: boolean; toggleKnowledge: () => void; openKnowledge: () => void
}>((set) => ({
  settingsOpen: false,
  toggle: () => set((s) => ({ settingsOpen: !s.settingsOpen })),
  open: () => set({ settingsOpen: true }),
  knowledgeOpen: false,
  toggleKnowledge: () => set((s) => ({ knowledgeOpen: !s.knowledgeOpen })),
  openKnowledge: () => set({ knowledgeOpen: true }),
}))

// Labels are i18n keys (resolved with t() at render time) so the sidebar
// follows the active language.
const settingsGroups = [
  {
    labelKey: 'nav.group.general',
    items: [
      { path: '/settings', labelKey: 'nav.system', icon: Monitor },
      { path: '/users', labelKey: 'nav.users', icon: Users },
      { path: '/api-keys', labelKey: 'nav.apiKeys', icon: Key },
      { path: '/secrets', labelKey: 'nav.secrets', icon: KeyRound },
      { path: '/connections', labelKey: 'nav.connections', icon: Plug },
    ],
  },
  {
    labelKey: 'nav.group.aiModel',
    items: [
      { path: '/providers', labelKey: 'nav.providers', icon: Cpu },
      { path: '/media', labelKey: 'nav.media', icon: ImageIcon },
      { path: '/prompts', labelKey: 'nav.prompts', icon: Wand2 },
      { path: '/memory', labelKey: 'nav.memory', icon: Brain },
      { path: '/mcp-settings', labelKey: 'nav.mcpServers', icon: Cable },
    ],
  },
  {
    labelKey: 'nav.group.modules',
    items: [
      { path: '/projects', labelKey: 'nav.projects', icon: FolderKanban },
      { path: '/documents-settings', labelKey: 'nav.documents', icon: FileText },
      { path: '/search-sources', labelKey: 'nav.searchSources', icon: Search },
      { path: '/notifications-settings', labelKey: 'nav.notifications', icon: BellRing },
      { path: '/proactive', labelKey: 'nav.proactive', icon: Bell },
      { path: '/self-learning', labelKey: 'nav.selfLearning', icon: Lightbulb },
      { path: '/extensions', labelKey: 'nav.extensions', icon: Puzzle },
    ],
  },
  {
    labelKey: 'nav.group.infrastructure',
    items: [
      { path: '/hands', labelKey: 'nav.hands', icon: HandMetal },
      { path: '/ingress', labelKey: 'nav.ingress', icon: Globe },
      { path: '/nodes', labelKey: 'nav.nodes', icon: Server },
      { path: '/backup', labelKey: 'nav.backup', icon: DatabaseBackup },
      { path: '/meetings', labelKey: 'nav.meetings', icon: Mic },
    ],
  },
]

const allSettingsItems = settingsGroups.flatMap((g) => g.items)

export function Sidebar() {
  const location = useLocation()
  const navigate = useNavigate()
  const isSettingsActive = allSettingsItems.some((item) => location.pathname === item.path)
  const { settingsOpen, toggle: toggleSettings, open: openSettings, knowledgeOpen, toggleKnowledge, openKnowledge } = useSidebarStore()
  const wasSettingsActive = useRef(isSettingsActive)
  const isKnowledgeActive = location.pathname.startsWith('/knowledge')

  useEffect(() => {
    if (isSettingsActive && !wasSettingsActive.current) {
      openSettings()
    }
    wasSettingsActive.current = isSettingsActive
  }, [isSettingsActive, openSettings])

  useEffect(() => {
    if (isKnowledgeActive) openKnowledge()
  }, [isKnowledgeActive, openKnowledge])

  const renderNavLink = (item: { path: string; labelKey: string; icon: any }) => {
    const isActive = location.pathname === item.path
    const Icon = item.icon
    return (
      <Link
        key={item.path}
        to={item.path}
        className={cn(
          'flex items-center gap-2 px-3 py-2 rounded-[7px] text-[13px] transition-colors relative',
          isActive
            ? 'bg-[var(--nav-active-bg)] text-foreground font-medium nav-active'
            : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
        )}
      >
        <Icon className="h-4 w-4" />
        {t(item.labelKey)}
      </Link>
    )
  }

  return (
    <aside className="w-[220px] vibrancy border-r border-[var(--vibrancy-border)] flex flex-col flex-shrink-0">
      <nav className="flex-1 p-2 pt-3 flex flex-col gap-0.5 overflow-y-auto">
        {/* Main */}
        <div className="section-label px-3 mb-1">{t('nav.section.main')}</div>
        {renderNavLink({ path: '/', labelKey: 'nav.dashboard', icon: LayoutDashboard })}
        {renderNavLink({ path: '/board', labelKey: 'nav.board', icon: KanbanSquare })}
        <button
          type="button"
          onClick={async (e) => {
            e.stopPropagation()
            try {
              const conv = await api.post<{ id: string }>('/conversations', {})
              navigate({ to: '/conversations/$conversationId', params: { conversationId: conv.id } })
            } catch (err) {
              console.error('Failed to create conversation:', err)
            }
          }}
          className="flex items-center gap-2 px-3 py-2 rounded-[7px] text-[13px] transition-colors text-muted-foreground hover:text-foreground hover:bg-accent/50 w-full text-left cursor-pointer relative z-10"
        >
          <MessageSquarePlus className="h-4 w-4" />
          {t('nav.newConversation')}
        </button>

        {/* AI */}
        <div className="section-label px-3 mb-1 mt-3">{t('nav.section.ai')}</div>
        {renderNavLink({ path: '/agents', labelKey: 'nav.agents', icon: Bot })}
        {renderNavLink({ path: '/agent-runs', labelKey: 'nav.agentRuns', icon: Activity })}
        {renderNavLink({ path: '/pipelines', labelKey: 'nav.pipelines', icon: Workflow })}
        {renderNavLink({ path: '/skills', labelKey: 'nav.skills', icon: Sparkles })}
        {renderNavLink({ path: '/forge', labelKey: 'nav.forge', icon: Hammer })}
        {renderNavLink({ path: '/tools', labelKey: 'nav.tools', icon: Wrench })}
        {renderNavLink({ path: '/research', labelKey: 'nav.research', icon: FlaskConical })}
        {renderNavLink({ path: '/browser-use', labelKey: 'nav.browserUse', icon: Globe })}

        {/* Content */}
        <div className="section-label px-3 mb-1 mt-3">{t('nav.section.content')}</div>
        {renderNavLink({ path: '/documents', labelKey: 'nav.documents', icon: FileText })}
        {renderNavLink({ path: '/design', labelKey: 'nav.design', icon: Frame })}
        {renderNavLink({ path: '/studio', labelKey: 'nav.studio', icon: Clapperboard })}
        <button
          type="button"
          onClick={toggleKnowledge}
          className={cn(
            'flex items-center gap-2 px-3 py-2 rounded-[7px] text-[13px] transition-colors w-full text-left',
            isKnowledgeActive
              ? 'text-foreground font-medium'
              : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
          )}
        >
          <BookOpen className="h-4 w-4" />
          <span className="flex-1">{t('nav.knowledge')}</span>
          <ChevronUp className={cn('h-3.5 w-3.5 transition-transform', knowledgeOpen ? '' : 'rotate-180')} />
        </button>
        {knowledgeOpen && <KnowledgeSidebarTree />}
        {renderNavLink({ path: '/memory', labelKey: 'nav.memory', icon: Brain })}

        {/* Operations */}
        <div className="section-label px-3 mb-1 mt-3">{t('nav.section.operations')}</div>
        {renderNavLink({ path: '/communication', labelKey: 'nav.communication', icon: Radio })}
        {renderNavLink({ path: '/scheduler', labelKey: 'nav.scheduler', icon: Clock })}

        {/* Monitoring */}
        <div className="section-label px-3 mb-1 mt-3">{t('nav.section.monitoring')}</div>
        {renderNavLink({ path: '/security', labelKey: 'nav.security', icon: Shield })}
        {renderNavLink({ path: '/privacy', labelKey: 'nav.privacy', icon: ShieldCheck })}
        {renderNavLink({ path: '/audit', labelKey: 'nav.audit', icon: ClipboardList })}
        {renderNavLink({ path: '/observability', labelKey: 'nav.observability', icon: Eye })}
        {renderNavLink({ path: '/mission-control', labelKey: 'nav.missionControl', icon: Radar })}
        {renderNavLink({ path: '/ops', labelKey: 'nav.ops', icon: ShieldAlert })}
        {renderNavLink({ path: '/autonomy', labelKey: 'nav.autonomy', icon: SlidersHorizontal })}

        {/* Product docs (static site served by the same origin) */}
        <div className="section-label px-3 mb-1 mt-3">{t('nav.section.help')}</div>
        <a
          href="/docs/"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 px-3 py-2 rounded-[7px] text-[13px] transition-colors text-muted-foreground hover:text-foreground hover:bg-accent/50"
        >
          <BookOpen className="h-4 w-4" />
          {t('nav.docs')}
        </a>
      </nav>

      {/* Bottom: Settings group */}
      <div className="p-2 border-t border-[var(--vibrancy-border)]">
        <button
          type="button"
          onClick={toggleSettings}
          className={cn(
            'flex items-center gap-2 px-3 py-2 rounded-[7px] text-[13px] transition-colors w-full text-left',
            isSettingsActive
              ? 'text-foreground font-medium'
              : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
          )}
        >
          <Settings className="h-4 w-4" />
          <span className="flex-1">{t('nav.settings')}</span>
          <ChevronUp className={cn('h-3.5 w-3.5 transition-transform', settingsOpen ? '' : 'rotate-180')} />
        </button>

        {settingsOpen && (
          <div className="flex flex-col gap-0.5 mt-0.5 max-h-[50vh] overflow-y-auto">
            {settingsGroups.map((group) => (
              <div key={group.labelKey}>
                <div className="section-label px-3 pl-7 mt-2 mb-0.5">{t(group.labelKey)}</div>
                {group.items.map((item) => {
                  const isActive = location.pathname === item.path
                  return (
                    <Link
                      key={item.path}
                      to={item.path}
                      className={cn(
                        'flex items-center gap-2 pl-7 pr-3 py-1.5 rounded-[7px] text-[12px] transition-colors relative',
                        isActive
                          ? 'bg-[var(--nav-active-bg)] text-foreground font-medium nav-active'
                          : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
                      )}
                    >
                      <item.icon className="h-3.5 w-3.5" />
                      {t(item.labelKey)}
                    </Link>
                  )
                })}
              </div>
            ))}
          </div>
        )}
      </div>
    </aside>
  )
}

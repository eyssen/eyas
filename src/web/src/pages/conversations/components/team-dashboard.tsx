// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { useNavigate } from '@tanstack/react-router'
import { Minimize2, Bot, Clock, Zap, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useTeamSessionStore, type AgentState, type TeamMemoryEntry } from '@/stores/team-session-store'
import { t } from '../i18n'

const CATEGORY_COLORS: Record<string, string> = {
  finding: 'text-blue-400',
  decision: 'text-emerald-400',
  blocker: 'text-red-400',
  question: 'text-amber-400',
  fact: 'text-muted-foreground',
}

const CATEGORY_LABEL_KEYS: Record<string, string> = {
  finding: 'conversations.teamDashboard.categoryFinding',
  decision: 'conversations.teamDashboard.categoryDecision',
  blocker: 'conversations.teamDashboard.categoryBlocker',
  question: 'conversations.teamDashboard.categoryQuestion',
  fact: 'conversations.teamDashboard.categoryFact',
}

function AgentCard({ agent }: { agent: AgentState }) {
  const navigate = useNavigate()

  const statusColor = {
    pending: 'text-zinc-400',
    running: 'text-blue-400',
    completed: 'text-emerald-400',
    failed: 'text-red-400',
  }[agent.status] ?? 'text-zinc-400'

  const statusDot = {
    pending: 'bg-zinc-400',
    running: 'bg-blue-400 animate-pulse',
    completed: 'bg-emerald-400',
    failed: 'bg-red-400',
  }[agent.status] ?? 'bg-zinc-400'

  return (
    <div className="glass-card p-3 flex flex-col gap-2 min-w-[180px]">
      <div className="flex items-center gap-2">
        <div className={`w-2 h-2 rounded-full shrink-0 ${statusDot}`} />
        <Bot className={`h-4 w-4 shrink-0 ${statusColor}`} />
        <span className="text-xs font-medium truncate flex-1">{agent.agentId}</span>
      </div>

      <Badge variant="outline" className={`self-start text-[9px] ${statusColor}`}>
        {agent.status}
      </Badge>

      <div className="text-[10px] text-muted-foreground">
        {t('conversations.teamDashboard.phase')} <span className="text-foreground">{agent.phase}</span>
      </div>

      {agent.turn > 0 && (
        <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
          <Clock className="h-3 w-3" />
          {t('conversations.teamDashboard.turn', { count: agent.turn })}
        </div>
      )}

      {agent.tokensUsed > 0 && (
        <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
          <Zap className="h-3 w-3" />
          {t('conversations.teamDashboard.tokens', { count: agent.tokensUsed.toLocaleString() })}
        </div>
      )}

      {agent.currentTool && (
        <div className="text-[10px] text-blue-400 truncate">
          {agent.currentTool}...
        </div>
      )}

      {agent.summary && (
        <div className="text-[10px] text-muted-foreground line-clamp-2">
          {agent.summary}
        </div>
      )}

      {agent.conversationId && (
        <Button
          size="sm"
          variant="outline"
          className="h-6 text-[10px] mt-auto"
          onClick={() => navigate({ to: '/conversations/$conversationId', params: { conversationId: agent.conversationId } })}
        >
          {t('conversations.teamDashboard.viewChat')}
        </Button>
      )}
    </div>
  )
}

function MemoryEntry({ entry }: { entry: TeamMemoryEntry }) {
  const colorClass = CATEGORY_COLORS[entry.category] ?? 'text-muted-foreground'
  const label = CATEGORY_LABEL_KEYS[entry.category] ? t(CATEGORY_LABEL_KEYS[entry.category]) : entry.category
  const valueStr = typeof entry.value === 'object' ? JSON.stringify(entry.value) : String(entry.value)
  const author = entry.authorAgentId ?? 'system'

  return (
    <div className="flex items-start gap-2 text-[11px] py-1 border-b border-border/20 last:border-0">
      <span className={`shrink-0 font-medium ${colorClass}`}>{label}</span>
      <span className="text-muted-foreground shrink-0">[{author}]</span>
      <span className="font-mono text-foreground/80 truncate">{entry.key}:</span>
      <span className="text-muted-foreground truncate flex-1">{valueStr}</span>
    </div>
  )
}

interface TeamDashboardProps {
  onCollapse(): void
}

export function TeamDashboard({ onCollapse }: TeamDashboardProps) {
  const { status, currentPhase, agentStates, memoryEntries } = useTeamSessionStore()

  const memoryCounts = {
    finding: memoryEntries.filter(e => e.category === 'finding').length,
    decision: memoryEntries.filter(e => e.category === 'decision').length,
    blocker: memoryEntries.filter(e => e.category === 'blocker').length,
  }

  const recentMemory = [...memoryEntries].reverse().slice(0, 10)

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border/50 shrink-0">
        <div className="flex items-center gap-2 flex-1">
          <span className="text-sm font-medium">{t('conversations.teamDashboard.title')}</span>
          {currentPhase && (
            <Badge variant="outline" className="text-[10px]">{currentPhase}</Badge>
          )}
          {status && (
            <Badge variant={status === 'running' ? 'default' : 'outline'} className="text-[10px]">
              {status}
            </Badge>
          )}
        </div>
        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={onCollapse}>
          <Minimize2 className="h-3.5 w-3.5 mr-1" />
          {t('conversations.teamDashboard.collapse')}
        </Button>
      </div>

      <div className="flex gap-3 p-4 overflow-x-auto shrink-0 border-b border-border/30">
        {agentStates.length === 0 ? (
          <div className="text-xs text-muted-foreground">{t('conversations.teamDashboard.noActiveAgent')}</div>
        ) : (
          agentStates.map(agent => <AgentCard key={`${agent.agentId}-${agent.phase}`} agent={agent} />)
        )}
      </div>

      <div className="flex-1 overflow-hidden flex flex-col">
        <div className="flex items-center gap-3 px-4 py-2 border-b border-border/30 text-xs shrink-0">
          <span className="font-medium">{t('conversations.teamDashboard.teamMemory')}</span>
          <span className="text-blue-400">{t('conversations.teamDashboard.findingCount', { count: memoryCounts.finding })}</span>
          <span className="text-emerald-400">{t('conversations.teamDashboard.decisionCount', { count: memoryCounts.decision })}</span>
          {memoryCounts.blocker > 0 && (
            <span className="text-red-400 flex items-center gap-1">
              <AlertCircle className="h-3 w-3" />
              {t('conversations.teamDashboard.blockerCount', { count: memoryCounts.blocker })}
            </span>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-2">
          {recentMemory.length === 0 ? (
            <div className="text-xs text-muted-foreground py-4">{t('conversations.teamDashboard.noEntries')}</div>
          ) : (
            recentMemory.map(entry => <MemoryEntry key={entry.id} entry={entry} />)
          )}
        </div>
      </div>
    </div>
  )
}

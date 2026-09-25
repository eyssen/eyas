// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { useState, useEffect, useMemo } from 'react'
import { useApi } from '@/hooks/use-api'
import { useWebSocket } from '@/hooks/use-websocket'
import { WS_TOPICS } from '@/lib/ws-topics'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Bot, ChevronDown, ChevronRight, MessageSquare, Expand, User } from 'lucide-react'
import { useTeamSessionStore } from '@/stores/team-session-store'
import { t } from '../i18n'

interface AgentDef { id: string; name: string }

interface SubConversation {
  id: string
  title: string | null
  status: string
  agentId: string | null
  messageCount: number
  teamSessionId: string | null
}

interface SubMessage {
  id: number
  role: 'user' | 'assistant'
  content: string
  createdAt: string
}

interface SubConversationTreeProps {
  conversationId: string
}

const STATUS_COLORS: Record<string, string> = {
  working: 'text-blue-400',
  running: 'text-blue-400',
  idle: 'text-zinc-400',
  pending: 'text-zinc-400',
  completed: 'text-emerald-400',
  failed: 'text-red-400',
  archived: 'text-zinc-600',
}

const STATUS_DOT_COLORS: Record<string, string> = {
  working: 'bg-blue-400 animate-pulse',
  running: 'bg-blue-400 animate-pulse',
  idle: 'bg-zinc-400',
  pending: 'bg-zinc-300',
  completed: 'bg-emerald-400',
  failed: 'bg-red-400',
  archived: 'bg-zinc-600',
}

export function SubConversationTree({ conversationId }: SubConversationTreeProps) {
  const { data, refetch } = useApi<{ conversations: SubConversation[] }>(
    `/conversations?parentId=${conversationId}`
  )
  const { subscribe } = useWebSocket()
  const [expanded, setExpanded] = useState(true)
  const [selectedChild, setSelectedChild] = useState<string | null>(null)
  const { agentStates, setExpanded: setDashboardExpanded } = useTeamSessionStore()
  const { data: agentsData } = useApi<{ agents: AgentDef[] }>('/agents')
  const agentNames = useMemo(() => {
    const map = new Map<string, string>()
    for (const a of agentsData?.agents ?? []) map.set(a.id, a.name)
    return map
  }, [agentsData])

  // Subscribe to real-time updates — refetch when child conversations are created or updated
  useEffect(() => {
    if (!conversationId) return
    return subscribe(WS_TOPICS.chat(conversationId), (msg) => {
      const event = msg.event
      if (event === 'eyas.conversation.sub_created' || event === 'eyas.conversation.updated') {
        refetch()
      }
    })
  }, [conversationId, subscribe, refetch])

  const children = data?.conversations ?? []
  if (children.length === 0) return null

  const isTeamSession = children.some(c => c.teamSessionId != null)

  const enrichedChildren = children.map(child => {
    const agentState = agentStates.find(a => a.conversationId === child.id)
    return { ...child, agentState }
  })

  const selected = enrichedChildren.find(c => c.id === selectedChild)

  return (
    <>
      <div className="glass-card p-3">
        <div className="flex items-center gap-2 w-full mb-2">
          <button
            type="button"
            className="flex items-center gap-2 flex-1 text-left text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            {isTeamSession ? t('conversations.subTree.team') : t('conversations.subTree.subConversations')} ({children.length})
          </button>

          {isTeamSession && (
            <Button
              size="sm"
              variant="ghost"
              className="h-5 px-1.5 text-[10px] text-muted-foreground"
              onClick={() => setDashboardExpanded(true)}
              title={t('conversations.subTree.expandTitle')}
            >
              <Expand className="h-3 w-3 mr-1" />
              {t('conversations.subTree.expand')}
            </Button>
          )}
        </div>

        {expanded && (
          <div className="space-y-1">
            {enrichedChildren.map((child) => {
              const effectiveStatus = child.agentState?.status ?? child.status
              const currentTool = child.agentState?.currentTool
              const turn = child.agentState?.turn

              return (
                <button
                  key={child.id}
                  type="button"
                  className="flex items-start gap-2.5 w-full px-2 py-1.5 rounded-md text-left text-xs hover:bg-accent/30 transition-colors"
                  onClick={() => setSelectedChild(child.id)}
                >
                  <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 mt-1 ${STATUS_DOT_COLORS[effectiveStatus] ?? 'bg-zinc-400'}`} />

                  {child.agentId ? (
                    <Bot className={`h-3.5 w-3.5 flex-shrink-0 mt-0.5 ${STATUS_COLORS[effectiveStatus] ?? 'text-zinc-400'}`} />
                  ) : (
                    <MessageSquare className="h-3.5 w-3.5 flex-shrink-0 mt-0.5 text-muted-foreground" />
                  )}

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      {child.agentId && agentNames.get(child.agentId) && (
                        <span className="font-semibold text-blue-400 shrink-0">{agentNames.get(child.agentId)}</span>
                      )}
                      <span className="truncate text-muted-foreground">{child.title || t('conversations.untitled')}</span>
                      <Badge variant="outline" className={`text-[9px] shrink-0 ${STATUS_COLORS[effectiveStatus] ?? ''}`}>
                        {effectiveStatus}
                      </Badge>
                    </div>
                    {currentTool && (
                      <div className="text-[10px] text-blue-400 mt-0.5 truncate">
                        {turn ? <span className="text-muted-foreground mr-1">{t('conversations.subTree.turn', { turn })}</span> : null}
                        {currentTool}...
                      </div>
                    )}
                  </div>

                  <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
                    {child.messageCount}m
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* Read-only dialog for viewing sub-conversation messages */}
      <Dialog open={!!selectedChild} onOpenChange={(open) => { if (!open) setSelectedChild(null) }}>
        <DialogContent className="!max-w-[60vw] !h-[90vh] flex flex-col bg-background border-border">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <Bot className="h-4 w-4" />
              {selected?.agentId && agentNames.get(selected.agentId) && (
                <span className="font-semibold text-blue-400 shrink-0">{agentNames.get(selected.agentId)}</span>
              )}
              <span className="truncate">{selected?.title || t('conversations.subTree.dialogFallback')}</span>
              {selected && (
                <Badge variant="outline" className={`text-[10px] ${STATUS_COLORS[selected.agentState?.status ?? selected.status] ?? ''}`}>
                  {selected.agentState?.status ?? selected.status}
                </Badge>
              )}
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto min-h-0">
            {selectedChild && <SubConversationMessages conversationId={selectedChild} />}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

/** Fetches and renders messages for a sub-conversation (read-only) */
function SubConversationMessages({ conversationId }: { conversationId: string }) {
  const { data, isLoading } = useApi<{ messages: SubMessage[] }>(
    `/conversations/${conversationId}`
  )

  const messages = data?.messages ?? []

  if (isLoading) {
    return <div className="text-xs text-muted-foreground p-4">{t('common.loading')}</div>
  }

  if (messages.length === 0) {
    return <div className="text-xs text-muted-foreground p-4">{t('conversations.subTree.noMessages')}</div>
  }

  return (
    <div className="space-y-3 p-1">
      {messages.map((msg) => (
        <div key={msg.id} className={`flex gap-2.5 ${msg.role === 'assistant' ? '' : 'justify-end'}`}>
          {msg.role === 'assistant' && (
            <Bot className="h-4 w-4 flex-shrink-0 mt-0.5 text-blue-400" />
          )}
          <div className={`rounded-lg px-3 py-2 text-xs max-w-[85%] ${
            msg.role === 'user'
              ? 'bg-primary/10 text-foreground'
              : 'bg-muted/50 text-foreground'
          }`}>
            <pre className="whitespace-pre-wrap font-sans">{msg.content}</pre>
          </div>
          {msg.role === 'user' && (
            <User className="h-4 w-4 flex-shrink-0 mt-0.5 text-muted-foreground" />
          )}
        </div>
      ))}
    </div>
  )
}

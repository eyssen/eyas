import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams } from '@tanstack/react-router'
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from 'react-resizable-panels'
import { useApi } from '@/hooks/use-api'
import { useConversationStore } from '@/stores/conversation-store'
import { useStreaming } from '@/hooks/use-streaming'
import { useWebSocket } from '@/hooks/use-websocket'
import { ConversationTopBar } from './conversation-top-bar'
import { ConversationFields } from './conversation-fields'
import { ConversationChat } from './conversation-chat'
import { ChatterPanel } from './chatter-panel'
import { ComplexityIndicator } from './components/complexity-indicator'
import { TeamProposalCard } from './components/team-proposal-card'
import { TeamDashboard } from './components/team-dashboard'
import { RuntimeStrip } from './components/runtime-strip'
import { useTeamSessionStore, type RawTeamMemoryEntry } from '@/stores/team-session-store'
import { useRunTreeStore, type OrchestrationEventLike } from '@/stores/run-tree-store'
import { createHydrationBuffer } from '@/lib/hydration-buffer'
import { api } from '@/lib/api'
import { WS_TOPICS } from '@/lib/ws-topics'
import {
  buildProposalFromSession,
  pickHydratableSession,
  type PersistedTeamSession,
} from './team-session-hydration'

export default function ConversationPage() {
  const { conversationId } = useParams({ from: '/conversations/$conversationId' })
  const { data, refetch } = useApi<any>(conversationId ? `/conversations/${conversationId}` : '')
  const { subscribe } = useWebSocket()
  const {
    activeConversation,
    setActiveConversation,
    streamingText,
    streamingThinking,
    isStreaming,
    clearStream,
    updateConversation,
    agentProgress,
    finishAgentProgress,
  } = useConversationStore()

  const { sendMessage, cancel, abortRef } = useStreaming()

  const {
    sessionId: teamSessionId,
    proposal: teamProposal,
    status: teamStatus,
    isExpanded: isTeamExpanded,
    setExpanded: setTeamExpanded,
    handleEvent: handleTeamEvent,
    reset: resetTeamSession,
  } = useTeamSessionStore()

  const [tab, setTab] = useState<'chat' | 'permissions' | 'audit'>('chat')
  const [chatterRefreshKey, setChatterRefreshKey] = useState(0)

  // Which orchestration run has already been hydrated for this page (guards
  // against re-fetching the replay on every conversation refetch).
  const hydratedRunRef = useRef<string | null>(null)

  // Live orchestration events that arrive while the replay fetch is in flight —
  // loadRun() resets the tree, so they are queued and replayed afterwards.
  const orchestrationBufferRef = useRef(createHydrationBuffer<OrchestrationEventLike>())

  /** Apply a live orchestration event unless hydration is still running. */
  const applyOrchestrationEvent = useCallback((event: OrchestrationEventLike) => {
    if (orchestrationBufferRef.current.push(event)) return
    useRunTreeStore.getState().handleEvent(event)
  }, [])

  // Plain claude-code conversations emit their own run tree — mount the rail
  // whenever the store has roots, not only for team sessions.
  const runTreeHasRoots = useRunTreeStore((s) => s.rootIds.length > 0)

  // Sync API data into store — only apply when the payload matches the URL
  // (useApi keeps the previous conversation's data until the next fetch lands).
  useEffect(() => {
    if (!data || !conversationId) return
    if ((data as { id?: string }).id !== conversationId) return
    setActiveConversation(data)
  }, [data, conversationId, setActiveConversation])

  // Auto-send pending message (e.g., from Agent Wizard)
  // Uses activeConversation with 0 messages as trigger — new conversation just loaded
  useEffect(() => {
    const pending = useConversationStore.getState().pendingMessage
    if (!pending || !conversationId || !activeConversation) return
    if (activeConversation.id !== conversationId) return
    // Only auto-send if conversation has no messages yet (freshly created)
    if (activeConversation.messages && activeConversation.messages.length > 0) return
    useConversationStore.getState().setPendingMessage(null)
    sendMessage(conversationId, pending)
  }, [conversationId, activeConversation, sendMessage])

  // Handle conversation switch: abort old stream, reset state, refetch
  useEffect(() => {
    cancel()
    resetTeamSession()
    useRunTreeStore.getState().reset()
    useConversationStore.getState().setAgentProgress(null)
    hydratedRunRef.current = null
    orchestrationBufferRef.current.clear()
    clearStream()

    if (conversationId) {
      // Drop previous conversation immediately so we never render another
      // conversation's messages under this URL while the fetch is in flight.
      const cur = useConversationStore.getState().activeConversation
      if (cur?.id !== conversationId) {
        setActiveConversation(null)
      }
      refetch()
    } else {
      setActiveConversation(null)
    }

    return () => { cancel() }
  }, [conversationId, refetch, setActiveConversation, clearStream, cancel, resetTeamSession])

  // While the agent is working in the background (user left and came back, or
  // SSE was aborted), poll for new messages so the chat pane is not empty.
  useEffect(() => {
    if (!conversationId) return
    const status = activeConversation?.status
    if (status !== 'working' && status !== 'running') return
    // Don't fight an active SSE stream
    if (isStreaming) return
    const id = window.setInterval(() => {
      if (!useConversationStore.getState().isStreaming) refetch()
    }, 2000)
    return () => window.clearInterval(id)
  }, [conversationId, activeConversation?.status, isStreaming, refetch])

  // Page-reload case: re-attach the team rails from the server's record. Runs
  // off the conversation id alone and is deliberately independent of the
  // orchestration replay below — it must never touch hydratedRunRef or the
  // live-event buffer, which that effect owns.
  //
  // The store is only written AFTER the list resolves. The previous version
  // attached the rails first and refined them from a fetch whose failure was
  // swallowed, so a failed lookup left the UI subscribed to a session it knew
  // nothing about. On failure now, the page simply stays plain.
  useEffect(() => {
    if (!conversationId) return
    // A live session (a proposal that just arrived) already owns the store.
    if (useTeamSessionStore.getState().sessionId) return
    let cancelled = false

    void api.get<{ sessions: PersistedTeamSession[] }>(`/conversations/${conversationId}/team-sessions`)
      .then(({ sessions }) => {
        if (cancelled) return
        // Read the conversation's own team stamp non-reactively — a dep on
        // activeConversation would re-run this on every chat refetch. Unknown
        // (not loaded yet, or a stale record from the previous conversation)
        // reads as null, which makes pickHydratableSession skip rejected
        // sessions rather than resurrect them.
        const loaded = useConversationStore.getState().activeConversation as any
        const linkedTeamSessionId: string | null =
          loaded?.id === conversationId ? (loaded.teamSessionId ?? null) : null

        const session = pickHydratableSession(sessions, linkedTeamSessionId)
        const store = useTeamSessionStore.getState()
        // Re-check: a live proposal may have landed while the fetch was in flight.
        if (!session || store.sessionId) return

        if (session.status === 'proposing') {
          const proposal = buildProposalFromSession(session)
          if (proposal) {
            store.setProposal(session.id, session.parentConversationId ?? conversationId, proposal)
          }
          return
        }

        store.rehydrate(session.id, session.parentConversationId ?? conversationId, session.status)
        // The dashboard is the only surface that renders team memory, so the
        // replay below would land in a panel nothing opens. Collapsing again is
        // one click (TeamDashboard's own control).
        store.setExpanded(true)
        void api.get<{ entries: RawTeamMemoryEntry[] }>(`/team-sessions/${session.id}/memory`)
          .then(({ entries }) => {
            const current = useTeamSessionStore.getState()
            if (!cancelled && current.sessionId === session.id) current.hydrateMemory(entries ?? [])
          })
          .catch(() => { /* memory replay is best-effort — live writes still land */ })
      })
      .catch(() => { /* no team session, or not readable — the page renders plain */ })

    return () => { cancelled = true }
  }, [conversationId])

  // Hydrate the orchestration run tree from the persisted replay once the
  // conversation record is loaded. Prefer the team run when the conversation
  // has a stored teamSessionId, else the conversation's own run. Non-blocking:
  // hydration failures (and retention-pruned, empty replays) leave the page
  // fully functional.
  useEffect(() => {
    const conv = activeConversation as any
    if (!conversationId || !conv || conv.id !== conversationId) return
    const runId: string = conv.teamSessionId ?? conversationId
    if (hydratedRunRef.current === runId) return
    hydratedRunRef.current = runId

    // Queue live events until the replay has been applied — see the buffer ref.
    orchestrationBufferRef.current.begin()
    void api.get<{ events: OrchestrationEventLike[] }>(`/orchestration/runs/${runId}/events`)
      .then(({ events }) => {
        if (events && events.length > 0 && hydratedRunRef.current === runId) {
          useRunTreeStore.getState().loadRun(runId, events)
        }
      })
      .catch(() => { /* no persisted run — nothing to hydrate */ })
      .finally(() => {
        // A newer run already took over the buffer — leave it to that
        // hydration, flushing here would disarm it.
        if (hydratedRunRef.current !== runId) return
        const { handleEvent } = useRunTreeStore.getState()
        for (const event of orchestrationBufferRef.current.flush()) handleEvent(event)
      })
  }, [conversationId, activeConversation])

  // Subscribe to real-time chat updates for this conversation
  useEffect(() => {
    if (!conversationId) return
    return subscribe(WS_TOPICS.chat(conversationId), () => {
      // Only refetch if we're not currently streaming (avoid conflicts)
      if (!useConversationStore.getState().isStreaming) {
        refetch()
      }
    })
  }, [conversationId, subscribe, refetch])

  // Subscribe to team session execution events (once sessionId is known).
  // Frames arrive enveloped as { event, data, topic } — the store expects the
  // event itself.
  useEffect(() => {
    if (!teamSessionId) return
    return subscribe(WS_TOPICS.teamEvent(teamSessionId), (msg: any) => {
      handleTeamEvent(msg?.data ?? msg)
    })
  }, [teamSessionId, subscribe, handleTeamEvent])

  // Subscribe to the normalized orchestration event stream → run-tree store.
  useEffect(() => {
    if (!teamSessionId) return
    return subscribe(WS_TOPICS.orchestration(teamSessionId), (msg: any) => {
      if (msg?.event === 'orchestration' && msg.data) {
        applyOrchestrationEvent(msg.data)
      }
    })
  }, [teamSessionId, subscribe, applyOrchestrationEvent])

  // Plain claude-code conversations emit orchestration events under their own
  // conversationId as runId — subscribe in addition to the team topic, but
  // never double-subscribe when the two ids coincide.
  useEffect(() => {
    if (!conversationId || conversationId === teamSessionId) return
    return subscribe(WS_TOPICS.orchestration(conversationId), (msg: any) => {
      if (msg?.event === 'orchestration' && msg.data) {
        applyOrchestrationEvent(msg.data)
      }
    })
  }, [conversationId, teamSessionId, subscribe, applyOrchestrationEvent])

  // Subscribe to new team proposals for this conversation
  useEffect(() => {
    if (!conversationId) return
    return subscribe(WS_TOPICS.teamProposed(conversationId), (msg: any) => {
      // Frames arrive enveloped — the proposal payload lives in `msg.data`.
      const payload = msg?.data
      if (!payload?.session || !payload?.proposal) return
      handleTeamEvent({ type: 'team:proposed', session: payload.session, proposal: payload.proposal })
    })
  }, [conversationId, subscribe, handleTeamEvent])

  const handleSend = useCallback(
    async (content: string, attachmentIds?: string[]) => {
      if (!conversationId || !activeConversation) return
      await sendMessage(conversationId, content, attachmentIds)
    },
    [conversationId, activeConversation, sendMessage],
  )

  const handleProviderChange = useCallback(async (providerId: string, modelId: string) => {
    if (!conversationId) return
    await api.patch(`/conversations/${conversationId}`, { providerId, modelId: modelId || undefined })
    refetch()
  }, [conversationId, refetch])

  const handleTitleChange = useCallback(async (title: string) => {
    if (!conversationId) return
    await api.patch(`/conversations/${conversationId}`, { title })
    updateConversation({ title })
  }, [conversationId, updateConversation])

  const handleFieldUpdate = useCallback(async (fields: Record<string, unknown>) => {
    if (!conversationId) return
    await api.patch(`/conversations/${conversationId}`, fields)
    refetch()
    // Refresh chatter panel to show new tracking entries
    setChatterRefreshKey((k) => k + 1)
  }, [conversationId, refetch])

  const conv = activeConversation
  const contextWindow = 200000

  // Suppress unused warning for tab/setTab — reserved for permissions/audit tabs
  void tab
  void setTab

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)] -mx-6 -mt-6">
      <ConversationTopBar
        conversationId={conversationId}
        title={conv?.title ?? null}
        status={conv?.status ?? 'idle'}
        priority={(conv as any)?.priority ?? 'normal'}
        providerId={conv?.providerId ?? null}
        modelId={conv?.modelId ?? null}
        agentId={(conv as any)?.agentId ?? null}
        tokensUsed={conv?.tokensUsed ?? 0}
        contextWindow={contextWindow}
        onProviderChange={handleProviderChange}
        onTitleChange={handleTitleChange}
        onUpdate={handleFieldUpdate}
      />

      <PanelGroup orientation="horizontal" className="flex-1 min-h-0">
        <Panel defaultSize={66} minSize={30}>
          <div className="flex flex-col h-full">
            <ConversationFields
              conversationId={conversationId}
              projectId={(conv as any)?.projectId ?? null}
              stageId={(conv as any)?.stageId ?? null}
              agentId={(conv as any)?.agentId ?? null}
              dueDate={(conv as any)?.dueDate ?? null}
              assignees={(conv as any)?.assignees ?? []}
              tags={(conv as any)?.tags ?? []}
              thinking={(conv as any)?.thinking ?? 'off'}
              thinkingBudget={(conv as any)?.thinkingBudget ?? null}
              effort={(conv as any)?.effort ?? null}
              orchestration={(conv as any)?.orchestration ?? 'auto'}
              hasMessages={(conv?.messages?.length ?? 0) > 0}
              onUpdate={handleFieldUpdate}
            />

            {/* Mode / complexity indicator */}
            {conv?.mode && conv.mode !== 'simple' && (
              <div className="px-4 py-1.5 border-b border-border/30">
                <ComplexityIndicator mode={conv.mode} complexity={conv.complexity} />
              </div>
            )}

            <ConversationChat
              messages={conv?.messages ?? []}
              streamingText={streamingText}
              streamingThinking={streamingThinking}
              isStreaming={isStreaming}
              conversationStatus={conv?.status}
              onSend={handleSend}
              onCancel={cancel}
              disabled={isStreaming || conv?.status === 'working'}
              conversationId={conversationId}
              providerId={conv?.providerId ?? null}
              modelId={conv?.modelId ?? null}
            />

            {/* Team proposal card — shown when agent proposes a team */}
            {teamProposal && teamSessionId && teamStatus === 'proposing' && (
              <div className="px-4 pb-2">
                <TeamProposalCard
                  sessionId={teamSessionId}
                  proposal={teamProposal}
                  onApproved={() => handleTeamEvent({ type: 'team_approved' })}
                  onRejected={() => resetTeamSession()}
                />
              </div>
            )}
          </div>
        </Panel>

        <PanelResizeHandle className="w-px bg-border/50 hover:bg-primary/30 transition-colors data-[resize-handle-active]:bg-primary/50" />

        <Panel defaultSize={34} minSize={20}>
          {isTeamExpanded && teamSessionId ? (
            <TeamDashboard onCollapse={() => setTeamExpanded(false)} />
          ) : (
            <div className="flex flex-col h-full min-h-0">
              {/* Runtime strip — live agent state, not business history.
                  Auto-expanded while an agent is running; otherwise collapsible. */}
              <RuntimeStrip
                forceOpen={Boolean(agentProgress?.isRunning) || conv?.status === 'working'}
                hasRunTree={runTreeHasRoots}
                agentProgress={agentProgress}
                onCancelProgress={() => {
                  cancel()
                  finishAgentProgress()
                }}
                showSubTree={conv?.parentConversationId === null}
                conversationId={conversationId}
              />

              <div className="flex-1 min-h-0 flex flex-col">
                <ChatterPanel conversationId={conversationId} externalRefreshKey={chatterRefreshKey} />
              </div>
            </div>
          )}
        </Panel>
      </PanelGroup>
    </div>
  )
}

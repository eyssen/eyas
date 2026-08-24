import { useState, useEffect, useCallback, useRef } from 'react'
import { Bell, Check, CheckCheck, RotateCcw } from 'lucide-react'
import { api } from '@/lib/api'
import { useWebSocket } from '@/hooks/use-websocket'
import { WS_TOPICS } from '@/lib/ws-topics'
import { useAuthStore } from '@/stores/auth-store'
import { t } from '@/pages/notifications/i18n'

interface IdentityChangedData {
  agentId?: string
  agentName?: string
  diff?: string
  snapshot?: string
}

interface Notification {
  id: string
  event: string
  severity: 'info' | 'warning' | 'error' | 'critical'
  title: string
  body: string | null
  data?: IdentityChangedData
  readAt: string | null
  createdAt: string
}

const SEVERITY_COLORS: Record<string, string> = {
  info: 'bg-blue-500',
  warning: 'bg-yellow-500',
  error: 'bg-red-500',
  critical: 'bg-red-700',
}

export function NotificationBell() {
  const [open, setOpen] = useState(false)
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const panelRef = useRef<HTMLDivElement>(null)
  const { subscribe } = useWebSocket()
  const userId = useAuthStore((s) => s.user?.id)

  const fetchNotifications = useCallback(async () => {
    try {
      const data = await api.get<{ notifications: Notification[]; unreadCount: number }>('/notifications?limit=20')
      setNotifications(data.notifications)
      setUnreadCount(data.unreadCount)
    } catch {
      // Silently fail — user may not be authenticated yet
    }
  }, [])

  useEffect(() => {
    fetchNotifications()
    const interval = setInterval(fetchNotifications, 30_000)
    return () => clearInterval(interval)
  }, [fetchNotifications])

  // Subscribe to real-time notification updates via WebSocket
  useEffect(() => {
    if (!userId) return
    return subscribe(WS_TOPICS.notifications(userId), () => {
      fetchNotifications()
    })
  }, [userId, subscribe, fetchNotifications])

  // Close on outside click
  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  const markRead = async (id: string) => {
    try {
      await api.post(`/notifications/${id}/read`)
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, readAt: new Date().toISOString() } : n))
      setUnreadCount(prev => Math.max(0, prev - 1))
    } catch {
      // ignore
    }
  }

  const markAllRead = async () => {
    try {
      await api.post('/notifications/read-all')
      setNotifications(prev => prev.map(n => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })))
      setUnreadCount(0)
    } catch {
      // ignore
    }
  }

  const revertIdentity = async (n: Notification) => {
    const d = n.data
    if (!d?.agentId) return
    try {
      if (d.snapshot) {
        await api.put(`/agents/${d.agentId}/workspace/IDENTITY.md`, { body: d.snapshot })
      }
      await markRead(n.id)
    } catch (e: unknown) {
      console.error('Identity revert failed:', e)
    }
  }

  const formatTime = (iso: string) => {
    const d = new Date(iso)
    const now = new Date()
    const diffMs = now.getTime() - d.getTime()
    const diffMin = Math.floor(diffMs / 60_000)
    if (diffMin < 1) return 'now'
    if (diffMin < 60) return `${diffMin}m`
    const diffH = Math.floor(diffMin / 60)
    if (diffH < 24) return `${diffH}h`
    const diffD = Math.floor(diffH / 24)
    return `${diffD}d`
  }

  return (
    <div className="relative" ref={panelRef}>
      <button
        onClick={() => setOpen(prev => !prev)}
        className="h-8 w-8 flex items-center justify-center text-muted-foreground hover:text-foreground rounded-md transition-colors relative"
      >
        <Bell className="h-4 w-4" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 flex items-center justify-center bg-red-500 text-white text-[10px] font-bold rounded-full leading-none">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-10 w-80 max-h-[420px] bg-popover border border-border rounded-lg shadow-lg overflow-hidden z-50">
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-border">
            <span className="text-sm font-semibold text-foreground">{t('notifications')}</span>
            {unreadCount > 0 && (
              <button
                onClick={markAllRead}
                className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
              >
                <CheckCheck className="h-3 w-3" />
                {t('mark_all_read')}
              </button>
            )}
          </div>

          {/* List */}
          <div className="overflow-y-auto max-h-[420px]">
            {notifications.length === 0 ? (
              <div className="px-3 py-8 text-center text-sm text-muted-foreground">
                {t('no_notifications')}
              </div>
            ) : (
              notifications.map(n => {
                if (n.event === 'agent.identity_changed') {
                  const d = n.data
                  const agentName = d?.agentName ?? 'Agent'
                  return (
                    <div
                      key={n.id}
                      className={`px-3 py-3 border-b border-border/50 ${!n.readAt ? 'bg-violet-500/5' : ''}`}
                    >
                      {/* Severity dot + title */}
                      <div className="flex items-start gap-2 mb-1.5">
                        <div className="pt-1.5 flex-shrink-0">
                          <div className="w-2 h-2 rounded-full bg-violet-500" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-foreground">
                            {t('identity_changed_title', { agentName })}
                          </div>
                          <div className="text-[10px] text-muted-foreground/60 mt-0.5">
                            {formatTime(n.createdAt)}
                          </div>
                        </div>
                      </div>
                      {/* Diff snippet */}
                      {d?.diff && (
                        <div className="ml-4 mb-2">
                          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1">
                            {t('identity_changed_diff_label')}
                          </div>
                          <pre className="text-[10px] text-muted-foreground bg-accent/30 rounded p-2 max-h-[80px] overflow-y-auto whitespace-pre-wrap font-mono">
                            {d.diff}
                          </pre>
                        </div>
                      )}
                      {/* Action buttons */}
                      <div className="ml-4 flex gap-2">
                        <button
                          onClick={() => markRead(n.id)}
                          className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-md bg-accent/30 hover:bg-accent/50 text-muted-foreground hover:text-foreground transition-colors"
                        >
                          <Check className="h-3 w-3" />
                          {t('identity_changed_approve')}
                        </button>
                        {d?.snapshot && (
                          <button
                            onClick={() => revertIdentity(n)}
                            className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-md bg-amber-500/10 hover:bg-amber-500/20 text-amber-500 hover:text-amber-400 transition-colors"
                          >
                            <RotateCcw className="h-3 w-3" />
                            {t('identity_changed_revert')}
                          </button>
                        )}
                      </div>
                    </div>
                  )
                }

                return (
                  <button
                    key={n.id}
                    onClick={() => !n.readAt && markRead(n.id)}
                    className={`w-full text-left px-3 py-2.5 border-b border-border/50 hover:bg-accent/50 transition-colors flex gap-2.5 ${
                      !n.readAt ? 'bg-accent/20' : ''
                    }`}
                  >
                    {/* Severity dot */}
                    <div className="pt-1.5 flex-shrink-0">
                      <div className={`w-2 h-2 rounded-full ${SEVERITY_COLORS[n.severity] ?? SEVERITY_COLORS.info}`} />
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-foreground truncate">{n.title}</div>
                      {n.body && (
                        <div className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{n.body}</div>
                      )}
                      <div className="text-[10px] text-muted-foreground/60 mt-1">{formatTime(n.createdAt)}</div>
                    </div>

                    {/* Read indicator */}
                    {!n.readAt && (
                      <div className="pt-1 flex-shrink-0">
                        <Check className="h-3 w-3 text-muted-foreground/40" />
                      </div>
                    )}
                  </button>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}

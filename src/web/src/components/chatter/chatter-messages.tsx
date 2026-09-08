import { useMemo } from 'react'
import { useApi } from '@/hooks/use-api'
import { Badge } from '@/components/ui/badge'
import { ArrowRight } from 'lucide-react'
import { t } from '@/pages/conversations/i18n'

interface TrackingChange {
  field: string
  oldValue: string | null
  newValue: string | null
}

interface ChatterMessage {
  id: string
  authorId: string | null
  authorName: string | null
  body: string
  messageType: string
  /** Backend field name */
  tracking?: TrackingChange[]
  createdAt: string
}

export type HistoryFilter = 'all' | 'notes' | 'changes'

interface ChatterMessageListProps {
  conversationId: string
  refreshKey: number
  filter?: HistoryFilter
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return t('conversations.list.timeJustNow')
  if (mins < 60) return t('conversations.list.timeMinutes', { count: mins })
  const hours = Math.floor(mins / 60)
  if (hours < 24) return t('conversations.list.timeHours', { count: hours })
  return t('conversations.list.timeDays', { count: Math.floor(hours / 24) })
}

function dayKey(dateStr: string): string {
  return new Date(dateStr).toISOString().slice(0, 10)
}

function dayLabel(isoDay: string): string {
  const today = new Date().toISOString().slice(0, 10)
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
  if (isoDay === today) return t('conversations.chatter.today')
  if (isoDay === yesterday) return t('conversations.chatter.yesterday')
  return isoDay
}

function authorInitial(name: string | null): string {
  if (!name) return '?'
  return name.charAt(0).toUpperCase()
}

function fieldLabel(field: string): string {
  const key = `conversations.chatter.field.${field}` as const
  const translated = t(key)
  return translated === key ? field : translated
}

export function ChatterMessageList({
  conversationId,
  refreshKey,
  filter = 'all',
}: ChatterMessageListProps) {
  const { data } = useApi<{ messages: ChatterMessage[] }>(
    `/chatter/conversation/${conversationId}/messages?_r=${refreshKey}`
  )

  const messages = useMemo(() => {
    const all = data?.messages ?? []
    if (filter === 'notes') return all.filter((m) => m.messageType === 'note' || m.messageType === 'comment')
    if (filter === 'changes') return all.filter((m) => m.messageType === 'tracking')
    return all
  }, [data?.messages, filter])

  const groups = useMemo(() => {
    const map = new Map<string, ChatterMessage[]>()
    for (const msg of messages) {
      const key = dayKey(msg.createdAt)
      const list = map.get(key) ?? []
      list.push(msg)
      map.set(key, list)
    }
    return Array.from(map.entries())
  }, [messages])

  if (messages.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-1 h-32 px-4 text-center">
        <p className="text-sm text-muted-foreground">{t('conversations.chatter.emptyTitle')}</p>
        <p className="text-[11px] text-muted-foreground/80">{t('conversations.chatter.emptyHint')}</p>
      </div>
    )
  }

  return (
    <div className="p-3 space-y-4">
      {groups.map(([day, items]) => (
        <div key={day}>
          <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-2 px-0.5">
            {dayLabel(day)}
          </div>
          <div className="space-y-3">
            {items.map((msg) => (
              <div key={msg.id} className="flex gap-2.5">
                <div className="h-7 w-7 rounded-full bg-accent/60 flex items-center justify-center flex-shrink-0 text-xs font-medium">
                  {authorInitial(msg.authorName)}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-xs font-medium truncate">
                      {msg.authorName || t('conversations.chatter.system')}
                    </span>
                    {msg.messageType === 'note' && (
                      <Badge
                        variant="outline"
                        className="text-[9px] bg-yellow-500/10 text-yellow-500 border-yellow-500/30"
                      >
                        {t('conversations.chatter.badgeNote')}
                      </Badge>
                    )}
                    {msg.messageType === 'tracking' && (
                      <Badge
                        variant="outline"
                        className="text-[9px] bg-blue-500/10 text-blue-500 border-blue-500/30"
                      >
                        {t('conversations.chatter.badgeUpdate')}
                      </Badge>
                    )}
                    <span className="text-[10px] text-muted-foreground ml-auto flex-shrink-0">
                      {timeAgo(msg.createdAt)}
                    </span>
                  </div>

                  {msg.messageType === 'tracking' && (msg.tracking?.length ?? 0) > 0 ? (
                    <div className="space-y-0.5">
                      {msg.tracking!.map((tv, i) => (
                        <div key={i} className="text-xs text-muted-foreground flex items-center gap-1 flex-wrap">
                          <span className="font-medium text-foreground/70">{fieldLabel(tv.field)}:</span>
                          <span>{tv.oldValue || t('conversations.chatter.emptyValue')}</span>
                          <ArrowRight className="h-3 w-3 flex-shrink-0" />
                          <span className="text-foreground">{tv.newValue || t('conversations.chatter.emptyValue')}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    msg.body && (
                      <p className="text-xs text-foreground/80 whitespace-pre-wrap">{msg.body}</p>
                    )
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

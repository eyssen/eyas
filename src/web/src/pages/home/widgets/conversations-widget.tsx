// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Lifted from dashboard-page.tsx:388-410 (recent conversations list):
// useApi -> useWidgetData, DashboardSection -> no wrapper (home-page.tsx
// already supplies the tile's WidgetFrame chrome — see attention-widget.tsx
// for why a second one here would nest two headers).
//
// Still calls pickPinned even though this tile never renders the pinned
// list itself (that's a future/separate concern) — pinnedIds is what
// pickRecent's excludeIds needs so an already-pinned conversation doesn't
// also show up here, exactly as it doesn't on the dashboard.
import { useCallback, useMemo } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Pin } from 'lucide-react'
import { pickPinned, pickRecent, relativeTime, type DashboardConversation } from '../dashboard-utils'
import { StatusDot } from '../status-dot'
import { useWidgetData } from '../use-widget-data'
import { DashboardRow } from '../widget-frame'
import { t } from '../i18n'

interface ConversationsResponse {
  conversations: DashboardConversation[]
}

// Reuses the dashboard's own untitled-conversation and relative-time i18n
// keys verbatim — same strings, same six locales, no new keys needed.
function convTitle(c: DashboardConversation): string {
  return c.title?.trim() || t('home.widget.conversations.untitled')
}

function formatRelative(code: string): string {
  if (!code) return ''
  if (code === 'just_now') return t('home.widget.time.justNow')
  if (code.startsWith('m:')) return t('home.widget.time.minutes', { count: code.slice(2) })
  if (code.startsWith('h:')) return t('home.widget.time.hours', { count: code.slice(2) })
  if (code.startsWith('d:')) return t('home.widget.time.days', { count: code.slice(2) })
  return code
}

const REFRESH = { pollMs: 60_000 }

export function ConversationsWidget({
  config: _config,
  onConfigChange: _onConfigChange,
}: {
  config: unknown
  onConfigChange: (next: unknown) => void
}) {
  const navigate = useNavigate()
  const { data, error, isLoading, tileRef } = useWidgetData<ConversationsResponse>('/conversations?active=true', REFRESH)

  const conversations = data?.conversations ?? []
  const pinnedIds = useMemo(() => new Set(pickPinned(conversations).map((c) => c.id)), [conversations])
  const recent = useMemo(() => pickRecent(conversations, 6, pinnedIds), [conversations, pinnedIds])

  const openConv = useCallback(
    (id: string) => {
      navigate({ to: '/conversations/$conversationId', params: { conversationId: id } })
    },
    [navigate],
  )

  // A dead /conversations endpoint used to render as "no active
  // conversations" — see the idiom note at the top of pulse-widget.tsx: the
  // empty state is a claim about the world, and a tile that never reached the
  // backend has not earned it.
  const hasError = !!error && !data
  const isEmpty = !isLoading && recent.length === 0

  return (
    <div ref={tileRef}>
      {isLoading ? (
        <p className="text-xs text-muted-foreground py-2">{t('home.widget.loading')}</p>
      ) : hasError ? (
        <p className="text-xs text-muted-foreground py-2">{t('home.widget.error')}</p>
      ) : isEmpty ? (
        <p className="text-xs text-muted-foreground py-2">{t('home.widget.conversations.empty')}</p>
      ) : (
        <ul className="flex flex-col gap-0.5 -mx-1">
          {recent.map((c) => (
            <li key={c.id}>
              <DashboardRow onClick={() => openConv(c.id)}>
                <StatusDot status={c.status} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate">{convTitle(c)}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {formatRelative(relativeTime(c.updatedAt))}
                  </div>
                </div>
                {c.pinned && <Pin className="h-3 w-3 text-muted-foreground shrink-0 mt-1" />}
              </DashboardRow>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

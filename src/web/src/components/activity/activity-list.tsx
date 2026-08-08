import { useApi } from '@/hooks/use-api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Check, Clock, AlertTriangle, CalendarClock, Plus, X } from 'lucide-react'
import { api } from '@/lib/api'
import { useState } from 'react'
import { t } from '@/pages/conversations/i18n'

interface ActivityItem {
  id: string
  typeId?: string
  typeName: string
  summary: string | null
  deadline: string | null
  dateDeadline?: string | null
  doneAt?: string | null
  state: string
  userId: string | null
  userName: string | null
  createdAt: string
}

interface ActivityType {
  id: string
  name: string
  icon: string | null
}

interface ActivityListProps {
  resModel: string
  resId: string
}

function groupActivities(activities: ActivityItem[]) {
  const overdue: ActivityItem[] = []
  const today: ActivityItem[] = []
  const planned: ActivityItem[] = []

  const todayStr = new Date().toISOString().slice(0, 10)

  for (const act of activities) {
    if (act.doneAt) continue
    const deadline = act.deadline ?? act.dateDeadline
    if (!deadline) {
      planned.push(act)
      continue
    }
    const deadlineStr = deadline.slice(0, 10)
    if (deadlineStr < todayStr) {
      overdue.push(act)
    } else if (deadlineStr === todayStr) {
      today.push(act)
    } else {
      planned.push(act)
    }
  }

  return { overdue, today, planned }
}

function ActivityGroup({
  title,
  icon,
  color,
  activities,
  onDone,
}: {
  title: string
  icon: React.ReactNode
  color: string
  activities: ActivityItem[]
  onDone: (id: string) => void
}) {
  if (activities.length === 0) return null

  return (
    <div className="mb-3">
      <div className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium ${color}`}>
        {icon}
        {title} ({activities.length})
      </div>
      <div className="space-y-1 px-3">
        {activities.map((act) => {
          const deadline = act.deadline ?? act.dateDeadline
          return (
            <div
              key={act.id}
              className="flex items-center gap-2 py-1.5 group hover:bg-accent/20 rounded px-2 -mx-2"
            >
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium truncate">
                  {act.summary || act.typeName}
                </div>
                {act.summary && (
                  <div className="text-[10px] text-muted-foreground">{act.typeName}</div>
                )}
                {deadline && (
                  <div className="text-[10px] text-muted-foreground">
                    {t('conversations.chatter.due')}: {deadline.slice(0, 10)}
                  </div>
                )}
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={() => onDone(act.id)}
                title={t('conversations.chatter.markDone')}
              >
                <Check className="h-3 w-3 text-emerald-500" />
              </Button>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function defaultDeadline(): string {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  return d.toISOString().slice(0, 10)
}

export function ActivityList({ resModel, resId }: ActivityListProps) {
  const { data, refetch } = useApi<{ activities: ActivityItem[] }>(
    `/activities?resModel=${resModel}&resId=${resId}`
  )
  const { data: typesData } = useApi<{ activityTypes: ActivityType[] }>('/activity-types')
  const [completing, setCompleting] = useState<string | null>(null)
  const [scheduling, setScheduling] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [typeId, setTypeId] = useState('')
  const [summary, setSummary] = useState('')
  const [deadline, setDeadline] = useState(defaultDeadline)

  const activities = data?.activities ?? []
  const types = typesData?.activityTypes ?? []
  const { overdue, today, planned } = groupActivities(activities)
  const doneCount = activities.filter((a) => Boolean(a.doneAt)).length

  // Default type once loaded
  const effectiveTypeId = typeId || types[0]?.id || ''

  const handleDone = async (id: string) => {
    setCompleting(id)
    try {
      await api.post(`/activities/${id}/done`, {})
      refetch()
    } catch (err) {
      console.error('Failed to complete activity:', err)
    } finally {
      setCompleting(null)
    }
  }

  const handleSchedule = async () => {
    if (!effectiveTypeId || !deadline || scheduling) return
    setScheduling(true)
    try {
      await api.post('/activities', {
        typeId: effectiveTypeId,
        resModel,
        resId,
        summary: summary.trim() || undefined,
        dateDeadline: deadline,
      })
      setSummary('')
      setDeadline(defaultDeadline())
      setShowForm(false)
      refetch()
    } catch (err) {
      console.error('Failed to schedule activity:', err)
    } finally {
      setScheduling(false)
    }
  }

  void completing

  return (
    <div className="py-2 flex flex-col min-h-0">
      <div className="flex items-center justify-between px-3 mb-2">
        <span className="text-[11px] text-muted-foreground">{t('conversations.chatter.nextHint')}</span>
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-[11px] gap-1"
          onClick={() => setShowForm((v) => !v)}
        >
          {showForm ? <X className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
          {showForm ? t('conversations.chatter.cancel') : t('conversations.chatter.schedule')}
        </Button>
      </div>

      {showForm && (
        <div className="mx-3 mb-3 p-2.5 rounded-lg border border-border/50 bg-accent/20 space-y-2">
          <label className="block text-[10px] font-medium text-muted-foreground">
            {t('conversations.chatter.activityType')}
            <select
              value={effectiveTypeId}
              onChange={(e) => setTypeId(e.target.value)}
              className="mt-0.5 w-full h-8 rounded border border-border/50 bg-background px-2 text-xs"
            >
              {types.length === 0 && <option value="">{t('conversations.chatter.loadingTypes')}</option>}
              {types.map((ty) => (
                <option key={ty.id} value={ty.id}>
                  {ty.icon ? `${ty.icon} ` : ''}
                  {ty.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-[10px] font-medium text-muted-foreground">
            {t('conversations.chatter.summary')}
            <input
              type="text"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder={t('conversations.chatter.summaryPlaceholder')}
              className="mt-0.5 w-full h-8 rounded border border-border/50 bg-background px-2 text-xs"
            />
          </label>
          <label className="block text-[10px] font-medium text-muted-foreground">
            {t('conversations.chatter.deadline')}
            <input
              type="date"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
              className="mt-0.5 w-full h-8 rounded border border-border/50 bg-background px-2 text-xs"
            />
          </label>
          <Button
            size="sm"
            className="h-7 w-full text-[11px]"
            disabled={scheduling || !effectiveTypeId || !deadline}
            onClick={handleSchedule}
          >
            {scheduling ? t('conversations.chatter.scheduling') : t('conversations.chatter.scheduleConfirm')}
          </Button>
        </div>
      )}

      {activities.length === 0 && !showForm ? (
        <div className="flex flex-col items-center justify-center h-28 px-4 text-center gap-1">
          <p className="text-sm text-muted-foreground">{t('conversations.chatter.noActivities')}</p>
          <p className="text-[11px] text-muted-foreground/80">{t('conversations.chatter.noActivitiesHint')}</p>
        </div>
      ) : (
        <>
          <ActivityGroup
            title={t('conversations.chatter.overdue')}
            icon={<AlertTriangle className="h-3.5 w-3.5" />}
            color="text-red-400"
            activities={overdue}
            onDone={handleDone}
          />
          <ActivityGroup
            title={t('conversations.chatter.todayGroup')}
            icon={<Clock className="h-3.5 w-3.5" />}
            color="text-orange-400"
            activities={today}
            onDone={handleDone}
          />
          <ActivityGroup
            title={t('conversations.chatter.planned')}
            icon={<CalendarClock className="h-3.5 w-3.5" />}
            color="text-blue-400"
            activities={planned}
            onDone={handleDone}
          />
          {doneCount > 0 && (
            <div className="px-3 mt-2">
              <Badge variant="outline" className="text-[10px] text-muted-foreground">
                {t('conversations.chatter.completedCount', { count: doneCount })}
              </Badge>
            </div>
          )}
        </>
      )}
    </div>
  )
}

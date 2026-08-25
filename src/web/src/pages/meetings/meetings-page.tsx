import { useApi } from '@/hooks/use-api'
import { Badge } from '@/components/ui/badge'
import { Mic, Construction, Clock, Users } from 'lucide-react'
import { t } from './i18n'
import { ContextualHelp } from '@/components/docs/contextual-help'

interface Meeting {
  id: string
  title: string
  date: string
  duration: number
  participants: string[]
  status: string
}

export default function MeetingsPage() {
  const { data } = useApi<{ meetings: Meeting[] }>('/meetings')
  const meetings = data?.meetings || []

  return (
    <div>
      <div className="mb-5">
        <h1 className="page-title inline-flex items-center gap-1.5">{t('meetings.title')} <ContextualHelp helpId="knowledge.meetings" /></h1>
        <p className="text-sm text-muted-foreground">{t('meetings.subtitle')}</p>
      </div>

      {/* Coming Soon banner */}
      <div className="glass-card p-6 mb-4 border-dashed opacity-90">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-accent/50 flex items-center justify-center">
            <Construction className="h-5 w-5 text-muted-foreground" />
          </div>
          <div>
            <div className="flex items-center gap-2 mb-0.5">
              <span className="text-sm font-medium">{t('meetings.comingSoon')}</span>
              <Badge variant="outline" className="text-[10px]">{t('meetings.planned')}</Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              {t('meetings.developmentNote')}
            </p>
          </div>
        </div>
      </div>

      {/* Meetings list (if any exist) */}
      {meetings.length > 0 ? (
        <div className="glass-card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--vibrancy-border)]">
                <th className="text-left p-3 section-label">{t('meetings.colTitle')}</th>
                <th className="text-left p-3 section-label">{t('meetings.colDate')}</th>
                <th className="text-left p-3 section-label">{t('meetings.colDuration')}</th>
                <th className="text-left p-3 section-label">{t('meetings.colParticipants')}</th>
                <th className="text-left p-3 section-label">{t('common.status')}</th>
              </tr>
            </thead>
            <tbody>
              {meetings.map((m) => (
                <tr key={m.id} className="border-b border-[var(--vibrancy-border)] last:border-0">
                  <td className="p-3 font-medium">{m.title}</td>
                  <td className="p-3 text-muted-foreground">{new Date(m.date).toLocaleDateString()}</td>
                  <td className="p-3 text-muted-foreground flex items-center gap-1">
                    <Clock className="h-3 w-3" /> {t('meetings.durationMinutes', { n: m.duration })}
                  </td>
                  <td className="p-3 text-muted-foreground flex items-center gap-1">
                    <Users className="h-3 w-3" /> {m.participants.length}
                  </td>
                  <td className="p-3">
                    <Badge variant="outline" className="text-[10px]">{m.status}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="glass-card p-12 text-center">
          <Mic className="h-10 w-10 mx-auto mb-3 text-muted-foreground opacity-50" />
          <p className="text-sm text-muted-foreground">{t('meetings.empty')}</p>
        </div>
      )}
    </div>
  )
}

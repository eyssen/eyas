// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { useApi } from '@/hooks/use-api'
import { Sparkles } from 'lucide-react'
import { t } from './i18n'

/** Cap 6 dream-engine — shows the latest nightly reflection digest as a briefing. */
export default function BriefingCard() {
  const { data } = useApi<{ briefing: string | null }>('/memory/briefing')
  if (!data?.briefing) return null
  return (
    <div className="glass-card p-4 mb-4">
      <div className="flex items-center gap-2 mb-2">
        <Sparkles className="h-4 w-4 text-indigo-400" />
        <span className="text-sm font-medium">{t('memory.briefing.title')}</span>
      </div>
      <pre className="text-xs text-muted-foreground whitespace-pre-wrap font-sans m-0">{data.briefing}</pre>
    </div>
  )
}

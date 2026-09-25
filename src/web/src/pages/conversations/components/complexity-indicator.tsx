// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { Badge } from '@/components/ui/badge'
import { t } from '../i18n'

interface ComplexityIndicatorProps {
  mode: string
  complexity?: string | null
}

const MODE_STYLES: Record<string, { className: string; labelKey: string }> = {
  simple: { className: 'bg-zinc-500/20 text-zinc-400 border-zinc-500/30', labelKey: 'conversations.complexity.simple' },
  managed: { className: 'bg-blue-500/20 text-blue-400 border-blue-500/30', labelKey: 'conversations.complexity.managed' },
  autonomous: { className: 'bg-purple-500/20 text-purple-400 border-purple-500/30', labelKey: 'conversations.complexity.autonomous' },
  wizard: { className: 'bg-amber-500/20 text-amber-400 border-amber-500/30', labelKey: 'conversations.complexity.wizard' },
}

export function ComplexityIndicator({ mode, complexity }: ComplexityIndicatorProps) {
  const style = MODE_STYLES[mode] ?? MODE_STYLES.simple

  return (
    <div className="flex items-center gap-1.5">
      <Badge variant="outline" className={`text-[10px] ${style.className}`}>
        {t(style.labelKey)}
      </Badge>
      {complexity && (
        <span className="text-[10px] text-muted-foreground capitalize">{complexity}</span>
      )}
    </div>
  )
}

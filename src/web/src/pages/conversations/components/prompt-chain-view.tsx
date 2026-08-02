// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { Badge } from '@/components/ui/badge'
import { ArrowDown } from 'lucide-react'
import { t } from '../i18n'

interface PromptLevel {
  label: string
  name: string | null
  preview: string | null
  isActive: boolean
  onEdit?: () => void
}

interface PromptChainViewProps {
  levels: PromptLevel[]
}

export function PromptChainView({ levels }: PromptChainViewProps) {
  return (
    <div className="space-y-1">
      {levels.map((level, i) => (
        <div key={level.label}>
          <div
            className={`rounded-lg border p-3 transition-colors ${
              level.isActive
                ? 'border-purple-500/30 bg-purple-500/5'
                : 'border-border/30 bg-accent/10 opacity-60'
            } ${level.onEdit ? 'cursor-pointer hover:bg-accent/20' : ''}`}
            onClick={level.onEdit}
          >
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                {level.label}
              </span>
              {level.isActive ? (
                <Badge variant="secondary" className="text-[9px] text-emerald-500">{t('common.active')}</Badge>
              ) : (
                <Badge variant="outline" className="text-[9px] text-muted-foreground">{t('common.inactive')}</Badge>
              )}
            </div>
            {level.name && (
              <div className="text-xs font-medium truncate">{level.name}</div>
            )}
            {level.preview ? (
              <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">{level.preview}</p>
            ) : (
              <p className="text-[11px] text-muted-foreground mt-0.5 italic">{t('conversations.promptChain.noPrompt')}</p>
            )}
          </div>

          {i < levels.length - 1 && (
            <div className="flex justify-center py-0.5">
              <ArrowDown className="h-3 w-3 text-muted-foreground/40" />
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

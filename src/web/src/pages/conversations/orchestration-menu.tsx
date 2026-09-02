// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { Check } from 'lucide-react'
import { useApi } from '@/hooks/use-api'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { t } from './i18n'
import { nextFieldsOnMenuPick, type OrchestrationMenuPick } from './orchestration-menu-utils'

interface GodModeConfigResponse {
  participants?: Array<unknown>
}

interface OrchestrationMenuProps {
  orchestration: string
  godMode: boolean
  onUpdate: (fields: Record<string, unknown>) => void
}

const ORCH_ITEMS: Array<{ pick: Exclude<OrchestrationMenuPick, 'god'>; labelKey: string }> = [
  { pick: 'solo', labelKey: 'conversations.fields.orchestrationSolo' },
  { pick: 'auto', labelKey: 'conversations.fields.orchestrationAuto' },
  { pick: 'deep', labelKey: 'conversations.fields.orchestrationDeep' },
]

const triggerClass =
  'h-7 px-2 bg-accent/30 border border-border/50 rounded-md focus:outline-none focus:ring-1 focus:ring-ring text-xs'

function closedLabel(orchestration: string, godMode: boolean): string {
  if (godMode) return t('conversations.fields.orchestrationGod')
  if (orchestration === 'solo') return t('conversations.fields.orchestrationSolo')
  if (orchestration === 'deep') return t('conversations.fields.orchestrationDeep')
  return t('conversations.fields.orchestrationAuto')
}

export function OrchestrationMenu({ orchestration, godMode, onUpdate }: OrchestrationMenuProps) {
  const { data: config } = useApi<GodModeConfigResponse>('/god-mode/config')
  const participantCount = config?.participants?.length ?? 0
  const rosterHint = participantCount < 2

  const pick = (value: OrchestrationMenuPick) => {
    onUpdate(nextFieldsOnMenuPick(value, { orchestration: orchestration || 'auto', godMode }))
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title={t('conversations.fields.orchestrationHint')}
          className={cn(
            triggerClass,
            godMode && 'bg-god text-god-foreground border-god font-semibold',
          )}
        >
          {closedLabel(orchestration, godMode)}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[12rem] text-xs">
        {ORCH_ITEMS.map((item) => {
          const selected = !godMode && (orchestration || 'auto') === item.pick
          return (
            <DropdownMenuItem
              key={item.pick}
              className="text-xs"
              onSelect={() => pick(item.pick)}
            >
              <Check className={cn('h-3 w-3', selected ? 'opacity-100' : 'opacity-0')} />
              {t(item.labelKey)}
            </DropdownMenuItem>
          )
        })}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className={cn(
            'text-xs font-semibold text-god',
            'focus:bg-god focus:text-god-foreground',
            'data-[highlighted]:bg-god data-[highlighted]:text-god-foreground',
            '[&_svg]:text-current',
            godMode && 'bg-god text-god-foreground',
          )}
          title={rosterHint ? t('conversations.fields.orchestrationGodDisabled') : undefined}
          onSelect={() => pick('god')}
        >
          <Check className={cn('h-3 w-3', godMode ? 'opacity-100' : 'opacity-0')} />
          {t('conversations.fields.orchestrationGod')}
        </DropdownMenuItem>
        {rosterHint && (
          <p className="px-2 pb-1.5 pt-0.5 text-[10px] leading-snug text-muted-foreground">
            {t('conversations.fields.orchestrationGodDisabled')}
          </p>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export { nextFieldsOnMenuPick }

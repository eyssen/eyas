// Part of eYssen. See LICENSE file for full copyright and licensing details.

/**
 * MVP NOTE: There is no backend GET endpoint that returns the resolved voice scope
 * for a conversation. This badge shows the user-set override (or "Auto" if none).
 * The resolved scope (internal vs external based on participants) is determined
 * server-side at message time and is not surfaced to the frontend in the current API.
 * Label shows "INTERNAL (default)" / "EXTERNAL (default)" when auto-resolved.
 */

import { Badge } from '@/components/ui/badge'
import { setVoiceScopeOverride } from '@/api/conversations'
import type { VoiceScope } from '@/api/conversations'
import { t } from '../i18n'

interface Props {
  conversationId: string
  currentScope: VoiceScope
  onChange?: (scope: VoiceScope) => void
}

const SCOPE_LABEL_KEYS: Record<string, string> = {
  internal: 'conversations.voiceScope.scopeInternal',
  external: 'conversations.voiceScope.scopeExternal',
  auto: 'conversations.voiceScope.scopeAuto',
}

const SCOPE_CLASS: Record<string, string> = {
  internal: 'text-blue-400 border-blue-400/30 bg-blue-400/10',
  external: 'text-emerald-400 border-emerald-400/30 bg-emerald-400/10',
  auto: 'text-muted-foreground',
}

export function VoiceScopeBadge({ conversationId, currentScope, onChange }: Props) {
  const displayKey = currentScope ?? 'auto'

  const handleChange = async (value: string) => {
    const scope: VoiceScope = value === 'auto' ? null : value as VoiceScope
    try {
      await setVoiceScopeOverride(conversationId, scope)
      onChange?.(scope)
    } catch {
      // silently ignore — backend may not support this on all conversations
    }
  }

  return (
    <div className="flex items-center gap-1.5">
      <Badge
        variant="outline"
        className={`text-[10px] ${SCOPE_CLASS[displayKey] ?? SCOPE_CLASS.auto}`}
      >
        {t('conversations.voiceScope.prefix')}: {SCOPE_LABEL_KEYS[displayKey] ? t(SCOPE_LABEL_KEYS[displayKey]) : displayKey.toUpperCase()}
        {displayKey === 'auto' && ` ${t('conversations.voiceScope.defaultSuffix')}`}
      </Badge>
      <select
        value={displayKey}
        onChange={(e) => handleChange(e.target.value)}
        className="h-6 px-1.5 text-[10px] bg-accent/30 border border-border/50 rounded-md focus:outline-none focus:ring-1 focus:ring-ring"
        title={t('conversations.voiceScope.overrideTitle')}
      >
        <option value="auto">{t('conversations.voiceScope.optAuto')}</option>
        <option value="internal">{t('conversations.voiceScope.optForceInternal')}</option>
        <option value="external">{t('conversations.voiceScope.optForceExternal')}</option>
      </select>
    </div>
  )
}

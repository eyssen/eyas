import { useState } from 'react'
import { useApi } from '@/hooks/use-api'
import { api, ApiError } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Sparkles } from 'lucide-react'
import { t } from './i18n'

interface FeatureFlag {
  key: string
  enabled: boolean
}

// Maps runtime feature-flag keys to their i18n label/description keys. Resolved
// with t() at render time so it follows the active language.
const LOOP_INFO: Record<string, { labelKey: string; descKey: string }> = {
  'proactive.heartbeat': {
    labelKey: 'settings.autonomy.loop.proactiveHeartbeat.label',
    descKey: 'settings.autonomy.loop.proactiveHeartbeat.desc',
  },
  'memory.reflection': {
    labelKey: 'settings.autonomy.loop.nightlyReflection.label',
    descKey: 'settings.autonomy.loop.nightlyReflection.desc',
  },
  'forge.apply': {
    labelKey: 'settings.autonomy.loop.forgeProposals.label',
    descKey: 'settings.autonomy.loop.forgeProposals.desc',
  },
  'selfLearning.apply': {
    labelKey: 'settings.autonomy.loop.selfLearning.label',
    descKey: 'settings.autonomy.loop.selfLearning.desc',
  },
  'skill.adopt': {
    labelKey: 'settings.autonomy.loop.skillAdoption.label',
    descKey: 'settings.autonomy.loop.skillAdoption.desc',
  },
}

/**
 * Settings card for the Phase-3 self-improvement loops. Lists the runtime
 * feature flags from GET /api/v1/autonomy/features and toggles each via
 * PATCH /api/v1/autonomy/features/:key (requires 'update Autonomy'). All
 * loops are OFF by default; this is the only place they can be turned on.
 */
export default function AutonomyFeaturesCard() {
  const { data, isLoading, error, refetch } = useApi<{ features: FeatureFlag[] }>('/autonomy/features')
  const [pending, setPending] = useState<string | null>(null)
  const [toggleError, setToggleError] = useState<string | null>(null)

  const features = data?.features ?? []

  async function toggle(key: string, enabled: boolean) {
    setPending(key)
    setToggleError(null)
    try {
      await api.patch(`/autonomy/features/${key}`, { enabled })
      refetch()
    } catch (e) {
      setToggleError(e instanceof ApiError ? e.message : t('settings.autonomy.updateError'))
    } finally {
      setPending(null)
    }
  }

  return (
    <div className="glass-card p-4">
      <h3 className="text-sm font-semibold mb-1 flex items-center gap-2">
        <Sparkles className="h-4 w-4" /> {t('settings.autonomy.heading')}
      </h3>
      <p className="text-xs text-muted-foreground mb-3">
        {t('settings.autonomy.subtitle')}
      </p>

      {error && (
        <div className="flex items-center gap-3">
          <p className="text-xs text-destructive">{t('settings.autonomy.loadError')}</p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>{t('common.retry')}</Button>
        </div>
      )}

      {!error && isLoading && <p className="text-xs text-muted-foreground">{t('common.loading')}</p>}

      {!error && !isLoading && (
        <div className="flex flex-col gap-2">
          {features.map((f) => {
            const info = LOOP_INFO[f.key]
            const label = info ? t(info.labelKey) : f.key
            const description = info ? t(info.descKey) : ''
            return (
              <div key={f.key} className="flex items-center gap-3 p-2 rounded-lg bg-accent/30">
                <div className="flex-1 min-w-0">
                  <p className="text-sm">{label}</p>
                  <p className="text-xs text-muted-foreground">{description}</p>
                </div>
                <Switch
                  checked={f.enabled}
                  disabled={pending === f.key}
                  onCheckedChange={(checked) => toggle(f.key, checked)}
                />
              </div>
            )
          })}
        </div>
      )}

      {toggleError && <p className="text-xs text-destructive mt-2">{toggleError}</p>}
    </div>
  )
}

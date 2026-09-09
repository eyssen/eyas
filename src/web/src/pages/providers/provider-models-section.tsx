import { useState } from 'react'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { RefreshCw } from 'lucide-react'
import { t } from './i18n'

interface ModelConfigItem {
  id: string
  modelId: string
  name: string
  enabled: boolean
  contextWindow: number | null
  maxOutputTokens: number | null
  supportsTools: boolean
  supportsImages: boolean
  supportsStreaming: boolean
}

interface ModelsSectionProps {
  providerId: string
  models: ModelConfigItem[]
  onModelsChanged: () => void
}

function formatNumber(n: number | null): string {
  if (n == null) return '—'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`
  return String(n)
}

export function ModelsSection({ providerId, models, onModelsChanged }: ModelsSectionProps) {
  const [refreshing, setRefreshing] = useState(false)

  const handleRefresh = async () => {
    setRefreshing(true)
    try {
      await api.post(`/model/providers/${providerId}/models/refresh`)
      onModelsChanged()
    } finally {
      setRefreshing(false)
    }
  }

  const handleToggleModel = async (modelId: string, enabled: boolean) => {
    await api.patch(`/model/providers/${providerId}/models/${modelId}`, { enabled })
    onModelsChanged()
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{t('providers.modelsSection.models', { count: models.length })}</span>
        <Button variant="outline" size="sm" onClick={handleRefresh} disabled={refreshing}>
          <RefreshCw className={`h-3 w-3 mr-1.5 ${refreshing ? 'animate-spin' : ''}`} />
          {providerId === 'claude-code' || providerId === 'grok-cli'
            ? t('providers.modelsSection.refreshCli')
            : t('providers.modelsSection.refreshApi')}
        </Button>
      </div>

      {models.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t('providers.modelsSection.noModels')}</p>
      ) : (
        <div className="space-y-1">
          {models.map(model => (
            <div key={model.id} className="flex items-center gap-3 p-2 rounded-md hover:bg-accent/30">
              <Switch
                checked={model.enabled}
                onCheckedChange={(checked) => handleToggleModel(model.id, checked)}
              />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{model.name}</div>
                <div className="text-[10px] text-muted-foreground font-mono truncate">{model.modelId}</div>
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                {model.contextWindow && (
                  <Badge variant="outline" className="text-[10px]">{t('providers.modelsSection.ctx', { count: formatNumber(model.contextWindow) })}</Badge>
                )}
                {model.supportsTools && (
                  <Badge variant="outline" className="text-[10px]">{t('providers.modelsSection.tools')}</Badge>
                )}
                {model.supportsImages && (
                  <Badge variant="outline" className="text-[10px]">{t('providers.modelsSection.vision')}</Badge>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

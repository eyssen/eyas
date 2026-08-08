import { useState } from 'react'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { t } from './i18n'

const SECRET_NAMES: Record<string, string> = {
  anthropic: 'anthropic-api-key',
  openai: 'openai-api-key',
  openrouter: 'openrouter-api-key',
  gemini: 'gemini-api-key',
  kimi: 'kimi-api-key',
  xai: 'xai-api-key',
  mistral: 'mistral-api-key',
  groq: 'groq-api-key',
  together: 'together-api-key',
  deepseek: 'deepseek-api-key',
  cerebras: 'cerebras-api-key',
  venice: 'venice-api-key',
  huggingface: 'huggingface-api-key',
  nvidia: 'nvidia-api-key',
  zai: 'zai-api-key',
  kilocode: 'kilocode-api-key',
  'vercel-ai-gateway': 'vercel-ai-gateway-api-key',
  qianfan: 'qianfan-api-key',
  vllm: 'vllm-api-key',
  minimax: 'minimax-api-key',
  synthetic: 'synthetic-api-key',
  xiaomi: 'xiaomi-api-key',
}

interface ApiKeySectionProps {
  providerId: string
  hasApiKey: boolean | null
  onKeyChanged: () => void
}

export function ApiKeySection({ providerId, hasApiKey, onKeyChanged }: ApiKeySectionProps) {
  const [apiKey, setApiKey] = useState('')
  const [saving, setSaving] = useState(false)
  const secretName = SECRET_NAMES[providerId]

  if (!secretName) return null

  const handleSave = async () => {
    if (!apiKey) return
    setSaving(true)
    try {
      await api.post('/secrets', { name: secretName, scope: 'system', value: apiKey })
      await api.post(`/model/providers/${providerId}/reload`)
      setApiKey('')
      onKeyChanged()
    } finally {
      setSaving(false)
    }
  }

  const handleRemove = async () => {
    setSaving(true)
    try {
      await api.delete(`/secrets/${secretName}?scope=system`)
      await api.post(`/model/providers/${providerId}/reload`)
      onKeyChanged()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium">{t('providers.apiKeySection.apiKey')}</Label>
        {hasApiKey ? (
          <Badge variant="secondary" className="text-emerald-500 text-[10px]">{t('providers.apiKeySection.keySaved')}</Badge>
        ) : (
          <Badge variant="outline" className="text-muted-foreground text-[10px]">{t('providers.apiKeySection.noKey')}</Badge>
        )}
      </div>
      <div className="flex gap-2">
        <Input
          type="password"
          placeholder={t('providers.apiKeySection.placeholder')}
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          className="flex-1"
        />
        <Button size="sm" onClick={handleSave} disabled={saving || !apiKey}>
          {t('common.save')}
        </Button>
      </div>
      {hasApiKey && (
        <Button variant="outline" size="sm" onClick={handleRemove} disabled={saving} className="text-destructive">
          {t('providers.apiKeySection.removeKey')}
        </Button>
      )}
      <p className="text-xs text-muted-foreground">
        {t('providers.apiKeySection.hint')}
      </p>
    </div>
  )
}

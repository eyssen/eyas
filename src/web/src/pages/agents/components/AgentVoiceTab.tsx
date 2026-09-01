// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Save } from 'lucide-react'
import { loadSoulStyle, saveSoulStyle } from '@/api/soul'
import { SoulPresetPicker } from './SoulPresetPicker'
import { VoiceProfileEditor } from './VoiceProfileEditor'
import {
  applyPresetToInternal,
  applyPresetToExternal,
  detectPresetMatch,
} from '@shared/prompt-wizard/soul-presets'
import type { PresetKey } from '@shared/prompt-wizard/soul-presets'
import type { SoulStyleParsed, InternalProfile, ExternalProfile } from '@shared/prompt-wizard/soul-style-schema'
import { t } from '../i18n'

const DEFAULT_STYLE: SoulStyleParsed = {
  version: 1,
  preset: { internal: 'jarvis', external: 'jarvis' },
  internal: {
    address: 'magázó',
    tone: 'komoly',
    verbosity: 'lényegre törő',
    directness: 'direkt + udvarias',
    humor: 'nincs',
    emoji: 'soha',
    blockedPhrases: [],
    signature: '',
  },
  external: {
    address: 'magázó',
    tone: 'komoly',
    verbosity: 'lényegre törő',
    directness: 'direkt + udvarias',
    humor: 'nincs',
    emoji: 'soha',
    blockedPhrases: [],
    signature: '',
  },
}

interface Props {
  agentId: string
}

export function AgentVoiceTab({ agentId }: Props) {
  const [style, setStyle] = useState<SoulStyleParsed>(DEFAULT_STYLE)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    loadSoulStyle(agentId).then((data) => {
      if (data) setStyle(data)
      setLoading(false)
    })
  }, [agentId])

  const handleInternalPreset = useCallback((key: string) => {
    if (key === 'custom') return
    setStyle((prev) => ({
      ...prev,
      preset: { ...prev.preset, internal: key },
      internal: applyPresetToInternal(prev.internal, key as PresetKey),
    }))
  }, [])

  const handleExternalPreset = useCallback((key: string) => {
    if (key === 'custom') return
    setStyle((prev) => ({
      ...prev,
      preset: { ...prev.preset, external: key },
      external: applyPresetToExternal(prev.external, key as PresetKey),
    }))
  }, [])

  const handleInternalChange = useCallback((updated: InternalProfile) => {
    const detected = detectPresetMatch(updated)
    setStyle((prev) => ({
      ...prev,
      preset: { ...prev.preset, internal: detected },
      internal: updated,
    }))
  }, [])

  const handleExternalChange = useCallback((updated: ExternalProfile) => {
    const detected = detectPresetMatch(updated)
    setStyle((prev) => ({
      ...prev,
      preset: { ...prev.preset, external: detected },
      external: updated,
    }))
  }, [])

  const handleSave = useCallback(async () => {
    setSaving(true)
    setError(null)
    try {
      await saveSoulStyle(agentId, style)
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t('agents.voiceTab.saveError'))
    } finally {
      setSaving(false)
    }
  }, [agentId, style])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
        {t('agents.voiceTab.loading')}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Internal scope */}
        <div className="glass-card p-4 space-y-4">
          <SoulPresetPicker
            scope="internal"
            value={style.preset.internal}
            onChange={handleInternalPreset}
          />
          <VoiceProfileEditor
            scope="internal"
            profile={style.internal}
            onChange={handleInternalChange as (p: InternalProfile | ExternalProfile) => void}
          />
        </div>

        {/* External scope */}
        <div className="glass-card p-4 space-y-4">
          <SoulPresetPicker
            scope="external"
            value={style.preset.external}
            onChange={handleExternalPreset}
          />
          <VoiceProfileEditor
            scope="external"
            profile={style.external}
            onChange={handleExternalChange as (p: InternalProfile | ExternalProfile) => void}
          />
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex justify-end">
        <Button size="sm" onClick={handleSave} disabled={saving}>
          <Save className="h-3.5 w-3.5 mr-1" />
          {saved ? t('agents.voiceTab.saved') : saving ? t('agents.voiceTab.saving') : t('agents.voiceTab.save')}
        </Button>
      </div>
    </div>
  )
}

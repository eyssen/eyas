// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { Label } from '@/components/ui/label'
import { listPresets } from '@shared/prompt-wizard/soul-presets'
import { t } from '../i18n'

// Preset keys are backend identifiers; the display labels resolve to i18n keys
// at render time.
const PRESET_LABEL_KEYS: Record<string, string> = {
  jarvis: 'agents.soulPreset.label.jarvis',
  'best-buddy': 'agents.soulPreset.label.bestBuddy',
  'senior-ceo': 'agents.soulPreset.label.seniorCeo',
  'pajtas-dev': 'agents.soulPreset.label.pajtasDev',
  standup: 'agents.soulPreset.label.standup',
  diplomata: 'agents.soulPreset.label.diplomata',
  coach: 'agents.soulPreset.label.coach',
  tutor: 'agents.soulPreset.label.tutor',
  custom: 'agents.soulPreset.custom',
}

interface Props {
  scope: 'internal' | 'external'
  value: string
  onChange: (key: string) => void
}

export function SoulPresetPicker({ scope, value, onChange }: Props) {
  const presets = listPresets()

  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{scope === 'internal' ? t('agents.soulPreset.internal') : t('agents.soulPreset.external')}</Label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full h-8 rounded-md border border-border/50 bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
      >
        {presets.map((key) => (
          <option key={key} value={key}>
            {PRESET_LABEL_KEYS[key] ? t(PRESET_LABEL_KEYS[key]) : key}
          </option>
        ))}
        {value === 'custom' && (
          <option value="custom">{t('agents.soulPreset.custom')}</option>
        )}
        {value !== 'custom' && (
          <option value="custom" disabled style={{ color: 'var(--muted-foreground)' }}>
            {t('agents.soulPreset.customAuto')}
          </option>
        )}
      </select>
    </div>
  )
}

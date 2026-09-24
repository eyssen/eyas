// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { ENUM_VALUES } from '@shared/prompt-wizard/soul-style-schema'
import type { InternalProfile, ExternalProfile } from '@shared/prompt-wizard/soul-style-schema'
import { t } from '../i18n'

type AnyProfile = InternalProfile | ExternalProfile

// Maps below are keyed by the schema's enum values (stored as-is); the labels
// resolve to i18n keys at render time.
const FIELD_LABEL_KEYS: Record<string, string> = {
  address: 'agents.voiceProfile.field.address',
  tone: 'agents.voiceProfile.field.tone',
  verbosity: 'agents.voiceProfile.field.verbosity',
  directness: 'agents.voiceProfile.field.directness',
  humor: 'agents.voiceProfile.field.humor',
  emoji: 'agents.voiceProfile.field.emoji',
}

const ADDRESS_LABEL_KEYS: Record<string, string> = {
  'tegező': 'agents.voiceProfile.address.informal',
  'magázó': 'agents.voiceProfile.address.formalMaga',
  'önöző': 'agents.voiceProfile.address.formalOn',
  'kontextus-érzékeny': 'agents.voiceProfile.address.contextSensitive',
}

const VALUE_LABEL_KEYS: Record<string, Record<string, string>> = {
  tone: {
    'komoly': 'agents.voiceProfile.tone.serious',
    'kiegyensúlyozott': 'agents.voiceProfile.tone.balanced',
    'baráti': 'agents.voiceProfile.tone.friendly',
    'laza': 'agents.voiceProfile.tone.casual',
    'játékos': 'agents.voiceProfile.tone.playful',
  },
  verbosity: {
    'lényegre törő': 'agents.voiceProfile.verbosity.concise',
    'kiegyensúlyozott': 'agents.voiceProfile.verbosity.balanced',
    'részletező': 'agents.voiceProfile.verbosity.detailed',
  },
  directness: {
    'nagyon direkt': 'agents.voiceProfile.directness.veryDirect',
    'direkt + udvarias': 'agents.voiceProfile.directness.directPolite',
    'diplomatikus': 'agents.voiceProfile.directness.diplomatic',
    'körülíró': 'agents.voiceProfile.directness.indirect',
  },
  humor: {
    'nincs': 'agents.voiceProfile.humor.none',
    'száraz/szellemes': 'agents.voiceProfile.humor.dryWitty',
    'könnyed': 'agents.voiceProfile.humor.light',
    'csípős/provokatív': 'agents.voiceProfile.humor.sharpProvocative',
  },
  emoji: {
    'soha': 'agents.voiceProfile.emoji.never',
    'funkcionálisan': 'agents.voiceProfile.emoji.functional',
    'gyakran': 'agents.voiceProfile.emoji.often',
  },
}

interface Props {
  scope: 'internal' | 'external'
  profile: AnyProfile
  onChange: (updated: AnyProfile) => void
}

function EnumField({
  label,
  field,
  options,
  value,
  onChange,
}: {
  label: string
  field: string
  options: readonly string[]
  value: string
  onChange: (v: string) => void
}) {
  const labelKeyMap = field === 'address' ? ADDRESS_LABEL_KEYS : (VALUE_LABEL_KEYS[field] ?? {})
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full h-8 rounded-md border border-border/50 bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
      >
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {labelKeyMap[opt] ? t(labelKeyMap[opt]) : opt}
          </option>
        ))}
      </select>
    </div>
  )
}

export function VoiceProfileEditor({ scope, profile, onChange }: Props) {
  // Internal scope: only 3 address values; external: all 4
  const addressOptions: readonly string[] = scope === 'internal'
    ? (['tegező', 'magázó', 'önöző'] as const)
    : ENUM_VALUES.address

  const update = (key: keyof AnyProfile, value: unknown) => {
    onChange({ ...profile, [key]: value } as AnyProfile)
  }

  const blockedPhrasesStr = profile.blockedPhrases.join('\n')

  return (
    <div className="space-y-3">
      <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
        {scope === 'internal' ? t('agents.voiceProfile.internalComm') : t('agents.voiceProfile.externalComm')}
      </h4>

      <div className="grid grid-cols-2 gap-3">
        <EnumField
          label={t(FIELD_LABEL_KEYS.address)}
          field="address"
          options={addressOptions}
          value={profile.address}
          onChange={(v) => update('address', v)}
        />
        <EnumField
          label={t(FIELD_LABEL_KEYS.tone)}
          field="tone"
          options={ENUM_VALUES.tone}
          value={profile.tone}
          onChange={(v) => update('tone', v)}
        />
        <EnumField
          label={t(FIELD_LABEL_KEYS.verbosity)}
          field="verbosity"
          options={ENUM_VALUES.verbosity}
          value={profile.verbosity}
          onChange={(v) => update('verbosity', v)}
        />
        <EnumField
          label={t(FIELD_LABEL_KEYS.directness)}
          field="directness"
          options={ENUM_VALUES.directness}
          value={profile.directness}
          onChange={(v) => update('directness', v)}
        />
        <EnumField
          label={t(FIELD_LABEL_KEYS.humor)}
          field="humor"
          options={ENUM_VALUES.humor}
          value={profile.humor}
          onChange={(v) => update('humor', v)}
        />
        <EnumField
          label={t(FIELD_LABEL_KEYS.emoji)}
          field="emoji"
          options={ENUM_VALUES.emoji}
          value={profile.emoji}
          onChange={(v) => update('emoji', v)}
        />
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">{t('agents.voiceProfile.blockedPhrases')}</Label>
        <textarea
          value={blockedPhrasesStr}
          onChange={(e) =>
            update('blockedPhrases', e.target.value.split('\n').map((s) => s.trim()).filter(Boolean))
          }
          className="w-full min-h-[60px] rounded-md border border-border/50 bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring resize-y"
          placeholder={t('agents.voiceProfile.blockedPhrasesPlaceholder')}
        />
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">{t('agents.voiceProfile.signature')}</Label>
        <Input
          value={profile.signature}
          onChange={(e) => update('signature', e.target.value)}
          className="h-8 text-sm"
          placeholder={t('agents.voiceProfile.signaturePlaceholder')}
          maxLength={200}
        />
      </div>
    </div>
  )
}

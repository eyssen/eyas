import type { SoulStyleParsed, ExternalProfile, InternalProfile } from './soul-style-schema.js'
import { PRESET_KEYS } from './soul-style-schema.js'

type ProfileFields = Pick<ExternalProfile, 'address' | 'tone' | 'verbosity' | 'directness' | 'humor' | 'emoji'>
type InternalFields = Pick<InternalProfile, 'address' | 'tone' | 'verbosity' | 'directness' | 'humor' | 'emoji'>

const PRESETS: Record<typeof PRESET_KEYS[number], InternalFields> = {
  'jarvis':     { address: 'magázó', tone: 'komoly',           verbosity: 'lényegre törő',    directness: 'direkt + udvarias', humor: 'nincs',             emoji: 'soha' },
  'best-buddy': { address: 'tegező', tone: 'baráti',           verbosity: 'kiegyensúlyozott', directness: 'diplomatikus',      humor: 'száraz/szellemes',  emoji: 'funkcionálisan' },
  'senior-ceo': { address: 'magázó', tone: 'komoly',           verbosity: 'lényegre törő',    directness: 'nagyon direkt',     humor: 'száraz/szellemes',  emoji: 'soha' },
  'pajtas-dev': { address: 'tegező', tone: 'laza',             verbosity: 'lényegre törő',    directness: 'direkt + udvarias', humor: 'száraz/szellemes',  emoji: 'funkcionálisan' },
  'standup':    { address: 'tegező', tone: 'játékos',          verbosity: 'kiegyensúlyozott', directness: 'nagyon direkt',     humor: 'csípős/provokatív', emoji: 'gyakran' },
  'diplomata':  { address: 'önöző',  tone: 'komoly',           verbosity: 'részletező',       directness: 'diplomatikus',      humor: 'nincs',             emoji: 'soha' },
  'coach':      { address: 'tegező', tone: 'kiegyensúlyozott', verbosity: 'kiegyensúlyozott', directness: 'nagyon direkt',     humor: 'száraz/szellemes',  emoji: 'funkcionálisan' },
  'tutor':      { address: 'tegező', tone: 'baráti',           verbosity: 'részletező',       directness: 'diplomatikus',      humor: 'könnyed',           emoji: 'funkcionálisan' },
}

export type PresetKey = keyof typeof PRESETS

export function getPreset(key: PresetKey): InternalFields {
  return PRESETS[key]
}

export function listPresets(): PresetKey[] {
  return Object.keys(PRESETS) as PresetKey[]
}

export function applyPresetToInternal(current: InternalProfile, key: PresetKey): InternalProfile {
  return { ...current, ...PRESETS[key] }
}

export function applyPresetToExternal(current: ExternalProfile, key: PresetKey): ExternalProfile {
  return { ...current, ...PRESETS[key] }
}

export function detectPresetMatch(profile: ProfileFields): PresetKey | 'custom' {
  for (const [key, preset] of Object.entries(PRESETS)) {
    if (
      profile.address === preset.address &&
      profile.tone === preset.tone &&
      profile.verbosity === preset.verbosity &&
      profile.directness === preset.directness &&
      profile.humor === preset.humor &&
      profile.emoji === preset.emoji
    ) return key as PresetKey
  }
  return 'custom'
}

export function defaultStyleForAgent(internalKey: PresetKey, externalKey: PresetKey): SoulStyleParsed {
  return {
    version: 1,
    preset: { internal: internalKey, external: externalKey },
    internal: { ...PRESETS[internalKey], blockedPhrases: [], signature: '' },
    external: { ...PRESETS[externalKey], blockedPhrases: [], signature: '' },
  }
}

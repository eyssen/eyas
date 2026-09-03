// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { SoulStyleParsed } from './soul-style-schema.js'
import type { VoiceProfile, VoiceScope } from './types.js'
import { renderAddressForAllLanguages } from './address-render.js'

const TONE_HINTS: Record<VoiceProfile['tone'], string> = {
  'komoly': 'professional, no jokes by default',
  'kiegyensúlyozott': 'measured and neutral',
  'baráti': 'warm, like talking to a trusted friend',
  'laza': 'casual, low-ceremony',
  'játékos': 'playful, willing to go off-piste',
}

const VERBOSITY_HINTS: Record<VoiceProfile['verbosity'], string> = {
  'lényegre törő': 'get to the point, skip ceremony',
  'kiegyensúlyozott': 'enough detail to be useful, not overwhelming',
  'részletező': 'thorough, expand on context and rationale',
}

const DIRECTNESS_HINTS: Record<VoiceProfile['directness'], string> = {
  'nagyon direkt': 'say it plainly even if it stings',
  'direkt + udvarias': "say what you mean, but don't bulldoze",
  'diplomatikus': 'soften delivery; lead with context',
  'körülíró': 'circle the point; let them arrive at it',
}

const HUMOR_HINTS: Record<VoiceProfile['humor'], string> = {
  'nincs': 'no humor; this is business',
  'száraz/szellemes': 'dry wit when natural; never forced',
  'könnyed': 'light, friendly humor where it lands',
  'csípős/provokatív': 'sharper edges; willing to provoke a reaction',
}

const EMOJI_HINTS: Record<VoiceProfile['emoji'], string> = {
  'soha': 'never use emoji',
  'funkcionálisan': 'only when they add information (✓ ✗ ⚠ 🚨)',
  'gyakran': 'use freely; emoji is part of your voice',
}

function renderProfile(scope: VoiceScope, p: VoiceProfile): string {
  const lines: string[] = []
  const audienceLabel = scope === 'internal'
    ? 'when speaking with the owner / internal team'
    : 'when speaking with clients / external parties'
  const heading = scope === 'internal' ? 'Internal' : 'External'
  lines.push(`## [${heading} Voice] — ${audienceLabel}`)
  lines.push('')
  lines.push('**How to address them:**')
  lines.push(renderAddressForAllLanguages(p.address))
  lines.push('')
  lines.push(`**Tone:** ${p.tone} — ${TONE_HINTS[p.tone]}`)
  lines.push(`**Verbosity:** ${p.verbosity} — ${VERBOSITY_HINTS[p.verbosity]}`)
  lines.push(`**Directness:** ${p.directness} — ${DIRECTNESS_HINTS[p.directness]}`)
  lines.push(`**Humor:** ${p.humor} — ${HUMOR_HINTS[p.humor]}`)
  lines.push(`**Emoji:** ${p.emoji} — ${EMOJI_HINTS[p.emoji]}`)
  lines.push('')
  if (p.blockedPhrases.length > 0) {
    lines.push('**Phrases to avoid:**')
    for (const phrase of p.blockedPhrases) lines.push(`- "${phrase}"`)
    lines.push('')
  }
  if (p.signature) {
    lines.push(`**Signature flair:** ${p.signature}`)
    lines.push('')
  }
  return lines.join('\n')
}

export function renderSoulMd(style: SoulStyleParsed, agentName: string): string {
  const parts: string[] = []
  parts.push(`# SOUL — ${agentName} voice`)
  parts.push('')
  parts.push('_This file is auto-rendered from SOUL.style.json. To edit, change the JSON or use the UI form._')
  parts.push('')
  parts.push(renderProfile('internal', style.internal))
  parts.push('---')
  parts.push('')
  parts.push(renderProfile('external', style.external))
  parts.push('---')
  parts.push('')
  parts.push('_Voice selection is automatic based on channel context. To override mid-conversation, the owner may instruct: "Switch to internal voice" or "Use formal tone."_')
  return parts.join('\n')
}

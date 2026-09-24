// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// K6 — the pure mapping from the isolation view to providers.panel.* keys:
// every check id the backend can emit has a label in all six languages, an
// unknown id falls back to the raw id, and an unknown status never reads as
// verified.

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  HOW_KEY,
  ISOLATION_CHECK_IDS,
  ISOLATION_PROVIDER_IDS,
  ISOLATION_STATUS_KEY,
  PROOF_KEY,
  RESIDUAL_KEY,
  RUNTIME_SOURCE_KEY,
  isIsolationProvider,
  isolationCheckKey,
  isolationStatusKey,
} from '@/pages/providers/provider-isolation-labels'
import { ACP_ISOLATION_CHECKS } from '@modules/model/submodules/grok-cli/acp-verify'
import { ISOLATION_CLI_IDS } from '@modules/model/cli-runtime/verified-versions'
import en from '@/pages/providers/locales/en.json'
import hu from '@/pages/providers/locales/hu.json'
import de from '@/pages/providers/locales/de.json'
import es from '@/pages/providers/locales/es.json'
import fr from '@/pages/providers/locales/fr.json'
import tlh from '@/pages/providers/locales/tlh.json'

const BUNDLES: Record<string, Record<string, string>> = { en, hu, de, es, fr, tlh }

/** The check ids Claude Code's init tripwire emits, read from its source. */
function claudeCheckIds(): string[] {
  const dir = join(process.cwd(), 'src/modules/model/submodules/claude-code')
  const ids = new Set<string>()
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.ts'))) {
    for (const m of readFileSync(join(dir, file), 'utf8').matchAll(/check:\s*'([A-Za-z]+)'/g)) ids.add(m[1])
  }
  return [...ids]
}

describe('isolation check labels', () => {
  it('(+) cover every check id the ACP checks and the Claude Code tripwire emit', () => {
    const emitted = new Set<string>([...ACP_ISOLATION_CHECKS, ...claudeCheckIds()])
    expect(claudeCheckIds().length).toBeGreaterThan(0)
    for (const id of emitted) expect(isolationCheckKey(id), id).toBe(`providers.panel.isolation.check.${id}`)
    // …and name nothing the backend no longer emits.
    for (const id of ISOLATION_CHECK_IDS) expect(emitted.has(id), id).toBe(true)
  })

  it('(−) an unknown id has no key (the panel shows the raw id)', () => {
    expect(isolationCheckKey('somethingNew')).toBeNull()
    expect(isolationCheckKey('')).toBeNull()
    expect(isolationCheckKey('__proto__')).toBeNull()
  })

  it('(+) every mapped key is translated in all six languages', () => {
    const keys = [
      ...ISOLATION_CHECK_IDS.map((id) => isolationCheckKey(id)!),
      ...Object.values(ISOLATION_STATUS_KEY),
      ...Object.values(RUNTIME_SOURCE_KEY),
      ...Object.values(PROOF_KEY),
      ...Object.values(HOW_KEY),
      ...Object.values(RESIDUAL_KEY),
    ]
    for (const [lang, bundle] of Object.entries(BUNDLES)) {
      for (const key of keys) {
        expect(bundle[key], `${lang} ${key}`).toBeTruthy()
        if (lang !== 'en' && !key.endsWith('.check.hooks') && !key.endsWith('.title')) {
          expect(bundle[key], `${lang} ${key} is translated`).not.toBe(en[key as keyof typeof en])
        }
      }
    }
  })
})

describe('isolation status / providers', () => {
  it('(+) each known status has its own key', () => {
    expect(isolationStatusKey('verified')).toBe('providers.panel.isolation.status.verified')
    expect(isolationStatusKey('auth-required')).toBe('providers.panel.isolation.status.authRequired')
  })

  it('(−) an unknown status reads as unverified, never as verified', () => {
    expect(isolationStatusKey('bogus')).toBe(ISOLATION_STATUS_KEY.unverified)
    expect(isolationStatusKey('constructor')).toBe(ISOLATION_STATUS_KEY.unverified)
  })

  it('(+) the panel shows the section for exactly the providers the backend describes', () => {
    expect([...ISOLATION_PROVIDER_IDS].sort()).toEqual([...ISOLATION_CLI_IDS].sort())
    expect(isIsolationProvider('kimi-cli')).toBe(true)
    expect(isIsolationProvider('opencode')).toBe(false)
  })
})

describe('stale panel texts are gone', () => {
  const REMOVED = [
    'providers.panel.grokAcpHint',
    'providers.panel.kimiAcpHint',
    'providers.panel.cliAuthDescPre.grok',
    'providers.panel.cliAuthDescPre.kimi',
  ]
  for (const [lang, bundle] of Object.entries(BUNDLES)) {
    it(`(−) ${lang}: no host-login / "cannot disable" key survives`, () => {
      for (const key of REMOVED) expect(bundle[key], `${lang} ${key}`).toBeUndefined()
    })
  }

  it('(−) no English providers text claims the host login, config or memory is used', () => {
    const text = Object.values(en).join('\n')
    expect(text).not.toMatch(/cannot disable/i)
    expect(text).not.toMatch(/host (Grok|Kimi) login/i)
    expect(text).not.toMatch(/machine-level config/i)
    expect(text).not.toMatch(/locally installed .* session/i)
  })
})

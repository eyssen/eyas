import { describe, it, expect } from 'vitest'
import { resolveHelpUrl, getHelpEntry, listHelpIds } from '@/lib/docs-help'

describe('docs-help', () => {
  it('resolves known help ids with locale and trailing slash', () => {
    expect(resolveHelpUrl('agents.voice', 'hu')).toBe('/docs/hu/agents/voice/')
    expect(resolveHelpUrl('daily.board', 'en')).toBe('/docs/en/daily/board/')
  })

  it('appends hash when present', () => {
    expect(resolveHelpUrl('agents.voice.presets', 'en')).toBe(
      '/docs/en/agents/voice/#presets',
    )
  })

  it('falls back to default locale for unknown lang', () => {
    expect(resolveHelpUrl('concepts', 'fr' as any)).toBe('/docs/en/concepts/')
  })

  it('returns null for unknown help id', () => {
    expect(resolveHelpUrl('no.such.help.id', 'en')).toBeNull()
  })

  it('lists entries from help-map', () => {
    const ids = listHelpIds()
    expect(ids.length).toBeGreaterThan(20)
    expect(ids).toContain('agents.overview')
    expect(ids).toContain('admin.ingress')
    expect(getHelpEntry('agents.overview')?.path).toBe('agents/overview')
    expect(getHelpEntry('admin.ingress')?.path).toBe('admin/ingress')
  })
})

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
    expect(resolveHelpUrl('concepts', 'xx' as any)).toBe('/docs/en/concepts/')
  })

  it('returns null for unknown help id', () => {
    expect(resolveHelpUrl('no.such.help.id', 'en')).toBeNull()
  })

  it('lists entries from help-map', () => {
    const ids = listHelpIds()
    expect(ids.length).toBeGreaterThan(20)
    expect(ids).toContain('agents.overview')
    expect(ids).toContain('admin.ingress')
    expect(ids).toContain('knowledge.design')
    expect(ids).toContain('admin.hands')
    expect(ids).toContain('admin.notifications')
    expect(ids).toContain('ai.media')
    expect(getHelpEntry('ai.media')?.path).toBe('ai/media')
    expect(resolveHelpUrl('ai.media.compare', 'hu')).toBe('/docs/hu/ai/media/#compare')
    expect(ids).toContain('first-hour')
    expect(ids).toContain('daily.conversations')
    expect(ids).toContain('admin.data-port')
    expect(getHelpEntry('agents.overview')?.path).toBe('agents/overview')
    expect(getHelpEntry('admin.ingress')?.path).toBe('admin/ingress')
    expect(getHelpEntry('knowledge.design')?.path).toBe('knowledge/design')
    expect(getHelpEntry('admin.hands')?.path).toBe('admin/hands')
    expect(getHelpEntry('admin.notifications')?.path).toBe('admin/notifications')
    expect(getHelpEntry('first-hour')?.path).toBe('first-hour')
    expect(getHelpEntry('daily.conversations')?.path).toBe('daily/conversations')
  })
})

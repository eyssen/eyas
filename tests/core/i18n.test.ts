import { describe, it, expect, beforeEach } from 'vitest'
import { initI18n, getT } from '@core/i18n/setup'

describe('i18n', () => {
  beforeEach(async () => {
    await initI18n('hu')
  })

  it('initializes with Hungarian as default', async () => {
    const t = getT()
    expect(t('app.name')).toBe('eYssen EYAS')
  })

  it('falls back to English', async () => {
    await initI18n('en')
    const t = getT()
    expect(t('app.name')).toBe('eYssen EYAS')
  })

  it('translates server messages in Hungarian', async () => {
    const t = getT()
    expect(t('server.starting')).toContain('Szerver')
  })

  it('translates server messages in English', async () => {
    await initI18n('en')
    const t = getT()
    expect(t('server.starting')).toContain('Starting')
  })
})

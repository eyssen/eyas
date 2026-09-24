// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// K2 — a stored folder a protection rule now refuses is left out of the run
// with a folderRefused notice (shared/chat-stream.ts). The transcript shows
// it in the active language with the folder's path; the six conversations
// locales hold the text.

import { describe, it, expect, afterEach } from 'vitest'
import { useLanguageStore } from '@/stores/language-store'
import { noticeText, parseTurnNotice } from '@/pages/conversations/turn-notices'
import { NoticeSchema } from '@shared/chat-stream'
import en from '@/pages/conversations/locales/en.json'
import hu from '@/pages/conversations/locales/hu.json'
import de from '@/pages/conversations/locales/de.json'
import es from '@/pages/conversations/locales/es.json'
import fr from '@/pages/conversations/locales/fr.json'
import tlh from '@/pages/conversations/locales/tlh.json'

const LOCALES: Record<string, Record<string, string>> = { en, hu, de, es, fr, tlh }

afterEach(() => useLanguageStore.getState().setLang('en'))

describe('conversations.notice.folderRefused', () => {
  it('has a text with {{path}} in all six languages', () => {
    for (const [lang, bundle] of Object.entries(LOCALES)) {
      expect(bundle['conversations.notice.folderRefused']?.trim(), lang).toBeTruthy()
      expect(bundle['conversations.notice.folderRefused'], lang).toContain('{{path}}')
    }
  })

  it('(+) the notice from the wire reads with its path, in the active language', () => {
    const wire = { code: 'folderRefused', params: { path: '/work/checkout', reason: 'containsEyasData' } }
    expect(NoticeSchema.safeParse(wire).success).toBe(true)
    const notice = parseTurnNotice(wire)
    expect(noticeText(notice!)).toBe(en['conversations.notice.folderRefused'].replace('{{path}}', '/work/checkout'))
    useLanguageStore.getState().setLang('hu')
    expect(noticeText(notice!)).toBe(hu['conversations.notice.folderRefused'].replace('{{path}}', '/work/checkout'))
  })

  it('(−) a folderRefused notice with a non-flat param is dropped, never shown raw', () => {
    expect(parseTurnNotice({ code: 'folderRefused', params: { path: ['/a'] } })).toBeNull()
    expect(NoticeSchema.safeParse({ code: 'folderRefused', params: { path: 'x'.repeat(501) } }).success).toBe(false)
  })
})

describe('the OpenCode terminal shows the folders the server left out (K2)', () => {
  it('(+) each folderRefused notice of the session reads with its path, in the active language', async () => {
    const { terminalNoticeLines } = await import('@/components/terminal/web-terminal')
    const lines = terminalNoticeLines([{ code: 'folderRefused', params: { path: '/home/u/Documents', reason: 'containsVault' } }])
    expect(lines).toEqual([en['conversations.notice.folderRefused'].replace('{{path}}', '/home/u/Documents')])
    useLanguageStore.getState().setLang('de')
    expect(terminalNoticeLines([{ code: 'folderRefused', params: { path: '/x', reason: 'home' } }]))
      .toEqual([de['conversations.notice.folderRefused'].replace('{{path}}', '/x')])
  })

  it('(−) no notices, a malformed one or an unknown code show nothing', async () => {
    const { terminalNoticeLines } = await import('@/components/terminal/web-terminal')
    expect(terminalNoticeLines(undefined)).toEqual([])
    expect(terminalNoticeLines([])).toEqual([])
    expect(terminalNoticeLines([{ code: 'folderRefused', params: { path: ['/a'] } }, { code: 'noSuchNotice' }, 'x'])).toEqual([])
  })
})

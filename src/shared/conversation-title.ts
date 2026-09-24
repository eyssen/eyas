// Part of eYssen. See LICENSE file for full copyright and licensing details.

/**
 * Shared conversation-title helpers (backend auto-title + frontend optimistic
 * rename). Keep this file free of model / DB imports so the web bundle can use it.
 */

/** Display placeholders stored as a real title (board command palette, i18n). */
const UNTITLED_PLACEHOLDERS = new Set([
  'untitled',
  'untitled conversation',
  'névtelen',
  'névtelen beszélgetés',
  'ohne titel',
  'sin título',
  'sans titre',
  'pong hutlh',
])

const FALLBACK_MAX = 60
const GENERATED_MAX = 80

export function isUntitledTitle(title: string | null | undefined): boolean {
  if (title == null) return true
  const trimmed = title.trim()
  if (!trimmed) return true
  return UNTITLED_PLACEHOLDERS.has(trimmed.toLowerCase())
}

/** Collapse whitespace and cut at a word boundary. Empty input → ''. */
export function fallbackTitleFromMessage(content: string, maxLen = FALLBACK_MAX): string {
  const line = content.replace(/\s+/g, ' ').trim()
  if (!line) return ''
  if (line.length <= maxLen) return line
  const cut = line.slice(0, maxLen)
  const sp = cut.lastIndexOf(' ')
  const base = (sp > 20 ? cut.slice(0, sp) : cut).replace(/[.,;:]+$/, '')
  return `${base}…`
}

export function sanitizeGeneratedTitle(raw: string, fallback: string, maxLen = GENERATED_MAX): string {
  let text = raw.replace(/\s+/g, ' ').trim()
  text = text.split('\n')[0]?.trim() ?? ''
  text = text.replace(/^["'`«»„“”]+|["'`«»„“”]+$/g, '').trim()
  text = text.replace(/[.]+$/, '').trim()
  if (!text || isUntitledTitle(text)) return fallback
  if (text.length <= maxLen) return text
  const cut = text.slice(0, maxLen)
  const sp = cut.lastIndexOf(' ')
  return (sp > 20 ? cut.slice(0, sp) : cut).replace(/[.,;:]+$/, '')
}

/** Immediate snippet if the current title is still a placeholder; else ''. */
export function planAutoTitle(currentTitle: string | null | undefined, userMessage: string): string {
  if (!isUntitledTitle(currentTitle)) return ''
  return fallbackTitleFromMessage(userMessage)
}

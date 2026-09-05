// Part of eYssen. See LICENSE file for full copyright and licensing details.
// src/shared/html-document.ts
//
// The deterministic HTML renderer for anything EYAS sends out: notification
// email, channel replies, agent-composed documents.
//
// It accepts MARKDOWN OR PLAIN TEXT, never HTML. That is the security
// property, not a convenience: accepting HTML would need a sanitizer, and a
// sanitizer is a large surface to get exactly right. Instead the body goes
// through client-wiki's escape-by-construction markdown renderer — which
// already blocks javascript:, data: and vbscript: in links — and the shell is
// built here. It owns every byte of markup it emits.
//
// Email flavour uses INLINE STYLES ONLY. Mail clients strip <style> blocks
// unreliably, and an EYAS-hosted image URL usually will not load either, so a
// logo travels as a data: URI or not at all.
//
// The palette is a constant. It used to come from a configurable brand entity,
// which is why an earlier version sanitised every colour and font name at the
// point of interpolation — those were untrusted. They are literals now, so
// there is nothing left to sanitise and no sanitiser pretending otherwise.

import { escapeHtml, renderMarkdown } from '@modules/client-wiki/markdown-render.js'

export type HtmlFlavour = 'email' | 'page'

export interface HtmlDocumentInput {
  /** Markdown or plain text. HTML is NOT accepted — see the module comment. */
  body: string
  title?: string
  /** Bare data: URI for a logo. A URL will not load in mail. */
  logoDataUri?: string | null
  /** Small print under the rule. Plain text; it is escaped. */
  footer?: string
}

export interface HtmlDocumentOutput {
  html: string
  /** Always produced: a multipart email without a text part lands in spam. */
  text: string
  subject?: string
}

export class HtmlDocumentError extends Error {}

/** The one palette. Neutral on purpose — it has to work for everyone. */
export const DOCUMENT_PALETTE = {
  background: '#ffffff',
  foreground: '#12151a',
  primary: '#1f4ed8',
  muted: '#f4f6f9',
  mutedForeground: '#5b6472',
  border: '#dde2e9',
} as const

export const DOCUMENT_FONTS = {
  body: "system-ui, 'Segoe UI', Helvetica, Arial, sans-serif",
  display: "Georgia, 'Times New Roman', serif",
  mono: "ui-monospace, SFMono-Regular, Menlo, monospace",
} as const

const RADIUS_PX = 8
const BORDER_PX = 1

/**
 * Reject input that is already HTML. A caller that passes markup is making a
 * mistake this renderer cannot safely absorb, and failing loudly beats
 * silently escaping their tags into visible angle brackets.
 */
const LOOKS_LIKE_HTML = /<\/?(?:html|body|head|script|style|iframe|div|span|table|p|h[1-6]|a|img)\b[^>]*>/i

export function assertNotHtml(body: string): void {
  if (LOOKS_LIKE_HTML.test(body)) {
    throw new HtmlDocumentError(
      'This renderer takes Markdown or plain text, not HTML. Send the content as Markdown; the shell produces the markup.',
    )
  }
}

/**
 * Push inline styles onto the block elements the markdown renderer produces.
 * Mail clients need it inline; a page could use a stylesheet, but one code path
 * is easier to keep correct than two.
 *
 * Only elements client-wiki's renderer actually emits: h1-h3, p, ul/ol/li,
 * pre/code, a, hr, table/th/td. It has no blockquote support, so there is no
 * blockquote rule here — a rule for markup that never arrives is dead code.
 */
function inlineStyles(html: string): string {
  const b = DOCUMENT_PALETTE
  const f = DOCUMENT_FONTS
  const rules: [RegExp, string][] = [
    [/<h1>/g, `<h1 style="font-family:${f.display};font-size:28px;line-height:1.15;margin:0 0 16px;color:${b.foreground}">`],
    [/<h2>/g, `<h2 style="font-family:${f.display};font-size:21px;line-height:1.2;margin:24px 0 10px;color:${b.foreground}">`],
    [/<h3>/g, `<h3 style="font-family:${f.display};font-size:17px;line-height:1.25;margin:20px 0 8px;color:${b.foreground}">`],
    [/<p>/g, `<p style="margin:0 0 14px;color:${b.foreground}">`],
    [/<ul>/g, `<ul style="margin:0 0 14px;padding-left:22px;color:${b.foreground}">`],
    [/<ol>/g, `<ol style="margin:0 0 14px;padding-left:22px;color:${b.foreground}">`],
    [/<li>/g, `<li style="margin:0 0 6px">`],
    [/<pre>/g, `<pre style="margin:0 0 14px;padding:12px;background:${b.muted};border-radius:${RADIUS_PX}px;overflow-x:auto">`],
    [/<code>/g, `<code style="font-family:${f.mono};font-size:13px">`],
    [/<a /g, `<a style="color:${b.primary};text-decoration:underline" `],
    [/<hr\s*\/?>/g, `<hr style="border:0;border-top:${BORDER_PX}px solid ${b.border};margin:20px 0">`],
    [/<table>/g, `<table style="border-collapse:collapse;margin:0 0 14px;width:100%">`],
    [/<th>/g, `<th style="text-align:left;padding:6px 8px;border-bottom:${BORDER_PX}px solid ${b.border};color:${b.mutedForeground}">`],
    [/<td>/g, `<td style="padding:6px 8px;border-bottom:${BORDER_PX}px solid ${b.border}">`],
  ]
  let out = html
  for (const [pattern, replacement] of rules) out = out.replace(pattern, replacement)
  return out
}

/** Strip markup back to something readable for the text/plain alternative. */
export function toPlainText(markdown: string): string {
  return markdown
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
    .replace(/[*_`]{1,3}/g, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function renderHtmlDocument(input: HtmlDocumentInput, flavour: HtmlFlavour): HtmlDocumentOutput {
  assertNotHtml(input.body)

  const b = DOCUMENT_PALETTE
  const f = DOCUMENT_FONTS
  const content = inlineStyles(renderMarkdown(input.body))

  const logo = input.logoDataUri
    ? `<img src="${escapeHtml(input.logoDataUri)}" alt="" style="max-height:36px;display:block;margin:0 0 20px">`
    : ''

  const heading = input.title
    ? `<h1 style="font-family:${f.display};font-size:24px;line-height:1.15;margin:0 0 18px;color:${b.foreground}">${escapeHtml(input.title)}</h1>`
    : ''

  const footer = input.footer
    ? `<hr style="border:0;border-top:${BORDER_PX}px solid ${b.border};margin:24px 0 12px">
      <p style="margin:0;font-size:12px;color:${b.mutedForeground}">${escapeHtml(input.footer)}</p>`
    : ''

  const width = flavour === 'email' ? '600px' : '720px'

  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(input.title ?? 'EYAS')}</title>
</head>
<body style="margin:0;padding:0;background:${b.muted};font-family:${f.body};font-size:15px;line-height:1.55;-webkit-text-size-adjust:100%">
<div style="max-width:${width};margin:0 auto;padding:28px ${flavour === 'email' ? '20px' : '32px'};background:${b.background}">
${logo}${heading}${content}${footer}
</div>
</body>
</html>`

  return {
    html,
    text: [input.title, toPlainText(input.body), input.footer].filter(Boolean).join('\n\n'),
    ...(input.title ? { subject: input.title } : {}),
  }
}

export const renderHtmlEmail = (input: HtmlDocumentInput): HtmlDocumentOutput => renderHtmlDocument(input, 'email')
export const renderHtmlPage = (input: HtmlDocumentInput): HtmlDocumentOutput => renderHtmlDocument(input, 'page')

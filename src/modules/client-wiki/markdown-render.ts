// Part of eYssen. See LICENSE file for full copyright and licensing details.

/**
 * Minimal, safe Markdown → HTML renderer for client wiki pages.
 *
 * Self-contained converter (no external deps) covering the subset needed for
 * living project docs. Raw HTML in the source is escaped — XSS prevention by
 * construction.
 *
 * Supported features:
 *   - ATX headings (#..######)
 *   - GFM fenced code blocks
 *   - GFM tables (header | --- | row)
 *   - Unordered and ordered lists (single level)
 *   - Bold, italic, inline code
 *   - Links — javascript: scheme blocked
 *   - Paragraphs, horizontal rules
 *
 * For richer rendering (Shiki, complex GFM, footnotes), the frontend can
 * replace this with Streamdown/remark. The server uses this for safe preview.
 */

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function safeUrl(url: string): string {
  const trimmed = url.trim()
  if (/^\s*(javascript|data|vbscript):/i.test(trimmed)) return '#'
  return escapeHtml(trimmed)
}

function renderInline(src: string): string {
  let out = escapeHtml(src)

  out = out.replace(/`([^`]+)`/g, (_m, code) => `<code>${code}</code>`)
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  out = out.replace(/(^|[^*])\*([^*\s][^*]*?)\*(?!\*)/g, '$1<em>$2</em>')
  out = out.replace(/(^|[^_])_([^_\s][^_]*?)_(?!_)/g, '$1<em>$2</em>')
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, text, url) => {
    return `<a href="${safeUrl(url)}">${text}</a>`
  })

  return out
}

export function renderMarkdown(markdown: string): string {
  if (!markdown) return ''
  const lines = markdown.replace(/\r\n/g, '\n').split('\n')
  const out: string[] = []

  let i = 0
  while (i < lines.length) {
    const line = lines[i]

    // Fenced code block
    const fence = line.match(/^```(\w+)?\s*$/)
    if (fence) {
      const lang = fence[1] ?? ''
      const codeLines: string[] = []
      i++
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        codeLines.push(lines[i])
        i++
      }
      i++ // skip closing fence (or EOF)
      const langAttr = lang ? ` class="language-${escapeHtml(lang)}"` : ''
      out.push(`<pre><code${langAttr}>${escapeHtml(codeLines.join('\n'))}</code></pre>`)
      continue
    }

    // Horizontal rule
    if (/^---\s*$/.test(line)) {
      out.push('<hr />')
      i++
      continue
    }

    // ATX heading
    const heading = line.match(/^(#{1,6})\s+(.*)$/)
    if (heading) {
      const level = heading[1].length
      out.push(`<h${level}>${renderInline(heading[2].trim())}</h${level}>`)
      i++
      continue
    }

    // GFM Table
    if (/\|/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?\s*$/.test(lines[i + 1])) {
      const headers = line.split('|').map(s => s.trim()).filter((_, idx, arr) => !(idx === 0 && arr[0] === '') && !(idx === arr.length - 1 && arr[arr.length - 1] === ''))
      i += 2
      const rows: string[][] = []
      while (i < lines.length && /\|/.test(lines[i]) && lines[i].trim() !== '') {
        const cells = lines[i].split('|').map(s => s.trim())
        if (cells[0] === '') cells.shift()
        if (cells[cells.length - 1] === '') cells.pop()
        rows.push(cells)
        i++
      }
      const thead = '<thead><tr>' + headers.map(h => `<th>${renderInline(h)}</th>`).join('') + '</tr></thead>'
      const tbody = '<tbody>' + rows.map(r => '<tr>' + r.map(c => `<td>${renderInline(c)}</td>`).join('') + '</tr>').join('') + '</tbody>'
      out.push(`<table>${thead}${tbody}</table>`)
      continue
    }

    // Unordered list
    if (/^\s*[-*+]\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*+]\s+/, ''))
        i++
      }
      out.push('<ul>' + items.map(it => `<li>${renderInline(it)}</li>`).join('') + '</ul>')
      continue
    }

    // Ordered list
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ''))
        i++
      }
      out.push('<ol>' + items.map(it => `<li>${renderInline(it)}</li>`).join('') + '</ol>')
      continue
    }

    // Blank line
    if (line.trim() === '') {
      i++
      continue
    }

    // Paragraph
    const paraLines: string[] = [line]
    i++
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^(#{1,6})\s+/.test(lines[i]) &&
      !/^```/.test(lines[i]) &&
      !/^---\s*$/.test(lines[i]) &&
      !/^\s*[-*+]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i])
    ) {
      paraLines.push(lines[i])
      i++
    }
    out.push(`<p>${renderInline(paraLines.join(' '))}</p>`)
  }

  return out.join('\n')
}

/**
 * Extract a one-line summary from markdown.
 */
export function summarize(markdown: string, maxLen = 160): string {
  if (!markdown) return ''
  const lines = markdown.replace(/\r\n/g, '\n').split('\n')
  let inCode = false
  for (const raw of lines) {
    const line = raw.trim()
    if (/^```/.test(line)) { inCode = !inCode; continue }
    if (inCode) continue
    if (!line) continue
    if (/^#{1,6}\s/.test(line)) continue
    const plain = line
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/_([^_]+)_/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    return plain.length > maxLen ? plain.slice(0, maxLen - 1) + '…' : plain
  }
  return ''
}

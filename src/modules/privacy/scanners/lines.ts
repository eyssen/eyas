// Part of eYssen. See LICENSE file for full copyright and licensing details.

export interface TextLine {
  /** The line without its '\n' terminator. */
  text: string
  /** Offset of the line's first character in the original text. */
  offset: number
}

/**
 * Split text on '\n' and remember where each line starts. Scanning line by
 * line is what makes detection line-bounded: no match and no context window
 * (phone word, tax-ID word) can reach across a line break, so one memory
 * line is masked the same wherever it appears.
 */
export function splitLines(text: string): TextLine[] {
  const lines: TextLine[] = []
  let offset = 0
  for (;;) {
    const nl = text.indexOf('\n', offset)
    if (nl === -1) {
      lines.push({ text: text.slice(offset), offset })
      return lines
    }
    lines.push({ text: text.slice(offset, nl), offset })
    offset = nl + 1
  }
}

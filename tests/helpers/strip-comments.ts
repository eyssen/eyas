// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Blank the comments out of TypeScript source before a guard matches against it.
//
// Why this exists. Three separate failures in one wave came from a guard reading
// PROSE as data:
//
//   1. Two files held a raw NUL byte, so `grep` called them binary and answered
//      nothing for every pattern — a true statement was deleted from six
//      documentation pages on the strength of that silence (A-61).
//   2. A sweep grepped the web package for example paths that come from the
//      server, and concluded the feature did not exist (A-63).
//   3. A vocabulary comparison extracted the server's array with `/'([^']+)'/g`
//      over the raw text. A doc comment beginning "A cloud provider's sync root"
//      opened a quote, and six lines of prose were read as array members.
//
// The third is the one this fixes, and it fixes the CLASS rather than the
// sentence: rewording the comment would work today and break again the next time
// anyone writes "doesn't" near an array.
//
// Every comment is replaced by spaces, and newlines are kept, so byte offsets and
// line numbers are unchanged — a guard can still report where a hit was.
//
// String literals are skipped rather than scanned, so `'// not a comment'` and a
// URL inside a string survive intact. Regex literals are NOT tracked: a `/` in
// an expression position is ambiguous without a real parser, and the cost of
// being wrong here would be a guard that silently reads less than it should. The
// one shape that would confuse it — a regex literal containing an unpaired quote
// or a `//` — does not appear in the files these guards read, and a guard is
// better off simple enough to be checked by eye.

/** The source with every comment blanked to spaces, newlines and offsets preserved. */
export function stripComments(source: string): string {
  const out = source.split('')
  let i = 0
  const blank = (from: number, to: number): void => {
    for (let k = from; k < to; k++) if (out[k] !== '\n') out[k] = ' '
  }
  while (i < source.length) {
    const ch = source[i]!
    const next = source[i + 1]
    // A string: skipped whole, so its contents can never look like a comment.
    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch
      i++
      while (i < source.length) {
        if (source[i] === '\\') { i += 2; continue }
        if (source[i] === quote) { i++; break }
        i++
      }
      continue
    }
    if (ch === '/' && next === '/') {
      const end = source.indexOf('\n', i)
      blank(i, end === -1 ? source.length : end)
      i = end === -1 ? source.length : end
      continue
    }
    if (ch === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2)
      const stop = end === -1 ? source.length : end + 2
      blank(i, stop)
      i = stop
      continue
    }
    i++
  }
  return out.join('')
}

// Part of eYssen. See LICENSE file for full copyright and licensing details.

/** CSI / OSC / charset sequences — enough to index terminal output as prose. */
const ANSI_RE = new RegExp(
  [
    String.raw`\x1B\[[0-9;?]*[ -/]*[@-~]`,
    String.raw`\x1B\][^\x07\x1B]*(?:\x07|\x1B\\)`,
    String.raw`\x1B[P^_].*?(?:\x1B\\|\x07)`,
    String.raw`\x1B[@-Z\\-_]`,
    String.raw`[\x00-\x08\x0B\x0C\x0E-\x1A\x1C-\x1F]`,
  ].join('|'),
  'g',
)

export function stripAnsi(input: string): string {
  return input.replace(ANSI_RE, '')
}

export function clipText(input: string, maxChars: number): string {
  if (input.length <= maxChars) return input
  return input.slice(input.length - maxChars)
}

// Part of eYssen. See LICENSE file for full copyright and licensing details.

/** Merge document ids from studio jobs into an existing attachment id list (deduped, order-preserving). */
export function collectStudioDocumentIds(
  jobs: Array<{ documentIds: string[] }>,
  already: string[],
): string[] {
  const out = [...already]
  for (const job of jobs) {
    for (const id of job.documentIds ?? []) {
      if (!out.includes(id)) out.push(id)
    }
  }
  return out
}

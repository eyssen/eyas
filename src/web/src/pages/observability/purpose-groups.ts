// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Background-call purpose groups as the traces API reports and filters them
// (the backend's AUX_POLICY groups, in its order). Kept in a plain module so
// the parity test can hold it against the backend list.

export const PURPOSE_GROUPS = ['memory', 'learning', 'title', 'safety', 'planning', 'research', 'triage'] as const

export type PurposeGroup = (typeof PURPOSE_GROUPS)[number]

/** Select value for "no purpose filter" (Radix Select items cannot be empty). */
export const PURPOSE_ALL = 'all'

// Part of eYssen. See LICENSE file for full copyright and licensing details.

/** User-owned / imported / AI-proposed skills land here. */
export const OWN_SKILLS_CATEGORY = 'own' as const

export const DATA_PORT_EXPORT_VERSION = 'eyas-export-v1' as const

/** Raised so a full Obsidian ai-memory + skills tree fits; walker prioritizes high-value paths. */
export const MAX_SCAN_FILES = 2500
export const MAX_FILE_BYTES = 768 * 1024 // 768 KiB per file in scan
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024 // 50 MiB zip/upload
export const MAX_CHUNK_CHARS = 12_000

export const IMPORT_TAGS = {
  imported: 'imported',
  sourcePrefix: 'source:',
  jobPrefix: 'import-job:',
} as const

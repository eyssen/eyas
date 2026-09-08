// Part of eYssen. See LICENSE file for full copyright and licensing details.

/** User-owned / imported / AI-proposed skills land here. */
export const OWN_SKILLS_CATEGORY = 'own' as const

export const DATA_PORT_EXPORT_VERSION = 'eyas-export-v1' as const

/** Thresholds above which a row carries the `large-file` warning. Never a skip (R11.1). */
export const LARGE_TEXT_WARN_BYTES = 4 * 1024 * 1024
export const LARGE_CONTAINER_WARN_BYTES = 50 * 1024 * 1024
/** HTTP body limit of the upload endpoint only — a transport limit, not a scan limit. */
export const UPLOAD_BODY_BYTES = 50 * 1024 * 1024
/** Bytes sniffed for a NUL byte to tell text from binary. */
export const SNIFF_BYTES = 8_000
/** Chunk size of the streaming sha256 for files above LARGE_TEXT_WARN_BYTES. */
export const STREAM_CHUNK_BYTES = 1024 * 1024
/** Walker yields to the event loop and reports progress this often. */
export const PROGRESS_EVERY_FILES = 500
export const PROGRESS_EVERY_DIRS = 200
/** Candidate rows per scan-sink transaction. */
export const SCAN_FLUSH_ROWS = 500
/** Runner: items per ledger/progress flush and per event-loop yield. */
export const JOB_BATCH_SIZE = 100
/** One API page. Paging is unbounded; this bounds one response. */
export const CANDIDATE_PAGE_DEFAULT = 200
export const CANDIDATE_PAGE_MAX = 500
/** One selection payload. Bulk gestures are groups; these bound one request body. */
export const SELECTION_MAX_ROWS = 50_000
export const SELECTION_MAX_GROUPS = 5_000
/** A rendered session above this is stored as ordered parts — never truncated. */
export const MAX_EPISODIC_BODY_BYTES = 256 * 1024 * 1024
/**
 * The JavaScript engine's own string size (V8: ~512 MiB). Not a policy cap: a
 * text file above it is still listed, hashed and importable; the runner reports
 * it as `exceeds-string-limit` instead of failing with a generic error (P-17).
 */
export const STRING_LIMIT_BYTES = 512 * 1024 * 1024
/** Candidate rows of older scans are dropped when BOTH hold; a scan a job references is kept. */
export const SCAN_RETENTION = { keepNewest: 10, keepDays: 30 } as const
/** Classification looks at the head only; apply reads the whole file. */
export const HEAD_CHARS = 4_000

/** Only clips the text handed to the optional model pass. */
export const MAX_CHUNK_CHARS = 12_000

/**
 * `data_port_proposals.agent_id` for a proposal whose target is a project type's
 * prompt rather than an agent workspace. It is an in-band sentinel, never an id
 * in `agent_definitions` — nothing may join it to that table.
 */
export const PROJECT_TYPE_AGENT_ID = '-' as const

export const IMPORT_TAGS = {
  imported: 'imported',
  sourcePrefix: 'source:',
  jobPrefix: 'import-job:',
} as const

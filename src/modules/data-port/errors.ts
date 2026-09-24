// Part of eYssen. See LICENSE file for full copyright and licensing details.
// src/modules/data-port/errors.ts
//
// One helper decides what a data-port failure SAYS — in a stored field, in an
// HTTP body and in a log line alike (A-50, A-54).
//
// It lives in a leaf module rather than in `service.ts` so the scanners, the
// adapters and the apply pipeline can all reach it: those are the files
// `service.ts` itself imports, and an import back the other way would be a
// cycle. `service.ts` re-exports it, so every existing caller is unchanged.

/** A stored failure message is a sentence for the owner, never a payload. */
const FAILURE_MESSAGE_MAX = 2_000

/** Deep enough for any real wrapper chain, and finite so a cyclic `cause` cannot loop. */
const CAUSE_DEPTH_MAX = 16

/**
 * Why something failed, in words the owner can act on.
 *
 * drizzle wraps every query error as `Failed to run the query '<the entire
 * prepared statement>'` and puts the driver's own words on `.cause`, so
 * `err.message` alone is tens of kilobytes of `?` placeholders that never
 * mention the reason: a real `disk I/O error` was stored as 61 414 bytes of SQL
 * with those three words nowhere in it, and `GET /scans/:id` handed all of it
 * to the wizard. The innermost link of the chain is the reason; every outer
 * link is a wrapper carrying the statement.
 *
 * The chain is walked HERE rather than recovered from `errorText`'s joined
 * string: splitting that back apart on its ` | ` separator truncates any cause
 * that contains those three characters itself — SQLite's own
 * `constraint failed | column x | table y` would be stored as `table y` — and
 * cannot see past that helper's depth cap, which would store a middle wrapper
 * as if it were the reason. `errorText` stays what A-22b made it: the module's
 * one cause-walking PHRASE TEST, for `isNestedTransactionError`.
 *
 * An error with no cause answers with its own message; a link with an empty
 * message is passed over rather than stored as a blank reason; anything still
 * oversized is capped, so a stored message can never become a payload again.
 *
 * It CANNOT throw. `message` and `cause` are accessors an error may define
 * however it likes, and every caller here is a catch block: a throw out of this
 * function inside `driveScan`'s catch would escape the drive and leave the scan
 * `running` for ever, with nothing at startup to close it. A link that refuses
 * to be read ends the walk and the reason is whatever was reached before it.
 */
export function failureReason(err: unknown): string {
  const messages: string[] = []
  let current: unknown = err
  for (let depth = 0; depth < CAUSE_DEPTH_MAX && current instanceof Error; depth++) {
    try {
      const message = current.message
      if (typeof message === 'string' && message.trim()) messages.push(message.trim())
      current = current.cause
    } catch {
      break
    }
  }
  let reason = messages[messages.length - 1]
  if (reason === undefined) {
    try {
      reason = String(err)
    } catch {
      reason = 'unknown error'
    }
  }
  return reason.length > FAILURE_MESSAGE_MAX ? `${reason.slice(0, FAILURE_MESSAGE_MAX)}…` : reason
}

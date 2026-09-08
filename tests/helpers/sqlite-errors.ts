// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Drizzle wraps SQLite failures: db.run() throws a DrizzleError whose message is
// "Failed to run the query '<sql>'" and whose .cause carries the real SQLite
// error. Asserting on .message alone both misses the constraint text and can
// match the SQL echoed into the wrapper. Raw bun:sqlite / better-sqlite3 handles
// throw unwrapped, so this helper handles both shapes.

import { expect } from 'vitest'

export function expectSqliteError(fn: () => unknown, pattern: RegExp): void {
  let caught: unknown
  try {
    fn()
  } catch (error) {
    caught = error
  }
  expect(caught, 'expected the statement to throw a SQLite error').toBeDefined()
  const cause = (caught as { cause?: unknown }).cause
  // A defined, non-Error cause (a string, a plain object) must still win over the
  // wrapper's own .message — falling through to it would reintroduce the exact
  // spurious-match risk this helper exists to eliminate.
  const text = cause instanceof Error
    ? cause.message
    : cause !== undefined
      ? String(cause)
      : String((caught as Error)?.message ?? caught)
  expect(text).toMatch(pattern)
}

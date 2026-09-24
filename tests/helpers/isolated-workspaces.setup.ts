// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Vitest setup: every test file gets a private, throw-away workspaces root.
//
// Creating a conversation creates its EYAS workspace, and the CLI cwd
// resolver creates run scratch folders. Without this, those land under the
// real instance's workspaces root — for a source checkout that is the
// per-user application data folder — and every test run would leave folders
// on the developer's machine. A test that exercises the root resolution
// itself deletes the variable in its own scope and restores it afterwards.

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll } from 'vitest'

if (!process.env.EYAS_WORKSPACES_DIR) {
  const root = mkdtempSync(join(tmpdir(), 'eyas-test-workspaces-'))
  process.env.EYAS_WORKSPACES_DIR = root
  afterAll(() => {
    if (process.env.EYAS_WORKSPACES_DIR === root) delete process.env.EYAS_WORKSPACES_DIR
    rmSync(root, { recursive: true, force: true })
  })
}

// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// A resolved Claude Code runtime for provider unit tests. The path is never
// executed: those tests mock the Agent SDK's query(), and only assert that
// this exact path reaches pathToClaudeCodeExecutable.

import type { ClaudeRuntime } from '@modules/model/submodules/claude-code/runtime.js'

export const TEST_CLAUDE_RUNTIME: ClaudeRuntime = Object.freeze({
  path: '/opt/eyas-test/bin/claude',
  version: '2.1.89',
  source: 'override',
})

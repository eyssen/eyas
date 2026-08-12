// Part of eYssen. See LICENSE file for full copyright and licensing details.

/**
 * Lightweight review helpers for the coding surface (P2).
 * Full semantic review still goes through code-reviewer / devils-advocate agents;
 * these tools give every model a structured diff snapshot without shell.
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { z } from 'zod'
import type { ToolContext, ToolImplementation } from '../types.js'
import { getWorkspaceRoot } from './path-utils.js'

const execFileAsync = promisify(execFile)

const diffSchema = z.object({
  base: z.string().max(128).optional(),
  staged: z.boolean().optional(),
  path: z.string().max(4096).optional(),
  maxBytes: z.number().int().positive().max(500_000).optional(),
})

const statusSchema = z.object({})

function cwd(ctx?: ToolContext): string {
  return getWorkspaceRoot(ctx?.workingDirectory)
}

async function git(args: string[], dir: string, maxBuffer = 2 * 1024 * 1024): Promise<{ stdout: string; stderr: string; code: number }> {
  try {
    const { stdout, stderr } = await execFileAsync('git', args, {
      cwd: dir,
      maxBuffer,
      timeout: 30_000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    })
    return { stdout: stdout ?? '', stderr: stderr ?? '', code: 0 }
  } catch (err: any) {
    return {
      stdout: err?.stdout?.toString?.() ?? '',
      stderr: err?.stderr?.toString?.() ?? err?.message ?? String(err),
      code: typeof err?.code === 'number' ? err.code : 1,
    }
  }
}

export function createReviewTools(): ToolImplementation[] {
  return [
    {
      name: 'git_status',
      description: 'Show git status (short) for the workspace or agent worktree. Read-only.',
      category: 'shell',
      riskTier: 'green',
      timeoutMs: 15_000,
      inputSchema: { type: 'object', properties: {} },
      validator: statusSchema,
      execute: async (_raw, ctx) => {
        const dir = cwd(ctx)
        const r = await git(['status', '--short', '--branch'], dir)
        if (r.code !== 0 && !r.stdout) {
          return { error: r.stderr || 'git status failed', cwd: dir }
        }
        return { cwd: dir, status: r.stdout.trim(), ok: true }
      },
    },
    {
      name: 'git_diff',
      description:
        'Show git diff for review (unstaged by default). Use base=HEAD~1 or staged=true. Read-only — does not modify the repo.',
      category: 'shell',
      riskTier: 'green',
      timeoutMs: 30_000,
      inputSchema: {
        type: 'object',
        properties: {
          base: { type: 'string', description: 'Compare against this ref (e.g. main, HEAD~1). Ignored if staged=true.' },
          staged: { type: 'boolean', description: 'Show only staged changes' },
          path: { type: 'string', description: 'Limit to path' },
          maxBytes: { type: 'number', description: 'Truncate output above this size (default 120000)' },
        },
      },
      validator: diffSchema,
      aci: { enabled: true, field: 'diff', maxChars: 80_000, headLines: 300, tailLines: 80 },
      execute: async (raw, ctx) => {
        const input = raw as z.infer<typeof diffSchema>
        const dir = cwd(ctx)
        const maxBytes = input.maxBytes ?? 120_000
        const args = ['diff', '--no-color', '--find-renames']
        if (input.staged) args.push('--cached')
        else if (input.base) args.push(input.base)
        if (input.path) args.push('--', input.path)

        const r = await git(args, dir, maxBytes + 64_000)
        if (r.code !== 0 && !r.stdout) {
          return { error: r.stderr || 'git diff failed', cwd: dir }
        }
        let diff = r.stdout
        let truncated = false
        if (diff.length > maxBytes) {
          diff = diff.slice(0, maxBytes) + `\n... [truncated: original ${r.stdout.length} chars]`
          truncated = true
        }
        return {
          cwd: dir,
          base: input.base ?? (input.staged ? 'staged' : 'working-tree'),
          truncated,
          diff,
          ok: true,
        }
      },
    },
  ]
}

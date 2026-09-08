// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// `eyas migrate` — v1 → v2 prompt architecture migration commands.
//
// Subcommands:
//   eyas migrate run        — Run the full migration (requires --provider + --model)
//   eyas migrate rollback   — Restore v1 data from the pre-migration snapshot
//   eyas migrate drop-cols  — Drop v1 columns after verifying migration correctness
import { defineCommand } from 'citty'

// ─── run ─────────────────────────────────────────────────────────────────────

const run = defineCommand({
  meta: {
    name: 'run',
    description: 'Migrate agent_definitions from v1 systemPrompt to v2 workspace files',
  },
  args: {
    provider: {
      type: 'string',
      description: 'AI provider to use for systemPrompt splitting (anthropic | openai | gemini | ollama)',
      required: true,
    },
    model: {
      type: 'string',
      description: 'Model ID to use (e.g. claude-3-5-haiku-20241022, gpt-4o-mini, llama3.2)',
      required: true,
    },
    'dry-run': {
      type: 'boolean',
      description: 'Log what would happen without writing any files or DB rows',
      default: false,
    },
  },
  async run({ args }) {
    const { main } = await import('../../../scripts/migrate-prompts-v2.js')
    const argv = [
      'bun',
      'scripts/migrate-prompts-v2.ts',
      '--provider', args.provider,
      '--model', args.model,
      ...(args['dry-run'] ? ['--dry-run'] : []),
    ]
    await main(argv)
  },
})

// ─── rollback ─────────────────────────────────────────────────────────────────

const rollback = defineCommand({
  meta: {
    name: 'rollback',
    description: 'Restore agent_definitions v1 data from the pre-migration snapshot',
  },
  args: {
    'remove-files': {
      type: 'boolean',
      description: 'Also delete data/agents/ workspace directory',
      default: false,
    },
  },
  async run({ args }) {
    const { main } = await import('../../../scripts/migrate-prompts-v2-rollback.js')
    const argv = [
      'bun',
      'scripts/migrate-prompts-v2-rollback.ts',
      ...(args['remove-files'] ? ['--remove-files'] : []),
    ]
    await main(argv)
  },
})

// ─── drop-cols ────────────────────────────────────────────────────────────────

const dropCols = defineCommand({
  meta: {
    name: 'drop-cols',
    description: 'Drop v1 columns from agent_definitions (IRREVERSIBLE — run after verifying migration)',
  },
  args: {
    yes: {
      type: 'boolean',
      description: 'Confirm destructive operation (required)',
      default: false,
    },
  },
  async run({ args }) {
    const { main } = await import('../../../scripts/migrate-prompts-v2-drop-cols.js')
    const argv = [
      'bun',
      'scripts/migrate-prompts-v2-drop-cols.ts',
      ...(args.yes ? ['--yes'] : []),
    ]
    await main(argv)
  },
})

// ─── Root command ─────────────────────────────────────────────────────────────

export default defineCommand({
  meta: {
    name: 'migrate',
    description: 'Manage v1 → v2 prompt architecture migration',
  },
  subCommands: {
    run,
    rollback,
    'drop-cols': dropCols,
  },
})

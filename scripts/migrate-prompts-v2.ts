// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// EYAS v1 → v2 prompt architecture migration.
//
// PRE-CONDITIONS:
//   - Production DB exists at the configured path
//   - data/agents/ does NOT exist (we refuse to overwrite an in-progress v2 setup)
//
// PHASES:
//   1. Pre-flight checks + db backup + v1 row snapshot
//   2. AI-assisted systemPrompt → workspace section split
//   3. Per-agent workspace file generation
//   4. Project-type / project cascade migration
//
// USAGE:
//   bun run scripts/migrate-prompts-v2.ts --provider anthropic --model claude-3-5-haiku-20241022
//   bun run scripts/migrate-prompts-v2.ts --provider openai --model gpt-4o-mini --dry-run
//   bun run scripts/migrate-prompts-v2.ts --provider ollama --model llama3.2 --dry-run
//
// SAFETY:
//   - Always creates a `<dbPath>.pre-prompts-v2.bak` backup before any DB write
//   - Stops on first error
//   - Snapshot table preserves the original v1 row JSON for rollback
import { copyFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { Database } from 'bun:sqlite'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { sql } from 'drizzle-orm'
import { loadConfig } from '../src/core/config/loader.js'
import { snapshotV1AgentRows } from './lib/snapshot-v1-agent-rows.js'
import { splitLegacySystemPrompt, type LegacyAgentMeta } from './lib/legacy-prompt-splitter.js'
import { bootstrapAgentWorkspace } from './lib/agent-workspace-bootstrap.js'
import { migrateCascadeFiles } from './lib/cascade-migration.js'
import { agentDefinitions } from '../src/modules/agent/schema.js'
import type { ModelProvider } from '../src/modules/model/types.js'

const DEFAULT_DATA_DIR = 'data'

// ─── CLI argument parsing ────────────────────────────────────────────────────

function parseArgs(argv: string[]): { provider: string; modelId: string; dryRun: boolean } {
  const args = argv.slice(2) // skip 'bun' and script path
  let provider = ''
  let modelId = ''
  let dryRun = false

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--provider' && args[i + 1]) {
      provider = args[++i]
    } else if (args[i] === '--model' && args[i + 1]) {
      modelId = args[++i]
    } else if (args[i] === '--dry-run') {
      dryRun = true
    }
  }

  if (!provider) throw new Error('--provider is required (anthropic | openai | gemini | ollama)')
  if (!modelId) throw new Error('--model is required')

  return { provider, modelId, dryRun }
}

// ─── Provider factory ─────────────────────────────────────────────────────────

async function resolveProvider(provider: string): Promise<ModelProvider> {
  switch (provider) {
    case 'anthropic': {
      const apiKey = process.env.ANTHROPIC_API_KEY
      if (!apiKey) throw new Error('ANTHROPIC_API_KEY environment variable is required for provider=anthropic')
      const Anthropic = (await import('@anthropic-ai/sdk')).default
      const { AnthropicAdapter } = await import('../src/modules/model/submodules/anthropic/adapter.js')
      return new AnthropicAdapter(new Anthropic({ apiKey }))
    }
    case 'openai': {
      const apiKey = process.env.OPENAI_API_KEY
      if (!apiKey) throw new Error('OPENAI_API_KEY environment variable is required for provider=openai')
      const OpenAI = (await import('openai')).default
      const { OpenAIAdapter } = await import('../src/modules/model/submodules/openai/adapter.js')
      return new OpenAIAdapter(new OpenAI({ apiKey }))
    }
    case 'gemini': {
      const apiKey = process.env.GEMINI_API_KEY
      if (!apiKey) throw new Error('GEMINI_API_KEY environment variable is required for provider=gemini')
      const { GoogleGenAI } = await import('@google/genai')
      const { GeminiAdapter } = await import('../src/modules/model/submodules/gemini/adapter.js')
      return new GeminiAdapter(new GoogleGenAI({ apiKey }))
    }
    case 'ollama': {
      const { OllamaAdapter } = await import('../src/modules/model/submodules/ollama/adapter.js')
      const baseUrl = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434'
      return new OllamaAdapter(baseUrl)
    }
    default:
      throw new Error(`Unknown provider: ${provider}. Valid values: anthropic | openai | gemini | ollama`)
  }
}

// ─── Core migration logic (exported for testing) ─────────────────────────────

export async function runMigration(argv: string[]): Promise<void> {
  const { provider, modelId, dryRun } = parseArgs(argv)

  const config = loadConfig('config/default.yaml')
  const dbPath = config.database.path
  const dataDir = DEFAULT_DATA_DIR

  if (!existsSync(dbPath)) {
    throw new Error(`db not found: ${dbPath}`)
  }
  const agentsDir = join(dataDir, 'agents')
  if (existsSync(agentsDir)) {
    throw new Error(
      `${agentsDir} exists — refusing to overwrite an in-progress v2 setup. ` +
        'Remove the directory or run a clean restore from backup.',
    )
  }

  // 1. Backup the DB before any write.
  const bak = `${dbPath}.pre-prompts-v2.bak`
  if (!dryRun) {
    copyFileSync(dbPath, bak)
    console.log(`[migrate] backed up db → ${bak}`)
  } else {
    console.log(`[migrate] dry-run: would back up db → ${bak}`)
  }

  // 2. Open the migration's own drizzle handle (bypasses EyasDb sync wrapper).
  const sqlite = new Database(dbPath)
  const db = drizzle(sqlite)

  // 3. Snapshot v1 agent rows.
  const snapshotCount = await snapshotV1AgentRows(db)
  console.log(`[migrate] snapshotted ${snapshotCount} agent rows`)

  // 4. Resolve the model provider.
  console.log(`[migrate] using provider=${provider} model=${modelId}${dryRun ? ' (dry-run)' : ''}`)
  const modelProvider = await resolveProvider(provider)

  // 5. Per-agent loop.
  const rows = await db.select().from(agentDefinitions)
  let migratedCount = 0

  for (const row of rows) {
    if (row.workspacePath) {
      console.log(`[migrate] skip ${row.id} ${row.name} — already migrated`)
      continue
    }

    const meta: LegacyAgentMeta = {
      id: row.id,
      name: row.name,
      role: row.role ?? null,
      goal: row.goal ?? null,
      backstory: row.backstory ?? null,
      tier: row.tier,
    }

    const split = await splitLegacySystemPrompt(row.systemPrompt ?? '', meta, modelProvider, modelId)
    console.log(`[migrate] ${row.id} ${row.name} → confidence=${split.confidence}`)

    if (!dryRun) {
      await bootstrapAgentWorkspace({
        dataDir,
        agentId: row.id,
        agentName: row.name,
        tier: row.tier as 'primary' | 'team' | 'specialist',
        split,
      })
      const workspacePath = `${dataDir}/agents/${row.id}`
      const addressable = row.tier === 'primary' || row.tier === 'team' ? 1 : 0
      db.run(
        sql`UPDATE agent_definitions SET workspace_path = ${workspacePath}, addressable = ${addressable} WHERE id = ${row.id}`,
      )
    }

    migratedCount++
  }

  // 6. Cascade migration for project_types and projects.
  if (!dryRun) {
    const cascadeResult = await migrateCascadeFiles(db, dataDir)
    console.log(
      `[migrate] cascade migration: ${cascadeResult.projectTypesMigrated} project_types, ${cascadeResult.projectsMigrated} projects`,
    )
  }

  if (dryRun) {
    console.log(`[migrate] complete (dry-run: would migrate ${migratedCount} agents)`)
  } else {
    console.log(`[migrate] complete (${migratedCount} agents migrated)`)
  }

  sqlite.close()
}

// ─── CLI entry point ──────────────────────────────────────────────────────────

export async function main(argv: string[]): Promise<void> {
  await runMigration(argv)
}

// Only auto-run when this file is the entry point (not when imported by tests or CLI).
if (import.meta.main) {
  main(process.argv).catch((err) => {
    console.error('[migrate] failed:', err)
    process.exit(1)
  })
}

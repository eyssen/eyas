// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Runs the fake ACP agent (tests/fixtures/cli/fake-acp-agent.ts) through a
// real ACP profile: the profile's own argv, env and EYAS home are used
// unchanged, only the executable is a tiny wrapper script that starts the
// fake under the current JS runtime and tells it where to log.

import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createAcpProfile, type AcpCliProfile, type AcpProviderId } from '@modules/model/submodules/grok-cli/acp-profiles.js'

export const FAKE_ACP_AGENT = fileURLToPath(new URL('../fixtures/cli/fake-acp-agent.ts', import.meta.url))

export type FakeAcpScenario = 'text' | 'tools' | 'ungoverned' | 'read' | 'script'

/**
 * The models the fake's session offers: 'recorded' (the grok 1.0.41
 * recording: four models, per-model reasoning efforts) or a path to a JSON
 * file {currentModelId, availableModels}. Default: the grok 1.0.40 recording.
 */
export type FakeAcpModels = 'recorded' | (string & {})

/**
 * How the fake answers session/new and session/set_model: 'grok' (default,
 * the grok 1.0.40/1.0.41 recordings) or 'kimi' (derived from the kimi-cli
 * 1.52.0 source: models state only, `<key>,thinking` variants, set_model
 * answered with an empty result).
 */
export type FakeAcpDialect = 'grok' | 'kimi'

/** What the fake prints for `grok inspect --json`: a recorded fixture, a failure or non-JSON. */
export type FakeAcpInspect = 'isolated' | 'hostile' | 'in-root-project' | 'mcp-allowlist' | 'fail' | 'garbage'

export interface FakeAcpLog {
  start: { argv: string[]; env: Record<string, string>; cwd: string }
  /** Every `inspect --json` run (the isolation preflight), in order. */
  inspects: Array<{ argv: string[]; env: Record<string, string>; cwd: string }>
  /** What EYAS answered to the fake's fs/read_text_file ('read' scenario). */
  fsReads: any[]
  /** Every message the fake received, in order. */
  received: Array<{ jsonrpc?: string; id?: number | string; method?: string; params?: any; result?: any }>
  /** How EYAS answered each permission request (tools scenario). */
  permissionAnswers: Array<{ toolCallId: string; decision: any }>
  /** 'kimi' dialect: the config.toml writes a real kimi's session/set_model would make. */
  configWrites: Array<{ path: string; default_model: string; default_thinking: boolean }>
}

function shQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

/**
 * Write an executable wrapper in `dir` that runs the fake agent with the
 * given scenario and log file, passing the profile's argv through.
 */
export function writeFakeAcpExecutable(
  dir: string,
  opts: { log: string; scenario?: FakeAcpScenario; maxTools?: number; inspect?: FakeAcpInspect; sessionMode?: string; readPath?: string; promptImage?: boolean; systemOverride?: 'honour' | 'ignore'; promptError?: boolean; script?: string; models?: FakeAcpModels; dialect?: FakeAcpDialect },
): string {
  const path = join(dir, `fake-acp-${Math.random().toString(36).slice(2)}.sh`)
  const vars = [
    `FAKE_ACP_LOG=${shQuote(opts.log)}`,
    `FAKE_ACP_SCENARIO=${shQuote(opts.scenario ?? 'text')}`,
    `FAKE_ACP_MAX_TOOLS=${shQuote(String(opts.maxTools ?? 10))}`,
    `FAKE_ACP_INSPECT=${shQuote(opts.inspect ?? 'isolated')}`,
    ...(opts.sessionMode ? [`FAKE_ACP_SESSION_MODE=${shQuote(opts.sessionMode)}`] : []),
    ...(opts.readPath ? [`FAKE_ACP_READ_PATH=${shQuote(opts.readPath)}`] : []),
    ...(opts.promptImage ? ['FAKE_ACP_PROMPT_IMAGE=1'] : []),
    ...(opts.systemOverride ? [`FAKE_ACP_SYSTEM_OVERRIDE=${shQuote(opts.systemOverride)}`] : []),
    ...(opts.promptError ? ['FAKE_ACP_PROMPT_ERROR=1'] : []),
    ...(opts.script ? [`FAKE_ACP_SCRIPT=${shQuote(opts.script)}`] : []),
    ...(opts.models ? [`FAKE_ACP_MODELS=${shQuote(opts.models)}`] : []),
    ...(opts.dialect ? [`FAKE_ACP_DIALECT=${shQuote(opts.dialect)}`] : []),
  ].join(' ')
  writeFileSync(path, `#!/bin/sh\n${vars} exec ${shQuote(process.execPath)} ${shQuote(FAKE_ACP_AGENT)} "$@"\n`)
  chmodSync(path, 0o755)
  return path
}

export interface FakeAcpProfileOptions {
  providerId?: AcpProviderId
  homesDir: string
  dir: string
  log: string
  scenario?: FakeAcpScenario
  maxTools?: number
  inspect?: FakeAcpInspect
  sessionMode?: string
  readPath?: string
  /** initialize advertises image input (the recorded grok 1.0.40 answer is no). */
  promptImage?: boolean
  /** Whether the fake's system_prompt.txt takes the _meta override at the model request (default 'honour', like grok 1.0.40). */
  systemOverride?: 'honour' | 'ignore'
  /** session/prompt fails before any model request. */
  promptError?: boolean
  /** 'script' scenario: the JSON file the fake replays ({steps, result}). */
  script?: string
  /** The models (and their reasoning efforts) the fake's session offers. */
  models?: FakeAcpModels
  /** How the fake answers session/new and session/set_model (default 'grok'). */
  dialect?: FakeAcpDialect
  /** The "host" environment the profile filters (default: PATH only). */
  sourceEnv?: NodeJS.ProcessEnv
  extraEnv?: () => Record<string, string | undefined>
}

/** A real profile whose executable is the fake agent wrapper. */
export function fakeAcpProfile(opts: FakeAcpProfileOptions): AcpCliProfile {
  const executable = writeFakeAcpExecutable(opts.dir, opts)
  return createAcpProfile(opts.providerId ?? 'grok-cli', {
    homesDir: opts.homesDir,
    resolveExecutable: async () => executable,
    sourceEnv: opts.sourceEnv ?? { PATH: process.env.PATH ?? '' },
    extraEnv: opts.extraEnv,
  })
}

/** Parse the fake agent's log. */
export function readFakeAcpLog(log: string): FakeAcpLog {
  const lines = existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []
  const start = lines.find((l) => l.start)?.start ?? { argv: [], env: {}, cwd: '' }
  return {
    start,
    inspects: lines.filter((l) => l.inspect).map((l) => l.inspect),
    fsReads: lines.filter((l) => l.fsRead).map((l) => l.fsRead),
    received: lines.filter((l) => l.in).map((l) => l.in),
    permissionAnswers: lines.filter((l) => l.permissionAnswer).map((l) => l.permissionAnswer),
    configWrites: lines.filter((l) => l.configWrite).map((l) => l.configWrite),
  }
}

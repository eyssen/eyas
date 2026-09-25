// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// A fake ACP agent (Grok / Kimi over stdio) for the runner tests. It replays
// the shapes the A1 spike recorded from grok 1.0.40 (initialize, session/new,
// read_file permission requests, the session-store layout) and records what
// EYAS actually did to it: argv, environment, cwd and every message.
//
// Launched through a wrapper script (tests/helpers/fake-acp.ts) that sets
//   FAKE_ACP_LOG       JSON-lines log file (first line: argv/env/cwd)
//   FAKE_ACP_SCENARIO  'text' (default), 'tools' (a tool call per turn step
//                      until the client cancels, at most FAKE_ACP_MAX_TOOLS),
//                      'ungoverned' (a shell call that runs without asking,
//                      as under a flipped always-approve) or 'read' (a
//                      read_file of FAKE_ACP_READ_PATH: permission first,
//                      then fs/read_text_file with line 2, limit 2) or
//                      'script' (replays FAKE_ACP_SCRIPT, see runScript)
//   FAKE_ACP_SCRIPT    'script' scenario: a JSON file {steps, result}
//   FAKE_ACP_INSPECT   the `grok inspect --json` report: a recorded fixture
//                      name ('isolated' default, 'hostile', 'in-root-project',
//                      'mcp-allowlist'), 'fail' (exit 3) or 'garbage'
//   FAKE_ACP_SESSION_MODE  a modes.currentModeId to report from session/new
//   FAKE_ACP_PROMPT_IMAGE  '1': initialize advertises promptCapabilities.image
//                      true (the recorded grok 1.0.40 answer is false)
//   FAKE_ACP_SYSTEM_OVERRIDE  'honour' (default): like grok 1.0.40,
//                      system_prompt.txt holds a default prompt from
//                      session/new and the _meta.systemPromptOverride only
//                      once the model request is made (session/prompt);
//                      'ignore': the default prompt stays
//   FAKE_ACP_PROMPT_ERROR  '1': session/prompt fails before any model request
//   FAKE_ACP_MODELS    the models the session offers: unset = the recorded
//                      grok 1.0.40 session/new (grok-4.6, no effort option);
//                      'recorded' = the grok 1.0.41 recording
//                      (grok/1.0.41/acp-config-options.json: grok-4.7 default,
//                      grok-4.6, grok-4.5 without xhigh, grok-code-fast
//                      without reasoning control); or a path to a JSON file
//                      {currentModelId, availableModels} in the same shape.
// The session's config options (model, and reasoning_effort for a model with
// efforts) behave as recorded from grok 1.0.41: session/set_config_option
// takes a plain string value, answers with the complete option list and
// mirrors it as a config_option_update; a switch keeps the effort when the
// new model offers it; an unknown value, model or option is refused (-32602).
// `--model X` on the argv selects X when the session offers it; an unknown X
// is ignored and the default runs, as grok does. session/set_model (ACP,
// unstable) switches the model the same way.
//   FAKE_ACP_DIALECT   'kimi': answer as kimi-cli 1.52.0 does, derived from
//                      its source (acp/server.py; no kimi binary was
//                      recorded): session/new returns modes {default} and the
//                      models state only (no configOptions; default models:
//                      kimi/1.52.0/session-new-models.json), session/set_model
//                      takes `<model key>` or `<model key>,thinking` for any
//                      key the session lists, answers with an empty result and
//                      no update, does nothing when the id is already current,
//                      and otherwise logs the config.toml write kimi makes
//                      (default_model / default_thinking in the share dir);
//                      session/set_config_option is not supported.
// Like the real CLI, it writes its session store under $GROK_HOME (or
// $KIMI_SHARE_DIR)/sessions/<encoded cwd>/<session id>/.

import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const fixture = (name: string): any => JSON.parse(readFileSync(join(here, 'grok', '1.0.40', name), 'utf8'))

const logPath = process.env.FAKE_ACP_LOG ?? ''
const scenario = process.env.FAKE_ACP_SCENARIO ?? 'text'
const kimi = process.env.FAKE_ACP_DIALECT === 'kimi'
const maxTools = Number(process.env.FAKE_ACP_MAX_TOOLS ?? '10')

const log = (entry: unknown): void => {
  if (logPath) appendFileSync(logPath, JSON.stringify(entry) + '\n')
}

if (process.argv[2] === '--version') {
  process.stdout.write('grok 1.0.41 (fake)\n')
  process.exit(0)
}

// `grok inspect --json` (the isolation preflight): print the recorded report
// with this run's real paths and exit, as the CLI does. Logged apart from
// the session's `start` line.
if (process.argv[2] === 'inspect') {
  const variant = process.env.FAKE_ACP_INSPECT ?? 'isolated'
  log({ inspect: { argv: process.argv.slice(2), cwd: process.cwd(), env: process.env } })
  if (variant === 'fail') {
    process.stderr.write('inspect failed\n')
    process.exit(3)
  }
  if (variant === 'garbage') {
    process.stdout.write('not json\n')
    process.exit(0)
  }
  const homes = dirname(dirname(process.env.GROK_HOME ?? '/nonexistent/grok-cli/.grok'))
  const text = readFileSync(join(here, 'grok', '1.0.40', `inspect-${variant}.json`), 'utf8')
    .replaceAll('<EYAS_HOMES>', homes)
    .replaceAll('<ROOT>/workspaces/conv-1', process.cwd())
    .replaceAll('<PROJECT>', process.cwd())
    .replaceAll('<HOME>', process.env.HOME ?? '/nonexistent')
  process.stdout.write(text)
  process.exit(0)
}

log({ start: { argv: process.argv.slice(2), env: process.env, cwd: process.cwd() } })

const send = (msg: unknown): void => {
  process.stdout.write(JSON.stringify(msg) + '\n')
}
const update = (sessionId: string, u: Record<string, unknown>): void =>
  send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId, update: u } })

const SESSION_ID = 'fake-session-1'

// ─── Models and session config options (grok 1.0.41 semantics) ───

interface FakeModel {
  modelId: string
  name?: string
  _meta?: { supportsReasoningEffort?: boolean; reasoningEfforts?: Array<{ value: string; label?: string; default?: boolean }>; [k: string]: unknown }
}
interface ModelsState { currentModelId: string; availableModels: FakeModel[] }

function loadModelsState(): ModelsState {
  const source = process.env.FAKE_ACP_MODELS
  if (source === 'recorded') {
    const recorded = JSON.parse(readFileSync(join(here, 'grok', '1.0.41', 'acp-config-options.json'), 'utf8'))
    return structuredClone(recorded.sessionNew.models)
  }
  if (source) return JSON.parse(readFileSync(source, 'utf8'))
  if (kimi) {
    const { currentModelId, availableModels } = JSON.parse(readFileSync(join(here, 'kimi', '1.52.0', 'session-new-models.json'), 'utf8'))
    return { currentModelId, availableModels }
  }
  return structuredClone(fixture('session-new.json').models)
}

/** kimi-cli 1.52.0 _ModelIDConv: `<key>,thinking` is the thinking variant of `<key>`. */
const kimiKeyOf = (modelId: string): string => (modelId.endsWith(',thinking') ? modelId.slice(0, -',thinking'.length) : modelId)

/** session/set_model as kimi-cli 1.52.0 answers it: an error text, or null when applied. */
function setKimiModel(modelId: unknown): string | null {
  if (typeof modelId !== 'string') return 'Invalid params'
  // kimi looks the key up in its [models] table; the variant itself is not checked.
  if (!models.availableModels.some((m) => kimiKeyOf(m.modelId) === kimiKeyOf(modelId))) return 'Model not found'
  if (modelId === models.currentModelId) return null
  models.currentModelId = modelId
  const shareDir = process.env.KIMI_SHARE_DIR || join(process.env.HOME ?? '/nonexistent', '.kimi')
  log({ configWrite: { path: join(shareDir, 'config.toml'), default_model: kimiKeyOf(modelId), default_thinking: modelId.endsWith(',thinking') } })
  return null
}

const models = loadModelsState()
const argvModel = (() => {
  const i = process.argv.indexOf('--model')
  return i >= 0 ? process.argv[i + 1] : undefined
})()
// An unknown --model is ignored silently; the default runs (grok 1.0.41).
if (argvModel && models.availableModels.some((m) => m.modelId === argvModel)) models.currentModelId = argvModel

const modelById = (id: string): FakeModel | undefined => models.availableModels.find((m) => m.modelId === id)
const effortsOf = (m: FakeModel | undefined): Array<{ value: string; label?: string; default?: boolean }> =>
  m?._meta?.supportsReasoningEffort ? m._meta.reasoningEfforts ?? [] : []
const defaultEffortOf = (m: FakeModel | undefined): string | null => {
  const efforts = effortsOf(m)
  return (efforts.find((e) => e.default) ?? efforts[0])?.value ?? null
}
let currentEffort: string | null = defaultEffortOf(modelById(models.currentModelId))

function configOptions(): unknown[] {
  const out: unknown[] = [{
    id: 'model',
    name: 'Model',
    category: 'model',
    type: 'select',
    currentValue: models.currentModelId,
    options: models.availableModels.map((m) => ({ value: m.modelId, name: m.name ?? m.modelId })),
  }]
  const efforts = effortsOf(modelById(models.currentModelId))
  if (efforts.length > 0 && currentEffort) {
    out.push({
      id: 'reasoning_effort',
      name: 'Reasoning Effort',
      category: 'thought_level',
      type: 'select',
      currentValue: currentEffort,
      options: efforts.map((e) => ({ value: e.value, name: e.label ?? e.value })),
    })
  }
  return out
}

/** Switch the model; the effort is kept when the new model offers it (grok 1.0.41). */
function selectModel(modelId: string): void {
  models.currentModelId = modelId
  const efforts = effortsOf(modelById(modelId)).map((e) => e.value)
  if (efforts.length === 0) currentEffort = null
  else if (!currentEffort || !efforts.includes(currentEffort)) currentEffort = defaultEffortOf(modelById(modelId))
}

/** session/set_config_option as grok 1.0.41 answers it: an error text, or null when applied. */
function setConfigOption(configId: unknown, value: unknown): string | null {
  if (typeof value !== 'string') return 'data did not match any variant of untagged enum SessionConfigOptionValue'
  if (configId === 'model') {
    if (!modelById(value)) return 'unknown model id'
    selectModel(value)
    return null
  }
  if (configId === 'reasoning_effort') {
    if (!effortsOf(modelById(models.currentModelId)).some((e) => e.value === value)) return 'unknown reasoning_effort value'
    currentEffort = value
    return null
  }
  return `unknown config option: ${String(configId)}`
}

let sessionCwd = process.cwd()
let cancelled = false
let onCancel: () => void = () => {}
const cancelledPromise = new Promise<void>((resolve) => { onCancel = resolve })
let nextServerId = 1000
const waiting = new Map<number, (result: unknown) => void>()

function storeDir(): string | null {
  const root = process.env.GROK_HOME ?? process.env.KIMI_SHARE_DIR
  return root ? join(root, 'sessions', encodeURIComponent(sessionCwd), SESSION_ID) : null
}

function writeStore(file: string, line: unknown): void {
  const dir = storeDir()
  if (!dir) return
  mkdirSync(dir, { recursive: true })
  appendFileSync(join(dir, file), JSON.stringify(line) + '\n')
  writeFileSync(join(dir, '..', 'prompt_history.jsonl'), JSON.stringify(line) + '\n', { flag: 'a' })
}

/** grok's DEFAULT system prompt stand-in (the real one is ~9 KB). */
const DEFAULT_SYSTEM_PROMPT = 'You are the fake CLI default assistant.\n'
/** The override session/new carried, if any. */
let systemOverride: string | null = null

/** system_prompt.txt as grok 1.0.40 keeps it (A1 fixture system-prompt-file.json). */
function writeSystemPromptFile(text: string): void {
  const dir = storeDir()
  if (!dir) return
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'system_prompt.txt'), text)
}

/** Send a request to the client (EYAS) and wait for its answer. */
function requestClient(method: string, params: unknown): Promise<unknown> {
  const id = nextServerId++
  return new Promise((resolve) => {
    waiting.set(id, resolve)
    send({ jsonrpc: '2.0', id, method, params })
  })
}

function askPermission(toolCallId: string, rawInput?: Record<string, unknown>): Promise<unknown> {
  const [template] = fixture('permission-requests.json')
  return requestClient('session/request_permission', {
    sessionId: SESSION_ID,
    toolCall: { ...template.toolCall, toolCallId, ...(rawInput ? { rawInput } : {}) },
    options: template.options,
  })
}

const usage = { inputTokens: 10, outputTokens: 5, totalTokens: 15 }

async function runTools(): Promise<{ stopReason: string }> {
  update(SESSION_ID, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'partial answer' } })
  for (let i = 0; i < maxTools && !cancelled; i++) {
    const toolCallId = `call_main_${i}`
    update(SESSION_ID, { sessionUpdate: 'tool_call', toolCallId, title: 'read_file' })
    update(SESSION_ID, { sessionUpdate: 'tool_call_update', toolCallId, kind: 'read', title: 'Read probe.txt' })
    const decision = await askPermission(toolCallId)
    log({ permissionAnswer: { toolCallId, decision } })
    if (cancelled) break
    const outcome = (decision as { outcome?: { outcome?: string } })?.outcome?.outcome
    update(SESSION_ID, { sessionUpdate: 'tool_call_update', toolCallId, status: outcome === 'selected' ? 'completed' : 'failed' })
    // Give a cancel notification the chance to arrive between two calls.
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  return { stopReason: cancelled ? 'cancelled' : 'end_turn' }
}

/**
 * Replay a recorded turn (G3 stream fixtures): each step is
 *   {update}      sent as a session/update,
 *   {permission}  a toolCall EYAS is asked about (the recorded allow-once /
 *                 reject-once options); the answer is logged,
 *   {sleep: ms}   a pause;
 * the prompt is then answered with the script's `result`, as recorded.
 */
async function runScript(): Promise<Record<string, unknown>> {
  const script = JSON.parse(readFileSync(process.env.FAKE_ACP_SCRIPT ?? '', 'utf8')) as {
    steps?: Array<{ update?: Record<string, unknown>; permission?: Record<string, unknown>; sleep?: number }>
    result?: Record<string, unknown>
  }
  const [template] = fixture('permission-requests.json')
  for (const step of script.steps ?? []) {
    if (cancelled) break
    if (step.update) {
      update(SESSION_ID, step.update)
    } else if (step.permission) {
      const decision = await requestClient('session/request_permission', { sessionId: SESSION_ID, toolCall: step.permission, options: template.options })
      log({ permissionAnswer: { toolCallId: step.permission.toolCallId, decision } })
    } else if (step.sleep) {
      await new Promise((resolve) => setTimeout(resolve, step.sleep))
    }
  }
  return script.result ?? { stopReason: 'end_turn' }
}

/** A native shell call that runs without asking (what always-approve looks like). */
async function runUngoverned(): Promise<{ stopReason: string }> {
  update(SESSION_ID, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'before ' } })
  const toolCallId = 'call_main_0'
  update(SESSION_ID, { sessionUpdate: 'tool_call', toolCallId, title: 'run_terminal_command', rawInput: { command: 'cat ~/.grok/memory/MEMORY.md' } })
  update(SESSION_ID, { sessionUpdate: 'tool_call_update', toolCallId, kind: 'execute', title: 'Execute `cat`' })
  update(SESSION_ID, { sessionUpdate: 'tool_call_update', toolCallId, status: 'in_progress' })
  await new Promise((resolve) => setTimeout(resolve, 20))
  update(SESSION_ID, { sessionUpdate: 'tool_call_update', toolCallId, status: 'completed' })
  update(SESSION_ID, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'LEAKED-AFTER-TRIP' } })
  return { stopReason: cancelled ? 'cancelled' : 'end_turn' }
}

/** read_file as grok 1.0.40 does it: permission first, then the client fs read. */
async function runRead(): Promise<{ stopReason: string }> {
  const path = process.env.FAKE_ACP_READ_PATH ?? join(sessionCwd, 'probe.txt')
  const toolCallId = 'call_main_0'
  update(SESSION_ID, { sessionUpdate: 'tool_call', toolCallId, title: 'read_file', rawInput: { target_file: path, offset: 2, limit: 2 } })
  update(SESSION_ID, { sessionUpdate: 'tool_call_update', toolCallId, kind: 'read', title: `Read \`${path}\``, locations: [{ path, line: 2 }] })
  const decision = await askPermission(toolCallId, { variant: 'ReadFile', target_file: path, offset: 2, limit: 2 })
  log({ permissionAnswer: { toolCallId, decision } })
  const selected = (decision as { outcome?: { outcome?: string; optionId?: string } })?.outcome
  if (selected?.outcome === 'selected' && selected.optionId === 'allow-once') {
    const read = await requestClient('fs/read_text_file', { sessionId: SESSION_ID, path, line: 2, limit: 2 })
    log({ fsRead: read })
    update(SESSION_ID, { sessionUpdate: 'tool_call_update', toolCallId, status: 'completed' })
  } else {
    update(SESSION_ID, { sessionUpdate: 'tool_call_update', toolCallId, status: 'failed' })
  }
  update(SESSION_ID, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'read done' } })
  return { stopReason: 'end_turn' }
}

createInterface({ input: process.stdin }).on('line', (line) => {
  let msg: any
  try {
    msg = JSON.parse(line)
  } catch {
    return
  }
  log({ in: msg })

  // A response to one of our permission requests.
  if (msg.id != null && !msg.method) {
    const resolve = waiting.get(msg.id)
    waiting.delete(msg.id)
    resolve?.(msg.result ?? { error: msg.error })
    return
  }

  if (msg.method === 'session/cancel') {
    cancelled = true
    onCancel()
    return
  }
  if (msg.id == null) return
  const reply = (result: unknown): void => send({ jsonrpc: '2.0', id: msg.id, result })

  switch (msg.method) {
    case 'initialize': {
      const initialized = fixture('initialize.json')
      if (process.env.FAKE_ACP_PROMPT_IMAGE === '1') initialized.agentCapabilities.promptCapabilities.image = true
      return reply(initialized)
    }
    // Would "succeed" if asked; the tests prove it never is.
    case 'session/load':
      return reply({})
    case 'session/set_config_option': {
      if (kimi) return send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'Method not found' } })
      const error = setConfigOption(msg.params?.configId, msg.params?.value)
      if (error) return send({ jsonrpc: '2.0', id: msg.id, error: { code: -32602, message: 'Invalid params', data: error } })
      const listed = configOptions()
      update(SESSION_ID, { sessionUpdate: 'config_option_update', configOptions: listed })
      return reply({ configOptions: listed })
    }
    case 'session/set_model': {
      if (kimi) {
        const error = setKimiModel(msg.params?.modelId)
        if (error) return send({ jsonrpc: '2.0', id: msg.id, error: { code: -32602, message: 'Invalid params', data: { model_id: error } } })
        return reply(null)
      }
      const modelId = msg.params?.modelId
      if (typeof modelId !== 'string' || !modelById(modelId)) {
        return send({ jsonrpc: '2.0', id: msg.id, error: { code: -32602, message: 'Invalid params', data: 'unknown model id' } })
      }
      selectModel(modelId)
      update(SESSION_ID, { sessionUpdate: 'config_option_update', configOptions: configOptions() })
      return reply({})
    }
    case 'session/new': {
      sessionCwd = msg.params?.cwd ?? sessionCwd
      // kimi-cli 1.52.0 new_session: modes (always 'default') and the models state, no configOptions.
      const created = kimi
        ? { modes: { availableModes: [{ id: 'default', name: 'Default', description: 'The default mode.' }], currentModeId: 'default' }, models: structuredClone(models) }
        : { ...fixture('session-new.json'), models: structuredClone(models), configOptions: configOptions() }
      writeStore('summary.json', { created: true })
      const override = msg.params?._meta?.systemPromptOverride
      systemOverride = typeof override === 'string' ? override : null
      // At session/new the record holds the default prompt, never the override.
      writeSystemPromptFile(DEFAULT_SYSTEM_PROMPT)
      const mode = process.env.FAKE_ACP_SESSION_MODE
      return reply({ ...created, sessionId: SESSION_ID, ...(mode ? { modes: { currentModeId: mode, availableModes: [{ id: mode }] } } : {}) })
    }
    case 'session/prompt': {
      if (process.env.FAKE_ACP_PROMPT_ERROR === '1') {
        return send({ jsonrpc: '2.0', id: msg.id, error: { code: -32000, message: 'fake: failed before the model request' } })
      }
      // The model request is built now: the override (if honoured) replaces the record.
      if (systemOverride !== null && process.env.FAKE_ACP_SYSTEM_OVERRIDE !== 'ignore') writeSystemPromptFile(systemOverride)
      const text = msg.params?.prompt?.[0]?.text ?? ''
      writeStore('chat_history.jsonl', { role: 'user', text })
      if (scenario === 'script') {
        const cancelledLater = cancelledPromise.then(
          () => new Promise<Record<string, unknown>>((resolve) => setTimeout(() => resolve({ stopReason: 'cancelled' }), 50)),
        )
        void Promise.race([runScript(), cancelledLater]).then((r) => reply(r))
        return
      }
      if (scenario === 'tools' || scenario === 'ungoverned' || scenario === 'read') {
        const done = scenario === 'tools' ? runTools() : scenario === 'ungoverned' ? runUngoverned() : runRead()
        // Reply to the prompt once the loop stops or the turn is cancelled.
        // A cancelled turn is confirmed a moment later, as a real CLI winds
        // down its in-flight call first.
        const cancelledLater = cancelledPromise.then(
          () => new Promise<{ stopReason: string }>((resolve) => setTimeout(() => resolve({ stopReason: 'cancelled' }), 50)),
        )
        void Promise.race([done, cancelledLater]).then((r) => reply({ stopReason: r.stopReason, _meta: { usage } }))
        return
      }
      update(SESSION_ID, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'answer' } })
      return reply({ stopReason: 'end_turn', _meta: { usage } })
    }
    default:
      return send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'unsupported' } })
  }
})

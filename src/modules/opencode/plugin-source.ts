// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// The EYAS memory plugin, written into the EYAS-owned OpenCode home
// (isolation.ts) and run inside every OpenCode process EYAS starts. It gives
// OpenCode's model the same two memory tools every EYAS run has —
// memory_search and memory_expand, with EYAS's own names, descriptions and
// arguments (generated below from the registered tool definitions) — and
// nothing that writes: EYAS records memory itself.
//
// Its key (plugin-tokens.ts) arrives on fd 3, never in the environment: the
// plugin reads it once when OpenCode loads it — before any session can run a
// shell — keeps it in memory and closes fd 3, so nothing OpenCode starts
// later inherits it. The key itself is never sent: each call carries a proof
// made for the OpenCode session the tool runs in (the tool context's
// sessionID, set by OpenCode, not by the model). The plugin sends only the
// tool's declared arguments, so a session id the model slips into the
// arguments never reaches EYAS. What a proven session may read is decided in
// EYAS from its binding (memory-bridge.ts).
//
// OpenCode 1.18.29 runs the model's shell (and the `!` shell and the
// terminal's PTY) with its own environment plus what the `shell.env` hook
// returns: `{ ...process.env, ...hook.env }`. The hook blanks the server
// password and the key-descriptor marker there (OPENCODE_SHELL_HIDDEN_ENV).

import { createMemoryTools } from '@modules/tools/builtin/memory-tools.js'
import { OPENCODE_KEY_FD, OPENCODE_KEY_FD_ENV, SESSION_PROOF_LABEL, SESSION_PROOF_PREFIX } from './plugin-tokens.js'

/** The basic-auth password variable of a spawned `opencode serve` (isolation.ts). */
export const OPENCODE_SERVER_PASSWORD_ENV = 'OPENCODE_SERVER_PASSWORD'

/** Variables of an EYAS-started OpenCode process that a shell the model runs sees only as ''. */
export const OPENCODE_SHELL_HIDDEN_ENV: readonly string[] = Object.freeze([OPENCODE_SERVER_PASSWORD_ENV, OPENCODE_KEY_FD_ENV])

/** The plugin's two EYAS endpoints (routes.ts registers these literal paths). */
export const OPENCODE_MEMORY_SEARCH_PATH = '/api/v1/opencode/memory/search'
export const OPENCODE_MEMORY_EXPAND_PATH = '/api/v1/opencode/memory/expand'

/** The EYAS tools the plugin mirrors, and the endpoint each one calls. */
export const OPENCODE_MEMORY_TOOLS: ReadonlyArray<{ name: string; path: string }> = Object.freeze([
  { name: 'memory_search', path: OPENCODE_MEMORY_SEARCH_PATH },
  { name: 'memory_expand', path: OPENCODE_MEMORY_EXPAND_PATH },
])

interface JsonSchemaProperty {
  type?: unknown
  description?: unknown
}

/** One argument of an EYAS tool as an OpenCode plugin arg (`tool.schema` is zod). */
function argSource(name: string, prop: JsonSchemaProperty, required: boolean): string {
  const base = prop.type === 'number' || prop.type === 'integer' ? 'tool.schema.number()' : 'tool.schema.string()'
  const optional = required ? '' : '.optional()'
  const describe = typeof prop.description === 'string' ? `.describe(${JSON.stringify(prop.description)})` : ''
  return `          ${JSON.stringify(name)}: ${base}${optional}${describe},`
}

function toolSource(name: string, path: string): string {
  const def = createMemoryTools(() => undefined).find((t) => t.name === name)
  if (!def) throw new Error(`EYAS memory tool ${name} is not defined`)
  const schema = def.inputSchema as { properties?: Record<string, JsonSchemaProperty>; required?: unknown }
  const required = new Set(Array.isArray(schema.required) ? schema.required.filter((r): r is string => typeof r === 'string') : [])
  const props = Object.entries(schema.properties ?? {})
  const args = props.map(([arg, prop]) => argSource(arg, prop, required.has(arg)))
  return [
    `      ${name}: tool({`,
    `        description: ${JSON.stringify(def.description)},`,
    '        args: {',
    ...args,
    '        },',
    '        async execute(args, context) {',
    `          return await callEyas(${JSON.stringify(path)}, pick(args, ${JSON.stringify(props.map(([arg]) => arg))}), context)`,
    '        },',
    '      }),',
  ].join('\n')
}

function buildPluginSource(): string {
  return `import { tool } from "@opencode-ai/plugin"
import { createHmac, randomBytes } from "node:crypto"
import { closeSync, fstatSync, readFileSync } from "node:fs"

// This process's memory key: EYAS wrote it into fd ${OPENCODE_KEY_FD} and ended it. Read once,
// kept in memory only, and fd ${OPENCODE_KEY_FD} is closed so nothing started later inherits it.
let keyRead = false
let processKey = null

function readProcessKey() {
  if (keyRead) return processKey
  keyRead = true
  if (process.env.${OPENCODE_KEY_FD_ENV} !== "${OPENCODE_KEY_FD}") return null
  let stat = null
  try {
    stat = fstatSync(${OPENCODE_KEY_FD})
  } catch {
    return null
  }
  if (!stat.isSocket() && !stat.isFIFO()) return null
  try {
    processKey = readFileSync(${OPENCODE_KEY_FD}, "utf8").trim() || null
  } catch {
    processKey = null
  }
  try {
    closeSync(${OPENCODE_KEY_FD})
  } catch {}
  return processKey
}

// A proof for one session: the key itself never leaves this process.
function sessionProof(key, sessionId) {
  const body = { s: sessionId, n: randomBytes(18).toString("base64url"), t: Date.now() }
  const payload = Buffer.from(JSON.stringify(body), "utf8").toString("base64url")
  const mac = createHmac("sha256", key).update(${JSON.stringify(SESSION_PROOF_LABEL)} + "." + payload).digest("base64url")
  return ${JSON.stringify(SESSION_PROOF_PREFIX)} + payload + "." + mac
}

// Only the tool's declared arguments are sent.
function pick(args, names) {
  const out = {}
  for (const name of names) {
    if (args && args[name] !== undefined) out[name] = args[name]
  }
  return out
}

async function callEyas(path, body, context) {
  const base = process.env.EYAS_OPENCODE_EYAS_URL
  const key = readProcessKey()
  if (!base || !key) return "Error: EYAS memory is not available in this OpenCode process"
  const sessionId = context?.sessionID
  if (typeof sessionId !== "string" || !sessionId) return "Error: EYAS memory needs the OpenCode session of this call"
  try {
    const res = await fetch(base + path, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + sessionProof(key, sessionId),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    })
    const data = await res.json().catch(() => null)
    if (data && typeof data.text === "string") return data.text
    return "Error: EYAS memory is not available (HTTP " + res.status + ")"
  } catch {
    return "Error: EYAS memory is not reachable"
  }
}

export const EyasMemoryPlugin = async () => {
  // Now, while OpenCode loads its plugins: before any session can start a shell.
  readProcessKey()
  return {
    tool: {
${OPENCODE_MEMORY_TOOLS.map((t) => toolSource(t.name, t.path)).join('\n')}
    },
    // A shell the model runs gets OpenCode's own environment plus this
    // hook's env: blank the server password and the key marker there.
    "shell.env": async (_input, output) => {
      output.env = output.env ?? {}
${OPENCODE_SHELL_HIDDEN_ENV.map((name) => `      output.env[${JSON.stringify(name)}] = ""`).join('\n')}
    },
  }
}
`
}

/** Written into the OpenCode home (isolation.ts). Runs inside OpenCode. */
export const EYAS_MEMORY_PLUGIN_SOURCE = buildPluginSource()

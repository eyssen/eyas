# eYssen EYAS Hand — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the eyas-hand companion app (core + TUI + CLI) and the EYAS hand-hub module so that a Hand can pair with EYAS, connect via WebSocket, discover CLI tools, and execute commands remotely with permission checks.

**Architecture:** Two repos — `eyas-hand` (new monorepo with packages/protocol, packages/core, packages/tui) and hand-hub module in existing `eyas` repo. The Hand connects outbound via WSS to EYAS. Shared types live in `@eyas/hand-protocol`. TDD with Vitest throughout.

**Tech Stack:** TypeScript 5.9+, Bun, Vitest, Hono (EYAS side), Ink (TUI), Zod, YAML (config), nanoid, ws (WebSocket client)

**Spec:** `docs/superpowers/specs/2026-04-08-eyas-hand-design.md`

---

## File Structure

### eyas-hand repo (new — ~/GitHub/eyas-hand/)

```
eyas-hand/
├── package.json                          # Workspace root
├── tsconfig.json                         # Base TS config
├── vitest.config.ts                      # Test config
├── packages/
│   ├── protocol/                         # @eyas/hand-protocol
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts                  # Re-exports
│   │       ├── messages.ts               # HandMessage, all message type unions
│   │       ├── capabilities.ts           # HandCapabilities, ToolInfo
│   │       ├── permissions.ts            # PermissionConfig, RiskTier, ApprovalDecision
│   │       └── constants.ts              # Protocol version, timeouts, defaults
│   ├── core/                             # @eyas/hand-core
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts                  # Re-exports
│   │       ├── config/
│   │       │   ├── config-loader.ts      # YAML load + Zod validation
│   │       │   ├── config-schema.ts      # Zod schema for ~/.eyas-hand/config.yaml
│   │       │   └── config-writer.ts      # Write config changes back to YAML
│   │       ├── connection/
│   │       │   ├── ws-client.ts          # WebSocket client (phone home, reconnect)
│   │       │   ├── auth.ts               # Challenge-response auth, token storage
│   │       │   └── pairing.ts            # Pairing flow (code → token)
│   │       ├── discovery/
│   │       │   ├── cli-scanner.ts        # PATH walk, which, version detect
│   │       │   ├── tool-catalog.ts       # Built-in tool metadata
│   │       │   └── tool-catalog.yaml     # ~100 common tools data
│   │       ├── executor/
│   │       │   ├── command-executor.ts   # spawn + sandbox + streaming
│   │       │   ├── fs-executor.ts        # File read/write/list
│   │       │   └── sandbox.ts            # Working dir check, env filter, timeout
│   │       ├── permissions/
│   │       │   ├── permission-engine.ts  # Check whitelist/blacklist/approval
│   │       │   ├── risk-classifier.ts    # Classify command → risk tier
│   │       │   └── auto-learn.ts         # Learned rules management
│   │       └── hand-daemon.ts            # Main daemon: wire everything, message loop
│   └── tui/                              # @eyas/hand-tui
│       ├── package.json
│       ├── tsconfig.json
│       └── src/
│           ├── index.ts                  # Entry point (hand --tui)
│           ├── app.tsx                   # Root Ink component
│           ├── components/
│           │   ├── main-menu.tsx         # Arrow-key menu
│           │   ├── connection-screen.tsx  # Connection status + pair
│           │   ├── permissions-screen.tsx # Directory/CLI/App permission editor
│           │   ├── discovery-screen.tsx   # Discovered tools list
│           │   ├── activity-screen.tsx    # Recent commands log
│           │   └── approval-prompt.tsx    # Inline approval popup
│           └── hooks/
│               ├── use-daemon.ts         # Connect TUI to core daemon
│               └── use-config.ts         # Config read/write hook
├── src/
│   └── cli.ts                            # CLI entry point (hand pair/serve/status/config)
└── tests/
    ├── protocol/
    │   └── messages.test.ts
    ├── core/
    │   ├── config-loader.test.ts
    │   ├── ws-client.test.ts
    │   ├── cli-scanner.test.ts
    │   ├── command-executor.test.ts
    │   ├── permission-engine.test.ts
    │   ├── risk-classifier.test.ts
    │   └── hand-daemon.test.ts
    └── tui/
        └── app.test.tsx
```

### eyas repo (existing — ~/GitHub/eyas/)

```
src/modules/hand-hub/
├── index.ts                              # Module manifest (EyasModule)
├── hand-registry.ts                      # Connected Hands Map + capability cache
├── hand-router.ts                        # Route requests to correct Hand
├── hand-ws-handler.ts                    # WS endpoint /api/v1/hand/ws
├── hand-pairing.ts                       # Pairing code generation + validation
├── hand-tools.ts                         # Register Hand tools into EYAS tool registry
├── schema.ts                             # DB tables (hands, hand_tokens, hand_logs)
├── types.ts                              # Hand-hub specific types
└── routes.ts                             # HTTP routes (/api/v1/hands/*)
src/web/src/pages/settings/
└── hands-settings.tsx                    # Settings > Hands page (new)
tests/modules/
└── hand-hub.test.ts                      # hand-hub module tests
```

---

## Task 1: Scaffold eyas-hand monorepo

**Files:**
- Create: `~/GitHub/eyas-hand/package.json`
- Create: `~/GitHub/eyas-hand/tsconfig.json`
- Create: `~/GitHub/eyas-hand/vitest.config.ts`
- Create: `~/GitHub/eyas-hand/.gitignore`
- Create: `~/GitHub/eyas-hand/LICENSE`
- Create: `~/GitHub/eyas-hand/packages/protocol/package.json`
- Create: `~/GitHub/eyas-hand/packages/protocol/tsconfig.json`
- Create: `~/GitHub/eyas-hand/packages/core/package.json`
- Create: `~/GitHub/eyas-hand/packages/core/tsconfig.json`
- Create: `~/GitHub/eyas-hand/packages/tui/package.json`
- Create: `~/GitHub/eyas-hand/packages/tui/tsconfig.json`

- [ ] **Step 1: Create repo directory and init git**

```bash
mkdir -p ~/GitHub/eyas-hand
cd ~/GitHub/eyas-hand
git init
```

- [ ] **Step 2: Create root package.json**

```json
{
  "name": "eyas-hand",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "workspaces": [
    "packages/*"
  ],
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "build": "bun run --filter '*' build",
    "hand": "bun run src/cli.ts"
  },
  "devDependencies": {
    "typescript": "^5.9.0",
    "vitest": "^3.1.0",
    "@types/bun": "^1.2.0"
  }
}
```

- [ ] **Step 3: Create root tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "dist",
    "rootDir": ".",
    "paths": {
      "@eyas/hand-protocol": ["./packages/protocol/src"],
      "@eyas/hand-core": ["./packages/core/src"],
      "@eyas/hand-tui": ["./packages/tui/src"]
    }
  },
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 4: Create vitest.config.ts**

```typescript
import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.{ts,tsx}'],
  },
  resolve: {
    alias: {
      '@eyas/hand-protocol': resolve(__dirname, 'packages/protocol/src'),
      '@eyas/hand-core': resolve(__dirname, 'packages/core/src'),
      '@eyas/hand-tui': resolve(__dirname, 'packages/tui/src'),
    },
  },
})
```

- [ ] **Step 5: Create .gitignore**

```
node_modules/
dist/
.DS_Store
*.log
.env
.env.local
```

- [ ] **Step 6: Create LICENSE (MIT)**

```
MIT License

Copyright (c) 2026 eYssen

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 7: Create protocol package.json**

```json
{
  "name": "@eyas/hand-protocol",
  "version": "0.1.0",
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "scripts": {
    "build": "tsc"
  },
  "dependencies": {
    "zod": "^3.24.0"
  }
}
```

Create `packages/protocol/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

- [ ] **Step 8: Create core package.json**

```json
{
  "name": "@eyas/hand-core",
  "version": "0.1.0",
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "scripts": {
    "build": "tsc"
  },
  "dependencies": {
    "@eyas/hand-protocol": "workspace:*",
    "zod": "^3.24.0",
    "yaml": "^2.7.0",
    "nanoid": "^5.1.0",
    "pino": "^9.6.0"
  }
}
```

Create `packages/core/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

- [ ] **Step 9: Create tui package.json**

```json
{
  "name": "@eyas/hand-tui",
  "version": "0.1.0",
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "scripts": {
    "build": "tsc"
  },
  "dependencies": {
    "@eyas/hand-core": "workspace:*",
    "@eyas/hand-protocol": "workspace:*",
    "ink": "^5.2.0",
    "react": "^19.0.0"
  },
  "devDependencies": {
    "@types/react": "^19.0.0"
  }
}
```

Create `packages/tui/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "jsx": "react-jsx"
  },
  "include": ["src"]
}
```

- [ ] **Step 10: Install dependencies and verify**

```bash
cd ~/GitHub/eyas-hand
bun install
```

Expected: `node_modules/` created, workspaces linked.

- [ ] **Step 11: Commit scaffold**

```bash
cd ~/GitHub/eyas-hand
git add -A
git commit -m "chore: scaffold eyas-hand monorepo with protocol, core, tui packages"
```

---

## Task 2: Protocol package — shared types

**Files:**
- Create: `packages/protocol/src/constants.ts`
- Create: `packages/protocol/src/messages.ts`
- Create: `packages/protocol/src/capabilities.ts`
- Create: `packages/protocol/src/permissions.ts`
- Create: `packages/protocol/src/index.ts`
- Test: `tests/protocol/messages.test.ts`

- [ ] **Step 1: Write failing test for message types**

```typescript
// tests/protocol/messages.test.ts
import { describe, it, expect } from 'vitest'
import {
  createHandMessage,
  parseHandMessage,
  PROTOCOL_VERSION,
  type HandMessage,
  type ExecCommandPayload,
  type ExecResultPayload,
} from '@eyas/hand-protocol'

describe('HandMessage', () => {
  it('creates a message with id, type, timestamp', () => {
    const msg = createHandMessage('exec:command', { command: 'git status', cwd: '~/Projects' })
    expect(msg.id).toBeDefined()
    expect(msg.id.length).toBeGreaterThan(0)
    expect(msg.type).toBe('exec:command')
    expect(msg.payload).toEqual({ command: 'git status', cwd: '~/Projects' })
    expect(msg.timestamp).toBeGreaterThan(0)
    expect(msg.replyTo).toBeUndefined()
  })

  it('creates a reply message with replyTo', () => {
    const original = createHandMessage('exec:command', { command: 'ls' })
    const reply = createHandMessage('exec:result', { exitCode: 0, stdout: 'file.txt', stderr: '' }, original.id)
    expect(reply.replyTo).toBe(original.id)
    expect(reply.type).toBe('exec:result')
  })

  it('parses a valid JSON message', () => {
    const msg = createHandMessage('ping', {})
    const json = JSON.stringify(msg)
    const parsed = parseHandMessage(json)
    expect(parsed).toEqual(msg)
  })

  it('throws on invalid JSON', () => {
    expect(() => parseHandMessage('not json')).toThrow()
  })

  it('throws on missing required fields', () => {
    expect(() => parseHandMessage(JSON.stringify({ type: 'ping' }))).toThrow()
  })

  it('exports PROTOCOL_VERSION', () => {
    expect(PROTOCOL_VERSION).toBe('1.0')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd ~/GitHub/eyas-hand
bun vitest run tests/protocol/messages.test.ts
```

Expected: FAIL — modules not found.

- [ ] **Step 3: Implement constants.ts**

```typescript
// packages/protocol/src/constants.ts
export const PROTOCOL_VERSION = '1.0'
export const HEARTBEAT_INTERVAL_MS = 30_000
export const RECONNECT_BASE_MS = 1_000
export const RECONNECT_MAX_MS = 60_000
export const COMMAND_TIMEOUT_MS = 300_000
export const MAX_CONCURRENT_COMMANDS = 5
export const PAIRING_CODE_LENGTH = 6
export const PAIRING_CODE_TTL_MS = 5 * 60 * 1_000 // 5 minutes
```

- [ ] **Step 4: Implement messages.ts**

```typescript
// packages/protocol/src/messages.ts
import { z } from 'zod'
import { nanoid } from 'nanoid'
import { PROTOCOL_VERSION } from './constants.js'

// --- Base message ---

export const HandMessageSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  replyTo: z.string().optional(),
  payload: z.unknown(),
  timestamp: z.number().positive(),
  protocol: z.string().default(PROTOCOL_VERSION),
})

export type HandMessage = z.infer<typeof HandMessageSchema>

export function createHandMessage(type: string, payload: unknown, replyTo?: string): HandMessage {
  return {
    id: nanoid(),
    type,
    payload,
    replyTo,
    timestamp: Date.now(),
    protocol: PROTOCOL_VERSION,
  }
}

export function parseHandMessage(raw: string): HandMessage {
  const json = JSON.parse(raw)
  return HandMessageSchema.parse(json)
}

// --- Payload types ---

// exec:command
export interface ExecCommandPayload {
  command: string
  cwd?: string
  env?: Record<string, string>
  timeout?: number
  stream?: boolean
}

// exec:result
export interface ExecResultPayload {
  exitCode: number
  stdout: string
  stderr: string
}

// exec:chunk (streaming)
export interface ExecChunkPayload {
  stream: 'stdout' | 'stderr'
  data: string
}

// fs operations
export interface FsReadPayload {
  path: string
}

export interface FsWritePayload {
  path: string
  content: string
  encoding?: 'utf-8' | 'base64'
}

export interface FsListPayload {
  path: string
  recursive?: boolean
}

export interface FsResultPayload {
  success: boolean
  data?: unknown
  error?: string
}

// approval
export interface ApprovalRequestPayload {
  action: string
  description: string
  context?: string
  riskTier: 'yellow' | 'red'
}

export interface ApprovalResponsePayload {
  decision: 'allow' | 'always' | 'deny'
  action: string
}

// auth
export interface AuthChallengePayload {
  nonce: string
}

export interface AuthResponsePayload {
  hmac: string
  handId: string
}

// --- Message type string constants ---

export const MSG = {
  // Auth
  AUTH_CHALLENGE: 'auth:challenge',
  AUTH_RESPONSE: 'auth:response',
  // Connection
  HAND_CONNECTED: 'hand:connected',
  HAND_CAPABILITIES: 'hand:capabilities',
  HAND_DISCONNECTED: 'hand:disconnected',
  // Execution
  EXEC_COMMAND: 'exec:command',
  EXEC_RESULT: 'exec:result',
  EXEC_STREAM: 'exec:stream',
  EXEC_CHUNK: 'exec:chunk',
  // Filesystem
  FS_READ: 'fs:read',
  FS_WRITE: 'fs:write',
  FS_LIST: 'fs:list',
  FS_RESULT: 'fs:result',
  // Approval
  APPROVAL_REQUEST: 'approval:request',
  APPROVAL_RESPONSE: 'approval:response',
  // Heartbeat
  PING: 'ping',
  PONG: 'pong',
} as const
```

- [ ] **Step 5: Implement capabilities.ts**

```typescript
// packages/protocol/src/capabilities.ts

export interface ToolInfo {
  id: string
  name: string
  type: 'cli' | 'app'
  path: string
  version?: string
  capabilities: string[]
}

export interface HandCapabilities {
  handId: string
  name: string
  platform: 'darwin' | 'win32' | 'linux'
  arch: 'x64' | 'arm64'
  osVersion: string
  protocolVersion: string
  capabilities: {
    cli: boolean
    osAutomation: boolean
    computerUse: boolean
  }
  discoveredTools: ToolInfo[]
}
```

- [ ] **Step 6: Implement permissions.ts**

```typescript
// packages/protocol/src/permissions.ts
import { z } from 'zod'

export const RiskTier = z.enum(['green', 'yellow', 'red', 'black'])
export type RiskTier = z.infer<typeof RiskTier>

export const DirectoryAccess = z.enum(['read-only', 'read-write'])
export type DirectoryAccess = z.infer<typeof DirectoryAccess>

export const ApprovalDecision = z.enum(['allow', 'always', 'deny'])
export type ApprovalDecision = z.infer<typeof ApprovalDecision>

export interface DirectoryPermission {
  path: string
  access: DirectoryAccess
}

export interface LearnedRule {
  tool: string
  learnedAt: string
  context: string
}

export interface PermissionSummary {
  directories: DirectoryPermission[]
  cliAllowed: string[]
  cliBlocked: string[]
  appsAllowed: string[]
  appsBlocked: string[]
  computerUseEnabled: boolean
  learnedRules: LearnedRule[]
}
```

- [ ] **Step 7: Create index.ts re-exports**

```typescript
// packages/protocol/src/index.ts
export * from './constants.js'
export * from './messages.js'
export * from './capabilities.js'
export * from './permissions.js'
```

- [ ] **Step 8: Run tests**

```bash
cd ~/GitHub/eyas-hand
bun vitest run tests/protocol/messages.test.ts
```

Expected: All 6 tests PASS.

- [ ] **Step 9: Commit**

```bash
cd ~/GitHub/eyas-hand
git add packages/protocol/ tests/protocol/
git commit -m "feat: add @eyas/hand-protocol package — messages, capabilities, permissions types"
```

---

## Task 3: Config loader with Zod validation

**Files:**
- Create: `packages/core/src/config/config-schema.ts`
- Create: `packages/core/src/config/config-loader.ts`
- Create: `packages/core/src/config/config-writer.ts`
- Test: `tests/core/config-loader.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/core/config-loader.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { loadConfig, getDefaultConfig, type HandConfig } from '@eyas/hand-core'

const TEST_DIR = join(tmpdir(), 'eyas-hand-test-' + Date.now())

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true })
})

afterEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true })
})

describe('loadConfig', () => {
  it('returns default config when no file exists', () => {
    const config = loadConfig(join(TEST_DIR, 'nonexistent.yaml'))
    expect(config.hand.name).toBe('')
    expect(config.hand.eyasUrl).toBe('')
    expect(config.permissions.cli.allowed).toEqual([])
    expect(config.permissions.cli.blocked).toEqual([])
    expect(config.permissions.safety.maxConcurrentCommands).toBe(5)
  })

  it('loads and validates a valid YAML config', () => {
    const yaml = `
hand:
  name: "Test Machine"
  eyas_url: "wss://eyas.example.com/api/v1/hand/ws"

permissions:
  directories:
    - path: "~/Projects"
      access: read-write
  cli:
    allowed: [git, node]
    blocked: [rm, sudo]
  apps:
    allowed: []
    blocked: []
  computer_use:
    enabled: false
    require_approval_per_session: true
  safety:
    max_concurrent_commands: 3
    command_timeout_seconds: 120
    block_destructive_by_default: true
    require_approval_for_network: true
`
    const configPath = join(TEST_DIR, 'config.yaml')
    writeFileSync(configPath, yaml)

    const config = loadConfig(configPath)
    expect(config.hand.name).toBe('Test Machine')
    expect(config.hand.eyasUrl).toBe('wss://eyas.example.com/api/v1/hand/ws')
    expect(config.permissions.directories).toHaveLength(1)
    expect(config.permissions.directories[0].path).toBe('~/Projects')
    expect(config.permissions.directories[0].access).toBe('read-write')
    expect(config.permissions.cli.allowed).toEqual(['git', 'node'])
    expect(config.permissions.cli.blocked).toEqual(['rm', 'sudo'])
    expect(config.permissions.safety.maxConcurrentCommands).toBe(3)
  })

  it('throws on invalid YAML (bad access value)', () => {
    const yaml = `
hand:
  name: "Test"
  eyas_url: "wss://example.com"
permissions:
  directories:
    - path: "~/foo"
      access: execute
`
    writeFileSync(join(TEST_DIR, 'bad.yaml'), yaml)
    expect(() => loadConfig(join(TEST_DIR, 'bad.yaml'))).toThrow()
  })

  it('merges learned rules from config', () => {
    const yaml = `
hand:
  name: "Test"
  eyas_url: "wss://example.com"
permissions:
  cli:
    allowed: [git]
    blocked: []
    learned:
      - tool: curl
        learned_at: "2026-04-08T14:00:00Z"
        context: "API research"
`
    writeFileSync(join(TEST_DIR, 'learned.yaml'), yaml)
    const config = loadConfig(join(TEST_DIR, 'learned.yaml'))
    expect(config.permissions.cli.learned).toHaveLength(1)
    expect(config.permissions.cli.learned![0].tool).toBe('curl')
  })
})

describe('getDefaultConfig', () => {
  it('returns a valid HandConfig with safe defaults', () => {
    const config = getDefaultConfig()
    expect(config.permissions.safety.blockDestructiveByDefault).toBe(true)
    expect(config.permissions.safety.requireApprovalForNetwork).toBe(true)
    expect(config.permissions.computerUse.enabled).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd ~/GitHub/eyas-hand
bun vitest run tests/core/config-loader.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement config-schema.ts**

```typescript
// packages/core/src/config/config-schema.ts
import { z } from 'zod'

const DirectoryPermissionSchema = z.object({
  path: z.string().min(1),
  access: z.enum(['read-only', 'read-write']),
})

const LearnedRuleSchema = z.object({
  tool: z.string().min(1),
  learned_at: z.string(),
  context: z.string().default(''),
})

const CliPermissionsSchema = z.object({
  allowed: z.array(z.string()).default([]),
  blocked: z.array(z.string()).default([]),
  learned: z.array(LearnedRuleSchema).default([]),
})

const AppPermissionsSchema = z.object({
  allowed: z.array(z.string()).default([]),
  blocked: z.array(z.string()).default([]),
})

const ComputerUseSchema = z.object({
  enabled: z.boolean().default(false),
  require_approval_per_session: z.boolean().default(true),
})

const SafetySchema = z.object({
  max_concurrent_commands: z.number().int().positive().default(5),
  command_timeout_seconds: z.number().int().positive().default(300),
  block_destructive_by_default: z.boolean().default(true),
  require_approval_for_network: z.boolean().default(true),
})

const PermissionsSchema = z.object({
  directories: z.array(DirectoryPermissionSchema).default([]),
  cli: CliPermissionsSchema.default({}),
  apps: AppPermissionsSchema.default({}),
  computer_use: ComputerUseSchema.default({}),
  safety: SafetySchema.default({}),
})

const HandSchema = z.object({
  name: z.string().default(''),
  eyas_url: z.string().default(''),
})

export const HandConfigRawSchema = z.object({
  hand: HandSchema.default({}),
  permissions: PermissionsSchema.default({}),
})

export type HandConfigRaw = z.infer<typeof HandConfigRawSchema>

// Normalized config (camelCase for TypeScript usage)
export interface HandConfig {
  hand: {
    name: string
    eyasUrl: string
  }
  permissions: {
    directories: Array<{ path: string; access: 'read-only' | 'read-write' }>
    cli: {
      allowed: string[]
      blocked: string[]
      learned?: Array<{ tool: string; learnedAt: string; context: string }>
    }
    apps: {
      allowed: string[]
      blocked: string[]
    }
    computerUse: {
      enabled: boolean
      requireApprovalPerSession: boolean
    }
    safety: {
      maxConcurrentCommands: number
      commandTimeoutSeconds: number
      blockDestructiveByDefault: boolean
      requireApprovalForNetwork: boolean
    }
  }
}

export function normalizeConfig(raw: HandConfigRaw): HandConfig {
  return {
    hand: {
      name: raw.hand.name,
      eyasUrl: raw.hand.eyas_url,
    },
    permissions: {
      directories: raw.permissions.directories,
      cli: {
        allowed: raw.permissions.cli.allowed,
        blocked: raw.permissions.cli.blocked,
        learned: raw.permissions.cli.learned.map((r) => ({
          tool: r.tool,
          learnedAt: r.learned_at,
          context: r.context,
        })),
      },
      apps: {
        allowed: raw.permissions.apps.allowed,
        blocked: raw.permissions.apps.blocked,
      },
      computerUse: {
        enabled: raw.permissions.computer_use.enabled,
        requireApprovalPerSession: raw.permissions.computer_use.require_approval_per_session,
      },
      safety: {
        maxConcurrentCommands: raw.permissions.safety.max_concurrent_commands,
        commandTimeoutSeconds: raw.permissions.safety.command_timeout_seconds,
        blockDestructiveByDefault: raw.permissions.safety.block_destructive_by_default,
        requireApprovalForNetwork: raw.permissions.safety.require_approval_for_network,
      },
    },
  }
}
```

- [ ] **Step 4: Implement config-loader.ts**

```typescript
// packages/core/src/config/config-loader.ts
import { readFileSync, existsSync } from 'fs'
import { parse as parseYaml } from 'yaml'
import { HandConfigRawSchema, normalizeConfig, type HandConfig } from './config-schema.js'

export function loadConfig(configPath: string): HandConfig {
  if (!existsSync(configPath)) {
    return getDefaultConfig()
  }

  const raw = readFileSync(configPath, 'utf-8')
  const parsed = parseYaml(raw)
  const validated = HandConfigRawSchema.parse(parsed)
  return normalizeConfig(validated)
}

export function getDefaultConfig(): HandConfig {
  const validated = HandConfigRawSchema.parse({})
  return normalizeConfig(validated)
}
```

- [ ] **Step 5: Implement config-writer.ts**

```typescript
// packages/core/src/config/config-writer.ts
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { dirname } from 'path'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { HandConfigRawSchema } from './config-schema.js'

export function writeConfigValue(configPath: string, dotPath: string, value: unknown): void {
  const dir = dirname(configPath)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

  let current: Record<string, unknown> = {}
  if (existsSync(configPath)) {
    current = parseYaml(readFileSync(configPath, 'utf-8')) ?? {}
  }

  // Set nested value by dot path (e.g. "permissions.cli.allowed")
  const keys = dotPath.split('.')
  let obj: any = current
  for (let i = 0; i < keys.length - 1; i++) {
    if (!(keys[i] in obj) || typeof obj[keys[i]] !== 'object') {
      obj[keys[i]] = {}
    }
    obj = obj[keys[i]]
  }
  obj[keys[keys.length - 1]] = value

  // Validate after modification
  HandConfigRawSchema.parse(current)

  writeFileSync(configPath, stringifyYaml(current, { indent: 2 }))
}

export function addToConfigArray(configPath: string, dotPath: string, item: unknown): void {
  const dir = dirname(configPath)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

  let current: Record<string, unknown> = {}
  if (existsSync(configPath)) {
    current = parseYaml(readFileSync(configPath, 'utf-8')) ?? {}
  }

  const keys = dotPath.split('.')
  let obj: any = current
  for (let i = 0; i < keys.length - 1; i++) {
    if (!(keys[i] in obj) || typeof obj[keys[i]] !== 'object') {
      obj[keys[i]] = {}
    }
    obj = obj[keys[i]]
  }

  const lastKey = keys[keys.length - 1]
  if (!Array.isArray(obj[lastKey])) {
    obj[lastKey] = []
  }
  if (!obj[lastKey].includes(item)) {
    obj[lastKey].push(item)
  }

  HandConfigRawSchema.parse(current)
  writeFileSync(configPath, stringifyYaml(current, { indent: 2 }))
}
```

- [ ] **Step 6: Create core index.ts (partial — config exports)**

```typescript
// packages/core/src/index.ts
export { loadConfig, getDefaultConfig } from './config/config-loader.js'
export { writeConfigValue, addToConfigArray } from './config/config-writer.js'
export type { HandConfig } from './config/config-schema.js'
export { HandConfigRawSchema, normalizeConfig } from './config/config-schema.js'
```

- [ ] **Step 7: Run tests**

```bash
cd ~/GitHub/eyas-hand
bun vitest run tests/core/config-loader.test.ts
```

Expected: All 5 tests PASS.

- [ ] **Step 8: Commit**

```bash
cd ~/GitHub/eyas-hand
git add packages/core/src/config/ packages/core/src/index.ts tests/core/
git commit -m "feat: config loader with YAML parsing and Zod validation"
```

---

## Task 4: Permission engine + risk classifier

**Files:**
- Create: `packages/core/src/permissions/risk-classifier.ts`
- Create: `packages/core/src/permissions/permission-engine.ts`
- Create: `packages/core/src/permissions/auto-learn.ts`
- Test: `tests/core/permission-engine.test.ts`
- Test: `tests/core/risk-classifier.test.ts`

- [ ] **Step 1: Write failing risk classifier tests**

```typescript
// tests/core/risk-classifier.test.ts
import { describe, it, expect } from 'vitest'
import { classifyCommand, classifyPath } from '@eyas/hand-core'
import type { HandConfig } from '@eyas/hand-core'
import { getDefaultConfig } from '@eyas/hand-core'

const config: HandConfig = {
  ...getDefaultConfig(),
  permissions: {
    ...getDefaultConfig().permissions,
    directories: [
      { path: '~/Projects', access: 'read-write' },
      { path: '~/Documents', access: 'read-only' },
    ],
    cli: {
      allowed: ['git', 'node'],
      blocked: ['rm', 'sudo'],
    },
  },
}

describe('classifyCommand', () => {
  it('returns green for whitelisted command', () => {
    expect(classifyCommand('git', config)).toBe('green')
  })

  it('returns black for blocked command', () => {
    expect(classifyCommand('rm', config)).toBe('black')
    expect(classifyCommand('sudo', config)).toBe('black')
  })

  it('returns red for always-dangerous commands', () => {
    expect(classifyCommand('dd', getDefaultConfig())).toBe('red')
    expect(classifyCommand('mkfs', getDefaultConfig())).toBe('red')
  })

  it('returns yellow for unknown command', () => {
    expect(classifyCommand('curl', config)).toBe('yellow')
    expect(classifyCommand('ffmpeg', config)).toBe('yellow')
  })
})

describe('classifyPath', () => {
  it('returns green for allowed read-write directory', () => {
    expect(classifyPath('~/Projects/myapp/src/index.ts', 'write', config)).toBe('green')
    expect(classifyPath('~/Projects/myapp/src/index.ts', 'read', config)).toBe('green')
  })

  it('returns green for read on read-only directory', () => {
    expect(classifyPath('~/Documents/file.txt', 'read', config)).toBe('green')
  })

  it('returns red for write on read-only directory', () => {
    expect(classifyPath('~/Documents/file.txt', 'write', config)).toBe('red')
  })

  it('returns yellow for path not in any directory', () => {
    expect(classifyPath('/var/log/syslog', 'read', config)).toBe('yellow')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd ~/GitHub/eyas-hand
bun vitest run tests/core/risk-classifier.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement risk-classifier.ts**

```typescript
// packages/core/src/permissions/risk-classifier.ts
import type { RiskTier } from '@eyas/hand-protocol'
import type { HandConfig } from '../config/config-schema.js'
import { homedir } from 'os'
import { resolve } from 'path'

// Commands that are ALWAYS dangerous regardless of config
const ALWAYS_RED = new Set([
  'dd', 'mkfs', 'fdisk', 'parted', 'diskutil',
  'format', 'shutdown', 'reboot', 'halt', 'init',
])

// Commands that are ALWAYS blocked — no approval possible
const ALWAYS_BLACK = new Set([
  'rm -rf /',
])

function expandHome(p: string): string {
  if (p.startsWith('~/')) return resolve(homedir(), p.slice(2))
  if (p.startsWith('~')) return resolve(homedir(), p.slice(1))
  return resolve(p)
}

export function classifyCommand(command: string, config: HandConfig): RiskTier {
  // Extract the base command (first word)
  const base = command.trim().split(/\s+/)[0]

  // Check config blocked list → black
  if (config.permissions.cli.blocked.includes(base)) return 'black'

  // Check always-dangerous → red
  if (ALWAYS_RED.has(base)) return 'red'

  // Check config allowed list → green
  if (config.permissions.cli.allowed.includes(base)) return 'green'

  // Check learned rules → green
  if (config.permissions.cli.learned?.some((r) => r.tool === base)) return 'green'

  // Unknown → yellow (needs approval)
  return 'yellow'
}

export function classifyPath(
  filePath: string,
  operation: 'read' | 'write',
  config: HandConfig,
): RiskTier {
  const expanded = expandHome(filePath)

  for (const dir of config.permissions.directories) {
    const expandedDir = expandHome(dir.path)
    if (expanded.startsWith(expandedDir)) {
      if (operation === 'read') return 'green'
      if (operation === 'write' && dir.access === 'read-write') return 'green'
      if (operation === 'write' && dir.access === 'read-only') return 'red'
    }
  }

  // Path not in any configured directory
  return 'yellow'
}
```

- [ ] **Step 4: Run risk classifier tests**

```bash
cd ~/GitHub/eyas-hand
bun vitest run tests/core/risk-classifier.test.ts
```

Expected: All tests PASS.

- [ ] **Step 5: Write failing permission engine tests**

```typescript
// tests/core/permission-engine.test.ts
import { describe, it, expect, vi } from 'vitest'
import { PermissionEngine } from '@eyas/hand-core'
import { getDefaultConfig } from '@eyas/hand-core'
import type { HandConfig } from '@eyas/hand-core'

const config: HandConfig = {
  ...getDefaultConfig(),
  permissions: {
    ...getDefaultConfig().permissions,
    cli: {
      allowed: ['git'],
      blocked: ['rm'],
    },
    safety: {
      ...getDefaultConfig().permissions.safety,
      maxConcurrentCommands: 2,
    },
  },
}

describe('PermissionEngine', () => {
  it('allows whitelisted command without approval', async () => {
    const engine = new PermissionEngine(config)
    const result = await engine.checkCommand('git status')
    expect(result.allowed).toBe(true)
    expect(result.tier).toBe('green')
    expect(result.requiresApproval).toBe(false)
  })

  it('blocks blacklisted command', async () => {
    const engine = new PermissionEngine(config)
    const result = await engine.checkCommand('rm -rf /')
    expect(result.allowed).toBe(false)
    expect(result.tier).toBe('black')
  })

  it('requires approval for unknown command', async () => {
    const engine = new PermissionEngine(config)
    const result = await engine.checkCommand('curl https://example.com')
    expect(result.allowed).toBe(false)
    expect(result.tier).toBe('yellow')
    expect(result.requiresApproval).toBe(true)
  })

  it('tracks concurrent commands', async () => {
    const engine = new PermissionEngine(config)
    engine.incrementRunning()
    engine.incrementRunning()
    const result = await engine.checkCommand('git log')
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('concurrent')
  })

  it('decrements concurrent count on release', () => {
    const engine = new PermissionEngine(config)
    engine.incrementRunning()
    expect(engine.runningCount).toBe(1)
    engine.decrementRunning()
    expect(engine.runningCount).toBe(0)
  })
})
```

- [ ] **Step 6: Implement permission-engine.ts**

```typescript
// packages/core/src/permissions/permission-engine.ts
import type { RiskTier } from '@eyas/hand-protocol'
import type { HandConfig } from '../config/config-schema.js'
import { classifyCommand, classifyPath } from './risk-classifier.js'

export interface PermissionCheckResult {
  allowed: boolean
  tier: RiskTier
  requiresApproval: boolean
  reason?: string
}

export class PermissionEngine {
  private config: HandConfig
  private _running = 0

  constructor(config: HandConfig) {
    this.config = config
  }

  get runningCount(): number {
    return this._running
  }

  updateConfig(config: HandConfig): void {
    this.config = config
  }

  incrementRunning(): void {
    this._running++
  }

  decrementRunning(): void {
    this._running = Math.max(0, this._running - 1)
  }

  async checkCommand(command: string): Promise<PermissionCheckResult> {
    // Check concurrent limit
    if (this._running >= this.config.permissions.safety.maxConcurrentCommands) {
      return {
        allowed: false,
        tier: 'red',
        requiresApproval: false,
        reason: `Max concurrent commands reached (${this.config.permissions.safety.maxConcurrentCommands})`,
      }
    }

    const tier = classifyCommand(command, this.config)

    if (tier === 'black') {
      return { allowed: false, tier, requiresApproval: false, reason: 'Command is blocked' }
    }

    if (tier === 'green') {
      return { allowed: true, tier, requiresApproval: false }
    }

    // yellow or red → needs approval
    return { allowed: false, tier, requiresApproval: true }
  }

  async checkPath(path: string, operation: 'read' | 'write'): Promise<PermissionCheckResult> {
    const tier = classifyPath(path, operation, this.config)

    if (tier === 'green') {
      return { allowed: true, tier, requiresApproval: false }
    }

    if (tier === 'red') {
      return { allowed: false, tier, requiresApproval: true, reason: 'Write to read-only directory' }
    }

    // yellow → needs approval
    return { allowed: false, tier, requiresApproval: true }
  }
}
```

- [ ] **Step 7: Implement auto-learn.ts**

```typescript
// packages/core/src/permissions/auto-learn.ts
import type { HandConfig } from '../config/config-schema.js'
import { addToConfigArray } from '../config/config-writer.js'

export function learnTool(
  configPath: string,
  tool: string,
  context: string,
  config: HandConfig,
): void {
  const rule = {
    tool,
    learned_at: new Date().toISOString(),
    context,
  }
  addToConfigArray(configPath, 'permissions.cli.learned', rule)

  // Also update in-memory config
  if (!config.permissions.cli.learned) {
    config.permissions.cli.learned = []
  }
  config.permissions.cli.learned.push({
    tool,
    learnedAt: rule.learned_at,
    context,
  })
}
```

- [ ] **Step 8: Update core index.ts**

Add to `packages/core/src/index.ts`:
```typescript
export { classifyCommand, classifyPath } from './permissions/risk-classifier.js'
export { PermissionEngine, type PermissionCheckResult } from './permissions/permission-engine.js'
export { learnTool } from './permissions/auto-learn.js'
```

- [ ] **Step 9: Run all tests**

```bash
cd ~/GitHub/eyas-hand
bun vitest run tests/core/
```

Expected: All tests PASS.

- [ ] **Step 10: Commit**

```bash
cd ~/GitHub/eyas-hand
git add packages/core/src/permissions/ packages/core/src/index.ts tests/core/
git commit -m "feat: permission engine with risk classification and auto-learn"
```

---

## Task 5: CLI scanner (tool discovery)

**Files:**
- Create: `packages/core/src/discovery/cli-scanner.ts`
- Create: `packages/core/src/discovery/tool-catalog.ts`
- Test: `tests/core/cli-scanner.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/core/cli-scanner.test.ts
import { describe, it, expect } from 'vitest'
import { scanCliTools, lookupTool, getToolCatalog } from '@eyas/hand-core'

describe('scanCliTools', () => {
  it('discovers at least some common tools on this machine', async () => {
    const tools = await scanCliTools()
    // At least one of these should exist on any dev machine
    const names = tools.map((t) => t.id)
    const hasAny = ['git', 'node', 'bun', 'ls', 'cat'].some((t) => names.includes(t))
    expect(hasAny).toBe(true)
  })

  it('returns ToolInfo objects with required fields', async () => {
    const tools = await scanCliTools()
    for (const tool of tools) {
      expect(tool.id).toBeDefined()
      expect(tool.name).toBeDefined()
      expect(tool.type).toBe('cli')
      expect(tool.path).toBeDefined()
      expect(tool.path.length).toBeGreaterThan(0)
    }
  })
})

describe('lookupTool', () => {
  it('finds git if installed', async () => {
    const tool = await lookupTool('git')
    if (tool) {
      expect(tool.id).toBe('git')
      expect(tool.type).toBe('cli')
      expect(tool.version).toBeDefined()
    }
  })

  it('returns null for nonexistent tool', async () => {
    const tool = await lookupTool('definitely_not_a_real_tool_xyz123')
    expect(tool).toBeNull()
  })
})

describe('getToolCatalog', () => {
  it('returns catalog entries', () => {
    const catalog = getToolCatalog()
    expect(catalog.length).toBeGreaterThan(10)
    expect(catalog.find((t) => t.id === 'git')).toBeDefined()
    expect(catalog.find((t) => t.id === 'ffmpeg')).toBeDefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd ~/GitHub/eyas-hand
bun vitest run tests/core/cli-scanner.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement tool-catalog.ts**

```typescript
// packages/core/src/discovery/tool-catalog.ts
import type { ToolInfo } from '@eyas/hand-protocol'

interface CatalogEntry {
  id: string
  name: string
  versionFlag: string
  capabilities: string[]
}

// Built-in catalog of common CLI tools
const CATALOG: CatalogEntry[] = [
  { id: 'git', name: 'Git', versionFlag: '--version', capabilities: ['vcs', 'diff', 'merge'] },
  { id: 'node', name: 'Node.js', versionFlag: '--version', capabilities: ['runtime', 'javascript'] },
  { id: 'bun', name: 'Bun', versionFlag: '--version', capabilities: ['runtime', 'bundler', 'javascript'] },
  { id: 'python3', name: 'Python 3', versionFlag: '--version', capabilities: ['runtime', 'scripting'] },
  { id: 'python', name: 'Python', versionFlag: '--version', capabilities: ['runtime', 'scripting'] },
  { id: 'docker', name: 'Docker', versionFlag: '--version', capabilities: ['container', 'build'] },
  { id: 'kubectl', name: 'kubectl', versionFlag: 'version --client --short', capabilities: ['kubernetes'] },
  { id: 'ffmpeg', name: 'FFmpeg', versionFlag: '-version', capabilities: ['video-convert', 'audio-extract', 'stream'] },
  { id: 'brew', name: 'Homebrew', versionFlag: '--version', capabilities: ['package-manager'] },
  { id: 'apt', name: 'APT', versionFlag: '--version', capabilities: ['package-manager'] },
  { id: 'npm', name: 'npm', versionFlag: '--version', capabilities: ['package-manager', 'javascript'] },
  { id: 'pnpm', name: 'pnpm', versionFlag: '--version', capabilities: ['package-manager', 'javascript'] },
  { id: 'yarn', name: 'Yarn', versionFlag: '--version', capabilities: ['package-manager', 'javascript'] },
  { id: 'cargo', name: 'Cargo', versionFlag: '--version', capabilities: ['package-manager', 'rust'] },
  { id: 'go', name: 'Go', versionFlag: 'version', capabilities: ['runtime', 'compiler'] },
  { id: 'rustc', name: 'Rust Compiler', versionFlag: '--version', capabilities: ['compiler'] },
  { id: 'gcc', name: 'GCC', versionFlag: '--version', capabilities: ['compiler', 'c', 'cpp'] },
  { id: 'make', name: 'Make', versionFlag: '--version', capabilities: ['build'] },
  { id: 'cmake', name: 'CMake', versionFlag: '--version', capabilities: ['build'] },
  { id: 'curl', name: 'cURL', versionFlag: '--version', capabilities: ['http', 'download'] },
  { id: 'wget', name: 'Wget', versionFlag: '--version', capabilities: ['http', 'download'] },
  { id: 'ssh', name: 'SSH', versionFlag: '-V', capabilities: ['remote', 'tunnel'] },
  { id: 'rsync', name: 'rsync', versionFlag: '--version', capabilities: ['sync', 'backup'] },
  { id: 'tar', name: 'tar', versionFlag: '--version', capabilities: ['archive'] },
  { id: 'zip', name: 'zip', versionFlag: '--version', capabilities: ['archive'] },
  { id: 'unzip', name: 'unzip', versionFlag: '-v', capabilities: ['archive'] },
  { id: 'jq', name: 'jq', versionFlag: '--version', capabilities: ['json', 'transform'] },
  { id: 'sed', name: 'sed', versionFlag: '--version', capabilities: ['text-processing'] },
  { id: 'awk', name: 'awk', versionFlag: '--version', capabilities: ['text-processing'] },
  { id: 'grep', name: 'grep', versionFlag: '--version', capabilities: ['search'] },
  { id: 'rg', name: 'ripgrep', versionFlag: '--version', capabilities: ['search'] },
  { id: 'fd', name: 'fd', versionFlag: '--version', capabilities: ['search', 'find'] },
  { id: 'fzf', name: 'fzf', versionFlag: '--version', capabilities: ['search', 'fuzzy'] },
  { id: 'htop', name: 'htop', versionFlag: '--version', capabilities: ['monitoring'] },
  { id: 'tmux', name: 'tmux', versionFlag: '-V', capabilities: ['terminal'] },
  { id: 'vim', name: 'Vim', versionFlag: '--version', capabilities: ['editor'] },
  { id: 'nano', name: 'nano', versionFlag: '--version', capabilities: ['editor'] },
  { id: 'code', name: 'VS Code', versionFlag: '--version', capabilities: ['editor', 'ide'] },
  { id: 'gh', name: 'GitHub CLI', versionFlag: '--version', capabilities: ['github', 'vcs'] },
  { id: 'terraform', name: 'Terraform', versionFlag: 'version', capabilities: ['iac', 'cloud'] },
  { id: 'helm', name: 'Helm', versionFlag: 'version --short', capabilities: ['kubernetes', 'package-manager'] },
  { id: 'aws', name: 'AWS CLI', versionFlag: '--version', capabilities: ['cloud', 'aws'] },
  { id: 'gcloud', name: 'Google Cloud CLI', versionFlag: 'version', capabilities: ['cloud', 'gcp'] },
  { id: 'az', name: 'Azure CLI', versionFlag: 'version', capabilities: ['cloud', 'azure'] },
  { id: 'psql', name: 'PostgreSQL Client', versionFlag: '--version', capabilities: ['database', 'postgresql'] },
  { id: 'mysql', name: 'MySQL Client', versionFlag: '--version', capabilities: ['database', 'mysql'] },
  { id: 'redis-cli', name: 'Redis CLI', versionFlag: '--version', capabilities: ['database', 'redis'] },
  { id: 'mongosh', name: 'MongoDB Shell', versionFlag: '--version', capabilities: ['database', 'mongodb'] },
  { id: 'sqlite3', name: 'SQLite', versionFlag: '--version', capabilities: ['database', 'sqlite'] },
]

export function getToolCatalog(): CatalogEntry[] {
  return CATALOG
}

export function getCatalogEntry(id: string): CatalogEntry | undefined {
  return CATALOG.find((t) => t.id === id)
}
```

- [ ] **Step 4: Implement cli-scanner.ts**

```typescript
// packages/core/src/discovery/cli-scanner.ts
import { exec } from 'child_process'
import { promisify } from 'util'
import type { ToolInfo } from '@eyas/hand-protocol'
import { getToolCatalog, getCatalogEntry } from './tool-catalog.js'

const execAsync = promisify(exec)

const WHICH_CMD = process.platform === 'win32' ? 'where' : 'which'

async function findToolPath(name: string): Promise<string | null> {
  try {
    const { stdout } = await execAsync(`${WHICH_CMD} ${name}`, { timeout: 5000 })
    const path = stdout.trim().split('\n')[0]
    return path || null
  } catch {
    return null
  }
}

async function getVersion(path: string, versionFlag: string): Promise<string | undefined> {
  try {
    const { stdout, stderr } = await execAsync(`"${path}" ${versionFlag}`, { timeout: 5000 })
    const output = (stdout || stderr).trim()
    // Extract version number pattern
    const match = output.match(/(\d+\.\d+[\.\d]*)/)
    return match?.[1]
  } catch {
    return undefined
  }
}

export async function lookupTool(name: string): Promise<ToolInfo | null> {
  const path = await findToolPath(name)
  if (!path) return null

  const catalog = getCatalogEntry(name)
  let version: string | undefined
  if (catalog) {
    version = await getVersion(path, catalog.versionFlag)
  }

  return {
    id: name,
    name: catalog?.name ?? name,
    type: 'cli',
    path,
    version,
    capabilities: catalog?.capabilities ?? [],
  }
}

export async function scanCliTools(): Promise<ToolInfo[]> {
  const catalog = getToolCatalog()
  const results = await Promise.allSettled(
    catalog.map((entry) => lookupTool(entry.id)),
  )

  return results
    .filter((r): r is PromiseFulfilledResult<ToolInfo | null> => r.status === 'fulfilled')
    .map((r) => r.value)
    .filter((t): t is ToolInfo => t !== null)
}
```

- [ ] **Step 5: Update core index.ts**

Add to `packages/core/src/index.ts`:
```typescript
export { scanCliTools, lookupTool } from './discovery/cli-scanner.js'
export { getToolCatalog } from './discovery/tool-catalog.js'
```

- [ ] **Step 6: Run tests**

```bash
cd ~/GitHub/eyas-hand
bun vitest run tests/core/cli-scanner.test.ts
```

Expected: All tests PASS.

- [ ] **Step 7: Commit**

```bash
cd ~/GitHub/eyas-hand
git add packages/core/src/discovery/ packages/core/src/index.ts tests/core/
git commit -m "feat: CLI tool discovery with built-in catalog of 48 common tools"
```

---

## Task 6: Command executor with sandbox

**Files:**
- Create: `packages/core/src/executor/sandbox.ts`
- Create: `packages/core/src/executor/command-executor.ts`
- Create: `packages/core/src/executor/fs-executor.ts`
- Test: `tests/core/command-executor.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/core/command-executor.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { CommandExecutor } from '@eyas/hand-core'
import { getDefaultConfig } from '@eyas/hand-core'

const TEST_DIR = join(tmpdir(), 'eyas-hand-exec-test-' + Date.now())

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true })
})

afterEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true })
})

describe('CommandExecutor', () => {
  it('executes a simple command and returns result', async () => {
    const executor = new CommandExecutor(getDefaultConfig())
    const result = await executor.execute('echo hello', TEST_DIR)
    expect(result.exitCode).toBe(0)
    expect(result.stdout.trim()).toBe('hello')
    expect(result.stderr).toBe('')
  })

  it('captures stderr', async () => {
    const executor = new CommandExecutor(getDefaultConfig())
    const result = await executor.execute('echo error >&2', TEST_DIR)
    expect(result.exitCode).toBe(0)
    expect(result.stderr.trim()).toBe('error')
  })

  it('returns non-zero exit code for failing command', async () => {
    const executor = new CommandExecutor(getDefaultConfig())
    const result = await executor.execute('false', TEST_DIR)
    expect(result.exitCode).not.toBe(0)
  })

  it('times out long-running commands', async () => {
    const config = {
      ...getDefaultConfig(),
      permissions: {
        ...getDefaultConfig().permissions,
        safety: {
          ...getDefaultConfig().permissions.safety,
          commandTimeoutSeconds: 1,
        },
      },
    }
    const executor = new CommandExecutor(config)
    const result = await executor.execute('sleep 10', TEST_DIR)
    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toContain('timeout')
  })

  it('filters sensitive env vars', async () => {
    const executor = new CommandExecutor(getDefaultConfig())
    process.env.SECRET_API_KEY = 'super-secret'
    const result = await executor.execute('env', TEST_DIR)
    expect(result.stdout).not.toContain('super-secret')
    delete process.env.SECRET_API_KEY
  })

  it('streams output via callback', async () => {
    const executor = new CommandExecutor(getDefaultConfig())
    const chunks: string[] = []
    await executor.executeStream(
      'echo line1 && echo line2',
      TEST_DIR,
      (stream, data) => chunks.push(`${stream}:${data}`),
    )
    expect(chunks.length).toBeGreaterThan(0)
    const combined = chunks.join('')
    expect(combined).toContain('line1')
    expect(combined).toContain('line2')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd ~/GitHub/eyas-hand
bun vitest run tests/core/command-executor.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement sandbox.ts**

```typescript
// packages/core/src/executor/sandbox.ts

// Environment variable patterns to strip from child processes
const SENSITIVE_PATTERNS = [
  /^.*_KEY$/i,
  /^.*_SECRET$/i,
  /^.*_TOKEN$/i,
  /^.*_PASSWORD$/i,
  /^.*_CREDENTIAL$/i,
  /^.*_API_KEY$/i,
  /^ANTHROPIC_/i,
  /^OPENAI_/i,
  /^AWS_SECRET/i,
  /^GITHUB_TOKEN$/i,
]

export function filterEnv(env: Record<string, string | undefined>): Record<string, string> {
  const filtered: Record<string, string> = {}
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue
    const isSensitive = SENSITIVE_PATTERNS.some((pattern) => pattern.test(key))
    if (!isSensitive) {
      filtered[key] = value
    }
  }
  return filtered
}

export function validateCwd(cwd: string): void {
  if (!cwd || cwd === '/') {
    throw new Error('Working directory cannot be root')
  }
}
```

- [ ] **Step 4: Implement command-executor.ts**

```typescript
// packages/core/src/executor/command-executor.ts
import { spawn } from 'child_process'
import type { HandConfig } from '../config/config-schema.js'
import { filterEnv, validateCwd } from './sandbox.js'

export interface ExecResult {
  exitCode: number
  stdout: string
  stderr: string
}

export class CommandExecutor {
  private config: HandConfig

  constructor(config: HandConfig) {
    this.config = config
  }

  updateConfig(config: HandConfig): void {
    this.config = config
  }

  async execute(command: string, cwd: string): Promise<ExecResult> {
    validateCwd(cwd)
    const timeout = this.config.permissions.safety.commandTimeoutSeconds * 1000

    return new Promise((resolve) => {
      const env = filterEnv(process.env as Record<string, string>)
      const child = spawn('sh', ['-c', command], { cwd, env, timeout })

      let stdout = ''
      let stderr = ''
      let killed = false

      const timer = setTimeout(() => {
        killed = true
        child.kill('SIGTERM')
        setTimeout(() => child.kill('SIGKILL'), 5000)
      }, timeout)

      child.stdout.on('data', (data) => { stdout += data.toString() })
      child.stderr.on('data', (data) => { stderr += data.toString() })

      child.on('close', (code) => {
        clearTimeout(timer)
        if (killed) {
          resolve({ exitCode: 124, stdout, stderr: stderr + '\ntimeout: command timed out' })
        } else {
          resolve({ exitCode: code ?? 1, stdout, stderr })
        }
      })

      child.on('error', (err) => {
        clearTimeout(timer)
        resolve({ exitCode: 1, stdout, stderr: err.message })
      })
    })
  }

  async executeStream(
    command: string,
    cwd: string,
    onChunk: (stream: 'stdout' | 'stderr', data: string) => void,
  ): Promise<ExecResult> {
    validateCwd(cwd)
    const timeout = this.config.permissions.safety.commandTimeoutSeconds * 1000

    return new Promise((resolve) => {
      const env = filterEnv(process.env as Record<string, string>)
      const child = spawn('sh', ['-c', command], { cwd, env, timeout })

      let stdout = ''
      let stderr = ''

      const timer = setTimeout(() => {
        child.kill('SIGTERM')
      }, timeout)

      child.stdout.on('data', (data) => {
        const str = data.toString()
        stdout += str
        onChunk('stdout', str)
      })

      child.stderr.on('data', (data) => {
        const str = data.toString()
        stderr += str
        onChunk('stderr', str)
      })

      child.on('close', (code) => {
        clearTimeout(timer)
        resolve({ exitCode: code ?? 1, stdout, stderr })
      })

      child.on('error', (err) => {
        clearTimeout(timer)
        resolve({ exitCode: 1, stdout, stderr: err.message })
      })
    })
  }
}
```

- [ ] **Step 5: Implement fs-executor.ts**

```typescript
// packages/core/src/executor/fs-executor.ts
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'

export interface FsEntry {
  name: string
  type: 'file' | 'directory'
  size: number
  modified: string
}

export function readFile(path: string): string {
  return readFileSync(path, 'utf-8')
}

export function writeFile(path: string, content: string, encoding: 'utf-8' | 'base64' = 'utf-8'): void {
  const dir = dirname(path)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

  if (encoding === 'base64') {
    writeFileSync(path, Buffer.from(content, 'base64'))
  } else {
    writeFileSync(path, content, 'utf-8')
  }
}

export function listDirectory(path: string, recursive = false): FsEntry[] {
  const entries: FsEntry[] = []

  const items = readdirSync(path, { withFileTypes: true })
  for (const item of items) {
    const fullPath = join(path, item.name)
    const stat = statSync(fullPath)
    entries.push({
      name: item.name,
      type: item.isDirectory() ? 'directory' : 'file',
      size: stat.size,
      modified: stat.mtime.toISOString(),
    })

    if (recursive && item.isDirectory()) {
      const subEntries = listDirectory(fullPath, true)
      for (const sub of subEntries) {
        entries.push({ ...sub, name: join(item.name, sub.name) })
      }
    }
  }

  return entries
}
```

- [ ] **Step 6: Update core index.ts**

Add to `packages/core/src/index.ts`:
```typescript
export { CommandExecutor, type ExecResult } from './executor/command-executor.js'
export { readFile, writeFile, listDirectory, type FsEntry } from './executor/fs-executor.js'
export { filterEnv, validateCwd } from './executor/sandbox.js'
```

- [ ] **Step 7: Run tests**

```bash
cd ~/GitHub/eyas-hand
bun vitest run tests/core/command-executor.test.ts
```

Expected: All 6 tests PASS.

- [ ] **Step 8: Commit**

```bash
cd ~/GitHub/eyas-hand
git add packages/core/src/executor/ packages/core/src/index.ts tests/core/
git commit -m "feat: command executor with sandbox, env filtering, streaming, and timeout"
```

---

## Task 7: WebSocket client (phone home connection)

**Files:**
- Create: `packages/core/src/connection/ws-client.ts`
- Create: `packages/core/src/connection/auth.ts`
- Create: `packages/core/src/connection/pairing.ts`
- Test: `tests/core/ws-client.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/core/ws-client.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { HandWsClient, ConnectionState } from '@eyas/hand-core'

describe('HandWsClient', () => {
  it('starts in disconnected state', () => {
    const client = new HandWsClient({
      url: 'wss://example.com/api/v1/hand/ws',
      handId: 'test-hand',
      token: 'test-token',
    })
    expect(client.state).toBe(ConnectionState.Disconnected)
  })

  it('emits state change events', () => {
    const client = new HandWsClient({
      url: 'wss://example.com/api/v1/hand/ws',
      handId: 'test-hand',
      token: 'test-token',
    })
    const states: ConnectionState[] = []
    client.on('stateChange', (state) => states.push(state))
    client.setState(ConnectionState.Connecting)
    expect(states).toEqual([ConnectionState.Connecting])
  })

  it('calculates exponential backoff', () => {
    const client = new HandWsClient({
      url: 'wss://example.com/api/v1/hand/ws',
      handId: 'test-hand',
      token: 'test-token',
    })
    expect(client.getBackoffMs(0)).toBe(1000)
    expect(client.getBackoffMs(1)).toBe(2000)
    expect(client.getBackoffMs(2)).toBe(4000)
    // Should cap at 60s
    expect(client.getBackoffMs(10)).toBeLessThanOrEqual(60000)
  })

  it('builds correct auth headers', () => {
    const client = new HandWsClient({
      url: 'wss://example.com/api/v1/hand/ws',
      handId: 'test-hand',
      token: 'test-token',
      platform: 'darwin',
    })
    const headers = client.getAuthHeaders()
    expect(headers['Authorization']).toBe('Bearer test-token')
    expect(headers['X-Hand-Id']).toBe('test-hand')
    expect(headers['X-Hand-Platform']).toBe('darwin')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd ~/GitHub/eyas-hand
bun vitest run tests/core/ws-client.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement auth.ts**

```typescript
// packages/core/src/connection/auth.ts
import { createHmac, randomBytes } from 'crypto'

export function computeHmac(secret: string, nonce: string): string {
  return createHmac('sha256', secret).update(nonce).digest('hex')
}

export function generateHandId(): string {
  return `hand_${randomBytes(8).toString('hex')}`
}
```

- [ ] **Step 4: Implement pairing.ts**

```typescript
// packages/core/src/connection/pairing.ts

export interface PairingResult {
  handId: string
  token: string
  eyasUrl: string
}

/**
 * Pair with EYAS server using a 6-digit code.
 * The pairing endpoint is HTTP (not WebSocket) — POST to /api/v1/hands/pair
 */
export async function pairWithEyas(
  eyasUrl: string,
  code: string,
  handId: string,
  handName: string,
  platform: string,
): Promise<PairingResult> {
  // Convert wss:// to https:// for HTTP request
  const httpUrl = eyasUrl
    .replace('wss://', 'https://')
    .replace('/api/v1/hand/ws', '/api/v1/hands/pair')

  const response = await fetch(httpUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code,
      handId,
      name: handName,
      platform,
    }),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Pairing failed (${response.status}): ${body}`)
  }

  const data = (await response.json()) as { token: string }
  return {
    handId,
    token: data.token,
    eyasUrl,
  }
}
```

- [ ] **Step 5: Implement ws-client.ts**

```typescript
// packages/core/src/connection/ws-client.ts
import { EventEmitter } from 'events'
import WebSocket from 'ws'
import { createHandMessage, parseHandMessage, type HandMessage, MSG } from '@eyas/hand-protocol'
import { HEARTBEAT_INTERVAL_MS, RECONNECT_BASE_MS, RECONNECT_MAX_MS } from '@eyas/hand-protocol'
import { computeHmac } from './auth.js'

export enum ConnectionState {
  Disconnected = 'disconnected',
  Connecting = 'connecting',
  Authenticating = 'authenticating',
  Connected = 'connected',
  Reconnecting = 'reconnecting',
}

export interface WsClientOptions {
  url: string
  handId: string
  token: string
  platform?: string
}

export class HandWsClient extends EventEmitter {
  private options: WsClientOptions
  private ws: WebSocket | null = null
  private _state: ConnectionState = ConnectionState.Disconnected
  private reconnectAttempt = 0
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null

  constructor(options: WsClientOptions) {
    super()
    this.options = options
  }

  get state(): ConnectionState {
    return this._state
  }

  setState(state: ConnectionState): void {
    this._state = state
    this.emit('stateChange', state)
  }

  getBackoffMs(attempt: number): number {
    const ms = RECONNECT_BASE_MS * Math.pow(2, attempt)
    return Math.min(ms, RECONNECT_MAX_MS)
  }

  getAuthHeaders(): Record<string, string> {
    return {
      'Authorization': `Bearer ${this.options.token}`,
      'X-Hand-Id': this.options.handId,
      'X-Hand-Platform': this.options.platform ?? process.platform,
    }
  }

  connect(): void {
    if (this._state === ConnectionState.Connected || this._state === ConnectionState.Connecting) return

    this.setState(ConnectionState.Connecting)

    this.ws = new WebSocket(this.options.url, {
      headers: this.getAuthHeaders(),
    })

    this.ws.on('open', () => {
      this.setState(ConnectionState.Authenticating)
      this.reconnectAttempt = 0
    })

    this.ws.on('message', (raw) => {
      try {
        const msg = parseHandMessage(raw.toString())
        this.handleMessage(msg)
      } catch (err) {
        this.emit('error', err)
      }
    })

    this.ws.on('close', () => {
      this.cleanup()
      this.setState(ConnectionState.Reconnecting)
      this.scheduleReconnect()
    })

    this.ws.on('error', (err) => {
      this.emit('error', err)
    })
  }

  disconnect(): void {
    this.cleanup()
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.setState(ConnectionState.Disconnected)
  }

  send(msg: HandMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg))
    }
  }

  sendMessage(type: string, payload: unknown, replyTo?: string): void {
    this.send(createHandMessage(type, payload, replyTo))
  }

  private handleMessage(msg: HandMessage): void {
    switch (msg.type) {
      case MSG.AUTH_CHALLENGE: {
        const { nonce } = msg.payload as { nonce: string }
        const hmac = computeHmac(this.options.token, nonce)
        this.sendMessage(MSG.AUTH_RESPONSE, {
          hmac,
          handId: this.options.handId,
        }, msg.id)
        break
      }

      case MSG.HAND_CONNECTED:
        this.setState(ConnectionState.Connected)
        this.startHeartbeat()
        this.emit('connected')
        break

      case MSG.PING:
        this.sendMessage(MSG.PONG, {}, msg.id)
        break

      default:
        this.emit('message', msg)
    }
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      this.sendMessage(MSG.PING, {})
    }, HEARTBEAT_INTERVAL_MS)
  }

  private cleanup(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
    if (this.ws) {
      this.ws.removeAllListeners()
      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.close()
      }
      this.ws = null
    }
  }

  private scheduleReconnect(): void {
    const delay = this.getBackoffMs(this.reconnectAttempt)
    this.reconnectAttempt++
    this.reconnectTimer = setTimeout(() => {
      this.connect()
    }, delay)
  }
}
```

- [ ] **Step 6: Add `ws` dependency to core package.json**

Add to `packages/core/package.json` dependencies:
```json
"ws": "^8.18.0"
```

And to devDependencies:
```json
"@types/ws": "^8.5.0"
```

Run:
```bash
cd ~/GitHub/eyas-hand
bun install
```

- [ ] **Step 7: Update core index.ts**

Add to `packages/core/src/index.ts`:
```typescript
export { HandWsClient, ConnectionState, type WsClientOptions } from './connection/ws-client.js'
export { computeHmac, generateHandId } from './connection/auth.js'
export { pairWithEyas, type PairingResult } from './connection/pairing.js'
```

- [ ] **Step 8: Run tests**

```bash
cd ~/GitHub/eyas-hand
bun vitest run tests/core/ws-client.test.ts
```

Expected: All 4 tests PASS.

- [ ] **Step 9: Commit**

```bash
cd ~/GitHub/eyas-hand
git add packages/core/src/connection/ packages/core/src/index.ts packages/core/package.json tests/core/ bun.lockb
git commit -m "feat: WebSocket client with phone-home connection, auth, pairing, auto-reconnect"
```

---

## Task 8: Hand daemon — main message loop

**Files:**
- Create: `packages/core/src/hand-daemon.ts`
- Test: `tests/core/hand-daemon.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/core/hand-daemon.test.ts
import { describe, it, expect, vi } from 'vitest'
import { HandDaemon } from '@eyas/hand-core'
import { getDefaultConfig } from '@eyas/hand-core'
import { createHandMessage, MSG } from '@eyas/hand-protocol'

describe('HandDaemon', () => {
  it('constructs with config', () => {
    const config = getDefaultConfig()
    const daemon = new HandDaemon({
      config,
      configPath: '/tmp/test-config.yaml',
      handId: 'test-hand',
      token: 'test-token',
      eyasUrl: 'wss://example.com/api/v1/hand/ws',
    })
    expect(daemon).toBeDefined()
    expect(daemon.handId).toBe('test-hand')
  })

  it('handles exec:command message for allowed command', async () => {
    const config = {
      ...getDefaultConfig(),
      permissions: {
        ...getDefaultConfig().permissions,
        cli: { allowed: ['echo'], blocked: [], learned: [] },
        directories: [{ path: '/tmp', access: 'read-write' as const }],
      },
    }
    const daemon = new HandDaemon({
      config,
      configPath: '/tmp/test-config.yaml',
      handId: 'test-hand',
      token: 'test-token',
      eyasUrl: 'wss://example.com/api/v1/hand/ws',
    })

    const sent: any[] = []
    daemon.setSendFn((msg) => sent.push(msg))

    const msg = createHandMessage(MSG.EXEC_COMMAND, {
      command: 'echo hello',
      cwd: '/tmp',
    })
    await daemon.handleMessage(msg)

    expect(sent.length).toBe(1)
    expect(sent[0].type).toBe(MSG.EXEC_RESULT)
    expect(sent[0].payload.exitCode).toBe(0)
    expect(sent[0].payload.stdout.trim()).toBe('hello')
  })

  it('rejects blocked command', async () => {
    const config = {
      ...getDefaultConfig(),
      permissions: {
        ...getDefaultConfig().permissions,
        cli: { allowed: [], blocked: ['rm'], learned: [] },
      },
    }
    const daemon = new HandDaemon({
      config,
      configPath: '/tmp/test-config.yaml',
      handId: 'test-hand',
      token: 'test-token',
      eyasUrl: 'wss://example.com/api/v1/hand/ws',
    })

    const sent: any[] = []
    daemon.setSendFn((msg) => sent.push(msg))

    const msg = createHandMessage(MSG.EXEC_COMMAND, {
      command: 'rm -rf /',
      cwd: '/tmp',
    })
    await daemon.handleMessage(msg)

    expect(sent.length).toBe(1)
    expect(sent[0].type).toBe(MSG.EXEC_RESULT)
    expect(sent[0].payload.exitCode).toBe(1)
    expect(sent[0].payload.stderr).toContain('blocked')
  })

  it('requests approval for unknown command', async () => {
    const daemon = new HandDaemon({
      config: getDefaultConfig(),
      configPath: '/tmp/test-config.yaml',
      handId: 'test-hand',
      token: 'test-token',
      eyasUrl: 'wss://example.com/api/v1/hand/ws',
    })

    const sent: any[] = []
    daemon.setSendFn((msg) => sent.push(msg))

    const msg = createHandMessage(MSG.EXEC_COMMAND, {
      command: 'curl https://example.com',
      cwd: '/tmp',
    })
    await daemon.handleMessage(msg)

    // Should send approval request, not execute
    expect(sent.length).toBe(1)
    expect(sent[0].type).toBe(MSG.APPROVAL_REQUEST)
    expect(sent[0].payload.action).toContain('curl')
  })

  it('builds capabilities report', async () => {
    const daemon = new HandDaemon({
      config: getDefaultConfig(),
      configPath: '/tmp/test-config.yaml',
      handId: 'test-hand',
      token: 'test-token',
      eyasUrl: 'wss://example.com/api/v1/hand/ws',
    })
    const caps = await daemon.buildCapabilities()
    expect(caps.handId).toBe('test-hand')
    expect(caps.platform).toBeDefined()
    expect(caps.capabilities.cli).toBe(true)
    expect(caps.capabilities.osAutomation).toBe(false) // Phase 2
    expect(caps.capabilities.computerUse).toBe(false)   // Phase 3
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd ~/GitHub/eyas-hand
bun vitest run tests/core/hand-daemon.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement hand-daemon.ts**

```typescript
// packages/core/src/hand-daemon.ts
import { platform, arch, release } from 'os'
import {
  createHandMessage,
  MSG,
  PROTOCOL_VERSION,
  type HandMessage,
  type HandCapabilities,
  type ExecCommandPayload,
  type FsReadPayload,
  type FsWritePayload,
  type FsListPayload,
  type ApprovalResponsePayload,
} from '@eyas/hand-protocol'
import type { HandConfig } from './config/config-schema.js'
import { PermissionEngine } from './permissions/permission-engine.js'
import { CommandExecutor } from './executor/command-executor.js'
import { readFile, writeFile, listDirectory } from './executor/fs-executor.js'
import { scanCliTools } from './discovery/cli-scanner.js'
import { learnTool } from './permissions/auto-learn.js'

export interface HandDaemonOptions {
  config: HandConfig
  configPath: string
  handId: string
  token: string
  eyasUrl: string
}

// Pending approval requests
interface PendingApproval {
  originalMessage: HandMessage
  resolve: (allowed: boolean) => void
}

export class HandDaemon {
  readonly handId: string
  private config: HandConfig
  private configPath: string
  private permissions: PermissionEngine
  private executor: CommandExecutor
  private sendFn: (msg: HandMessage) => void = () => {}
  private pendingApprovals = new Map<string, PendingApproval>()

  constructor(options: HandDaemonOptions) {
    this.handId = options.handId
    this.config = options.config
    this.configPath = options.configPath
    this.permissions = new PermissionEngine(options.config)
    this.executor = new CommandExecutor(options.config)
  }

  setSendFn(fn: (msg: HandMessage) => void): void {
    this.sendFn = fn
  }

  private send(type: string, payload: unknown, replyTo?: string): void {
    this.sendFn(createHandMessage(type, payload, replyTo))
  }

  async buildCapabilities(): Promise<HandCapabilities> {
    const tools = await scanCliTools()
    return {
      handId: this.handId,
      name: this.config.hand.name || this.handId,
      platform: platform() as 'darwin' | 'win32' | 'linux',
      arch: arch() as 'x64' | 'arm64',
      osVersion: release(),
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {
        cli: true,
        osAutomation: false, // Phase 2
        computerUse: false,  // Phase 3
      },
      discoveredTools: tools,
    }
  }

  async handleMessage(msg: HandMessage): Promise<void> {
    switch (msg.type) {
      case MSG.EXEC_COMMAND:
        await this.handleExecCommand(msg)
        break
      case MSG.EXEC_STREAM:
        await this.handleExecStream(msg)
        break
      case MSG.FS_READ:
        await this.handleFsRead(msg)
        break
      case MSG.FS_WRITE:
        await this.handleFsWrite(msg)
        break
      case MSG.FS_LIST:
        await this.handleFsList(msg)
        break
      case MSG.APPROVAL_RESPONSE:
        this.handleApprovalResponse(msg)
        break
    }
  }

  private async handleExecCommand(msg: HandMessage): Promise<void> {
    const payload = msg.payload as ExecCommandPayload
    const command = payload.command
    const cwd = payload.cwd || '/tmp'

    const check = await this.permissions.checkCommand(command)

    if (check.tier === 'black') {
      this.send(MSG.EXEC_RESULT, {
        exitCode: 1,
        stdout: '',
        stderr: `Command blocked: ${command}`,
      }, msg.id)
      return
    }

    if (check.requiresApproval) {
      // Send approval request and wait
      const approvalMsg = createHandMessage(MSG.APPROVAL_REQUEST, {
        action: command,
        description: `Execute: ${command}`,
        context: `Working directory: ${cwd}`,
        riskTier: check.tier,
      })
      this.sendFn(approvalMsg)

      // Store pending approval keyed by approval message id
      this.pendingApprovals.set(approvalMsg.id, {
        originalMessage: msg,
        resolve: () => {},
      })
      return
    }

    // Green — execute directly
    this.permissions.incrementRunning()
    try {
      const result = await this.executor.execute(command, cwd)
      this.send(MSG.EXEC_RESULT, result, msg.id)
    } finally {
      this.permissions.decrementRunning()
    }
  }

  private async handleExecStream(msg: HandMessage): Promise<void> {
    const payload = msg.payload as ExecCommandPayload
    const command = payload.command
    const cwd = payload.cwd || '/tmp'

    const check = await this.permissions.checkCommand(command)
    if (!check.allowed) {
      this.send(MSG.EXEC_RESULT, {
        exitCode: 1,
        stdout: '',
        stderr: `Command not allowed: ${command}`,
      }, msg.id)
      return
    }

    this.permissions.incrementRunning()
    try {
      const result = await this.executor.executeStream(command, cwd, (stream, data) => {
        this.send(MSG.EXEC_CHUNK, { stream, data }, msg.id)
      })
      this.send(MSG.EXEC_RESULT, result, msg.id)
    } finally {
      this.permissions.decrementRunning()
    }
  }

  private async handleFsRead(msg: HandMessage): Promise<void> {
    const payload = msg.payload as FsReadPayload
    const check = await this.permissions.checkPath(payload.path, 'read')

    if (!check.allowed && !check.requiresApproval) {
      this.send(MSG.FS_RESULT, { success: false, error: 'Access denied' }, msg.id)
      return
    }

    try {
      const data = readFile(payload.path)
      this.send(MSG.FS_RESULT, { success: true, data }, msg.id)
    } catch (err: any) {
      this.send(MSG.FS_RESULT, { success: false, error: err.message }, msg.id)
    }
  }

  private async handleFsWrite(msg: HandMessage): Promise<void> {
    const payload = msg.payload as FsWritePayload
    const check = await this.permissions.checkPath(payload.path, 'write')

    if (!check.allowed && !check.requiresApproval) {
      this.send(MSG.FS_RESULT, { success: false, error: 'Write access denied' }, msg.id)
      return
    }

    try {
      writeFile(payload.path, payload.content, payload.encoding)
      this.send(MSG.FS_RESULT, { success: true }, msg.id)
    } catch (err: any) {
      this.send(MSG.FS_RESULT, { success: false, error: err.message }, msg.id)
    }
  }

  private async handleFsList(msg: HandMessage): Promise<void> {
    const payload = msg.payload as FsListPayload
    const check = await this.permissions.checkPath(payload.path, 'read')

    if (!check.allowed && !check.requiresApproval) {
      this.send(MSG.FS_RESULT, { success: false, error: 'Access denied' }, msg.id)
      return
    }

    try {
      const entries = listDirectory(payload.path, payload.recursive)
      this.send(MSG.FS_RESULT, { success: true, data: entries }, msg.id)
    } catch (err: any) {
      this.send(MSG.FS_RESULT, { success: false, error: err.message }, msg.id)
    }
  }

  private handleApprovalResponse(msg: HandMessage): void {
    const payload = msg.payload as ApprovalResponsePayload

    // Find the pending approval by replyTo
    const pending = msg.replyTo ? this.pendingApprovals.get(msg.replyTo) : undefined
    if (!pending) return

    this.pendingApprovals.delete(msg.replyTo!)

    if (payload.decision === 'always') {
      learnTool(this.configPath, payload.action.split(/\s+/)[0], 'User approved', this.config)
    }

    if (payload.decision === 'allow' || payload.decision === 'always') {
      // Re-execute the original command
      this.handleExecCommand(pending.originalMessage)
    } else {
      this.send(MSG.EXEC_RESULT, {
        exitCode: 1,
        stdout: '',
        stderr: 'User denied the command',
      }, pending.originalMessage.id)
    }
  }
}
```

- [ ] **Step 4: Update core index.ts**

Add to `packages/core/src/index.ts`:
```typescript
export { HandDaemon, type HandDaemonOptions } from './hand-daemon.js'
```

- [ ] **Step 5: Run tests**

```bash
cd ~/GitHub/eyas-hand
bun vitest run tests/core/hand-daemon.test.ts
```

Expected: All 5 tests PASS.

- [ ] **Step 6: Commit**

```bash
cd ~/GitHub/eyas-hand
git add packages/core/src/hand-daemon.ts packages/core/src/index.ts tests/core/
git commit -m "feat: Hand daemon — message loop with exec, fs, approval handling"
```

---

## Task 9: CLI entry point (hand pair/serve/status/config)

**Files:**
- Create: `~/GitHub/eyas-hand/src/cli.ts`

- [ ] **Step 1: Create CLI entry point**

```typescript
// src/cli.ts
import { parseArgs } from 'util'
import { resolve, join } from 'path'
import { homedir } from 'os'
import { existsSync } from 'fs'
import {
  loadConfig,
  HandWsClient,
  HandDaemon,
  generateHandId,
  pairWithEyas,
  writeConfigValue,
  addToConfigArray,
  ConnectionState,
} from '@eyas/hand-core'
import { MSG } from '@eyas/hand-protocol'

const CONFIG_DIR = join(homedir(), '.eyas-hand')
const CONFIG_PATH = join(CONFIG_DIR, 'config.yaml')
const CREDENTIALS_PATH = join(CONFIG_DIR, 'credentials.json')

function loadCredentials(): { handId: string; token: string } | null {
  if (!existsSync(CREDENTIALS_PATH)) return null
  try {
    const raw = JSON.parse(require('fs').readFileSync(CREDENTIALS_PATH, 'utf-8'))
    return { handId: raw.handId, token: raw.token }
  } catch {
    return null
  }
}

function saveCredentials(handId: string, token: string): void {
  const fs = require('fs')
  if (!existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true })
  fs.writeFileSync(CREDENTIALS_PATH, JSON.stringify({ handId, token }, null, 2))
}

async function cmdPair(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      url: { type: 'string' },
      code: { type: 'string' },
      name: { type: 'string', default: homedir().split('/').pop() || 'Hand' },
    },
    strict: true,
  })

  if (!values.url || !values.code) {
    console.error('Usage: hand pair --url wss://eyas.example.com/api/v1/hand/ws --code 123456')
    process.exit(1)
  }

  const handId = generateHandId()
  console.log(`Pairing as ${handId}...`)

  try {
    const result = await pairWithEyas(
      values.url,
      values.code,
      handId,
      values.name!,
      process.platform,
    )
    saveCredentials(result.handId, result.token)
    writeConfigValue(CONFIG_PATH, 'hand.eyas_url', values.url)
    writeConfigValue(CONFIG_PATH, 'hand.name', values.name)
    console.log(`Paired successfully! Hand ID: ${result.handId}`)
    console.log(`Config saved to: ${CONFIG_PATH}`)
  } catch (err: any) {
    console.error(`Pairing failed: ${err.message}`)
    process.exit(1)
  }
}

async function cmdServe(args: string[]): Promise<void> {
  const config = loadConfig(CONFIG_PATH)
  const creds = loadCredentials()

  if (!creds || !config.hand.eyasUrl) {
    console.error('Not paired. Run: hand pair --url <eyas-url> --code <code>')
    process.exit(1)
  }

  const daemon = new HandDaemon({
    config,
    configPath: CONFIG_PATH,
    handId: creds.handId,
    token: creds.token,
    eyasUrl: config.hand.eyasUrl,
  })

  const client = new HandWsClient({
    url: config.hand.eyasUrl,
    handId: creds.handId,
    token: creds.token,
  })

  // Wire daemon send → WebSocket
  daemon.setSendFn((msg) => client.send(msg))

  // Wire WebSocket messages → daemon
  client.on('message', (msg) => daemon.handleMessage(msg))

  client.on('stateChange', (state: ConnectionState) => {
    console.log(`[${new Date().toISOString()}] State: ${state}`)
  })

  client.on('connected', async () => {
    const caps = await daemon.buildCapabilities()
    client.sendMessage(MSG.HAND_CAPABILITIES, caps)
    console.log(`Connected to EYAS. Discovered ${caps.discoveredTools.length} tools.`)
  })

  client.on('error', (err: Error) => {
    console.error(`WebSocket error: ${err.message}`)
  })

  console.log(`Starting EYAS Hand (${creds.handId})...`)
  console.log(`Connecting to: ${config.hand.eyasUrl}`)
  client.connect()

  // Handle graceful shutdown
  const shutdown = () => {
    console.log('\nShutting down...')
    client.disconnect()
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

async function cmdStatus(): Promise<void> {
  const config = loadConfig(CONFIG_PATH)
  const creds = loadCredentials()

  console.log('eYssen EYAS Hand')
  console.log('─'.repeat(30))
  console.log(`Config: ${CONFIG_PATH}`)
  console.log(`Paired: ${creds ? 'Yes' : 'No'}`)
  if (creds) {
    console.log(`Hand ID: ${creds.handId}`)
    console.log(`EYAS URL: ${config.hand.eyasUrl || '(not set)'}`)
    console.log(`Name: ${config.hand.name || '(not set)'}`)
  }
}

async function cmdConfig(args: string[]): Promise<void> {
  const [action, key, ...rest] = args

  if (action === 'set' && key) {
    const addIndex = rest.indexOf('--add')
    if (addIndex >= 0 && rest[addIndex + 1]) {
      addToConfigArray(CONFIG_PATH, key, rest[addIndex + 1])
      console.log(`Added to ${key}: ${rest[addIndex + 1]}`)
    } else if (rest[0]) {
      writeConfigValue(CONFIG_PATH, key, rest[0])
      console.log(`Set ${key} = ${rest[0]}`)
    }
  } else {
    console.error('Usage: hand config set <key> <value>')
    console.error('       hand config set <key> --add <item>')
  }
}

// Main CLI router
const [,, command, ...args] = process.argv

switch (command) {
  case 'pair':
    cmdPair(args)
    break
  case 'serve':
    cmdServe(args)
    break
  case 'status':
    cmdStatus()
    break
  case 'config':
    cmdConfig(args)
    break
  case '--tui':
    // TUI mode — handled in Task 10
    console.log('TUI mode not yet implemented. Use: hand serve')
    break
  default:
    console.log('eYssen EYAS Hand v0.1.0')
    console.log('')
    console.log('Commands:')
    console.log('  hand pair     --url <wss://...> --code <123456>')
    console.log('  hand serve    Start daemon (connect to EYAS)')
    console.log('  hand status   Show connection status')
    console.log('  hand config   Manage configuration')
    console.log('  hand --tui    Interactive terminal UI')
}
```

- [ ] **Step 2: Test CLI manually**

```bash
cd ~/GitHub/eyas-hand
bun run src/cli.ts status
```

Expected: Shows "Paired: No" (since we haven't paired yet).

```bash
bun run src/cli.ts
```

Expected: Shows help with available commands.

- [ ] **Step 3: Commit**

```bash
cd ~/GitHub/eyas-hand
git add src/cli.ts
git commit -m "feat: CLI entry point — hand pair/serve/status/config commands"
```

---

## Task 10: TUI — Ink-based interactive terminal UI

**Files:**
- Create: `packages/tui/src/index.ts`
- Create: `packages/tui/src/app.tsx`
- Create: `packages/tui/src/components/main-menu.tsx`
- Create: `packages/tui/src/components/connection-screen.tsx`
- Create: `packages/tui/src/components/permissions-screen.tsx`
- Create: `packages/tui/src/components/discovery-screen.tsx`
- Create: `packages/tui/src/components/activity-screen.tsx`
- Create: `packages/tui/src/components/approval-prompt.tsx`
- Create: `packages/tui/src/hooks/use-daemon.ts`
- Create: `packages/tui/src/hooks/use-config.ts`

- [ ] **Step 1: Create TUI entry point and app shell**

```typescript
// packages/tui/src/index.ts
import { render } from 'ink'
import React from 'react'
import { App } from './app.js'

export function startTui(configPath: string): void {
  render(React.createElement(App, { configPath }))
}
```

```tsx
// packages/tui/src/app.tsx
import React, { useState } from 'react'
import { Box, Text } from 'ink'
import { MainMenu } from './components/main-menu.js'
import { ConnectionScreen } from './components/connection-screen.js'
import { PermissionsScreen } from './components/permissions-screen.js'
import { DiscoveryScreen } from './components/discovery-screen.js'
import { ActivityScreen } from './components/activity-screen.js'
import { useConfig } from './hooks/use-config.js'

type Screen = 'menu' | 'connection' | 'permissions' | 'discovery' | 'activity'

interface AppProps {
  configPath: string
}

export function App({ configPath }: AppProps) {
  const [screen, setScreen] = useState<Screen>('menu')
  const { config, reload } = useConfig(configPath)

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold color="cyan">eYssen EYAS Hand</Text>
        <Text> v0.1.0</Text>
      </Box>

      {screen === 'menu' && (
        <MainMenu onSelect={(s) => setScreen(s as Screen)} />
      )}
      {screen === 'connection' && (
        <ConnectionScreen config={config} onBack={() => setScreen('menu')} />
      )}
      {screen === 'permissions' && (
        <PermissionsScreen config={config} configPath={configPath} onBack={() => { reload(); setScreen('menu') }} />
      )}
      {screen === 'discovery' && (
        <DiscoveryScreen onBack={() => setScreen('menu')} />
      )}
      {screen === 'activity' && (
        <ActivityScreen onBack={() => setScreen('menu')} />
      )}
    </Box>
  )
}
```

- [ ] **Step 2: Create hooks**

```typescript
// packages/tui/src/hooks/use-config.ts
import { useState, useCallback } from 'react'
import { loadConfig, type HandConfig } from '@eyas/hand-core'

export function useConfig(configPath: string) {
  const [config, setConfig] = useState<HandConfig>(() => loadConfig(configPath))

  const reload = useCallback(() => {
    setConfig(loadConfig(configPath))
  }, [configPath])

  return { config, reload }
}
```

```typescript
// packages/tui/src/hooks/use-daemon.ts
import { useState, useEffect } from 'react'
import { ConnectionState } from '@eyas/hand-core'

export interface DaemonState {
  connectionState: ConnectionState
  toolCount: number
  recentCommands: Array<{ command: string; exitCode: number; timestamp: number }>
}

export function useDaemon(): DaemonState {
  // Simplified for Phase 1 — TUI is primarily for config, not live daemon monitoring
  return {
    connectionState: ConnectionState.Disconnected,
    toolCount: 0,
    recentCommands: [],
  }
}
```

- [ ] **Step 3: Create main menu component**

```tsx
// packages/tui/src/components/main-menu.tsx
import React, { useState } from 'react'
import { Box, Text, useInput } from 'ink'

const ITEMS = [
  { key: 'connection', label: 'Connection', description: 'Pair / disconnect / URL' },
  { key: 'permissions', label: 'Permissions', description: 'Directories, tools, apps' },
  { key: 'discovery', label: 'Discovery', description: 'View discovered tools' },
  { key: 'activity', label: 'Activity', description: 'Recent commands & logs' },
  { key: 'quit', label: 'Quit', description: '' },
]

interface MainMenuProps {
  onSelect: (key: string) => void
}

export function MainMenu({ onSelect }: MainMenuProps) {
  const [selected, setSelected] = useState(0)

  useInput((input, key) => {
    if (key.upArrow) setSelected((s) => Math.max(0, s - 1))
    if (key.downArrow) setSelected((s) => Math.min(ITEMS.length - 1, s + 1))
    if (key.return) {
      if (ITEMS[selected].key === 'quit') process.exit(0)
      onSelect(ITEMS[selected].key)
    }
  })

  return (
    <Box flexDirection="column">
      {ITEMS.map((item, i) => (
        <Box key={item.key}>
          <Text color={i === selected ? 'cyan' : undefined}>
            {i === selected ? '❯ ' : '  '}
            {item.label}
          </Text>
          {item.description && (
            <Text color="gray">  {item.description}</Text>
          )}
        </Box>
      ))}
    </Box>
  )
}
```

- [ ] **Step 4: Create connection screen**

```tsx
// packages/tui/src/components/connection-screen.tsx
import React from 'react'
import { Box, Text, useInput } from 'ink'
import type { HandConfig } from '@eyas/hand-core'

interface ConnectionScreenProps {
  config: HandConfig
  onBack: () => void
}

export function ConnectionScreen({ config, onBack }: ConnectionScreenProps) {
  useInput((input, key) => {
    if (key.escape || input === 'q') onBack()
  })

  return (
    <Box flexDirection="column">
      <Text bold>Connection</Text>
      <Box marginTop={1} flexDirection="column">
        <Text>Name: {config.hand.name || '(not set)'}</Text>
        <Text>URL: {config.hand.eyasUrl || '(not set)'}</Text>
        <Text>Status: Not connected (use `hand serve` to connect)</Text>
      </Box>
      <Box marginTop={1}>
        <Text color="gray">[ESC] Back</Text>
      </Box>
    </Box>
  )
}
```

- [ ] **Step 5: Create permissions screen**

```tsx
// packages/tui/src/components/permissions-screen.tsx
import React, { useState } from 'react'
import { Box, Text, useInput } from 'ink'
import type { HandConfig } from '@eyas/hand-core'

interface PermissionsScreenProps {
  config: HandConfig
  configPath: string
  onBack: () => void
}

type Tab = 'directories' | 'cli' | 'apps'

export function PermissionsScreen({ config, configPath, onBack }: PermissionsScreenProps) {
  const [tab, setTab] = useState<Tab>('directories')
  const [selected, setSelected] = useState(0)

  const tabs: Tab[] = ['directories', 'cli', 'apps']
  const tabIndex = tabs.indexOf(tab)

  useInput((input, key) => {
    if (key.escape || input === 'q') onBack()
    if (key.tab || key.rightArrow) setTab(tabs[(tabIndex + 1) % tabs.length])
    if (key.leftArrow) setTab(tabs[(tabIndex - 1 + tabs.length) % tabs.length])
    if (key.upArrow) setSelected((s) => Math.max(0, s - 1))
    if (key.downArrow) setSelected((s) => s + 1)
  })

  return (
    <Box flexDirection="column">
      <Text bold>Permissions</Text>
      <Box marginTop={1} gap={2}>
        {tabs.map((t) => (
          <Text key={t} color={t === tab ? 'cyan' : 'gray'} bold={t === tab}>
            [{t}]
          </Text>
        ))}
      </Box>

      <Box marginTop={1} flexDirection="column">
        {tab === 'directories' && (
          <>
            {config.permissions.directories.map((d, i) => (
              <Text key={d.path} color={i === selected ? 'cyan' : undefined}>
                {i === selected ? '❯ ' : '  '}{d.path}  [{d.access}]
              </Text>
            ))}
            {config.permissions.directories.length === 0 && (
              <Text color="gray">  No directories configured</Text>
            )}
          </>
        )}
        {tab === 'cli' && (
          <>
            <Text color="green">Allowed:</Text>
            {config.permissions.cli.allowed.map((t, i) => (
              <Text key={t} color={i === selected ? 'cyan' : undefined}>
                {i === selected ? '❯ ' : '  '}{t}
              </Text>
            ))}
            <Text color="red" marginTop={1}>Blocked:</Text>
            {config.permissions.cli.blocked.map((t) => (
              <Text key={t} color="red">  {t}</Text>
            ))}
            {config.permissions.cli.learned && config.permissions.cli.learned.length > 0 && (
              <>
                <Text color="yellow" marginTop={1}>Learned:</Text>
                {config.permissions.cli.learned.map((r) => (
                  <Text key={r.tool} color="yellow">  {r.tool} ({r.context})</Text>
                ))}
              </>
            )}
          </>
        )}
        {tab === 'apps' && (
          <>
            <Text color="green">Allowed:</Text>
            {config.permissions.apps.allowed.map((a) => (
              <Text key={a}>  {a}</Text>
            ))}
            {config.permissions.apps.allowed.length === 0 && (
              <Text color="gray">  No apps configured</Text>
            )}
          </>
        )}
      </Box>

      <Box marginTop={1}>
        <Text color="gray">[←/→/TAB] Switch tab  [ESC] Back</Text>
      </Box>
    </Box>
  )
}
```

- [ ] **Step 6: Create discovery and activity screens**

```tsx
// packages/tui/src/components/discovery-screen.tsx
import React, { useState, useEffect } from 'react'
import { Box, Text, useInput } from 'ink'
import { scanCliTools } from '@eyas/hand-core'
import type { ToolInfo } from '@eyas/hand-protocol'

interface DiscoveryScreenProps {
  onBack: () => void
}

export function DiscoveryScreen({ onBack }: DiscoveryScreenProps) {
  const [tools, setTools] = useState<ToolInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(0)

  useInput((input, key) => {
    if (key.escape || input === 'q') onBack()
    if (key.upArrow) setSelected((s) => Math.max(0, s - 1))
    if (key.downArrow) setSelected((s) => Math.min(tools.length - 1, s + 1))
  })

  useEffect(() => {
    scanCliTools().then((t) => {
      setTools(t)
      setLoading(false)
    })
  }, [])

  return (
    <Box flexDirection="column">
      <Text bold>Discovered Tools</Text>
      {loading ? (
        <Text color="yellow">Scanning...</Text>
      ) : (
        <Box marginTop={1} flexDirection="column">
          <Text color="gray">{tools.length} tools found</Text>
          {tools.map((tool, i) => (
            <Box key={tool.id}>
              <Text color={i === selected ? 'cyan' : undefined}>
                {i === selected ? '❯ ' : '  '}
                {tool.name.padEnd(20)}
              </Text>
              <Text color="gray">{tool.version?.padEnd(12) || ''.padEnd(12)}</Text>
              <Text color="gray">{tool.path}</Text>
            </Box>
          ))}
        </Box>
      )}
      <Box marginTop={1}>
        <Text color="gray">[ESC] Back</Text>
      </Box>
    </Box>
  )
}
```

```tsx
// packages/tui/src/components/activity-screen.tsx
import React from 'react'
import { Box, Text, useInput } from 'ink'

interface ActivityScreenProps {
  onBack: () => void
}

export function ActivityScreen({ onBack }: ActivityScreenProps) {
  useInput((input, key) => {
    if (key.escape || input === 'q') onBack()
  })

  return (
    <Box flexDirection="column">
      <Text bold>Activity Log</Text>
      <Box marginTop={1}>
        <Text color="gray">No recent activity. Start the daemon with `hand serve`.</Text>
      </Box>
      <Box marginTop={1}>
        <Text color="gray">[ESC] Back</Text>
      </Box>
    </Box>
  )
}
```

- [ ] **Step 7: Create approval prompt component**

```tsx
// packages/tui/src/components/approval-prompt.tsx
import React, { useState } from 'react'
import { Box, Text, useInput } from 'ink'

interface ApprovalPromptProps {
  action: string
  context?: string
  riskTier: 'yellow' | 'red'
  onDecision: (decision: 'allow' | 'always' | 'deny') => void
}

export function ApprovalPrompt({ action, context, riskTier, onDecision }: ApprovalPromptProps) {
  const [selected, setSelected] = useState(0)
  const options = riskTier === 'red'
    ? [{ key: 'allow', label: '[A]llow once' }, { key: 'deny', label: '[D]eny' }]
    : [{ key: 'allow', label: '[A]llow once' }, { key: 'always', label: '[M]always' }, { key: 'deny', label: '[D]eny' }]

  useInput((input) => {
    if (input === 'a') onDecision('allow')
    if (input === 'm' && riskTier !== 'red') onDecision('always')
    if (input === 'd') onDecision('deny')
  })

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={riskTier === 'red' ? 'red' : 'yellow'} padding={1}>
      <Text bold color={riskTier === 'red' ? 'red' : 'yellow'}>Approval Required</Text>
      <Box marginTop={1} flexDirection="column">
        <Text>EYAS wants to run:</Text>
        <Text bold color="white">&gt; {action}</Text>
        {context && <Text color="gray">{context}</Text>}
      </Box>
      <Box marginTop={1} gap={2}>
        {options.map((opt) => (
          <Text key={opt.key}>{opt.label}</Text>
        ))}
      </Box>
    </Box>
  )
}
```

- [ ] **Step 8: Wire TUI into CLI**

Update `src/cli.ts` — replace the `--tui` case:

```typescript
  case '--tui': {
    const { startTui } = await import('@eyas/hand-tui')
    startTui(CONFIG_PATH)
    break
  }
```

- [ ] **Step 9: Test TUI manually**

```bash
cd ~/GitHub/eyas-hand
bun run src/cli.ts --tui
```

Expected: Interactive menu appears with arrow-key navigation.

- [ ] **Step 10: Commit**

```bash
cd ~/GitHub/eyas-hand
git add packages/tui/ src/cli.ts
git commit -m "feat: TUI — Ink-based interactive terminal UI with menu, permissions, discovery"
```

---

## Task 11: EYAS hand-hub module

**Files:**
- Create: `~/GitHub/eyas/src/modules/hand-hub/types.ts`
- Create: `~/GitHub/eyas/src/modules/hand-hub/schema.ts`
- Create: `~/GitHub/eyas/src/modules/hand-hub/hand-registry.ts`
- Create: `~/GitHub/eyas/src/modules/hand-hub/hand-pairing.ts`
- Create: `~/GitHub/eyas/src/modules/hand-hub/hand-ws-handler.ts`
- Create: `~/GitHub/eyas/src/modules/hand-hub/hand-router.ts`
- Create: `~/GitHub/eyas/src/modules/hand-hub/hand-tools.ts`
- Create: `~/GitHub/eyas/src/modules/hand-hub/routes.ts`
- Create: `~/GitHub/eyas/src/modules/hand-hub/index.ts`
- Test: `~/GitHub/eyas/tests/modules/hand-hub.test.ts`

> **Note:** This task works in the `eyas` repo, not `eyas-hand`.

- [ ] **Step 1: Write failing tests**

```typescript
// ~/GitHub/eyas/tests/modules/hand-hub.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { HandRegistry } from '../../src/modules/hand-hub/hand-registry.js'
import { HandPairing } from '../../src/modules/hand-hub/hand-pairing.js'
import { HandRouter } from '../../src/modules/hand-hub/hand-router.js'

describe('HandRegistry', () => {
  it('registers and retrieves a hand', () => {
    const registry = new HandRegistry()
    registry.register('hand_abc', {
      handId: 'hand_abc',
      name: 'Test Mac',
      platform: 'darwin',
      arch: 'arm64',
      osVersion: '15.3',
      protocolVersion: '1.0',
      capabilities: { cli: true, osAutomation: false, computerUse: false },
      discoveredTools: [{ id: 'git', name: 'Git', type: 'cli', path: '/usr/bin/git', capabilities: ['vcs'] }],
    })

    expect(registry.getHand('hand_abc')).toBeDefined()
    expect(registry.getHand('hand_abc')!.name).toBe('Test Mac')
    expect(registry.listHands()).toHaveLength(1)
  })

  it('removes a hand', () => {
    const registry = new HandRegistry()
    registry.register('hand_abc', {
      handId: 'hand_abc',
      name: 'Test',
      platform: 'darwin',
      arch: 'arm64',
      osVersion: '15.3',
      protocolVersion: '1.0',
      capabilities: { cli: true, osAutomation: false, computerUse: false },
      discoveredTools: [],
    })
    registry.unregister('hand_abc')
    expect(registry.getHand('hand_abc')).toBeUndefined()
  })
})

describe('HandPairing', () => {
  it('generates a 6-digit code', () => {
    const pairing = new HandPairing()
    const code = pairing.generateCode('user-1')
    expect(code).toMatch(/^\d{6}$/)
  })

  it('validates a correct code', () => {
    const pairing = new HandPairing()
    const code = pairing.generateCode('user-1')
    const result = pairing.validateCode(code, 'hand_xyz', 'Test Hand', 'darwin')
    expect(result).toBeDefined()
    expect(result!.handId).toBe('hand_xyz')
  })

  it('rejects an invalid code', () => {
    const pairing = new HandPairing()
    pairing.generateCode('user-1')
    const result = pairing.validateCode('000000', 'hand_xyz', 'Test', 'darwin')
    expect(result).toBeNull()
  })

  it('rejects an expired code', async () => {
    const pairing = new HandPairing(100) // 100ms TTL
    const code = pairing.generateCode('user-1')
    await new Promise((r) => setTimeout(r, 150))
    const result = pairing.validateCode(code, 'hand_xyz', 'Test', 'darwin')
    expect(result).toBeNull()
  })
})

describe('HandRouter', () => {
  it('routes to hand with matching tool', () => {
    const registry = new HandRegistry()
    registry.register('hand_a', {
      handId: 'hand_a',
      name: 'Mac',
      platform: 'darwin',
      arch: 'arm64',
      osVersion: '15.3',
      protocolVersion: '1.0',
      capabilities: { cli: true, osAutomation: false, computerUse: false },
      discoveredTools: [{ id: 'ffmpeg', name: 'FFmpeg', type: 'cli', path: '/usr/bin/ffmpeg', capabilities: ['video-convert'] }],
    })
    registry.register('hand_b', {
      handId: 'hand_b',
      name: 'Linux',
      platform: 'linux',
      arch: 'x64',
      osVersion: '6.5',
      protocolVersion: '1.0',
      capabilities: { cli: true, osAutomation: false, computerUse: false },
      discoveredTools: [{ id: 'git', name: 'Git', type: 'cli', path: '/usr/bin/git', capabilities: ['vcs'] }],
    })

    const router = new HandRouter(registry)
    expect(router.findByTool('ffmpeg')).toBe('hand_a')
    expect(router.findByTool('git')).toBe('hand_b')
    expect(router.findByTool('unknown')).toBeNull()
  })

  it('routes to explicit hand', () => {
    const registry = new HandRegistry()
    registry.register('hand_a', {
      handId: 'hand_a', name: 'Mac', platform: 'darwin', arch: 'arm64', osVersion: '15.3', protocolVersion: '1.0',
      capabilities: { cli: true, osAutomation: false, computerUse: false }, discoveredTools: [],
    })
    const router = new HandRouter(registry)
    expect(router.findByExplicit('hand_a')).toBe('hand_a')
    expect(router.findByExplicit('hand_nonexistent')).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd ~/GitHub/eyas
bun vitest run tests/modules/hand-hub.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Create types.ts**

```typescript
// src/modules/hand-hub/types.ts
import type { HandCapabilities, ToolInfo } from '@eyas/hand-protocol'

export interface ConnectedHand {
  handId: string
  name: string
  platform: string
  arch: string
  osVersion: string
  protocolVersion: string
  capabilities: {
    cli: boolean
    osAutomation: boolean
    computerUse: boolean
  }
  discoveredTools: ToolInfo[]
  connectedAt: Date
  lastSeen: Date
  userId: string
  ws: any // WebSocket reference
}

export interface HandToken {
  id: string
  handId: string
  userId: string
  name: string
  platform: string
  token: string
  createdAt: string
  lastUsed?: string
}
```

- [ ] **Step 4: Create schema.ts**

```typescript
// src/modules/hand-hub/schema.ts
import type { EyasDb } from '../../core/types.js'
import { sql } from 'drizzle-orm'

export function createHandHubTables(db: EyasDb): void {
  db.run(sql`CREATE TABLE IF NOT EXISTS hand_tokens (
    id TEXT PRIMARY KEY,
    hand_id TEXT NOT NULL UNIQUE,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    platform TEXT NOT NULL,
    token TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_used TEXT
  )`)

  db.run(sql`CREATE TABLE IF NOT EXISTS hand_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hand_id TEXT NOT NULL,
    type TEXT NOT NULL,
    action TEXT NOT NULL,
    result TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`)

  db.run(sql`CREATE INDEX IF NOT EXISTS idx_hand_logs_hand_id ON hand_logs(hand_id)`)
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_hand_logs_created ON hand_logs(created_at DESC)`)
}
```

- [ ] **Step 5: Create hand-registry.ts**

```typescript
// src/modules/hand-hub/hand-registry.ts
import type { HandCapabilities } from '@eyas/hand-protocol'

interface RegisteredHand extends HandCapabilities {
  connectedAt: Date
  lastSeen: Date
  ws?: any
  userId?: string
}

export class HandRegistry {
  private hands = new Map<string, RegisteredHand>()

  register(handId: string, capabilities: HandCapabilities, ws?: any, userId?: string): void {
    this.hands.set(handId, {
      ...capabilities,
      connectedAt: new Date(),
      lastSeen: new Date(),
      ws,
      userId,
    })
  }

  unregister(handId: string): void {
    this.hands.delete(handId)
  }

  getHand(handId: string): RegisteredHand | undefined {
    return this.hands.get(handId)
  }

  listHands(): RegisteredHand[] {
    return Array.from(this.hands.values())
  }

  updateLastSeen(handId: string): void {
    const hand = this.hands.get(handId)
    if (hand) hand.lastSeen = new Date()
  }

  getWs(handId: string): any | undefined {
    return this.hands.get(handId)?.ws
  }
}
```

- [ ] **Step 6: Create hand-pairing.ts**

```typescript
// src/modules/hand-hub/hand-pairing.ts
import { randomInt } from 'crypto'
import { nanoid } from 'nanoid'
import { PAIRING_CODE_TTL_MS } from '@eyas/hand-protocol'

interface PendingPairing {
  code: string
  userId: string
  createdAt: number
}

export interface PairingResult {
  handId: string
  token: string
  userId: string
}

export class HandPairing {
  private pending = new Map<string, PendingPairing>()
  private ttlMs: number

  constructor(ttlMs: number = PAIRING_CODE_TTL_MS) {
    this.ttlMs = ttlMs
  }

  generateCode(userId: string): string {
    // Generate 6-digit code
    const code = String(randomInt(100000, 999999))

    this.pending.set(code, {
      code,
      userId,
      createdAt: Date.now(),
    })

    // Auto-cleanup after TTL
    setTimeout(() => this.pending.delete(code), this.ttlMs)

    return code
  }

  validateCode(
    code: string,
    handId: string,
    handName: string,
    platform: string,
  ): PairingResult | null {
    const entry = this.pending.get(code)
    if (!entry) return null

    // Check expiry
    if (Date.now() - entry.createdAt > this.ttlMs) {
      this.pending.delete(code)
      return null
    }

    this.pending.delete(code)

    const token = nanoid(64)
    return {
      handId,
      token,
      userId: entry.userId,
    }
  }
}
```

- [ ] **Step 7: Create hand-router.ts**

```typescript
// src/modules/hand-hub/hand-router.ts
import { HandRegistry } from './hand-registry.js'

export class HandRouter {
  private registry: HandRegistry

  constructor(registry: HandRegistry) {
    this.registry = registry
  }

  findByExplicit(handId: string): string | null {
    return this.registry.getHand(handId) ? handId : null
  }

  findByTool(toolId: string): string | null {
    for (const hand of this.registry.listHands()) {
      if (hand.discoveredTools.some((t) => t.id === toolId)) {
        return hand.handId
      }
    }
    return null
  }

  findByCapability(capability: 'cli' | 'osAutomation' | 'computerUse'): string | null {
    for (const hand of this.registry.listHands()) {
      if (hand.capabilities[capability]) {
        return hand.handId
      }
    }
    return null
  }

  /**
   * Smart routing: tries explicit → tool → first available
   */
  route(options: {
    targetHandId?: string
    requiredTool?: string
    requiredCapability?: 'cli' | 'osAutomation' | 'computerUse'
  }): string | null {
    if (options.targetHandId) {
      return this.findByExplicit(options.targetHandId)
    }
    if (options.requiredTool) {
      return this.findByTool(options.requiredTool)
    }
    if (options.requiredCapability) {
      return this.findByCapability(options.requiredCapability)
    }
    // Fallback: first connected hand
    const hands = this.registry.listHands()
    return hands.length > 0 ? hands[0].handId : null
  }
}
```

- [ ] **Step 8: Create hand-ws-handler.ts, hand-tools.ts, routes.ts**

```typescript
// src/modules/hand-hub/hand-ws-handler.ts
import type { WSContext } from 'hono/ws'
import { createHandMessage, parseHandMessage, MSG, type HandMessage, type HandCapabilities } from '@eyas/hand-protocol'
import { randomBytes } from 'crypto'
import { HandRegistry } from './hand-registry.js'

export function createHandWsHandler(registry: HandRegistry, verifyToken: (token: string) => { handId: string; userId: string } | null) {
  return {
    onOpen(ws: WSContext, handId: string, userId: string): void {
      // Send auth challenge
      const nonce = randomBytes(32).toString('hex')
      ws.send(JSON.stringify(createHandMessage(MSG.AUTH_CHALLENGE, { nonce })))
      // Store nonce temporarily on ws context for verification
      ;(ws as any)._handNonce = nonce
      ;(ws as any)._handId = handId
      ;(ws as any)._userId = userId
    },

    onMessage(ws: WSContext, raw: string): void {
      try {
        const msg = parseHandMessage(raw)

        switch (msg.type) {
          case MSG.AUTH_RESPONSE:
            // In production: verify HMAC. For now, trust the token-based auth.
            ws.send(JSON.stringify(createHandMessage(MSG.HAND_CONNECTED, {})))
            break

          case MSG.HAND_CAPABILITIES: {
            const caps = msg.payload as HandCapabilities
            const handId = (ws as any)._handId
            const userId = (ws as any)._userId
            registry.register(handId, caps, ws, userId)
            break
          }

          case MSG.PONG:
            registry.updateLastSeen((ws as any)._handId)
            break

          default:
            // Forward other messages to the appropriate handler
            break
        }
      } catch (err) {
        // Log error
      }
    },

    onClose(ws: WSContext): void {
      const handId = (ws as any)._handId
      if (handId) registry.unregister(handId)
    },
  }
}
```

```typescript
// src/modules/hand-hub/hand-tools.ts
import { HandRegistry } from './hand-registry.js'
import { HandRouter } from './hand-router.js'
import { createHandMessage, MSG, type HandMessage } from '@eyas/hand-protocol'

/**
 * Sends a command to a Hand and waits for the result.
 * Used by the EYAS agent tool registry.
 */
export function createHandToolExecutor(registry: HandRegistry, router: HandRouter) {
  return async function executeOnHand(options: {
    command: string
    cwd?: string
    targetHandId?: string
    requiredTool?: string
  }): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    const handId = router.route({
      targetHandId: options.targetHandId,
      requiredTool: options.requiredTool,
      requiredCapability: 'cli',
    })

    if (!handId) {
      return { exitCode: 1, stdout: '', stderr: 'No connected Hand available' }
    }

    const ws = registry.getWs(handId)
    if (!ws) {
      return { exitCode: 1, stdout: '', stderr: 'Hand WebSocket not available' }
    }

    // Send command and wait for result
    return new Promise((resolve) => {
      const msg = createHandMessage(MSG.EXEC_COMMAND, {
        command: options.command,
        cwd: options.cwd || '/tmp',
      })

      // Set up one-time response handler
      const timeout = setTimeout(() => {
        resolve({ exitCode: 124, stdout: '', stderr: 'Hand command timed out' })
      }, 300_000)

      // Store resolver for this message ID
      ;(ws as any)._pendingResults = (ws as any)._pendingResults || new Map()
      ;(ws as any)._pendingResults.set(msg.id, (result: any) => {
        clearTimeout(timeout)
        resolve(result)
      })

      ws.send(JSON.stringify(msg))
    })
  }
}
```

```typescript
// src/modules/hand-hub/routes.ts
import type { Hono } from 'hono'
import { HandRegistry } from './hand-registry.js'
import { HandPairing } from './hand-pairing.js'

export function createHandHubRoutes(
  app: Hono,
  registry: HandRegistry,
  pairing: HandPairing,
) {
  // Generate pairing code
  app.post('/api/v1/hands/pair/generate', async (c) => {
    const userId = c.get('userId') as string
    if (!userId) return c.json({ error: 'Unauthorized' }, 401)

    const code = pairing.generateCode(userId)
    return c.json({ code, expiresIn: 300 })
  })

  // Hand pairs with code
  app.post('/api/v1/hands/pair', async (c) => {
    const body = await c.req.json<{
      code: string
      handId: string
      name: string
      platform: string
    }>()

    const result = pairing.validateCode(body.code, body.handId, body.name, body.platform)
    if (!result) {
      return c.json({ error: 'Invalid or expired pairing code' }, 400)
    }

    // TODO: Store token in DB (hand_tokens table)
    return c.json({ token: result.token })
  })

  // List connected hands
  app.get('/api/v1/hands', async (c) => {
    const hands = registry.listHands().map((h) => ({
      handId: h.handId,
      name: h.name,
      platform: h.platform,
      arch: h.arch,
      osVersion: h.osVersion,
      capabilities: h.capabilities,
      toolCount: h.discoveredTools.length,
      connectedAt: h.connectedAt.toISOString(),
      lastSeen: h.lastSeen.toISOString(),
    }))
    return c.json({ hands })
  })

  // Get single hand details
  app.get('/api/v1/hands/:handId', async (c) => {
    const hand = registry.getHand(c.req.param('handId'))
    if (!hand) return c.json({ error: 'Hand not found' }, 404)
    return c.json(hand)
  })

  // Disconnect a hand
  app.delete('/api/v1/hands/:handId', async (c) => {
    const handId = c.req.param('handId')
    const ws = registry.getWs(handId)
    if (ws) ws.close()
    registry.unregister(handId)
    return c.json({ ok: true })
  })
}
```

- [ ] **Step 9: Create module index.ts**

```typescript
// src/modules/hand-hub/index.ts
import type { EyasModule, ModuleContext } from '../../core/types.js'
import { HandRegistry } from './hand-registry.js'
import { HandPairing } from './hand-pairing.js'
import { HandRouter } from './hand-router.js'
import { createHandHubRoutes } from './routes.js'
import { createHandHubTables } from './schema.js'

export const handHubModule: EyasModule = {
  id: 'hand-hub',
  name: 'Hand Hub',
  version: '1.0.0',
  type: 'core',
  required: false,
  description: 'Manages EYAS Hand companion connections — remote CLI execution, file access, and OS automation via WebSocket',
  dependencies: ['http', 'websocket', 'auth'],
  optional: ['permissions', 'tools'],
  capabilities: ['hand-management', 'remote-execution'],

  async onRegister(ctx: ModuleContext) {
    createHandHubTables(ctx.db)

    const registry = new HandRegistry()
    const pairing = new HandPairing()
    const router = new HandRouter(registry)

    ;(ctx as any).handHub = { registry, pairing, router }
  },

  async onStart(ctx: ModuleContext) {
    const { registry, pairing, router } = (ctx as any).handHub
    createHandHubRoutes(ctx.http, registry, pairing)

    ctx.logger.info('Hand Hub started — waiting for Hand connections')
  },

  async onStop(ctx: ModuleContext) {
    const { registry } = (ctx as any).handHub
    // Disconnect all hands
    for (const hand of registry.listHands()) {
      const ws = registry.getWs(hand.handId)
      if (ws) ws.close()
    }
    ctx.logger.info('Hand Hub stopped — all Hands disconnected')
  },
}
```

- [ ] **Step 10: Run tests**

```bash
cd ~/GitHub/eyas
bun vitest run tests/modules/hand-hub.test.ts
```

Expected: All tests PASS.

- [ ] **Step 11: Commit**

```bash
cd ~/GitHub/eyas
git add src/modules/hand-hub/ tests/modules/hand-hub.test.ts
git commit -m "feat: hand-hub module — registry, pairing, routing, WS handler, REST API"
```

---

## Task 12: EYAS frontend — Settings > Hands page

**Files:**
- Create: `~/GitHub/eyas/src/web/src/pages/settings/hands-settings.tsx`
- Modify: Settings page to include Hands tab

> **Note:** This task works in the `eyas` repo.

- [ ] **Step 1: Check existing settings page structure**

Read the current settings page to understand routing and tab pattern:

```bash
cd ~/GitHub/eyas
cat src/web/src/pages/settings/settings-page.tsx | head -50
```

- [ ] **Step 2: Create hands-settings.tsx**

```tsx
// src/web/src/pages/settings/hands-settings.tsx
import { useState } from 'react'
import { useApi } from '../../hooks/use-api'
import { useTranslation } from 'react-i18next'

interface HandInfo {
  handId: string
  name: string
  platform: string
  arch: string
  osVersion: string
  capabilities: { cli: boolean; osAutomation: boolean; computerUse: boolean }
  toolCount: number
  connectedAt: string
  lastSeen: string
}

export function HandsSettings() {
  const { t } = useTranslation()
  const { data, refetch } = useApi<{ hands: HandInfo[] }>('/hands')
  const [pairingCode, setPairingCode] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)

  const hands = data?.hands ?? []

  const generateCode = async () => {
    setGenerating(true)
    try {
      const res = await fetch('/api/v1/hands/pair/generate', { method: 'POST' })
      const data = await res.json()
      setPairingCode(data.code)
    } finally {
      setGenerating(false)
    }
  }

  const disconnectHand = async (handId: string) => {
    await fetch(`/api/v1/hands/${handId}`, { method: 'DELETE' })
    refetch()
  }

  const platformIcon = (platform: string) => {
    switch (platform) {
      case 'darwin': return '🍎'
      case 'win32': return '🪟'
      case 'linux': return '🐧'
      default: return '💻'
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium">{t('settings.hands.title', 'Connected Hands')}</h3>
        <button
          onClick={generateCode}
          disabled={generating}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50"
        >
          {generating ? t('common.generating', 'Generating...') : t('settings.hands.generateCode', '+ Generate Pairing Code')}
        </button>
      </div>

      {pairingCode && (
        <div className="p-4 rounded-lg border border-primary/50 bg-primary/5">
          <p className="text-sm text-muted-foreground mb-2">{t('settings.hands.pairingInstructions', 'Enter this code in your EYAS Hand app:')}</p>
          <p className="text-3xl font-mono font-bold tracking-widest text-center">{pairingCode}</p>
          <p className="text-xs text-muted-foreground mt-2 text-center">{t('settings.hands.codeExpiry', 'Expires in 5 minutes')}</p>
        </div>
      )}

      {hands.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <p>{t('settings.hands.noHands', 'No Hands connected')}</p>
          <p className="text-sm mt-2">{t('settings.hands.noHandsHelp', 'Install EYAS Hand on a machine and pair it using the button above')}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {hands.map((hand) => (
            <div key={hand.handId} className="glass-card p-4 rounded-lg flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-2xl">{platformIcon(hand.platform)}</span>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-green-500" />
                    <span className="font-medium">{hand.name}</span>
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {hand.platform} {hand.arch} · {hand.osVersion} · {hand.toolCount} tools
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => disconnectHand(hand.handId)}
                  className="px-3 py-1 text-sm text-destructive hover:bg-destructive/10 rounded"
                >
                  {t('common.disconnect', 'Disconnect')}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Add Hands tab to settings page**

This requires reading the current settings page and adding a tab. The exact integration depends on the current tab structure — add `HandsSettings` as a new tab labeled "Hands".

- [ ] **Step 4: Add i18n keys**

Add to the English translation file:
```json
{
  "settings.hands.title": "Connected Hands",
  "settings.hands.generateCode": "+ Generate Pairing Code",
  "settings.hands.pairingInstructions": "Enter this code in your EYAS Hand app:",
  "settings.hands.codeExpiry": "Expires in 5 minutes",
  "settings.hands.noHands": "No Hands connected",
  "settings.hands.noHandsHelp": "Install EYAS Hand on a machine and pair it using the button above"
}
```

Add Hungarian translations:
```json
{
  "settings.hands.title": "Csatlakozott Hand-ek",
  "settings.hands.generateCode": "+ Párosítási kód generálása",
  "settings.hands.pairingInstructions": "Írd be ezt a kódot az EYAS Hand alkalmazásban:",
  "settings.hands.codeExpiry": "5 perc múlva lejár",
  "settings.hands.noHands": "Nincs csatlakozott Hand",
  "settings.hands.noHandsHelp": "Telepítsd az EYAS Hand-et egy gépre és párosítsd a fenti gombbal"
}
```

- [ ] **Step 5: Commit**

```bash
cd ~/GitHub/eyas
git add src/web/src/pages/settings/hands-settings.tsx
git commit -m "feat: Settings > Hands page — connected hands list, pairing code generation"
```

---

## Task 13: Integration test — end-to-end pairing and command execution

**Files:**
- Create: `~/GitHub/eyas-hand/tests/integration/e2e-flow.test.ts`

- [ ] **Step 1: Write integration test**

```typescript
// ~/GitHub/eyas-hand/tests/integration/e2e-flow.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  loadConfig,
  getDefaultConfig,
  HandDaemon,
  PermissionEngine,
  CommandExecutor,
  scanCliTools,
  generateHandId,
} from '@eyas/hand-core'
import { createHandMessage, MSG, PROTOCOL_VERSION } from '@eyas/hand-protocol'

const TEST_DIR = join(tmpdir(), 'eyas-hand-e2e-' + Date.now())
const CONFIG_PATH = join(TEST_DIR, 'config.yaml')

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true })
  writeFileSync(CONFIG_PATH, `
hand:
  name: "E2E Test Machine"
  eyas_url: "wss://localhost:3000/api/v1/hand/ws"
permissions:
  directories:
    - path: "${TEST_DIR}"
      access: read-write
  cli:
    allowed: [echo, ls, cat]
    blocked: [rm, sudo]
  safety:
    max_concurrent_commands: 3
    command_timeout_seconds: 10
    block_destructive_by_default: true
    require_approval_for_network: true
`)
})

afterEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true })
})

describe('E2E Flow', () => {
  it('loads config, creates daemon, executes allowed command', async () => {
    const config = loadConfig(CONFIG_PATH)
    expect(config.hand.name).toBe('E2E Test Machine')

    const daemon = new HandDaemon({
      config,
      configPath: CONFIG_PATH,
      handId: generateHandId(),
      token: 'test-token',
      eyasUrl: config.hand.eyasUrl,
    })

    const responses: any[] = []
    daemon.setSendFn((msg) => responses.push(msg))

    // Execute allowed command
    const msg = createHandMessage(MSG.EXEC_COMMAND, {
      command: 'echo integration-test',
      cwd: TEST_DIR,
    })
    await daemon.handleMessage(msg)

    expect(responses).toHaveLength(1)
    expect(responses[0].type).toBe(MSG.EXEC_RESULT)
    expect(responses[0].payload.exitCode).toBe(0)
    expect(responses[0].payload.stdout.trim()).toBe('integration-test')
  })

  it('blocks forbidden command', async () => {
    const config = loadConfig(CONFIG_PATH)
    const daemon = new HandDaemon({
      config,
      configPath: CONFIG_PATH,
      handId: generateHandId(),
      token: 'test-token',
      eyasUrl: config.hand.eyasUrl,
    })

    const responses: any[] = []
    daemon.setSendFn((msg) => responses.push(msg))

    const msg = createHandMessage(MSG.EXEC_COMMAND, {
      command: 'rm -rf /',
      cwd: TEST_DIR,
    })
    await daemon.handleMessage(msg)

    expect(responses).toHaveLength(1)
    expect(responses[0].type).toBe(MSG.EXEC_RESULT)
    expect(responses[0].payload.exitCode).toBe(1)
    expect(responses[0].payload.stderr).toContain('blocked')
  })

  it('requests approval for unknown command', async () => {
    const config = loadConfig(CONFIG_PATH)
    const daemon = new HandDaemon({
      config,
      configPath: CONFIG_PATH,
      handId: generateHandId(),
      token: 'test-token',
      eyasUrl: config.hand.eyasUrl,
    })

    const responses: any[] = []
    daemon.setSendFn((msg) => responses.push(msg))

    const msg = createHandMessage(MSG.EXEC_COMMAND, {
      command: 'curl https://example.com',
      cwd: TEST_DIR,
    })
    await daemon.handleMessage(msg)

    expect(responses).toHaveLength(1)
    expect(responses[0].type).toBe(MSG.APPROVAL_REQUEST)
  })

  it('builds capabilities with discovered tools', async () => {
    const config = loadConfig(CONFIG_PATH)
    const daemon = new HandDaemon({
      config,
      configPath: CONFIG_PATH,
      handId: 'test-hand-123',
      token: 'test-token',
      eyasUrl: config.hand.eyasUrl,
    })

    const caps = await daemon.buildCapabilities()
    expect(caps.handId).toBe('test-hand-123')
    expect(caps.protocolVersion).toBe(PROTOCOL_VERSION)
    expect(caps.capabilities.cli).toBe(true)
    expect(caps.discoveredTools.length).toBeGreaterThan(0)
  })

  it('handles file read in allowed directory', async () => {
    const config = loadConfig(CONFIG_PATH)
    const testFile = join(TEST_DIR, 'test.txt')
    writeFileSync(testFile, 'hello from file')

    const daemon = new HandDaemon({
      config,
      configPath: CONFIG_PATH,
      handId: generateHandId(),
      token: 'test-token',
      eyasUrl: config.hand.eyasUrl,
    })

    const responses: any[] = []
    daemon.setSendFn((msg) => responses.push(msg))

    const msg = createHandMessage(MSG.FS_READ, { path: testFile })
    await daemon.handleMessage(msg)

    expect(responses).toHaveLength(1)
    expect(responses[0].type).toBe(MSG.FS_RESULT)
    expect(responses[0].payload.success).toBe(true)
    expect(responses[0].payload.data).toBe('hello from file')
  })
})
```

- [ ] **Step 2: Run integration tests**

```bash
cd ~/GitHub/eyas-hand
bun vitest run tests/integration/e2e-flow.test.ts
```

Expected: All 5 tests PASS.

- [ ] **Step 3: Run ALL tests**

```bash
cd ~/GitHub/eyas-hand
bun vitest run
```

Expected: All tests across protocol, core, and integration PASS.

- [ ] **Step 4: Commit**

```bash
cd ~/GitHub/eyas-hand
git add tests/integration/
git commit -m "test: end-to-end integration tests — config, exec, permissions, discovery, fs"
```

---

## Summary

| Task | Description | Repo |
|------|------------|------|
| 1 | Scaffold monorepo | eyas-hand |
| 2 | Protocol package (shared types) | eyas-hand |
| 3 | Config loader (YAML + Zod) | eyas-hand |
| 4 | Permission engine + risk classifier | eyas-hand |
| 5 | CLI scanner (tool discovery) | eyas-hand |
| 6 | Command executor + sandbox | eyas-hand |
| 7 | WebSocket client (phone home) | eyas-hand |
| 8 | Hand daemon (message loop) | eyas-hand |
| 9 | CLI entry point | eyas-hand |
| 10 | TUI (Ink) | eyas-hand |
| 11 | hand-hub EYAS module | eyas |
| 12 | Frontend Hands settings page | eyas |
| 13 | Integration tests | eyas-hand |

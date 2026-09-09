# eYssen EYAS Hand — Phase 2: OS Automation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add platform-specific OS automation adapters to eyas-hand so EYAS can control applications, windows, clipboard, and system functions on the remote machine. macOS is the primary target using JXA (JavaScript for Automation); Windows and Linux are stubs.

**Repo:** `~/GitHub/eyas-hand/` (existing monorepo from Phase 1)

**Spec:** Phase 1 design spec already defines `OsAdapter` interface in capabilities section.

**Tech Stack:** TypeScript 5.9+, Bun, Vitest, child_process (spawn/exec), JXA via osascript (macOS)

**Depends on:** Phase 1 complete (protocol, core, tui packages exist)

---

## File Structure

### New files

```
packages/protocol/src/
  messages.ts                              # MODIFY — add OS message types + payloads

packages/core/src/os-adapter/
  types.ts                                 # OsAdapter interface, AppInfo, WindowInfo, Rect, OsActionType
  os-adapter-factory.ts                    # Factory returns platform adapter
  jxa-runner.ts                            # Shared JXA execution helper (osascript wrapper)
  darwin-adapter.ts                        # macOS implementation using JXA/osascript
  win32-adapter.ts                         # Windows stub
  linux-adapter.ts                         # Linux stub

packages/core/src/discovery/
  app-scanner.ts                           # Platform-specific installed app discovery

packages/core/src/
  hand-daemon.ts                           # MODIFY — add os:action handler
  index.ts                                 # MODIFY — export new modules

packages/protocol/src/
  index.ts                                 # MODIFY — already re-exports, no change needed (types in messages.ts)
  constants.ts                             # MODIFY — add OS_ACTION_TIMEOUT_MS

tests/core/
  os-adapter-types.test.ts                 # Type/interface tests
  jxa-runner.test.ts                       # JXA runner tests (mock osascript)
  darwin-adapter.test.ts                   # macOS adapter tests (mock exec)
  os-adapter-factory.test.ts               # Factory tests
  app-scanner.test.ts                      # App scanner tests
  hand-daemon-os.test.ts                   # Daemon OS message handling tests

tests/protocol/
  messages.test.ts                         # MODIFY — add OS payload tests
```

---

## Task 1: Protocol types — Add os:action/os:result to protocol package

**Files:**
- Modify: `packages/protocol/src/messages.ts`
- Modify: `packages/protocol/src/constants.ts`
- Modify: `tests/protocol/messages.test.ts`

### Step-by-step:

- [ ] **Step 1: Add OS_ACTION_TIMEOUT_MS constant**

```typescript
// packages/protocol/src/constants.ts — ADD at end of file

export const OS_ACTION_TIMEOUT_MS = 15_000
```

- [ ] **Step 2: Add OsAction type union and payload interfaces to messages.ts**

Add AFTER the existing `AuthResponsePayload` interface and BEFORE the `MSG` const:

```typescript
// packages/protocol/src/messages.ts — ADD after AuthResponsePayload

export type OsActionType =
  | 'launchApp'
  | 'listRunningApps'
  | 'focusApp'
  | 'listWindows'
  | 'moveWindow'
  | 'setVolume'
  | 'getClipboard'
  | 'setClipboard'
  | 'notify'
  | 'openFileWith'
  | 'listInstalledApps'

export interface OsActionPayload {
  action: OsActionType
  args: Record<string, unknown>
}

export interface OsResultPayload {
  success: boolean
  action: OsActionType
  data?: unknown
  error?: string
}
```

- [ ] **Step 3: Add MSG constants for OS messages**

Add to the `MSG` const object:

```typescript
// packages/protocol/src/messages.ts — ADD to MSG object, before closing `} as const`

  OS_ACTION: 'os:action',
  OS_RESULT: 'os:result',
```

The full MSG object after modification:

```typescript
export const MSG = {
  AUTH_CHALLENGE: 'auth:challenge',
  AUTH_RESPONSE: 'auth:response',
  HAND_CONNECTED: 'hand:connected',
  HAND_CAPABILITIES: 'hand:capabilities',
  HAND_DISCONNECTED: 'hand:disconnected',
  EXEC_COMMAND: 'exec:command',
  EXEC_RESULT: 'exec:result',
  EXEC_STREAM: 'exec:stream',
  EXEC_CHUNK: 'exec:chunk',
  FS_READ: 'fs:read',
  FS_WRITE: 'fs:write',
  FS_LIST: 'fs:list',
  FS_RESULT: 'fs:result',
  APPROVAL_REQUEST: 'approval:request',
  APPROVAL_RESPONSE: 'approval:response',
  OS_ACTION: 'os:action',
  OS_RESULT: 'os:result',
  PING: 'ping',
  PONG: 'pong',
} as const
```

- [ ] **Step 4: Add protocol tests for OS payloads**

Append to `tests/protocol/messages.test.ts`:

```typescript
// tests/protocol/messages.test.ts — ADD at end

describe('OS message types', () => {
  it('MSG has OS_ACTION and OS_RESULT', () => {
    expect(MSG.OS_ACTION).toBe('os:action')
    expect(MSG.OS_RESULT).toBe('os:result')
  })

  it('creates os:action message with correct structure', () => {
    const payload: OsActionPayload = {
      action: 'launchApp',
      args: { bundleId: 'com.apple.Safari' },
    }
    const msg = createHandMessage(MSG.OS_ACTION, payload)
    expect(msg.type).toBe('os:action')
    expect(msg.id).toBeTruthy()
    expect(msg.timestamp).toBeGreaterThan(0)

    const p = msg.payload as OsActionPayload
    expect(p.action).toBe('launchApp')
    expect(p.args.bundleId).toBe('com.apple.Safari')
  })

  it('creates os:result message with success', () => {
    const payload: OsResultPayload = {
      success: true,
      action: 'listRunningApps',
      data: [{ bundleId: 'com.apple.Finder', name: 'Finder', pid: 123, isActive: true }],
    }
    const msg = createHandMessage(MSG.OS_RESULT, payload, 'original-id')
    expect(msg.type).toBe('os:result')
    expect(msg.replyTo).toBe('original-id')

    const p = msg.payload as OsResultPayload
    expect(p.success).toBe(true)
    expect(p.action).toBe('listRunningApps')
    expect(Array.isArray(p.data)).toBe(true)
  })

  it('creates os:result message with error', () => {
    const payload: OsResultPayload = {
      success: false,
      action: 'setVolume',
      error: 'Permission denied',
    }
    const msg = createHandMessage(MSG.OS_RESULT, payload)

    const p = msg.payload as OsResultPayload
    expect(p.success).toBe(false)
    expect(p.error).toBe('Permission denied')
  })

  it('covers all OsActionType values', () => {
    const allActions: OsActionType[] = [
      'launchApp', 'listRunningApps', 'focusApp', 'listWindows',
      'moveWindow', 'setVolume', 'getClipboard', 'setClipboard',
      'notify', 'openFileWith', 'listInstalledApps',
    ]
    for (const action of allActions) {
      const payload: OsActionPayload = { action, args: {} }
      const msg = createHandMessage(MSG.OS_ACTION, payload)
      expect((msg.payload as OsActionPayload).action).toBe(action)
    }
  })
})
```

- [ ] **Step 5: Add imports in test file**

At the top of `tests/protocol/messages.test.ts`, ensure these imports exist:

```typescript
import type { OsActionPayload, OsResultPayload, OsActionType } from '@eyas/hand-protocol'
```

- [ ] **Step 6: Run tests to verify**

```bash
cd ~/GitHub/eyas-hand && bun run test -- tests/protocol/messages.test.ts
```

---

## Task 2: OsAdapter interface + types

**Files:**
- Create: `packages/core/src/os-adapter/types.ts`
- Create: `tests/core/os-adapter-types.test.ts`

- [ ] **Step 1: Create types.ts**

```typescript
// packages/core/src/os-adapter/types.ts

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface AppInfo {
  bundleId: string
  name: string
  pid: number
  isActive: boolean
}

export interface WindowInfo {
  id: number
  title: string
  bundleId: string
  rect: Rect
  isVisible: boolean
}

export interface InstalledAppInfo {
  bundleId: string
  name: string
  path: string
  version?: string
}

/**
 * Platform-specific OS automation adapter.
 * Each method maps 1:1 to an OsActionType from the protocol.
 */
export interface OsAdapter {
  readonly platform: 'darwin' | 'win32' | 'linux'

  // App lifecycle
  launchApp(bundleId: string, args?: string[]): Promise<void>
  listRunningApps(): Promise<AppInfo[]>
  focusApp(bundleId: string): Promise<void>

  // Window management
  listWindows(): Promise<WindowInfo[]>
  moveWindow(windowId: number, rect: Rect): Promise<void>

  // System
  setVolume(percent: number): Promise<void>
  getClipboard(): Promise<string>
  setClipboard(text: string): Promise<void>
  notify(title: string, body: string): Promise<void>

  // File associations
  openFileWith(path: string, appId: string): Promise<void>

  // Discovery
  listInstalledApps(): Promise<InstalledAppInfo[]>
}

/**
 * Error thrown when an OS adapter method is not implemented for the current platform.
 */
export class OsAdapterNotImplementedError extends Error {
  constructor(platform: string, method: string) {
    super(`OsAdapter.${method}() is not implemented on ${platform}`)
    this.name = 'OsAdapterNotImplementedError'
  }
}

/**
 * Error thrown when an osascript/JXA call fails.
 */
export class OsAutomationError extends Error {
  constructor(method: string, cause: string) {
    super(`OS automation failed in ${method}: ${cause}`)
    this.name = 'OsAutomationError'
  }
}
```

- [ ] **Step 2: Create type tests**

```typescript
// tests/core/os-adapter-types.test.ts

import { describe, it, expect } from 'vitest'
import type { OsAdapter, AppInfo, WindowInfo, Rect, InstalledAppInfo } from '../../packages/core/src/os-adapter/types.js'
import { OsAdapterNotImplementedError, OsAutomationError } from '../../packages/core/src/os-adapter/types.js'

describe('OsAdapter types', () => {
  it('Rect has x, y, width, height', () => {
    const rect: Rect = { x: 100, y: 200, width: 800, height: 600 }
    expect(rect.x).toBe(100)
    expect(rect.y).toBe(200)
    expect(rect.width).toBe(800)
    expect(rect.height).toBe(600)
  })

  it('AppInfo has required fields', () => {
    const app: AppInfo = {
      bundleId: 'com.apple.Safari',
      name: 'Safari',
      pid: 1234,
      isActive: true,
    }
    expect(app.bundleId).toBe('com.apple.Safari')
    expect(app.pid).toBe(1234)
  })

  it('WindowInfo has required fields including rect', () => {
    const win: WindowInfo = {
      id: 42,
      title: 'Untitled',
      bundleId: 'com.apple.TextEdit',
      rect: { x: 0, y: 0, width: 1024, height: 768 },
      isVisible: true,
    }
    expect(win.id).toBe(42)
    expect(win.rect.width).toBe(1024)
    expect(win.isVisible).toBe(true)
  })

  it('InstalledAppInfo has required and optional fields', () => {
    const app: InstalledAppInfo = {
      bundleId: 'com.apple.Safari',
      name: 'Safari',
      path: '/Applications/Safari.app',
      version: '17.4',
    }
    expect(app.path).toBe('/Applications/Safari.app')
    expect(app.version).toBe('17.4')

    const appNoVersion: InstalledAppInfo = {
      bundleId: 'com.example.test',
      name: 'Test',
      path: '/Applications/Test.app',
    }
    expect(appNoVersion.version).toBeUndefined()
  })

  it('OsAdapterNotImplementedError has correct name and message', () => {
    const err = new OsAdapterNotImplementedError('linux', 'launchApp')
    expect(err.name).toBe('OsAdapterNotImplementedError')
    expect(err.message).toBe('OsAdapter.launchApp() is not implemented on linux')
    expect(err).toBeInstanceOf(Error)
  })

  it('OsAutomationError has correct name and message', () => {
    const err = new OsAutomationError('setVolume', 'osascript timed out')
    expect(err.name).toBe('OsAutomationError')
    expect(err.message).toBe('OS automation failed in setVolume: osascript timed out')
    expect(err).toBeInstanceOf(Error)
  })
})
```

- [ ] **Step 3: Run tests**

```bash
cd ~/GitHub/eyas-hand && bun run test -- tests/core/os-adapter-types.test.ts
```

---

## Task 3: JXA runner + macOS adapter (main deliverable)

**Files:**
- Create: `packages/core/src/os-adapter/jxa-runner.ts`
- Create: `packages/core/src/os-adapter/darwin-adapter.ts`
- Create: `tests/core/jxa-runner.test.ts`
- Create: `tests/core/darwin-adapter.test.ts`

### Step-by-step:

- [ ] **Step 1: Create JXA runner helper**

```typescript
// packages/core/src/os-adapter/jxa-runner.ts

import { exec, execFile } from 'child_process'
import { promisify } from 'util'
import { OS_ACTION_TIMEOUT_MS } from '@eyas/hand-protocol'
import { OsAutomationError } from './types.js'

const execAsync = promisify(exec)
const execFileAsync = promisify(execFile)

export interface JxaRunOptions {
  timeoutMs?: number
}

/**
 * Execute a JXA (JavaScript for Automation) script via osascript.
 * Returns the stdout result as a string.
 */
export async function runJxa(script: string, opts: JxaRunOptions = {}): Promise<string> {
  const timeout = opts.timeoutMs ?? OS_ACTION_TIMEOUT_MS
  try {
    const { stdout } = await execAsync(`osascript -l JavaScript -e ${escapeShellArg(script)}`, {
      timeout,
      maxBuffer: 10 * 1024 * 1024, // 10MB for large app lists
    })
    return stdout.trim()
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new OsAutomationError('runJxa', msg)
  }
}

/**
 * Execute an AppleScript string via osascript (for simple commands like volume).
 */
export async function runAppleScript(script: string, opts: JxaRunOptions = {}): Promise<string> {
  const timeout = opts.timeoutMs ?? OS_ACTION_TIMEOUT_MS
  try {
    const { stdout } = await execAsync(`osascript -e ${escapeShellArg(script)}`, {
      timeout,
      maxBuffer: 1024 * 1024,
    })
    return stdout.trim()
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new OsAutomationError('runAppleScript', msg)
  }
}

/**
 * Execute a shell command with timeout. Used for pbpaste/pbcopy/open/mdfind.
 */
export async function runShell(command: string, args: string[], opts: JxaRunOptions = {}): Promise<string> {
  const timeout = opts.timeoutMs ?? OS_ACTION_TIMEOUT_MS
  try {
    const { stdout } = await execFileAsync(command, args, {
      timeout,
      maxBuffer: 10 * 1024 * 1024,
    })
    return stdout.trim()
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new OsAutomationError('runShell', msg)
  }
}

/**
 * Pipe text into a command's stdin (used for pbcopy).
 */
export async function runShellWithStdin(command: string, args: string[], stdin: string, opts: JxaRunOptions = {}): Promise<void> {
  const timeout = opts.timeoutMs ?? OS_ACTION_TIMEOUT_MS
  return new Promise((resolve, reject) => {
    const { spawn } = require('child_process') as typeof import('child_process')
    const child = spawn(command, args, { timeout, stdio: ['pipe', 'ignore', 'pipe'] })
    let stderr = ''
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    child.on('close', (code: number | null) => {
      if (code === 0) resolve()
      else reject(new OsAutomationError('runShellWithStdin', `Exit code ${code}: ${stderr}`))
    })
    child.on('error', (err: Error) => {
      reject(new OsAutomationError('runShellWithStdin', err.message))
    })
    child.stdin.write(stdin)
    child.stdin.end()
  })
}

/**
 * Escape a string for safe shell argument usage.
 */
function escapeShellArg(arg: string): string {
  return `'${arg.replace(/'/g, "'\\''")}'`
}

export { escapeShellArg }
```

- [ ] **Step 2: Create JXA runner tests**

```typescript
// tests/core/jxa-runner.test.ts

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { OsAutomationError } from '../../packages/core/src/os-adapter/types.js'

// Mock child_process before import
const mockExec = vi.fn()
const mockExecFile = vi.fn()
vi.mock('child_process', () => ({
  exec: (...args: any[]) => mockExec(...args),
  execFile: (...args: any[]) => mockExecFile(...args),
  spawn: vi.fn(),
}))

// Dynamically import after mock
const { runJxa, runAppleScript, runShell, escapeShellArg } = await import(
  '../../packages/core/src/os-adapter/jxa-runner.js'
)

describe('jxa-runner', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('escapeShellArg', () => {
    it('wraps in single quotes', () => {
      expect(escapeShellArg('hello')).toBe("'hello'")
    })

    it('escapes embedded single quotes', () => {
      expect(escapeShellArg("it's")).toBe("'it'\\''s'")
    })

    it('handles empty string', () => {
      expect(escapeShellArg('')).toBe("''")
    })
  })

  describe('runJxa', () => {
    it('calls osascript with -l JavaScript flag', async () => {
      mockExec.mockImplementation((_cmd: string, _opts: unknown, cb?: Function) => {
        // promisify pattern: exec returns ChildProcess, callback is 3rd arg
        if (typeof _opts === 'function') {
          _opts(null, { stdout: '42\n', stderr: '' })
        } else if (cb) {
          cb(null, { stdout: '42\n', stderr: '' })
        }
        return { kill: vi.fn() }
      })

      const result = await runJxa('1 + 41')
      expect(result).toBe('42')
      expect(mockExec).toHaveBeenCalledTimes(1)
      const callArgs = mockExec.mock.calls[0][0]
      expect(callArgs).toContain('osascript -l JavaScript -e')
    })

    it('throws OsAutomationError on failure', async () => {
      mockExec.mockImplementation((_cmd: string, _opts: unknown, cb?: Function) => {
        const err = new Error('execution error: script failed')
        if (typeof _opts === 'function') {
          _opts(err, { stdout: '', stderr: '' })
        } else if (cb) {
          cb(err, { stdout: '', stderr: '' })
        }
        return { kill: vi.fn() }
      })

      await expect(runJxa('bad script')).rejects.toThrow(OsAutomationError)
    })
  })

  describe('runAppleScript', () => {
    it('calls osascript without -l flag', async () => {
      mockExec.mockImplementation((_cmd: string, _opts: unknown, cb?: Function) => {
        if (typeof _opts === 'function') {
          _opts(null, { stdout: 'ok\n', stderr: '' })
        } else if (cb) {
          cb(null, { stdout: 'ok\n', stderr: '' })
        }
        return { kill: vi.fn() }
      })

      const result = await runAppleScript('set volume output volume 50')
      expect(result).toBe('ok')
      const callArgs = mockExec.mock.calls[0][0]
      expect(callArgs).toContain('osascript -e')
      expect(callArgs).not.toContain('-l JavaScript')
    })
  })

  describe('runShell', () => {
    it('calls execFile with command and args', async () => {
      mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb?: Function) => {
        if (typeof _opts === 'function') {
          _opts(null, { stdout: 'clipboard content\n', stderr: '' })
        } else if (cb) {
          cb(null, { stdout: 'clipboard content\n', stderr: '' })
        }
        return { kill: vi.fn() }
      })

      const result = await runShell('pbpaste', [])
      expect(result).toBe('clipboard content')
    })

    it('throws OsAutomationError on failure', async () => {
      mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb?: Function) => {
        const err = new Error('command not found')
        if (typeof _opts === 'function') {
          _opts(err, { stdout: '', stderr: '' })
        } else if (cb) {
          cb(err, { stdout: '', stderr: '' })
        }
        return { kill: vi.fn() }
      })

      await expect(runShell('nonexistent', [])).rejects.toThrow(OsAutomationError)
    })
  })
})
```

- [ ] **Step 3: Create darwin-adapter.ts**

```typescript
// packages/core/src/os-adapter/darwin-adapter.ts

import type { OsAdapter, AppInfo, WindowInfo, Rect, InstalledAppInfo } from './types.js'
import { OsAutomationError } from './types.js'
import { runJxa, runAppleScript, runShell, runShellWithStdin } from './jxa-runner.js'

/**
 * macOS OS automation adapter using JXA (JavaScript for Automation),
 * AppleScript, and native CLI tools (pbcopy/pbpaste/open/mdfind).
 */
export class DarwinAdapter implements OsAdapter {
  readonly platform = 'darwin' as const

  async launchApp(bundleId: string, args?: string[]): Promise<void> {
    if (args && args.length > 0) {
      // Use `open -b` with arguments
      await runShell('open', ['-b', bundleId, '--args', ...args])
    } else {
      // JXA launch
      const script = `
        const app = Application("${escapeBundleId(bundleId)}");
        app.launch();
        void 0;
      `
      await runJxa(script)
    }
  }

  async listRunningApps(): Promise<AppInfo[]> {
    const script = `
      const se = Application("System Events");
      const procs = se.applicationProcesses.whose({ backgroundOnly: false });
      const result = [];
      for (let i = 0; i < procs.length; i++) {
        const p = procs[i];
        result.push({
          bundleId: p.bundleIdentifier() || "",
          name: p.name(),
          pid: p.unixId(),
          isActive: p.frontmost()
        });
      }
      JSON.stringify(result);
    `
    const raw = await runJxa(script)
    try {
      return JSON.parse(raw) as AppInfo[]
    } catch {
      throw new OsAutomationError('listRunningApps', `Failed to parse JXA output: ${raw.slice(0, 200)}`)
    }
  }

  async focusApp(bundleId: string): Promise<void> {
    const script = `
      const app = Application("${escapeBundleId(bundleId)}");
      app.activate();
      void 0;
    `
    await runJxa(script)
  }

  async listWindows(): Promise<WindowInfo[]> {
    const script = `
      const se = Application("System Events");
      const procs = se.applicationProcesses.whose({ backgroundOnly: false });
      const result = [];
      for (let i = 0; i < procs.length; i++) {
        const p = procs[i];
        const wins = p.windows();
        for (let j = 0; j < wins.length; j++) {
          const w = wins[j];
          try {
            const pos = w.position();
            const size = w.size();
            result.push({
              id: j + i * 1000,
              title: w.name() || "",
              bundleId: p.bundleIdentifier() || "",
              rect: { x: pos[0], y: pos[1], width: size[0], height: size[1] },
              isVisible: true
            });
          } catch(e) {
            // Some windows may not report position/size — skip
          }
        }
      }
      JSON.stringify(result);
    `
    const raw = await runJxa(script)
    try {
      return JSON.parse(raw) as WindowInfo[]
    } catch {
      throw new OsAutomationError('listWindows', `Failed to parse JXA output: ${raw.slice(0, 200)}`)
    }
  }

  async moveWindow(windowId: number, rect: Rect): Promise<void> {
    // windowId encodes: processIndex * 1000 + windowIndex
    const processIdx = Math.floor(windowId / 1000)
    const windowIdx = windowId % 1000
    const script = `
      const se = Application("System Events");
      const procs = se.applicationProcesses.whose({ backgroundOnly: false });
      const proc = procs[${processIdx}];
      const win = proc.windows()[${windowIdx}];
      win.position = [${rect.x}, ${rect.y}];
      win.size = [${rect.width}, ${rect.height}];
      void 0;
    `
    await runJxa(script)
  }

  async setVolume(percent: number): Promise<void> {
    const clamped = Math.max(0, Math.min(100, Math.round(percent)))
    await runAppleScript(`set volume output volume ${clamped}`)
  }

  async getClipboard(): Promise<string> {
    return await runShell('pbpaste', [])
  }

  async setClipboard(text: string): Promise<void> {
    await runShellWithStdin('pbcopy', [], text)
  }

  async notify(title: string, body: string): Promise<void> {
    const safeTitle = escapeAppleScriptString(title)
    const safeBody = escapeAppleScriptString(body)
    await runAppleScript(`display notification "${safeBody}" with title "${safeTitle}"`)
  }

  async openFileWith(path: string, appId: string): Promise<void> {
    await runShell('open', ['-b', appId, path])
  }

  async listInstalledApps(): Promise<InstalledAppInfo[]> {
    // Use mdfind to find all .app bundles, then extract bundle IDs
    const raw = await runShell('mdfind', ['kMDItemContentType == "com.apple.application-bundle"'], {
      timeoutMs: 30_000,
    })
    if (!raw) return []

    const paths = raw.split('\n').filter(Boolean)
    const apps: InstalledAppInfo[] = []

    // Process in batches to avoid overwhelming the system
    const BATCH_SIZE = 50
    for (let i = 0; i < paths.length; i += BATCH_SIZE) {
      const batch = paths.slice(i, i + BATCH_SIZE)
      const promises = batch.map(async (appPath) => {
        try {
          const plistPath = `${appPath}/Contents/Info.plist`
          const bundleId = await runShell('defaults', ['read', plistPath, 'CFBundleIdentifier'], {
            timeoutMs: 5000,
          }).catch(() => '')
          const name = await runShell('defaults', ['read', plistPath, 'CFBundleName'], {
            timeoutMs: 5000,
          }).catch(() => appPath.split('/').pop()?.replace('.app', '') || 'Unknown')
          const version = await runShell('defaults', ['read', plistPath, 'CFBundleShortVersionString'], {
            timeoutMs: 5000,
          }).catch(() => undefined)

          if (bundleId) {
            return { bundleId, name, path: appPath, version: version || undefined } as InstalledAppInfo
          }
          return null
        } catch {
          return null
        }
      })
      const results = await Promise.allSettled(promises)
      for (const r of results) {
        if (r.status === 'fulfilled' && r.value) {
          apps.push(r.value)
        }
      }
    }

    return apps
  }
}

// --- Helpers ---

/**
 * Escape a bundle ID for safe insertion into JXA template strings.
 * Bundle IDs are reverse-DNS (e.g., com.apple.Safari) — only allow safe chars.
 */
function escapeBundleId(bundleId: string): string {
  if (!/^[a-zA-Z0-9._-]+$/.test(bundleId)) {
    throw new OsAutomationError('escapeBundleId', `Invalid bundle ID: ${bundleId}`)
  }
  return bundleId
}

/**
 * Escape a string for AppleScript double-quoted string context.
 */
function escapeAppleScriptString(str: string): string {
  return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

export { escapeBundleId, escapeAppleScriptString }
```

- [ ] **Step 4: Create darwin-adapter tests**

```typescript
// tests/core/darwin-adapter.test.ts

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { OsAutomationError } from '../../packages/core/src/os-adapter/types.js'

// Mock jxa-runner
const mockRunJxa = vi.fn()
const mockRunAppleScript = vi.fn()
const mockRunShell = vi.fn()
const mockRunShellWithStdin = vi.fn()

vi.mock('../../packages/core/src/os-adapter/jxa-runner.js', () => ({
  runJxa: (...args: any[]) => mockRunJxa(...args),
  runAppleScript: (...args: any[]) => mockRunAppleScript(...args),
  runShell: (...args: any[]) => mockRunShell(...args),
  runShellWithStdin: (...args: any[]) => mockRunShellWithStdin(...args),
}))

const { DarwinAdapter, escapeBundleId, escapeAppleScriptString } = await import(
  '../../packages/core/src/os-adapter/darwin-adapter.js'
)

describe('DarwinAdapter', () => {
  let adapter: InstanceType<typeof DarwinAdapter>

  beforeEach(() => {
    vi.clearAllMocks()
    adapter = new DarwinAdapter()
  })

  it('has platform darwin', () => {
    expect(adapter.platform).toBe('darwin')
  })

  describe('launchApp', () => {
    it('launches app via JXA without args', async () => {
      mockRunJxa.mockResolvedValue('')
      await adapter.launchApp('com.apple.Safari')
      expect(mockRunJxa).toHaveBeenCalledTimes(1)
      expect(mockRunJxa.mock.calls[0][0]).toContain('com.apple.Safari')
      expect(mockRunJxa.mock.calls[0][0]).toContain('.launch()')
    })

    it('launches app via open -b with args', async () => {
      mockRunShell.mockResolvedValue('')
      await adapter.launchApp('com.apple.Safari', ['https://example.com'])
      expect(mockRunShell).toHaveBeenCalledWith('open', [
        '-b', 'com.apple.Safari', '--args', 'https://example.com',
      ])
    })
  })

  describe('listRunningApps', () => {
    it('returns parsed app list from JXA', async () => {
      const fakeApps = [
        { bundleId: 'com.apple.Finder', name: 'Finder', pid: 100, isActive: false },
        { bundleId: 'com.apple.Safari', name: 'Safari', pid: 200, isActive: true },
      ]
      mockRunJxa.mockResolvedValue(JSON.stringify(fakeApps))
      const result = await adapter.listRunningApps()
      expect(result).toEqual(fakeApps)
      expect(result).toHaveLength(2)
      expect(result[1].isActive).toBe(true)
    })

    it('throws OsAutomationError on invalid JSON', async () => {
      mockRunJxa.mockResolvedValue('not json')
      await expect(adapter.listRunningApps()).rejects.toThrow(OsAutomationError)
    })
  })

  describe('focusApp', () => {
    it('activates app via JXA', async () => {
      mockRunJxa.mockResolvedValue('')
      await adapter.focusApp('com.apple.TextEdit')
      expect(mockRunJxa.mock.calls[0][0]).toContain('.activate()')
      expect(mockRunJxa.mock.calls[0][0]).toContain('com.apple.TextEdit')
    })
  })

  describe('listWindows', () => {
    it('returns parsed window list from JXA', async () => {
      const fakeWindows = [
        { id: 0, title: 'Desktop', bundleId: 'com.apple.Finder', rect: { x: 0, y: 0, width: 800, height: 600 }, isVisible: true },
      ]
      mockRunJxa.mockResolvedValue(JSON.stringify(fakeWindows))
      const result = await adapter.listWindows()
      expect(result).toHaveLength(1)
      expect(result[0].title).toBe('Desktop')
      expect(result[0].rect.width).toBe(800)
    })
  })

  describe('moveWindow', () => {
    it('sets position and size via JXA', async () => {
      mockRunJxa.mockResolvedValue('')
      await adapter.moveWindow(1002, { x: 50, y: 50, width: 1024, height: 768 })
      const script = mockRunJxa.mock.calls[0][0]
      expect(script).toContain('position = [50, 50]')
      expect(script).toContain('size = [1024, 768]')
      // windowId 1002 = process 1, window 2
      expect(script).toContain('procs[1]')
      expect(script).toContain('windows()[2]')
    })
  })

  describe('setVolume', () => {
    it('calls AppleScript with clamped volume', async () => {
      mockRunAppleScript.mockResolvedValue('')
      await adapter.setVolume(75)
      expect(mockRunAppleScript).toHaveBeenCalledWith('set volume output volume 75')
    })

    it('clamps volume to 0-100', async () => {
      mockRunAppleScript.mockResolvedValue('')

      await adapter.setVolume(-10)
      expect(mockRunAppleScript).toHaveBeenCalledWith('set volume output volume 0')

      await adapter.setVolume(150)
      expect(mockRunAppleScript).toHaveBeenCalledWith('set volume output volume 100')
    })
  })

  describe('getClipboard', () => {
    it('calls pbpaste', async () => {
      mockRunShell.mockResolvedValue('clipboard text')
      const result = await adapter.getClipboard()
      expect(result).toBe('clipboard text')
      expect(mockRunShell).toHaveBeenCalledWith('pbpaste', [])
    })
  })

  describe('setClipboard', () => {
    it('pipes text to pbcopy', async () => {
      mockRunShellWithStdin.mockResolvedValue(undefined)
      await adapter.setClipboard('hello world')
      expect(mockRunShellWithStdin).toHaveBeenCalledWith('pbcopy', [], 'hello world')
    })
  })

  describe('notify', () => {
    it('calls AppleScript display notification', async () => {
      mockRunAppleScript.mockResolvedValue('')
      await adapter.notify('Test Title', 'Test Body')
      const call = mockRunAppleScript.mock.calls[0][0]
      expect(call).toContain('display notification')
      expect(call).toContain('Test Body')
      expect(call).toContain('Test Title')
    })

    it('escapes special characters in title and body', async () => {
      mockRunAppleScript.mockResolvedValue('')
      await adapter.notify('He said "hello"', 'Line with \\ backslash')
      const call = mockRunAppleScript.mock.calls[0][0]
      expect(call).toContain('He said \\"hello\\"')
      expect(call).toContain('Line with \\\\ backslash')
    })
  })

  describe('openFileWith', () => {
    it('calls open -b with file path', async () => {
      mockRunShell.mockResolvedValue('')
      await adapter.openFileWith('/Users/test/doc.pdf', 'com.apple.Preview')
      expect(mockRunShell).toHaveBeenCalledWith('open', ['-b', 'com.apple.Preview', '/Users/test/doc.pdf'])
    })
  })

  describe('listInstalledApps', () => {
    it('uses mdfind and parses plist info', async () => {
      mockRunShell
        .mockResolvedValueOnce('/Applications/Safari.app\n/Applications/TextEdit.app') // mdfind
        .mockResolvedValueOnce('com.apple.Safari') // bundleId 1
        .mockResolvedValueOnce('Safari') // name 1
        .mockResolvedValueOnce('17.4') // version 1
        .mockResolvedValueOnce('com.apple.TextEdit') // bundleId 2
        .mockResolvedValueOnce('TextEdit') // name 2
        .mockResolvedValueOnce('1.18') // version 2

      const result = await adapter.listInstalledApps()
      expect(result).toHaveLength(2)
      expect(result[0].bundleId).toBe('com.apple.Safari')
      expect(result[0].path).toBe('/Applications/Safari.app')
      expect(result[1].name).toBe('TextEdit')
    })

    it('returns empty array when mdfind returns nothing', async () => {
      mockRunShell.mockResolvedValue('')
      const result = await adapter.listInstalledApps()
      expect(result).toEqual([])
    })
  })
})

describe('escapeBundleId', () => {
  it('allows valid reverse-DNS bundle IDs', () => {
    expect(escapeBundleId('com.apple.Safari')).toBe('com.apple.Safari')
    expect(escapeBundleId('org.mozilla.firefox')).toBe('org.mozilla.firefox')
    expect(escapeBundleId('com.example.my-app')).toBe('com.example.my-app')
  })

  it('throws on invalid characters', () => {
    expect(() => escapeBundleId('com.apple.Safari"; evil()')).toThrow(OsAutomationError)
    expect(() => escapeBundleId('com.apple.Safari\nmalicious')).toThrow(OsAutomationError)
    expect(() => escapeBundleId('')).toThrow(OsAutomationError)
  })
})

describe('escapeAppleScriptString', () => {
  it('escapes double quotes', () => {
    expect(escapeAppleScriptString('He said "hi"')).toBe('He said \\"hi\\"')
  })

  it('escapes backslashes', () => {
    expect(escapeAppleScriptString('path\\to\\file')).toBe('path\\\\to\\\\file')
  })

  it('handles empty string', () => {
    expect(escapeAppleScriptString('')).toBe('')
  })
})
```

- [ ] **Step 5: Run tests**

```bash
cd ~/GitHub/eyas-hand && bun run test -- tests/core/jxa-runner.test.ts tests/core/darwin-adapter.test.ts
```

---

## Task 4: Win32 + Linux stubs

**Files:**
- Create: `packages/core/src/os-adapter/win32-adapter.ts`
- Create: `packages/core/src/os-adapter/linux-adapter.ts`

- [ ] **Step 1: Create win32-adapter.ts**

```typescript
// packages/core/src/os-adapter/win32-adapter.ts

import type { OsAdapter, AppInfo, WindowInfo, Rect, InstalledAppInfo } from './types.js'
import { OsAdapterNotImplementedError } from './types.js'

/**
 * Windows OS automation adapter stub.
 * All methods throw OsAdapterNotImplementedError.
 * Future implementation will use PowerShell via child_process.
 */
export class Win32Adapter implements OsAdapter {
  readonly platform = 'win32' as const

  async launchApp(_bundleId: string, _args?: string[]): Promise<void> {
    throw new OsAdapterNotImplementedError('win32', 'launchApp')
  }

  async listRunningApps(): Promise<AppInfo[]> {
    throw new OsAdapterNotImplementedError('win32', 'listRunningApps')
  }

  async focusApp(_bundleId: string): Promise<void> {
    throw new OsAdapterNotImplementedError('win32', 'focusApp')
  }

  async listWindows(): Promise<WindowInfo[]> {
    throw new OsAdapterNotImplementedError('win32', 'listWindows')
  }

  async moveWindow(_windowId: number, _rect: Rect): Promise<void> {
    throw new OsAdapterNotImplementedError('win32', 'moveWindow')
  }

  async setVolume(_percent: number): Promise<void> {
    throw new OsAdapterNotImplementedError('win32', 'setVolume')
  }

  async getClipboard(): Promise<string> {
    throw new OsAdapterNotImplementedError('win32', 'getClipboard')
  }

  async setClipboard(_text: string): Promise<void> {
    throw new OsAdapterNotImplementedError('win32', 'setClipboard')
  }

  async notify(_title: string, _body: string): Promise<void> {
    throw new OsAdapterNotImplementedError('win32', 'notify')
  }

  async openFileWith(_path: string, _appId: string): Promise<void> {
    throw new OsAdapterNotImplementedError('win32', 'openFileWith')
  }

  async listInstalledApps(): Promise<InstalledAppInfo[]> {
    throw new OsAdapterNotImplementedError('win32', 'listInstalledApps')
  }
}
```

- [ ] **Step 2: Create linux-adapter.ts**

```typescript
// packages/core/src/os-adapter/linux-adapter.ts

import type { OsAdapter, AppInfo, WindowInfo, Rect, InstalledAppInfo } from './types.js'
import { OsAdapterNotImplementedError } from './types.js'

/**
 * Linux OS automation adapter stub.
 * All methods throw OsAdapterNotImplementedError.
 * Future implementation will use D-Bus + xdotool + xdg-open via child_process.
 */
export class LinuxAdapter implements OsAdapter {
  readonly platform = 'linux' as const

  async launchApp(_bundleId: string, _args?: string[]): Promise<void> {
    throw new OsAdapterNotImplementedError('linux', 'launchApp')
  }

  async listRunningApps(): Promise<AppInfo[]> {
    throw new OsAdapterNotImplementedError('linux', 'listRunningApps')
  }

  async focusApp(_bundleId: string): Promise<void> {
    throw new OsAdapterNotImplementedError('linux', 'focusApp')
  }

  async listWindows(): Promise<WindowInfo[]> {
    throw new OsAdapterNotImplementedError('linux', 'listWindows')
  }

  async moveWindow(_windowId: number, _rect: Rect): Promise<void> {
    throw new OsAdapterNotImplementedError('linux', 'moveWindow')
  }

  async setVolume(_percent: number): Promise<void> {
    throw new OsAdapterNotImplementedError('linux', 'setVolume')
  }

  async getClipboard(): Promise<string> {
    throw new OsAdapterNotImplementedError('linux', 'getClipboard')
  }

  async setClipboard(_text: string): Promise<void> {
    throw new OsAdapterNotImplementedError('linux', 'setClipboard')
  }

  async notify(_title: string, _body: string): Promise<void> {
    throw new OsAdapterNotImplementedError('linux', 'notify')
  }

  async openFileWith(_path: string, _appId: string): Promise<void> {
    throw new OsAdapterNotImplementedError('linux', 'openFileWith')
  }

  async listInstalledApps(): Promise<InstalledAppInfo[]> {
    throw new OsAdapterNotImplementedError('linux', 'listInstalledApps')
  }
}
```

- [ ] **Step 3: Run tests (stubs are implicitly tested via factory in Task 5)**

No dedicated test file needed — the stubs just throw. Factory tests cover the behavior.

---

## Task 5: Factory + daemon integration

**Files:**
- Create: `packages/core/src/os-adapter/os-adapter-factory.ts`
- Modify: `packages/core/src/hand-daemon.ts`
- Modify: `packages/core/src/index.ts`
- Create: `tests/core/os-adapter-factory.test.ts`
- Create: `tests/core/hand-daemon-os.test.ts`

### Step-by-step:

- [ ] **Step 1: Create os-adapter-factory.ts**

```typescript
// packages/core/src/os-adapter/os-adapter-factory.ts

import type { OsAdapter } from './types.js'
import { DarwinAdapter } from './darwin-adapter.js'
import { Win32Adapter } from './win32-adapter.js'
import { LinuxAdapter } from './linux-adapter.js'

/**
 * Returns the OS adapter for the current (or specified) platform.
 * Returns null for unsupported platforms.
 */
export function createOsAdapter(platform?: string): OsAdapter | null {
  const p = platform ?? process.platform

  switch (p) {
    case 'darwin':
      return new DarwinAdapter()
    case 'win32':
      return new Win32Adapter()
    case 'linux':
      return new LinuxAdapter()
    default:
      return null
  }
}
```

- [ ] **Step 2: Create factory tests**

```typescript
// tests/core/os-adapter-factory.test.ts

import { describe, it, expect } from 'vitest'
import { createOsAdapter } from '../../packages/core/src/os-adapter/os-adapter-factory.js'
import { DarwinAdapter } from '../../packages/core/src/os-adapter/darwin-adapter.js'
import { Win32Adapter } from '../../packages/core/src/os-adapter/win32-adapter.js'
import { LinuxAdapter } from '../../packages/core/src/os-adapter/linux-adapter.js'

describe('createOsAdapter', () => {
  it('returns DarwinAdapter for darwin', () => {
    const adapter = createOsAdapter('darwin')
    expect(adapter).toBeInstanceOf(DarwinAdapter)
    expect(adapter!.platform).toBe('darwin')
  })

  it('returns Win32Adapter for win32', () => {
    const adapter = createOsAdapter('win32')
    expect(adapter).toBeInstanceOf(Win32Adapter)
    expect(adapter!.platform).toBe('win32')
  })

  it('returns LinuxAdapter for linux', () => {
    const adapter = createOsAdapter('linux')
    expect(adapter).toBeInstanceOf(LinuxAdapter)
    expect(adapter!.platform).toBe('linux')
  })

  it('returns null for unsupported platform', () => {
    expect(createOsAdapter('freebsd')).toBeNull()
    expect(createOsAdapter('sunos')).toBeNull()
  })

  it('uses process.platform when no argument given', () => {
    const adapter = createOsAdapter()
    expect(adapter).not.toBeNull()
    expect(['darwin', 'win32', 'linux']).toContain(adapter!.platform)
  })
})
```

- [ ] **Step 3: Modify hand-daemon.ts — add OS adapter + handler**

Add imports at top of `packages/core/src/hand-daemon.ts`:

```typescript
// ADD to imports
import type { OsActionPayload, OsResultPayload } from '@eyas/hand-protocol'
import { createOsAdapter } from './os-adapter/os-adapter-factory.js'
import type { OsAdapter } from './os-adapter/types.js'
```

Add `osAdapter` property to the class, initialize in constructor:

```typescript
// In HandDaemon class — ADD property
private osAdapter: OsAdapter | null

// In constructor — ADD after this.executor assignment
this.osAdapter = createOsAdapter()
```

Update `buildCapabilities` to report `osAutomation: true` when adapter is available:

```typescript
// In buildCapabilities — CHANGE osAutomation line
capabilities: {
  cli: true,
  osAutomation: this.osAdapter !== null,
  computerUse: false,
},
```

Add case to `handleMessage` switch:

```typescript
// In handleMessage switch — ADD before default
case MSG.OS_ACTION:
  await this.handleOsAction(msg)
  break
```

Add the handler method:

```typescript
// ADD to HandDaemon class — private methods section

private async handleOsAction(msg: HandMessage): Promise<void> {
  const payload = msg.payload as OsActionPayload

  if (!this.osAdapter) {
    const result: OsResultPayload = {
      success: false,
      action: payload.action,
      error: `OS automation not available on ${process.platform}`,
    }
    this.sendFn(createHandMessage(MSG.OS_RESULT, result, msg.id))
    return
  }

  try {
    const data = await this.dispatchOsAction(this.osAdapter, payload)
    const result: OsResultPayload = {
      success: true,
      action: payload.action,
      data,
    }
    this.sendFn(createHandMessage(MSG.OS_RESULT, result, msg.id))
  } catch (err) {
    const result: OsResultPayload = {
      success: false,
      action: payload.action,
      error: err instanceof Error ? err.message : String(err),
    }
    this.sendFn(createHandMessage(MSG.OS_RESULT, result, msg.id))
  }
}

private async dispatchOsAction(adapter: OsAdapter, payload: OsActionPayload): Promise<unknown> {
  const { action, args } = payload

  switch (action) {
    case 'launchApp':
      await adapter.launchApp(args.bundleId as string, args.args as string[] | undefined)
      return undefined
    case 'listRunningApps':
      return await adapter.listRunningApps()
    case 'focusApp':
      await adapter.focusApp(args.bundleId as string)
      return undefined
    case 'listWindows':
      return await adapter.listWindows()
    case 'moveWindow':
      await adapter.moveWindow(args.windowId as number, args.rect as { x: number; y: number; width: number; height: number })
      return undefined
    case 'setVolume':
      await adapter.setVolume(args.percent as number)
      return undefined
    case 'getClipboard':
      return await adapter.getClipboard()
    case 'setClipboard':
      await adapter.setClipboard(args.text as string)
      return undefined
    case 'notify':
      await adapter.notify(args.title as string, args.body as string)
      return undefined
    case 'openFileWith':
      await adapter.openFileWith(args.path as string, args.appId as string)
      return undefined
    case 'listInstalledApps':
      return await adapter.listInstalledApps()
    default:
      throw new Error(`Unknown OS action: ${action}`)
  }
}
```

The full modified `hand-daemon.ts` after all changes:

```typescript
// packages/core/src/hand-daemon.ts — FULL FILE

import os from 'os'
import {
  createHandMessage,
  MSG,
  PROTOCOL_VERSION,
  type HandMessage,
  type HandCapabilities,
  type ExecCommandPayload,
  type ExecResultPayload,
  type FsReadPayload,
  type FsWritePayload,
  type FsListPayload,
  type ApprovalRequestPayload,
  type ApprovalResponsePayload,
  type OsActionPayload,
  type OsResultPayload,
} from '@eyas/hand-protocol'
import type { HandConfig } from './config/config-schema.js'
import { PermissionEngine } from './permissions/permission-engine.js'
import { CommandExecutor } from './executor/command-executor.js'
import { readFile, writeFile, listDirectory } from './executor/fs-executor.js'
import { scanCliTools } from './discovery/cli-scanner.js'
import { learnTool } from './permissions/auto-learn.js'
import { createOsAdapter } from './os-adapter/os-adapter-factory.js'
import type { OsAdapter } from './os-adapter/types.js'

export interface HandDaemonOptions {
  config: HandConfig
  configPath: string
  handId: string
  token: string
  eyasUrl: string
}

interface PendingApproval {
  originalMessage: HandMessage
}

export class HandDaemon {
  readonly handId: string

  private config: HandConfig
  private configPath: string
  private permissions: PermissionEngine
  private executor: CommandExecutor
  private osAdapter: OsAdapter | null
  private pendingApprovals = new Map<string, PendingApproval>()
  private sendFn: (msg: HandMessage) => void = () => {}

  constructor(options: HandDaemonOptions) {
    this.handId = options.handId
    this.config = options.config
    this.configPath = options.configPath
    this.permissions = new PermissionEngine(options.config)
    this.executor = new CommandExecutor(options.config)
    this.osAdapter = createOsAdapter()
  }

  setSendFn(fn: (msg: HandMessage) => void): void {
    this.sendFn = fn
  }

  async buildCapabilities(): Promise<HandCapabilities> {
    const tools = await scanCliTools()
    return {
      handId: this.handId,
      name: this.config.hand.name || this.handId,
      platform: process.platform as 'darwin' | 'win32' | 'linux',
      arch: process.arch as 'x64' | 'arm64',
      osVersion: os.release(),
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {
        cli: true,
        osAutomation: this.osAdapter !== null,
        computerUse: false,
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
      case MSG.OS_ACTION:
        await this.handleOsAction(msg)
        break
      case MSG.APPROVAL_RESPONSE:
        await this.handleApprovalResponse(msg)
        break
      default:
        // Unknown message type — ignore
        break
    }
  }

  // --- Private handlers ---

  private async handleExecCommand(msg: HandMessage): Promise<void> {
    const payload = msg.payload as ExecCommandPayload
    const check = await this.permissions.checkCommand(payload.command)

    if (check.allowed) {
      this.permissions.incrementRunning()
      try {
        const result = await this.executor.execute(payload.command, payload.cwd ?? process.cwd())
        this.sendFn(
          createHandMessage(MSG.EXEC_RESULT, result satisfies ExecResultPayload, msg.id)
        )
      } finally {
        this.permissions.decrementRunning()
      }
      return
    }

    if (!check.requiresApproval) {
      // black-listed
      const result: ExecResultPayload = {
        exitCode: 1,
        stdout: '',
        stderr: `Command blocked: ${check.reason ?? 'Command is blocked'}`,
      }
      this.sendFn(createHandMessage(MSG.EXEC_RESULT, result, msg.id))
      return
    }

    // yellow/red — request approval
    const approvalPayload: ApprovalRequestPayload = {
      action: payload.command,
      description: `Execute command: ${payload.command}`,
      riskTier: check.tier === 'red' ? 'red' : 'yellow',
    }
    const approvalMsg = createHandMessage(MSG.APPROVAL_REQUEST, approvalPayload, msg.id)
    this.pendingApprovals.set(approvalMsg.id, { originalMessage: msg })
    this.sendFn(approvalMsg)
  }

  private async handleExecStream(msg: HandMessage): Promise<void> {
    const payload = msg.payload as ExecCommandPayload
    const check = await this.permissions.checkCommand(payload.command)

    if (check.allowed) {
      this.permissions.incrementRunning()
      try {
        const result = await this.executor.executeStream(
          payload.command,
          payload.cwd ?? process.cwd(),
          (stream, data) => {
            this.sendFn(createHandMessage(MSG.EXEC_CHUNK, { stream, data }, msg.id))
          }
        )
        this.sendFn(createHandMessage(MSG.EXEC_RESULT, result satisfies ExecResultPayload, msg.id))
      } finally {
        this.permissions.decrementRunning()
      }
      return
    }

    if (!check.requiresApproval) {
      const result: ExecResultPayload = {
        exitCode: 1,
        stdout: '',
        stderr: `Command blocked: ${check.reason ?? 'Command is blocked'}`,
      }
      this.sendFn(createHandMessage(MSG.EXEC_RESULT, result, msg.id))
      return
    }

    const approvalPayload: ApprovalRequestPayload = {
      action: payload.command,
      description: `Stream command: ${payload.command}`,
      riskTier: check.tier === 'red' ? 'red' : 'yellow',
    }
    const approvalMsg = createHandMessage(MSG.APPROVAL_REQUEST, approvalPayload, msg.id)
    this.pendingApprovals.set(approvalMsg.id, { originalMessage: msg })
    this.sendFn(approvalMsg)
  }

  private async handleFsRead(msg: HandMessage): Promise<void> {
    const payload = msg.payload as FsReadPayload
    const check = await this.permissions.checkPath(payload.path, 'read')

    if (!check.allowed) {
      this.sendFn(
        createHandMessage(
          MSG.FS_RESULT,
          { success: false, error: check.reason ?? 'Access denied' },
          msg.id
        )
      )
      return
    }

    try {
      const content = readFile(payload.path)
      this.sendFn(createHandMessage(MSG.FS_RESULT, { success: true, data: content }, msg.id))
    } catch (err) {
      this.sendFn(
        createHandMessage(
          MSG.FS_RESULT,
          { success: false, error: String(err) },
          msg.id
        )
      )
    }
  }

  private async handleFsWrite(msg: HandMessage): Promise<void> {
    const payload = msg.payload as FsWritePayload
    const check = await this.permissions.checkPath(payload.path, 'write')

    if (!check.allowed) {
      this.sendFn(
        createHandMessage(
          MSG.FS_RESULT,
          { success: false, error: check.reason ?? 'Access denied' },
          msg.id
        )
      )
      return
    }

    try {
      writeFile(payload.path, payload.content, payload.encoding ?? 'utf-8')
      this.sendFn(createHandMessage(MSG.FS_RESULT, { success: true }, msg.id))
    } catch (err) {
      this.sendFn(
        createHandMessage(
          MSG.FS_RESULT,
          { success: false, error: String(err) },
          msg.id
        )
      )
    }
  }

  private async handleFsList(msg: HandMessage): Promise<void> {
    const payload = msg.payload as FsListPayload
    const check = await this.permissions.checkPath(payload.path, 'read')

    if (!check.allowed) {
      this.sendFn(
        createHandMessage(
          MSG.FS_RESULT,
          { success: false, error: check.reason ?? 'Access denied' },
          msg.id
        )
      )
      return
    }

    try {
      const entries = listDirectory(payload.path, payload.recursive ?? false)
      this.sendFn(createHandMessage(MSG.FS_RESULT, { success: true, data: entries }, msg.id))
    } catch (err) {
      this.sendFn(
        createHandMessage(
          MSG.FS_RESULT,
          { success: false, error: String(err) },
          msg.id
        )
      )
    }
  }

  private async handleOsAction(msg: HandMessage): Promise<void> {
    const payload = msg.payload as OsActionPayload

    if (!this.osAdapter) {
      const result: OsResultPayload = {
        success: false,
        action: payload.action,
        error: `OS automation not available on ${process.platform}`,
      }
      this.sendFn(createHandMessage(MSG.OS_RESULT, result, msg.id))
      return
    }

    try {
      const data = await this.dispatchOsAction(this.osAdapter, payload)
      const result: OsResultPayload = {
        success: true,
        action: payload.action,
        data,
      }
      this.sendFn(createHandMessage(MSG.OS_RESULT, result, msg.id))
    } catch (err) {
      const result: OsResultPayload = {
        success: false,
        action: payload.action,
        error: err instanceof Error ? err.message : String(err),
      }
      this.sendFn(createHandMessage(MSG.OS_RESULT, result, msg.id))
    }
  }

  private async dispatchOsAction(adapter: OsAdapter, payload: OsActionPayload): Promise<unknown> {
    const { action, args } = payload

    switch (action) {
      case 'launchApp':
        await adapter.launchApp(args.bundleId as string, args.args as string[] | undefined)
        return undefined
      case 'listRunningApps':
        return await adapter.listRunningApps()
      case 'focusApp':
        await adapter.focusApp(args.bundleId as string)
        return undefined
      case 'listWindows':
        return await adapter.listWindows()
      case 'moveWindow':
        await adapter.moveWindow(args.windowId as number, args.rect as { x: number; y: number; width: number; height: number })
        return undefined
      case 'setVolume':
        await adapter.setVolume(args.percent as number)
        return undefined
      case 'getClipboard':
        return await adapter.getClipboard()
      case 'setClipboard':
        await adapter.setClipboard(args.text as string)
        return undefined
      case 'notify':
        await adapter.notify(args.title as string, args.body as string)
        return undefined
      case 'openFileWith':
        await adapter.openFileWith(args.path as string, args.appId as string)
        return undefined
      case 'listInstalledApps':
        return await adapter.listInstalledApps()
      default:
        throw new Error(`Unknown OS action: ${action}`)
    }
  }

  private async handleApprovalResponse(msg: HandMessage): Promise<void> {
    const payload = msg.payload as ApprovalResponsePayload

    // Find pending approval by scanning for the one whose action matches
    // The approvalMsg.id is stored as a key, and replyTo on the response should match
    const approvalId = msg.replyTo
    const pending = approvalId ? this.pendingApprovals.get(approvalId) : undefined

    if (!pending) {
      return
    }

    this.pendingApprovals.delete(approvalId!)

    if (payload.decision === 'deny') {
      const result: ExecResultPayload = {
        exitCode: 1,
        stdout: '',
        stderr: 'Command denied by user',
      }
      this.sendFn(createHandMessage(MSG.EXEC_RESULT, result, pending.originalMessage.id))
      return
    }

    // allow or always — re-execute
    if (payload.decision === 'always') {
      const originalPayload = pending.originalMessage.payload as ExecCommandPayload
      await learnTool(
        this.configPath,
        originalPayload.command.split(' ')[0],
        `Approved by user: ${originalPayload.command}`,
        this.config
      )
    }

    // Re-execute the original message
    await this.handleMessage(pending.originalMessage)
  }
}
```

- [ ] **Step 4: Update core index.ts exports**

Add to `packages/core/src/index.ts`:

```typescript
// ADD at end of packages/core/src/index.ts

// OS Adapter
export type { OsAdapter, AppInfo, WindowInfo, Rect, InstalledAppInfo } from './os-adapter/types.js'
export { OsAdapterNotImplementedError, OsAutomationError } from './os-adapter/types.js'
export { createOsAdapter } from './os-adapter/os-adapter-factory.js'
export { DarwinAdapter } from './os-adapter/darwin-adapter.js'
export { Win32Adapter } from './os-adapter/win32-adapter.js'
export { LinuxAdapter } from './os-adapter/linux-adapter.js'
export { runJxa, runAppleScript, runShell } from './os-adapter/jxa-runner.js'
```

- [ ] **Step 5: Create hand-daemon OS handling tests**

```typescript
// tests/core/hand-daemon-os.test.ts

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createHandMessage, MSG } from '@eyas/hand-protocol'
import type { OsActionPayload, OsResultPayload } from '@eyas/hand-protocol'
import { getDefaultConfig } from '@eyas/hand-core'

// Mock the os-adapter-factory so we control which adapter the daemon gets
const mockListRunningApps = vi.fn()
const mockLaunchApp = vi.fn()
const mockSetVolume = vi.fn()
const mockGetClipboard = vi.fn()
const mockNotify = vi.fn()

vi.mock('../../packages/core/src/os-adapter/os-adapter-factory.js', () => ({
  createOsAdapter: () => ({
    platform: 'darwin',
    launchApp: (...args: any[]) => mockLaunchApp(...args),
    listRunningApps: () => mockListRunningApps(),
    focusApp: vi.fn().mockResolvedValue(undefined),
    listWindows: vi.fn().mockResolvedValue([]),
    moveWindow: vi.fn().mockResolvedValue(undefined),
    setVolume: (...args: any[]) => mockSetVolume(...args),
    getClipboard: () => mockGetClipboard(),
    setClipboard: vi.fn().mockResolvedValue(undefined),
    notify: (...args: any[]) => mockNotify(...args),
    openFileWith: vi.fn().mockResolvedValue(undefined),
    listInstalledApps: vi.fn().mockResolvedValue([]),
  }),
}))

// Import HandDaemon after mocks
const { HandDaemon } = await import('../../packages/core/src/hand-daemon.js')

function makeDaemon() {
  const daemon = new HandDaemon({
    config: getDefaultConfig(),
    configPath: '/tmp/test.yaml',
    handId: 'test-hand',
    token: 'test-token',
    eyasUrl: 'wss://example.com/api/v1/hand/ws',
  })
  const sent: any[] = []
  daemon.setSendFn((msg: any) => sent.push(msg))
  return { daemon, sent }
}

describe('HandDaemon OS action handling', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('handles os:action listRunningApps and replies with os:result', async () => {
    const fakeApps = [
      { bundleId: 'com.apple.Finder', name: 'Finder', pid: 100, isActive: true },
    ]
    mockListRunningApps.mockResolvedValue(fakeApps)

    const { daemon, sent } = makeDaemon()
    const actionPayload: OsActionPayload = { action: 'listRunningApps', args: {} }
    await daemon.handleMessage(createHandMessage(MSG.OS_ACTION, actionPayload))

    expect(sent).toHaveLength(1)
    expect(sent[0].type).toBe(MSG.OS_RESULT)
    const result = sent[0].payload as OsResultPayload
    expect(result.success).toBe(true)
    expect(result.action).toBe('listRunningApps')
    expect(result.data).toEqual(fakeApps)
  })

  it('handles os:action launchApp', async () => {
    mockLaunchApp.mockResolvedValue(undefined)

    const { daemon, sent } = makeDaemon()
    const actionPayload: OsActionPayload = {
      action: 'launchApp',
      args: { bundleId: 'com.apple.Safari' },
    }
    await daemon.handleMessage(createHandMessage(MSG.OS_ACTION, actionPayload))

    expect(mockLaunchApp).toHaveBeenCalledWith('com.apple.Safari', undefined)
    expect(sent[0].type).toBe(MSG.OS_RESULT)
    expect((sent[0].payload as OsResultPayload).success).toBe(true)
  })

  it('handles os:action setVolume', async () => {
    mockSetVolume.mockResolvedValue(undefined)

    const { daemon, sent } = makeDaemon()
    const actionPayload: OsActionPayload = {
      action: 'setVolume',
      args: { percent: 42 },
    }
    await daemon.handleMessage(createHandMessage(MSG.OS_ACTION, actionPayload))

    expect(mockSetVolume).toHaveBeenCalledWith(42)
    expect((sent[0].payload as OsResultPayload).success).toBe(true)
  })

  it('handles os:action getClipboard and returns data', async () => {
    mockGetClipboard.mockResolvedValue('clipboard content')

    const { daemon, sent } = makeDaemon()
    const actionPayload: OsActionPayload = { action: 'getClipboard', args: {} }
    await daemon.handleMessage(createHandMessage(MSG.OS_ACTION, actionPayload))

    const result = sent[0].payload as OsResultPayload
    expect(result.success).toBe(true)
    expect(result.data).toBe('clipboard content')
  })

  it('returns error for adapter method failure', async () => {
    mockNotify.mockRejectedValue(new Error('osascript timed out'))

    const { daemon, sent } = makeDaemon()
    const actionPayload: OsActionPayload = {
      action: 'notify',
      args: { title: 'Test', body: 'Body' },
    }
    await daemon.handleMessage(createHandMessage(MSG.OS_ACTION, actionPayload))

    const result = sent[0].payload as OsResultPayload
    expect(result.success).toBe(false)
    expect(result.action).toBe('notify')
    expect(result.error).toContain('osascript timed out')
  })

  it('returns error for unknown OS action', async () => {
    const { daemon, sent } = makeDaemon()
    const actionPayload: OsActionPayload = {
      action: 'unknownAction' as any,
      args: {},
    }
    await daemon.handleMessage(createHandMessage(MSG.OS_ACTION, actionPayload))

    const result = sent[0].payload as OsResultPayload
    expect(result.success).toBe(false)
    expect(result.error).toContain('Unknown OS action')
  })

  it('reports osAutomation=true in capabilities when adapter is available', async () => {
    const { daemon } = makeDaemon()
    const caps = await daemon.buildCapabilities()
    expect(caps.capabilities.osAutomation).toBe(true)
  })

  it('replyTo links os:result back to original os:action', async () => {
    mockListRunningApps.mockResolvedValue([])

    const { daemon, sent } = makeDaemon()
    const actionMsg = createHandMessage(MSG.OS_ACTION, { action: 'listRunningApps', args: {} })
    await daemon.handleMessage(actionMsg)

    expect(sent[0].replyTo).toBe(actionMsg.id)
  })
})
```

- [ ] **Step 6: Run all tests**

```bash
cd ~/GitHub/eyas-hand && bun run test
```

---

## Task 6: App scanner — discover installed applications

**Files:**
- Create: `packages/core/src/discovery/app-scanner.ts`
- Create: `tests/core/app-scanner.test.ts`

- [ ] **Step 1: Create app-scanner.ts**

```typescript
// packages/core/src/discovery/app-scanner.ts

import { exec } from 'child_process'
import { promisify } from 'util'
import type { InstalledAppInfo } from '../os-adapter/types.js'

const execAsync = promisify(exec)
const SCAN_TIMEOUT = 30_000

/**
 * Scan for installed GUI applications on the current platform.
 * Returns a lightweight list (no plist parsing) using mdfind on macOS.
 */
export async function scanInstalledApps(): Promise<InstalledAppInfo[]> {
  switch (process.platform) {
    case 'darwin':
      return scanDarwinApps()
    case 'win32':
      return [] // Future: PowerShell Get-StartApps or registry scan
    case 'linux':
      return [] // Future: .desktop file scan in /usr/share/applications
    default:
      return []
  }
}

/**
 * macOS: Use `system_profiler SPApplicationsDataType -json` for a reliable
 * app inventory with bundle IDs and versions.
 * Falls back to simple mdfind+basename if system_profiler is slow or fails.
 */
async function scanDarwinApps(): Promise<InstalledAppInfo[]> {
  try {
    return await scanDarwinAppsViaSystemProfiler()
  } catch {
    return await scanDarwinAppsViaMdfind()
  }
}

async function scanDarwinAppsViaSystemProfiler(): Promise<InstalledAppInfo[]> {
  const { stdout } = await execAsync(
    'system_profiler SPApplicationsDataType -json',
    { timeout: SCAN_TIMEOUT, maxBuffer: 50 * 1024 * 1024 }
  )
  const data = JSON.parse(stdout)
  const items: any[] = data.SPApplicationsDataType ?? []
  const apps: InstalledAppInfo[] = []

  for (const item of items) {
    const bundleId = item.info ?? item._name ?? ''
    const name = item._name ?? ''
    const path = item.path ?? ''
    const version = item.version ?? undefined

    if (name && path) {
      apps.push({
        bundleId: bundleId || `unknown.${name.toLowerCase().replace(/\s+/g, '.')}`,
        name,
        path,
        version: version || undefined,
      })
    }
  }

  return apps
}

async function scanDarwinAppsViaMdfind(): Promise<InstalledAppInfo[]> {
  const { stdout } = await execAsync(
    'mdfind "kMDItemContentType == \'com.apple.application-bundle\'" | head -500',
    { timeout: SCAN_TIMEOUT, maxBuffer: 10 * 1024 * 1024 }
  )
  if (!stdout.trim()) return []

  const paths = stdout.trim().split('\n')
  return paths.map((p) => {
    const name = p.split('/').pop()?.replace('.app', '') || 'Unknown'
    return {
      bundleId: `unknown.${name.toLowerCase().replace(/\s+/g, '.')}`,
      name,
      path: p,
    }
  })
}

export { scanDarwinApps, scanDarwinAppsViaSystemProfiler, scanDarwinAppsViaMdfind }
```

- [ ] **Step 2: Add app scanner export to index.ts**

Add to `packages/core/src/index.ts`:

```typescript
// ADD after existing discovery exports
export { scanInstalledApps } from './discovery/app-scanner.js'
```

- [ ] **Step 3: Create app scanner tests**

```typescript
// tests/core/app-scanner.test.ts

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock child_process
const mockExec = vi.fn()
vi.mock('child_process', () => ({
  exec: (...args: any[]) => mockExec(...args),
}))

const { scanDarwinAppsViaMdfind, scanDarwinAppsViaSystemProfiler } = await import(
  '../../packages/core/src/discovery/app-scanner.js'
)

describe('app-scanner', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('scanDarwinAppsViaMdfind', () => {
    it('parses mdfind output into InstalledAppInfo array', async () => {
      mockExec.mockImplementation((_cmd: string, _opts: unknown, cb?: Function) => {
        const stdout = '/Applications/Safari.app\n/Applications/TextEdit.app\n'
        if (typeof _opts === 'function') {
          _opts(null, { stdout, stderr: '' })
        } else if (cb) {
          cb(null, { stdout, stderr: '' })
        }
        return { kill: vi.fn() }
      })

      const result = await scanDarwinAppsViaMdfind()
      expect(result).toHaveLength(2)
      expect(result[0].name).toBe('Safari')
      expect(result[0].path).toBe('/Applications/Safari.app')
      expect(result[1].name).toBe('TextEdit')
    })

    it('returns empty array when mdfind returns nothing', async () => {
      mockExec.mockImplementation((_cmd: string, _opts: unknown, cb?: Function) => {
        if (typeof _opts === 'function') {
          _opts(null, { stdout: '', stderr: '' })
        } else if (cb) {
          cb(null, { stdout: '', stderr: '' })
        }
        return { kill: vi.fn() }
      })

      const result = await scanDarwinAppsViaMdfind()
      expect(result).toEqual([])
    })
  })

  describe('scanDarwinAppsViaSystemProfiler', () => {
    it('parses system_profiler JSON output', async () => {
      const json = JSON.stringify({
        SPApplicationsDataType: [
          { _name: 'Safari', path: '/Applications/Safari.app', version: '17.4', info: 'com.apple.Safari' },
          { _name: 'Terminal', path: '/Applications/Utilities/Terminal.app', version: '2.14' },
        ],
      })
      mockExec.mockImplementation((_cmd: string, _opts: unknown, cb?: Function) => {
        if (typeof _opts === 'function') {
          _opts(null, { stdout: json, stderr: '' })
        } else if (cb) {
          cb(null, { stdout: json, stderr: '' })
        }
        return { kill: vi.fn() }
      })

      const result = await scanDarwinAppsViaSystemProfiler()
      expect(result).toHaveLength(2)
      expect(result[0].bundleId).toBe('com.apple.Safari')
      expect(result[0].name).toBe('Safari')
      expect(result[0].version).toBe('17.4')
      expect(result[1].name).toBe('Terminal')
    })

    it('handles empty response', async () => {
      mockExec.mockImplementation((_cmd: string, _opts: unknown, cb?: Function) => {
        if (typeof _opts === 'function') {
          _opts(null, { stdout: '{"SPApplicationsDataType":[]}', stderr: '' })
        } else if (cb) {
          cb(null, { stdout: '{"SPApplicationsDataType":[]}', stderr: '' })
        }
        return { kill: vi.fn() }
      })

      const result = await scanDarwinAppsViaSystemProfiler()
      expect(result).toEqual([])
    })
  })
})
```

- [ ] **Step 4: Run tests**

```bash
cd ~/GitHub/eyas-hand && bun run test -- tests/core/app-scanner.test.ts
```

---

## Task 7: Full test suite run + verify all tests pass

**Files:** None created — verification only.

- [ ] **Step 1: Run full test suite**

```bash
cd ~/GitHub/eyas-hand && bun run test
```

Expected test files (existing + new):
- `tests/protocol/messages.test.ts` (extended)
- `tests/core/config-loader.test.ts`
- `tests/core/command-executor.test.ts`
- `tests/core/permission-engine.test.ts`
- `tests/core/risk-classifier.test.ts`
- `tests/core/ws-client.test.ts`
- `tests/core/cli-scanner.test.ts`
- `tests/core/hand-daemon.test.ts`
- `tests/core/os-adapter-types.test.ts` (new)
- `tests/core/jxa-runner.test.ts` (new)
- `tests/core/darwin-adapter.test.ts` (new)
- `tests/core/os-adapter-factory.test.ts` (new)
- `tests/core/hand-daemon-os.test.ts` (new)
- `tests/core/app-scanner.test.ts` (new)
- `tests/integration/e2e-flow.test.ts`

- [ ] **Step 2: Verify no TypeScript errors**

```bash
cd ~/GitHub/eyas-hand && bunx tsc --noEmit
```

- [ ] **Step 3: Verify exports work**

```bash
cd ~/GitHub/eyas-hand && bun -e "
  const core = require('./packages/core/src/index.ts');
  console.log('Exports:', Object.keys(core).filter(k => k.includes('Os') || k.includes('Darwin') || k.includes('Adapter') || k.includes('scanInstalled')));
"
```

---

## Summary

| Task | Files | Tests | Description |
|------|-------|-------|-------------|
| 1 | 3 modified | 5 tests | Protocol os:action/os:result types |
| 2 | 1 created, 1 test | 6 tests | OsAdapter interface + error types |
| 3 | 2 created, 2 tests | ~20 tests | JXA runner + macOS adapter |
| 4 | 2 created | 0 (covered by factory) | Win32 + Linux stubs |
| 5 | 1 created, 2 modified, 2 tests | ~13 tests | Factory + daemon integration |
| 6 | 1 created, 1 test, 1 modified | 4 tests | App scanner |
| 7 | 0 | verification | Full suite green |

**Total new files:** 9 source + 6 test = 15 files
**Total modified files:** 4 (messages.ts, constants.ts, hand-daemon.ts, core/index.ts) + 1 test
**Estimated new tests:** ~48 tests

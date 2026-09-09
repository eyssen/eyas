# eYssen EYAS Hand — Phase 3 Implementation Plan: Computer Use

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable EYAS Hand to see the screen (via screenshots) and control it (mouse/keyboard input simulation). This is the "slow but universal" fallback for apps that don't have CLI or OS Automation support. macOS is the priority platform; Windows and Linux get stubs.

**Prerequisites:** Phase 1 (CLI execution) and Phase 2 (OS Automation with OsAdapter) are complete. The eyas-hand repo is at `~/GitHub/eyas-hand/`.

**Architecture:** Computer Use actions are always "red" tier — every action requires per-session approval. Screenshots are sent as base64 PNG. All external commands (`screencapture`, JXA `osascript`) run via `execFile` with timeout (never `exec` — no shell injection risk). The `ComputerUseAdapter` interface is platform-specific; a factory returns the correct adapter based on `process.platform`.

**Tech Stack:** TypeScript 5.9+, Bun, Vitest, Zod, nanoid

**Repo:** `~/GitHub/eyas-hand/`

---

## File Structure

### New files

```
packages/protocol/src/
  messages.ts                     — ADD: screen:capture, screen:image, input:mouse, input:keyboard message types + payloads

packages/core/src/computer-use/
  types.ts                        — ComputerUseAdapter interface, Point, Rect, action enums
  computer-use-factory.ts         — Factory returning platform-specific adapter
  darwin-computer-use.ts          — macOS: screencapture + JXA CGEvent
  win32-computer-use.ts           — Windows stub (throws UnsupportedPlatformError)
  linux-computer-use.ts           — Linux stub (throws UnsupportedPlatformError)
  session-guard.ts                — Per-session approval gate for Computer Use

tests/core/
  computer-use-types.test.ts      — Type/validation tests
  darwin-computer-use.test.ts     — macOS adapter tests (mocked execFile)
  session-guard.test.ts           — Session guard tests
  computer-use-factory.test.ts    — Factory tests
  computer-use-daemon.test.ts     — Daemon integration tests for screen/input messages
```

### Modified files

```
packages/core/src/hand-daemon.ts          — Add screen:capture, input:mouse, input:keyboard handlers
packages/core/src/index.ts                — Export computer-use modules
packages/core/src/permissions/risk-classifier.ts  — Computer Use actions always return 'red'
packages/protocol/src/messages.ts         — New message types and payload interfaces
```

---

## Task 1: Protocol types — screen/input message types and payloads

**Files:**
- Modify: `~/GitHub/eyas-hand/packages/protocol/src/messages.ts`
- Create: `~/GitHub/eyas-hand/tests/core/computer-use-types.test.ts`

- [ ] **Step 1: Add payload interfaces to messages.ts**

Add these interfaces after the existing `AuthResponsePayload` interface in `packages/protocol/src/messages.ts`:

```typescript
// --- Computer Use payloads ---

export interface ScreenCapturePayload {
  /** Optional region to capture. If omitted, captures full screen. */
  region?: { x: number; y: number; width: number; height: number }
  /** Optional window ID. If provided, captures only that window. */
  windowId?: number
}

export interface ScreenImagePayload {
  /** Base64-encoded PNG data */
  image: string
  /** Width in pixels */
  width: number
  /** Height in pixels */
  height: number
  /** Timestamp when screenshot was taken */
  capturedAt: number
}

export interface MouseActionPayload {
  action: 'move' | 'click' | 'doubleClick' | 'drag' | 'scroll'
  /** Target position for move/click/doubleClick */
  x?: number
  y?: number
  /** Mouse button for click/doubleClick */
  button?: 'left' | 'right' | 'middle'
  /** Drag origin (for drag action) */
  fromX?: number
  fromY?: number
  /** Drag destination (for drag action) */
  toX?: number
  toY?: number
  /** Scroll deltas (for scroll action) */
  deltaX?: number
  deltaY?: number
}

export interface KeyboardActionPayload {
  action: 'type' | 'press'
  /** Text to type (for 'type' action) */
  text?: string
  /** Key name (for 'press' action, e.g. 'Return', 'Tab', 'Escape') */
  key?: string
  /** Modifier keys held during press (e.g. ['command', 'shift']) */
  modifiers?: string[]
}

export interface InputResultPayload {
  success: boolean
  error?: string
  /** Cursor position after the action (if applicable) */
  cursorX?: number
  cursorY?: number
}

export interface ScreenInfoPayload {
  width: number
  height: number
  cursorX: number
  cursorY: number
}
```

- [ ] **Step 2: Add message type constants to MSG object**

Add these entries to the `MSG` constant in `packages/protocol/src/messages.ts`, after the `PONG` entry:

```typescript
  // Computer Use
  SCREEN_CAPTURE: 'screen:capture',
  SCREEN_IMAGE: 'screen:image',
  SCREEN_INFO: 'screen:info',
  SCREEN_INFO_RESULT: 'screen:info:result',
  INPUT_MOUSE: 'input:mouse',
  INPUT_KEYBOARD: 'input:keyboard',
  INPUT_RESULT: 'input:result',
```

- [ ] **Step 3: Add Zod validation schemas for payloads**

Add these Zod schemas after the `MSG` constant in `packages/protocol/src/messages.ts`:

```typescript
// --- Computer Use Zod schemas ---

export const ScreenCapturePayloadSchema = z.object({
  region: z.object({
    x: z.number().int().nonnegative(),
    y: z.number().int().nonnegative(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }).optional(),
  windowId: z.number().int().positive().optional(),
})

export const MouseActionPayloadSchema = z.object({
  action: z.enum(['move', 'click', 'doubleClick', 'drag', 'scroll']),
  x: z.number().nonnegative().optional(),
  y: z.number().nonnegative().optional(),
  button: z.enum(['left', 'right', 'middle']).optional(),
  fromX: z.number().nonnegative().optional(),
  fromY: z.number().nonnegative().optional(),
  toX: z.number().nonnegative().optional(),
  toY: z.number().nonnegative().optional(),
  deltaX: z.number().optional(),
  deltaY: z.number().optional(),
})

export const KeyboardActionPayloadSchema = z.object({
  action: z.enum(['type', 'press']),
  text: z.string().optional(),
  key: z.string().optional(),
  modifiers: z.array(z.string()).optional(),
})
```

- [ ] **Step 4: Write protocol type tests**

Create `tests/core/computer-use-types.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import {
  MSG,
  ScreenCapturePayloadSchema,
  MouseActionPayloadSchema,
  KeyboardActionPayloadSchema,
} from '@eyas/hand-protocol'

describe('Computer Use message types', () => {
  it('defines screen:capture message type', () => {
    expect(MSG.SCREEN_CAPTURE).toBe('screen:capture')
    expect(MSG.SCREEN_IMAGE).toBe('screen:image')
    expect(MSG.INPUT_MOUSE).toBe('input:mouse')
    expect(MSG.INPUT_KEYBOARD).toBe('input:keyboard')
    expect(MSG.INPUT_RESULT).toBe('input:result')
    expect(MSG.SCREEN_INFO).toBe('screen:info')
    expect(MSG.SCREEN_INFO_RESULT).toBe('screen:info:result')
  })
})

describe('ScreenCapturePayloadSchema', () => {
  it('accepts empty payload (full screen capture)', () => {
    const result = ScreenCapturePayloadSchema.parse({})
    expect(result.region).toBeUndefined()
    expect(result.windowId).toBeUndefined()
  })

  it('accepts region capture', () => {
    const result = ScreenCapturePayloadSchema.parse({
      region: { x: 0, y: 0, width: 800, height: 600 },
    })
    expect(result.region!.width).toBe(800)
  })

  it('accepts window capture', () => {
    const result = ScreenCapturePayloadSchema.parse({ windowId: 42 })
    expect(result.windowId).toBe(42)
  })

  it('rejects negative region dimensions', () => {
    expect(() =>
      ScreenCapturePayloadSchema.parse({
        region: { x: 0, y: 0, width: -1, height: 600 },
      })
    ).toThrow()
  })

  it('rejects zero width', () => {
    expect(() =>
      ScreenCapturePayloadSchema.parse({
        region: { x: 0, y: 0, width: 0, height: 600 },
      })
    ).toThrow()
  })
})

describe('MouseActionPayloadSchema', () => {
  it('accepts move action', () => {
    const result = MouseActionPayloadSchema.parse({ action: 'move', x: 100, y: 200 })
    expect(result.action).toBe('move')
    expect(result.x).toBe(100)
  })

  it('accepts click action with button', () => {
    const result = MouseActionPayloadSchema.parse({
      action: 'click',
      x: 50,
      y: 50,
      button: 'right',
    })
    expect(result.button).toBe('right')
  })

  it('accepts drag action', () => {
    const result = MouseActionPayloadSchema.parse({
      action: 'drag',
      fromX: 10,
      fromY: 20,
      toX: 300,
      toY: 400,
    })
    expect(result.fromX).toBe(10)
    expect(result.toX).toBe(300)
  })

  it('accepts scroll action with deltas', () => {
    const result = MouseActionPayloadSchema.parse({
      action: 'scroll',
      deltaX: 0,
      deltaY: -120,
    })
    expect(result.deltaY).toBe(-120)
  })

  it('rejects unknown action', () => {
    expect(() => MouseActionPayloadSchema.parse({ action: 'hover' })).toThrow()
  })

  it('rejects negative coordinates', () => {
    expect(() => MouseActionPayloadSchema.parse({ action: 'move', x: -1, y: 0 })).toThrow()
  })
})

describe('KeyboardActionPayloadSchema', () => {
  it('accepts type action', () => {
    const result = KeyboardActionPayloadSchema.parse({
      action: 'type',
      text: 'Hello World',
    })
    expect(result.text).toBe('Hello World')
  })

  it('accepts press action with modifiers', () => {
    const result = KeyboardActionPayloadSchema.parse({
      action: 'press',
      key: 'c',
      modifiers: ['command'],
    })
    expect(result.key).toBe('c')
    expect(result.modifiers).toEqual(['command'])
  })

  it('rejects unknown action', () => {
    expect(() => KeyboardActionPayloadSchema.parse({ action: 'hold' })).toThrow()
  })
})
```

- [ ] **Step 5: Run tests — verify all pass**

```bash
cd ~/GitHub/eyas-hand && bun test tests/core/computer-use-types.test.ts
```

---

## Task 2: ComputerUseAdapter types and interface

**Files:**
- Create: `~/GitHub/eyas-hand/packages/core/src/computer-use/types.ts`

- [ ] **Step 1: Create the types file**

Create `packages/core/src/computer-use/types.ts`:

```typescript
/**
 * Computer Use adapter types.
 * Platform-specific implementations provide screenshot capture and input simulation.
 * All Computer Use actions are "red" tier — require per-session approval.
 */

export interface Point {
  x: number
  y: number
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface ScreenSize {
  width: number
  height: number
}

export interface ScreenshotResult {
  /** Base64-encoded PNG */
  image: string
  width: number
  height: number
  capturedAt: number
}

/**
 * ComputerUseAdapter — platform-specific GUI interaction.
 *
 * Implementations:
 * - darwin: screencapture + JXA/CGEvent
 * - win32: stub (future)
 * - linux: stub (future)
 */
export interface ComputerUseAdapter {
  /** Check if the platform supports computer use */
  isSupported(): boolean

  /** Capture the entire screen or a region */
  captureScreen(region?: Rect): Promise<ScreenshotResult>

  /** Capture a specific window by its ID */
  captureWindow(windowId: number): Promise<ScreenshotResult>

  /** Get the screen dimensions */
  getScreenSize(): Promise<ScreenSize>

  /** Get the current cursor position */
  getCursorPosition(): Promise<Point>

  /** Move the mouse cursor to (x, y) */
  moveMouse(x: number, y: number): Promise<void>

  /** Click a mouse button at the current position */
  click(button?: 'left' | 'right' | 'middle'): Promise<void>

  /** Double-click at the current position */
  doubleClick(): Promise<void>

  /** Drag from one point to another */
  drag(from: Point, to: Point): Promise<void>

  /** Scroll by delta amounts */
  scroll(deltaX: number, deltaY: number): Promise<void>

  /** Type text (character by character) */
  typeText(text: string): Promise<void>

  /** Press a key with optional modifiers */
  pressKey(key: string, modifiers?: string[]): Promise<void>
}

export class UnsupportedPlatformError extends Error {
  constructor(platform: string) {
    super(`Computer Use is not supported on platform: ${platform}`)
    this.name = 'UnsupportedPlatformError'
  }
}

export class ComputerUseDisabledError extends Error {
  constructor() {
    super('Computer Use is disabled in configuration. Enable it in config.yaml under permissions.computer_use.enabled')
    this.name = 'ComputerUseDisabledError'
  }
}

export class SessionApprovalRequiredError extends Error {
  constructor() {
    super('Computer Use requires per-session approval. The user must approve this action.')
    this.name = 'SessionApprovalRequiredError'
  }
}
```

---

## Task 3: macOS screenshot adapter — captureScreen, captureWindow, getScreenSize

**Files:**
- Create: `~/GitHub/eyas-hand/packages/core/src/computer-use/darwin-computer-use.ts`
- Create: `~/GitHub/eyas-hand/tests/core/darwin-computer-use.test.ts`

- [ ] **Step 1: Create the macOS adapter**

Create `packages/core/src/computer-use/darwin-computer-use.ts`:

NOTE: This adapter uses `execFile` (not `exec`) throughout — `execFile` does not spawn a shell and is safe from shell injection. Arguments are passed as an array, never interpolated into a shell string.

```typescript
import { execFile as nodeExecFile } from 'node:child_process'
import { readFileSync, unlinkSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import type {
  ComputerUseAdapter,
  Point,
  Rect,
  ScreenSize,
  ScreenshotResult,
} from './types.js'
import { UnsupportedPlatformError } from './types.js'

/** Timeout for external commands in milliseconds */
const CMD_TIMEOUT_MS = 10_000

/** Max buffer for execFile output (50 MB — screenshots can be large) */
const MAX_BUFFER = 50 * 1024 * 1024

/** Generate a unique temp path for a screenshot */
function screenshotTmpPath(): string {
  const id = randomBytes(8).toString('hex')
  return join(tmpdir(), `eyas-screenshot-${id}.png`)
}

/**
 * Execute a command using execFile (no shell) and return stdout.
 * Rejects on non-zero exit or timeout.
 *
 * SECURITY: Uses execFile, not exec. Arguments are an array — no shell
 * interpolation, no injection risk.
 */
function runExecFile(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    nodeExecFile(cmd, args, { timeout: CMD_TIMEOUT_MS, maxBuffer: MAX_BUFFER }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(`Command failed: ${cmd} ${args.join(' ')}: ${stderr || err.message}`))
        return
      }
      resolve(stdout)
    })
  })
}

/** Run osascript -l JavaScript (JXA) and return stdout */
function jxa(script: string): Promise<string> {
  return runExecFile('osascript', ['-l', 'JavaScript', '-e', script])
}

/** Read a PNG file, return base64 string, then delete the file */
function readAndCleanup(path: string): string {
  try {
    const buffer = readFileSync(path)
    return buffer.toString('base64')
  } finally {
    try {
      if (existsSync(path)) unlinkSync(path)
    } catch {
      // Best effort cleanup
    }
  }
}

/** Parse image dimensions from a PNG header (first 24 bytes) */
function pngDimensions(base64: string): { width: number; height: number } {
  const buf = Buffer.from(base64, 'base64')
  // PNG: bytes 16-19 = width (big-endian), bytes 20-23 = height (big-endian)
  if (buf.length < 24) {
    return { width: 0, height: 0 }
  }
  const width = buf.readUInt32BE(16)
  const height = buf.readUInt32BE(20)
  return { width, height }
}

export class DarwinComputerUse implements ComputerUseAdapter {
  constructor() {
    if (process.platform !== 'darwin') {
      throw new UnsupportedPlatformError(process.platform)
    }
  }

  isSupported(): boolean {
    return process.platform === 'darwin'
  }

  async captureScreen(region?: Rect): Promise<ScreenshotResult> {
    const tmpPath = screenshotTmpPath()
    const args: string[] = ['-x', '-t', 'png']

    if (region) {
      // -R x,y,w,h — capture a region
      args.push('-R', `${region.x},${region.y},${region.width},${region.height}`)
    }

    args.push(tmpPath)
    await runExecFile('screencapture', args)

    const image = readAndCleanup(tmpPath)
    const dims = pngDimensions(image)
    return {
      image,
      width: dims.width,
      height: dims.height,
      capturedAt: Date.now(),
    }
  }

  async captureWindow(windowId: number): Promise<ScreenshotResult> {
    const tmpPath = screenshotTmpPath()
    // -l <windowId> — capture a specific window
    await runExecFile('screencapture', ['-x', '-t', 'png', '-l', String(windowId), tmpPath])

    const image = readAndCleanup(tmpPath)
    const dims = pngDimensions(image)
    return {
      image,
      width: dims.width,
      height: dims.height,
      capturedAt: Date.now(),
    }
  }

  async getScreenSize(): Promise<ScreenSize> {
    const script = `
      ObjC.import('AppKit');
      var screen = $.NSScreen.mainScreen;
      var frame = screen.frame;
      JSON.stringify({ width: frame.size.width, height: frame.size.height });
    `
    const output = await jxa(script)
    const parsed = JSON.parse(output.trim())
    return { width: Math.round(parsed.width), height: Math.round(parsed.height) }
  }

  async getCursorPosition(): Promise<Point> {
    const script = `
      ObjC.import('CoreGraphics');
      var event = $.CGEventCreate(null);
      var point = $.CGEventGetLocation(event);
      JSON.stringify({ x: point.x, y: point.y });
    `
    const output = await jxa(script)
    const parsed = JSON.parse(output.trim())
    return { x: Math.round(parsed.x), y: Math.round(parsed.y) }
  }

  async moveMouse(x: number, y: number): Promise<void> {
    const script = [
      "ObjC.import('CoreGraphics');",
      `var point = $.CGPointMake(${x}, ${y});`,
      'var event = $.CGEventCreateMouseEvent(null, $.kCGEventMouseMoved, point, 0);',
      '$.CGEventPost($.kCGHIDEventTap, event);',
    ].join('\n')
    await jxa(script)
  }

  async click(button: 'left' | 'right' | 'middle' = 'left'): Promise<void> {
    const pos = await this.getCursorPosition()
    const { downType, upType, cgButton } = mouseButtonConstants(button)
    const script = [
      "ObjC.import('CoreGraphics');",
      `var point = $.CGPointMake(${pos.x}, ${pos.y});`,
      `var down = $.CGEventCreateMouseEvent(null, ${downType}, point, ${cgButton});`,
      `var up = $.CGEventCreateMouseEvent(null, ${upType}, point, ${cgButton});`,
      '$.CGEventPost($.kCGHIDEventTap, down);',
      '$.CGEventPost($.kCGHIDEventTap, up);',
    ].join('\n')
    await jxa(script)
  }

  async doubleClick(): Promise<void> {
    const pos = await this.getCursorPosition()
    const script = [
      "ObjC.import('CoreGraphics');",
      `var point = $.CGPointMake(${pos.x}, ${pos.y});`,
      'var down1 = $.CGEventCreateMouseEvent(null, $.kCGEventLeftMouseDown, point, 0);',
      'var up1 = $.CGEventCreateMouseEvent(null, $.kCGEventLeftMouseUp, point, 0);',
      'var down2 = $.CGEventCreateMouseEvent(null, $.kCGEventLeftMouseDown, point, 0);',
      'var up2 = $.CGEventCreateMouseEvent(null, $.kCGEventLeftMouseUp, point, 0);',
      '$.CGEventSetIntegerValueField(down2, $.kCGMouseEventClickState, 2);',
      '$.CGEventSetIntegerValueField(up2, $.kCGMouseEventClickState, 2);',
      '$.CGEventPost($.kCGHIDEventTap, down1);',
      '$.CGEventPost($.kCGHIDEventTap, up1);',
      '$.CGEventPost($.kCGHIDEventTap, down2);',
      '$.CGEventPost($.kCGHIDEventTap, up2);',
    ].join('\n')
    await jxa(script)
  }

  async drag(from: Point, to: Point): Promise<void> {
    const script = [
      "ObjC.import('CoreGraphics');",
      `var fromPoint = $.CGPointMake(${from.x}, ${from.y});`,
      `var toPoint = $.CGPointMake(${to.x}, ${to.y});`,
      'var down = $.CGEventCreateMouseEvent(null, $.kCGEventLeftMouseDown, fromPoint, 0);',
      'var dragged = $.CGEventCreateMouseEvent(null, $.kCGEventLeftMouseDragged, toPoint, 0);',
      'var up = $.CGEventCreateMouseEvent(null, $.kCGEventLeftMouseUp, toPoint, 0);',
      '$.CGEventPost($.kCGHIDEventTap, down);',
      'delay(0.05);',
      '$.CGEventPost($.kCGHIDEventTap, dragged);',
      'delay(0.05);',
      '$.CGEventPost($.kCGHIDEventTap, up);',
    ].join('\n')
    await jxa(script)
  }

  async scroll(deltaX: number, deltaY: number): Promise<void> {
    const script = [
      "ObjC.import('CoreGraphics');",
      `var event = $.CGEventCreateScrollWheelEvent(null, $.kCGScrollEventUnitPixel, 2, ${Math.round(deltaY)}, ${Math.round(deltaX)});`,
      '$.CGEventPost($.kCGHIDEventTap, event);',
    ].join('\n')
    await jxa(script)
  }

  async typeText(text: string): Promise<void> {
    // Use System Events for typing — handles all characters correctly
    // Escape double quotes and backslashes for AppleScript string
    const escaped = text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
    await runExecFile('osascript', [
      '-e',
      `tell application "System Events" to keystroke "${escaped}"`,
    ])
  }

  async pressKey(key: string, modifiers: string[] = []): Promise<void> {
    const keyCode = KEY_CODE_MAP[key.toLowerCase()]
    if (keyCode === undefined) {
      // Fallback: use keystroke for single characters
      if (key.length === 1) {
        const modClause = modifiers.length > 0
          ? ` using {${modifiers.map(m => `${m} down`).join(', ')}}`
          : ''
        await runExecFile('osascript', [
          '-e',
          `tell application "System Events" to keystroke "${key}"${modClause}`,
        ])
        return
      }
      throw new Error(`Unknown key: ${key}. Use a single character or a named key (Return, Tab, Escape, etc.)`)
    }

    const modClause = modifiers.length > 0
      ? ` using {${modifiers.map(m => `${m} down`).join(', ')}}`
      : ''
    await runExecFile('osascript', [
      '-e',
      `tell application "System Events" to key code ${keyCode}${modClause}`,
    ])
  }
}

// --- Helpers ---

function mouseButtonConstants(button: 'left' | 'right' | 'middle'): {
  downType: string
  upType: string
  cgButton: number
} {
  switch (button) {
    case 'left':
      return { downType: '$.kCGEventLeftMouseDown', upType: '$.kCGEventLeftMouseUp', cgButton: 0 }
    case 'right':
      return { downType: '$.kCGEventRightMouseDown', upType: '$.kCGEventRightMouseUp', cgButton: 1 }
    case 'middle':
      return { downType: '$.kCGEventOtherMouseDown', upType: '$.kCGEventOtherMouseUp', cgButton: 2 }
  }
}

/**
 * macOS virtual key codes for common keys.
 * Reference: Carbon HIToolbox/Events.h
 */
const KEY_CODE_MAP: Record<string, number> = {
  return: 36,
  enter: 36,
  tab: 48,
  space: 49,
  delete: 51,
  backspace: 51,
  escape: 53,
  esc: 53,
  command: 55,
  shift: 56,
  capslock: 57,
  option: 58,
  alt: 58,
  control: 59,
  ctrl: 59,
  rightshift: 60,
  rightoption: 61,
  rightcontrol: 62,
  fn: 63,
  f1: 122,
  f2: 120,
  f3: 99,
  f4: 118,
  f5: 96,
  f6: 97,
  f7: 98,
  f8: 100,
  f9: 101,
  f10: 109,
  f11: 103,
  f12: 111,
  home: 115,
  end: 119,
  pageup: 116,
  pagedown: 121,
  left: 123,
  right: 124,
  down: 125,
  up: 126,
  forwarddelete: 117,
}
```

- [ ] **Step 2: Write macOS adapter tests**

Create `tests/core/darwin-computer-use.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterAll, type Mock } from 'vitest'

// Mock node:child_process and node:fs before importing the module
vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}))

vi.mock('node:fs', () => ({
  readFileSync: vi.fn(),
  unlinkSync: vi.fn(),
  existsSync: vi.fn(),
}))

import { execFile } from 'node:child_process'
import { readFileSync, unlinkSync, existsSync } from 'node:fs'

const originalPlatform = process.platform

describe('DarwinComputerUse', () => {
  let DarwinComputerUse: any

  beforeEach(async () => {
    vi.resetModules()
    vi.resetAllMocks()

    // Ensure platform is darwin for tests
    Object.defineProperty(process, 'platform', { value: 'darwin', writable: true })

    // Re-import after mocks
    const mod = await import('@eyas/hand-core/computer-use/darwin-computer-use.js')
    DarwinComputerUse = mod.DarwinComputerUse
  })

  afterAll(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform, writable: true })
  })

  /** Helper: make execFile call the callback with given stdout */
  function mockExecFileSuccess(stdout = '', stderr = '') {
    ;(execFile as unknown as Mock).mockImplementation(
      (_cmd: string, _args: string[], _opts: any, cb: Function) => {
        cb(null, stdout, stderr)
      }
    )
  }

  /** Helper: make readFileSync return a minimal PNG buffer */
  function mockPngFile() {
    // Minimal PNG header with IHDR: width=1920, height=1080
    const buf = Buffer.alloc(33)
    buf.writeUInt32BE(0x89504e47, 0) // PNG magic
    buf.writeUInt32BE(0x0d0a1a0a, 4)
    buf.writeUInt32BE(13, 8)          // IHDR chunk length
    buf.write('IHDR', 12)
    buf.writeUInt32BE(1920, 16)       // width
    buf.writeUInt32BE(1080, 20)       // height
    ;(readFileSync as Mock).mockReturnValue(buf)
    ;(existsSync as Mock).mockReturnValue(true)
    ;(unlinkSync as Mock).mockImplementation(() => {})
  }

  it('constructs on darwin', () => {
    const adapter = new DarwinComputerUse()
    expect(adapter.isSupported()).toBe(true)
  })

  it('throws on non-darwin platform', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux', writable: true })
    vi.resetModules()
    const mod = await import('@eyas/hand-core/computer-use/darwin-computer-use.js')
    expect(() => new mod.DarwinComputerUse()).toThrow('not supported on platform: linux')
    Object.defineProperty(process, 'platform', { value: 'darwin', writable: true })
  })

  describe('captureScreen', () => {
    it('captures full screen', async () => {
      mockExecFileSuccess()
      mockPngFile()

      const adapter = new DarwinComputerUse()
      const result = await adapter.captureScreen()

      expect(execFile).toHaveBeenCalledWith(
        'screencapture',
        expect.arrayContaining(['-x', '-t', 'png']),
        expect.any(Object),
        expect.any(Function),
      )
      expect(result.width).toBe(1920)
      expect(result.height).toBe(1080)
      expect(result.image).toBeTruthy()
      expect(typeof result.capturedAt).toBe('number')
    })

    it('captures a region', async () => {
      mockExecFileSuccess()
      mockPngFile()

      const adapter = new DarwinComputerUse()
      await adapter.captureScreen({ x: 100, y: 200, width: 400, height: 300 })

      expect(execFile).toHaveBeenCalledWith(
        'screencapture',
        expect.arrayContaining(['-R', '100,200,400,300']),
        expect.any(Object),
        expect.any(Function),
      )
    })

    it('cleans up temp file after reading', async () => {
      mockExecFileSuccess()
      mockPngFile()

      const adapter = new DarwinComputerUse()
      await adapter.captureScreen()

      expect(unlinkSync).toHaveBeenCalled()
    })
  })

  describe('captureWindow', () => {
    it('passes window ID to screencapture', async () => {
      mockExecFileSuccess()
      mockPngFile()

      const adapter = new DarwinComputerUse()
      await adapter.captureWindow(12345)

      expect(execFile).toHaveBeenCalledWith(
        'screencapture',
        expect.arrayContaining(['-l', '12345']),
        expect.any(Object),
        expect.any(Function),
      )
    })
  })

  describe('getScreenSize', () => {
    it('parses JXA output', async () => {
      mockExecFileSuccess('{"width":2560,"height":1440}\n')

      const adapter = new DarwinComputerUse()
      const size = await adapter.getScreenSize()

      expect(size.width).toBe(2560)
      expect(size.height).toBe(1440)
    })
  })

  describe('getCursorPosition', () => {
    it('parses JXA output', async () => {
      mockExecFileSuccess('{"x":512,"y":384}\n')

      const adapter = new DarwinComputerUse()
      const pos = await adapter.getCursorPosition()

      expect(pos.x).toBe(512)
      expect(pos.y).toBe(384)
    })
  })

  describe('moveMouse', () => {
    it('calls JXA with CGEvent', async () => {
      mockExecFileSuccess()

      const adapter = new DarwinComputerUse()
      await adapter.moveMouse(100, 200)

      expect(execFile).toHaveBeenCalledWith(
        'osascript',
        expect.arrayContaining([
          '-l', 'JavaScript', '-e',
          expect.stringContaining('CGPointMake(100, 200)'),
        ]),
        expect.any(Object),
        expect.any(Function),
      )
    })
  })

  describe('click', () => {
    it('performs left click by default', async () => {
      // First call = getCursorPosition, second = click
      let callCount = 0
      ;(execFile as unknown as Mock).mockImplementation(
        (_cmd: string, _args: string[], _opts: any, cb: Function) => {
          callCount++
          if (callCount === 1) {
            cb(null, '{"x":50,"y":60}\n', '')
          } else {
            cb(null, '', '')
          }
        }
      )

      const adapter = new DarwinComputerUse()
      await adapter.click()

      // Second call should contain LeftMouseDown
      const secondCall = (execFile as unknown as Mock).mock.calls[1]
      const script = secondCall[1][secondCall[1].indexOf('-e') + 1]
      expect(script).toContain('kCGEventLeftMouseDown')
    })
  })

  describe('typeText', () => {
    it('uses System Events keystroke', async () => {
      mockExecFileSuccess()

      const adapter = new DarwinComputerUse()
      await adapter.typeText('Hello')

      expect(execFile).toHaveBeenCalledWith(
        'osascript',
        ['-e', 'tell application "System Events" to keystroke "Hello"'],
        expect.any(Object),
        expect.any(Function),
      )
    })

    it('escapes double quotes in text', async () => {
      mockExecFileSuccess()

      const adapter = new DarwinComputerUse()
      await adapter.typeText('say "hello"')

      expect(execFile).toHaveBeenCalledWith(
        'osascript',
        ['-e', 'tell application "System Events" to keystroke "say \\"hello\\""'],
        expect.any(Object),
        expect.any(Function),
      )
    })
  })

  describe('pressKey', () => {
    it('presses Return key', async () => {
      mockExecFileSuccess()

      const adapter = new DarwinComputerUse()
      await adapter.pressKey('Return')

      expect(execFile).toHaveBeenCalledWith(
        'osascript',
        ['-e', 'tell application "System Events" to key code 36'],
        expect.any(Object),
        expect.any(Function),
      )
    })

    it('presses key with modifiers', async () => {
      mockExecFileSuccess()

      const adapter = new DarwinComputerUse()
      await adapter.pressKey('c', ['command'])

      // Single char falls through to keystroke path
      expect(execFile).toHaveBeenCalledWith(
        'osascript',
        ['-e', 'tell application "System Events" to keystroke "c" using {command down}'],
        expect.any(Object),
        expect.any(Function),
      )
    })

    it('throws for unknown multi-char key', async () => {
      const adapter = new DarwinComputerUse()
      await expect(adapter.pressKey('unknownKey')).rejects.toThrow('Unknown key')
    })
  })

  describe('scroll', () => {
    it('calls CGEventCreateScrollWheelEvent', async () => {
      mockExecFileSuccess()

      const adapter = new DarwinComputerUse()
      await adapter.scroll(0, -120)

      expect(execFile).toHaveBeenCalledWith(
        'osascript',
        expect.arrayContaining(['-e', expect.stringContaining('CGEventCreateScrollWheelEvent')]),
        expect.any(Object),
        expect.any(Function),
      )
    })
  })

  describe('drag', () => {
    it('posts mouse down, dragged, and up events', async () => {
      mockExecFileSuccess()

      const adapter = new DarwinComputerUse()
      await adapter.drag({ x: 10, y: 20 }, { x: 300, y: 400 })

      const call = (execFile as unknown as Mock).mock.calls[0]
      const script = call[1][call[1].indexOf('-e') + 1]
      expect(script).toContain('kCGEventLeftMouseDown')
      expect(script).toContain('kCGEventLeftMouseDragged')
      expect(script).toContain('kCGEventLeftMouseUp')
      expect(script).toContain('CGPointMake(10, 20)')
      expect(script).toContain('CGPointMake(300, 400)')
    })
  })
})
```

- [ ] **Step 3: Run tests — verify all pass**

```bash
cd ~/GitHub/eyas-hand && bun test tests/core/darwin-computer-use.test.ts
```

---

## Task 4: Platform stubs + factory

**Files:**
- Create: `~/GitHub/eyas-hand/packages/core/src/computer-use/win32-computer-use.ts`
- Create: `~/GitHub/eyas-hand/packages/core/src/computer-use/linux-computer-use.ts`
- Create: `~/GitHub/eyas-hand/packages/core/src/computer-use/computer-use-factory.ts`
- Create: `~/GitHub/eyas-hand/tests/core/computer-use-factory.test.ts`

- [ ] **Step 1: Create Windows stub**

Create `packages/core/src/computer-use/win32-computer-use.ts`:

```typescript
import type {
  ComputerUseAdapter,
  Point,
  Rect,
  ScreenSize,
  ScreenshotResult,
} from './types.js'
import { UnsupportedPlatformError } from './types.js'

/**
 * Windows Computer Use stub — not yet implemented.
 * All methods throw UnsupportedPlatformError.
 */
export class Win32ComputerUse implements ComputerUseAdapter {
  isSupported(): boolean {
    return false
  }

  captureScreen(_region?: Rect): Promise<ScreenshotResult> {
    throw new UnsupportedPlatformError('win32')
  }

  captureWindow(_windowId: number): Promise<ScreenshotResult> {
    throw new UnsupportedPlatformError('win32')
  }

  getScreenSize(): Promise<ScreenSize> {
    throw new UnsupportedPlatformError('win32')
  }

  getCursorPosition(): Promise<Point> {
    throw new UnsupportedPlatformError('win32')
  }

  moveMouse(_x: number, _y: number): Promise<void> {
    throw new UnsupportedPlatformError('win32')
  }

  click(_button?: 'left' | 'right' | 'middle'): Promise<void> {
    throw new UnsupportedPlatformError('win32')
  }

  doubleClick(): Promise<void> {
    throw new UnsupportedPlatformError('win32')
  }

  drag(_from: Point, _to: Point): Promise<void> {
    throw new UnsupportedPlatformError('win32')
  }

  scroll(_deltaX: number, _deltaY: number): Promise<void> {
    throw new UnsupportedPlatformError('win32')
  }

  typeText(_text: string): Promise<void> {
    throw new UnsupportedPlatformError('win32')
  }

  pressKey(_key: string, _modifiers?: string[]): Promise<void> {
    throw new UnsupportedPlatformError('win32')
  }
}
```

- [ ] **Step 2: Create Linux stub**

Create `packages/core/src/computer-use/linux-computer-use.ts`:

```typescript
import type {
  ComputerUseAdapter,
  Point,
  Rect,
  ScreenSize,
  ScreenshotResult,
} from './types.js'
import { UnsupportedPlatformError } from './types.js'

/**
 * Linux Computer Use stub — not yet implemented.
 * All methods throw UnsupportedPlatformError.
 */
export class LinuxComputerUse implements ComputerUseAdapter {
  isSupported(): boolean {
    return false
  }

  captureScreen(_region?: Rect): Promise<ScreenshotResult> {
    throw new UnsupportedPlatformError('linux')
  }

  captureWindow(_windowId: number): Promise<ScreenshotResult> {
    throw new UnsupportedPlatformError('linux')
  }

  getScreenSize(): Promise<ScreenSize> {
    throw new UnsupportedPlatformError('linux')
  }

  getCursorPosition(): Promise<Point> {
    throw new UnsupportedPlatformError('linux')
  }

  moveMouse(_x: number, _y: number): Promise<void> {
    throw new UnsupportedPlatformError('linux')
  }

  click(_button?: 'left' | 'right' | 'middle'): Promise<void> {
    throw new UnsupportedPlatformError('linux')
  }

  doubleClick(): Promise<void> {
    throw new UnsupportedPlatformError('linux')
  }

  drag(_from: Point, _to: Point): Promise<void> {
    throw new UnsupportedPlatformError('linux')
  }

  scroll(_deltaX: number, _deltaY: number): Promise<void> {
    throw new UnsupportedPlatformError('linux')
  }

  typeText(_text: string): Promise<void> {
    throw new UnsupportedPlatformError('linux')
  }

  pressKey(_key: string, _modifiers?: string[]): Promise<void> {
    throw new UnsupportedPlatformError('linux')
  }
}
```

- [ ] **Step 3: Create the factory**

Create `packages/core/src/computer-use/computer-use-factory.ts`:

```typescript
import type { ComputerUseAdapter } from './types.js'
import { UnsupportedPlatformError, ComputerUseDisabledError } from './types.js'
import type { HandConfig } from '../config/config-schema.js'

/**
 * Factory that returns the platform-specific ComputerUseAdapter.
 * Throws if computer use is disabled in config or the platform is unsupported.
 *
 * Lazy-imports the platform module to avoid loading native code on other platforms.
 */
export async function createComputerUseAdapter(config: HandConfig): Promise<ComputerUseAdapter> {
  if (!config.permissions.computerUse.enabled) {
    throw new ComputerUseDisabledError()
  }

  switch (process.platform) {
    case 'darwin': {
      const { DarwinComputerUse } = await import('./darwin-computer-use.js')
      return new DarwinComputerUse()
    }
    case 'win32': {
      const { Win32ComputerUse } = await import('./win32-computer-use.js')
      return new Win32ComputerUse()
    }
    case 'linux': {
      const { LinuxComputerUse } = await import('./linux-computer-use.js')
      return new LinuxComputerUse()
    }
    default:
      throw new UnsupportedPlatformError(process.platform)
  }
}
```

- [ ] **Step 4: Write factory tests**

Create `tests/core/computer-use-factory.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { HandConfig } from '@eyas/hand-core'
import { getDefaultConfig } from '@eyas/hand-core'

function makeConfig(computerUseEnabled: boolean): HandConfig {
  const config = getDefaultConfig()
  return {
    ...config,
    permissions: {
      ...config.permissions,
      computerUse: { enabled: computerUseEnabled },
    },
  }
}

describe('createComputerUseAdapter', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('throws ComputerUseDisabledError when disabled in config', async () => {
    const { createComputerUseAdapter } = await import(
      '@eyas/hand-core/computer-use/computer-use-factory.js'
    )
    await expect(createComputerUseAdapter(makeConfig(false))).rejects.toThrow(
      'Computer Use is disabled in configuration'
    )
  })

  it('returns DarwinComputerUse on macOS when enabled', async () => {
    // This test only runs on macOS
    if (process.platform !== 'darwin') return

    const { createComputerUseAdapter } = await import(
      '@eyas/hand-core/computer-use/computer-use-factory.js'
    )
    const adapter = await createComputerUseAdapter(makeConfig(true))
    expect(adapter.isSupported()).toBe(true)
  })

  it('returns an adapter that reports unsupported for stubs', async () => {
    const { Win32ComputerUse } = await import(
      '@eyas/hand-core/computer-use/win32-computer-use.js'
    )
    const { LinuxComputerUse } = await import(
      '@eyas/hand-core/computer-use/linux-computer-use.js'
    )

    const win = new Win32ComputerUse()
    expect(win.isSupported()).toBe(false)
    expect(() => win.captureScreen()).toThrow('not supported on platform: win32')

    const linux = new LinuxComputerUse()
    expect(linux.isSupported()).toBe(false)
    expect(() => linux.captureScreen()).toThrow('not supported on platform: linux')
  })
})
```

- [ ] **Step 5: Run tests — verify all pass**

```bash
cd ~/GitHub/eyas-hand && bun test tests/core/computer-use-factory.test.ts
```

---

## Task 5: Session guard + risk classifier update + daemon integration

**Files:**
- Create: `~/GitHub/eyas-hand/packages/core/src/computer-use/session-guard.ts`
- Modify: `~/GitHub/eyas-hand/packages/core/src/permissions/risk-classifier.ts`
- Modify: `~/GitHub/eyas-hand/packages/core/src/hand-daemon.ts`
- Modify: `~/GitHub/eyas-hand/packages/core/src/index.ts`
- Create: `~/GitHub/eyas-hand/tests/core/session-guard.test.ts`
- Create: `~/GitHub/eyas-hand/tests/core/computer-use-daemon.test.ts`

- [ ] **Step 1: Create session guard**

Create `packages/core/src/computer-use/session-guard.ts`:

```typescript
/**
 * Session guard for Computer Use.
 * Computer Use is always "red" tier — requires explicit per-session approval.
 * Once approved for a session, it stays approved until reset.
 */

export class SessionGuard {
  private _approved = false
  private _approvedAt: number | null = null
  private _sessionId: string | null = null

  /** Whether Computer Use has been approved for the current session */
  get isApproved(): boolean {
    return this._approved
  }

  /** When the approval was granted (epoch ms), or null if not approved */
  get approvedAt(): number | null {
    return this._approvedAt
  }

  /** The session ID this approval was granted for */
  get sessionId(): string | null {
    return this._sessionId
  }

  /**
   * Grant Computer Use approval for this session.
   * @param sessionId — opaque identifier linking approval to a specific session
   */
  approve(sessionId: string): void {
    this._approved = true
    this._approvedAt = Date.now()
    this._sessionId = sessionId
  }

  /**
   * Revoke Computer Use approval (e.g. session ended, user revoked).
   */
  revoke(): void {
    this._approved = false
    this._approvedAt = null
    this._sessionId = null
  }

  /**
   * Check if a Computer Use action is allowed.
   * Returns { allowed: true } if session is approved, otherwise { allowed: false, reason }.
   */
  check(): { allowed: boolean; reason?: string } {
    if (!this._approved) {
      return {
        allowed: false,
        reason: 'Computer Use requires per-session approval. Send an approval:response to grant access.',
      }
    }
    return { allowed: true }
  }
}
```

- [ ] **Step 2: Add computer use classification to risk-classifier.ts**

Add this function to the end of `packages/core/src/permissions/risk-classifier.ts`, before the closing of the file:

```typescript
/**
 * Computer Use actions are ALWAYS red tier.
 * They require per-session approval regardless of configuration.
 */
export function classifyComputerUseAction(
  _action: string,
  config: HandConfig
): RiskTier {
  if (!config.permissions.computerUse.enabled) {
    return 'black'
  }
  return 'red'
}
```

- [ ] **Step 3: Update hand-daemon.ts — add imports**

Add these imports to the top of `packages/core/src/hand-daemon.ts`, after the existing imports:

```typescript
import type {
  ScreenCapturePayload,
  ScreenImagePayload,
  MouseActionPayload,
  KeyboardActionPayload,
  InputResultPayload,
  ScreenInfoPayload,
} from '@eyas/hand-protocol'
import { SessionGuard } from './computer-use/session-guard.js'
import { createComputerUseAdapter } from './computer-use/computer-use-factory.js'
import type { ComputerUseAdapter } from './computer-use/types.js'
import { classifyComputerUseAction } from './permissions/risk-classifier.js'
```

- [ ] **Step 4: Add computer use fields to HandDaemon class**

Add these fields after `private sendFn`:

```typescript
  private sessionGuard = new SessionGuard()
  private computerUseAdapter: ComputerUseAdapter | null = null
```

- [ ] **Step 5: Update buildCapabilities to report computerUse support**

Replace the `buildCapabilities` method body so the `computerUse` capability is dynamic:

```typescript
  async buildCapabilities(): Promise<HandCapabilities> {
    const tools = await scanCliTools()
    const computerUseSupported =
      this.config.permissions.computerUse.enabled && process.platform === 'darwin'
    return {
      handId: this.handId,
      name: this.config.hand.name || this.handId,
      platform: process.platform as 'darwin' | 'win32' | 'linux',
      arch: process.arch as 'x64' | 'arm64',
      osVersion: os.release(),
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {
        cli: true,
        osAutomation: false,
        computerUse: computerUseSupported,
      },
      discoveredTools: tools,
    }
  }
```

- [ ] **Step 6: Add message handlers to the switch in handleMessage**

Add these cases to the `switch` block in `handleMessage`, before the `default:` case:

```typescript
      case MSG.SCREEN_CAPTURE:
        await this.handleScreenCapture(msg)
        break
      case MSG.SCREEN_INFO:
        await this.handleScreenInfo(msg)
        break
      case MSG.INPUT_MOUSE:
        await this.handleInputMouse(msg)
        break
      case MSG.INPUT_KEYBOARD:
        await this.handleInputKeyboard(msg)
        break
```

- [ ] **Step 7: Add Computer Use helper methods to HandDaemon**

Add these methods to the `HandDaemon` class, after `handleApprovalResponse`:

```typescript
  // --- Computer Use helpers ---

  private async getOrCreateAdapter(): Promise<ComputerUseAdapter | null> {
    if (this.computerUseAdapter) return this.computerUseAdapter

    try {
      this.computerUseAdapter = await createComputerUseAdapter(this.config)
      return this.computerUseAdapter
    } catch {
      return null
    }
  }

  private sendComputerUseBlocked(msg: HandMessage, reason: string): void {
    const result: InputResultPayload = { success: false, error: reason }
    this.sendFn(createHandMessage(MSG.INPUT_RESULT, result, msg.id))
  }

  private async ensureComputerUseAllowed(msg: HandMessage): Promise<ComputerUseAdapter | null> {
    const tier = classifyComputerUseAction('computer-use', this.config)

    if (tier === 'black') {
      this.sendComputerUseBlocked(msg, 'Computer Use is disabled in configuration')
      return null
    }

    // Computer Use is always red — check session guard
    const guardCheck = this.sessionGuard.check()
    if (!guardCheck.allowed) {
      // Request approval from EYAS
      const approvalPayload: ApprovalRequestPayload = {
        action: `computer-use:${msg.type}`,
        description: `Computer Use action: ${msg.type}. This grants GUI control for this session.`,
        riskTier: 'red',
      }
      const approvalMsg = createHandMessage(MSG.APPROVAL_REQUEST, approvalPayload, msg.id)
      this.pendingApprovals.set(approvalMsg.id, { originalMessage: msg })
      this.sendFn(approvalMsg)
      return null
    }

    const adapter = await this.getOrCreateAdapter()
    if (!adapter) {
      this.sendComputerUseBlocked(msg, 'Computer Use adapter is not available on this platform')
      return null
    }

    return adapter
  }
```

- [ ] **Step 8: Add Computer Use handler methods to HandDaemon**

Add these methods after the helper methods:

```typescript
  // --- Computer Use handlers ---

  private async handleScreenCapture(msg: HandMessage): Promise<void> {
    const adapter = await this.ensureComputerUseAllowed(msg)
    if (!adapter) return

    const payload = msg.payload as ScreenCapturePayload

    try {
      let result
      if (payload.windowId) {
        result = await adapter.captureWindow(payload.windowId)
      } else {
        result = await adapter.captureScreen(payload.region ?? undefined)
      }

      const imagePayload: ScreenImagePayload = {
        image: result.image,
        width: result.width,
        height: result.height,
        capturedAt: result.capturedAt,
      }
      this.sendFn(createHandMessage(MSG.SCREEN_IMAGE, imagePayload, msg.id))
    } catch (err) {
      this.sendComputerUseBlocked(msg, `Screenshot failed: ${String(err)}`)
    }
  }

  private async handleScreenInfo(msg: HandMessage): Promise<void> {
    const adapter = await this.ensureComputerUseAllowed(msg)
    if (!adapter) return

    try {
      const size = await adapter.getScreenSize()
      const cursor = await adapter.getCursorPosition()

      const infoPayload: ScreenInfoPayload = {
        width: size.width,
        height: size.height,
        cursorX: cursor.x,
        cursorY: cursor.y,
      }
      this.sendFn(createHandMessage(MSG.SCREEN_INFO_RESULT, infoPayload, msg.id))
    } catch (err) {
      this.sendComputerUseBlocked(msg, `Screen info failed: ${String(err)}`)
    }
  }

  private async handleInputMouse(msg: HandMessage): Promise<void> {
    const adapter = await this.ensureComputerUseAllowed(msg)
    if (!adapter) return

    const payload = msg.payload as MouseActionPayload

    try {
      switch (payload.action) {
        case 'move':
          await adapter.moveMouse(payload.x ?? 0, payload.y ?? 0)
          break
        case 'click':
          if (payload.x !== undefined && payload.y !== undefined) {
            await adapter.moveMouse(payload.x, payload.y)
          }
          await adapter.click(payload.button ?? 'left')
          break
        case 'doubleClick':
          if (payload.x !== undefined && payload.y !== undefined) {
            await adapter.moveMouse(payload.x, payload.y)
          }
          await adapter.doubleClick()
          break
        case 'drag':
          await adapter.drag(
            { x: payload.fromX ?? 0, y: payload.fromY ?? 0 },
            { x: payload.toX ?? 0, y: payload.toY ?? 0 }
          )
          break
        case 'scroll':
          await adapter.scroll(payload.deltaX ?? 0, payload.deltaY ?? 0)
          break
      }

      const cursor = await adapter.getCursorPosition()
      const result: InputResultPayload = {
        success: true,
        cursorX: cursor.x,
        cursorY: cursor.y,
      }
      this.sendFn(createHandMessage(MSG.INPUT_RESULT, result, msg.id))
    } catch (err) {
      this.sendComputerUseBlocked(msg, `Mouse action failed: ${String(err)}`)
    }
  }

  private async handleInputKeyboard(msg: HandMessage): Promise<void> {
    const adapter = await this.ensureComputerUseAllowed(msg)
    if (!adapter) return

    const payload = msg.payload as KeyboardActionPayload

    try {
      switch (payload.action) {
        case 'type':
          await adapter.typeText(payload.text ?? '')
          break
        case 'press':
          await adapter.pressKey(payload.key ?? '', payload.modifiers)
          break
      }

      const result: InputResultPayload = { success: true }
      this.sendFn(createHandMessage(MSG.INPUT_RESULT, result, msg.id))
    } catch (err) {
      this.sendComputerUseBlocked(msg, `Keyboard action failed: ${String(err)}`)
    }
  }
```

- [ ] **Step 9: Update approval response handler for Computer Use session approval**

In `handleApprovalResponse`, after the `if (payload.decision === 'always')` block and before `// Re-execute the original message`, add:

```typescript
    // If this was a Computer Use approval, grant session access
    if (pending.originalMessage.type === MSG.SCREEN_CAPTURE ||
        pending.originalMessage.type === MSG.SCREEN_INFO ||
        pending.originalMessage.type === MSG.INPUT_MOUSE ||
        pending.originalMessage.type === MSG.INPUT_KEYBOARD) {
      this.sessionGuard.approve(pending.originalMessage.id)
    }
```

- [ ] **Step 10: Update core index.ts — add exports**

Add these exports to `packages/core/src/index.ts`:

```typescript
// Computer Use
export type { ComputerUseAdapter, Point, Rect, ScreenSize, ScreenshotResult } from './computer-use/types.js'
export { UnsupportedPlatformError, ComputerUseDisabledError, SessionApprovalRequiredError } from './computer-use/types.js'
export { createComputerUseAdapter } from './computer-use/computer-use-factory.js'
export { SessionGuard } from './computer-use/session-guard.js'
export { classifyComputerUseAction } from './permissions/risk-classifier.js'
```

- [ ] **Step 11: Write session guard tests**

Create `tests/core/session-guard.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { SessionGuard } from '@eyas/hand-core'

describe('SessionGuard', () => {
  let guard: SessionGuard

  beforeEach(() => {
    guard = new SessionGuard()
  })

  it('starts unapproved', () => {
    expect(guard.isApproved).toBe(false)
    expect(guard.approvedAt).toBeNull()
    expect(guard.sessionId).toBeNull()
  })

  it('check returns not allowed when unapproved', () => {
    const result = guard.check()
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('per-session approval')
  })

  it('approve grants access', () => {
    guard.approve('session-123')

    expect(guard.isApproved).toBe(true)
    expect(guard.sessionId).toBe('session-123')
    expect(guard.approvedAt).toBeGreaterThan(0)
    expect(guard.check().allowed).toBe(true)
  })

  it('revoke removes access', () => {
    guard.approve('session-123')
    guard.revoke()

    expect(guard.isApproved).toBe(false)
    expect(guard.sessionId).toBeNull()
    expect(guard.approvedAt).toBeNull()
    expect(guard.check().allowed).toBe(false)
  })

  it('can re-approve after revoke', () => {
    guard.approve('session-1')
    guard.revoke()
    guard.approve('session-2')

    expect(guard.isApproved).toBe(true)
    expect(guard.sessionId).toBe('session-2')
  })
})
```

- [ ] **Step 12: Write daemon integration tests for Computer Use**

Create `tests/core/computer-use-daemon.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { HandDaemon, getDefaultConfig } from '@eyas/hand-core'
import type { HandConfig } from '@eyas/hand-core'
import { createHandMessage, MSG } from '@eyas/hand-protocol'
import type { HandMessage } from '@eyas/hand-protocol'

function makeConfig(computerUseEnabled: boolean): HandConfig {
  const config = getDefaultConfig()
  return {
    ...config,
    permissions: {
      ...config.permissions,
      computerUse: { enabled: computerUseEnabled },
    },
  }
}

function makeDaemon(config: HandConfig): { daemon: HandDaemon; sent: HandMessage[] } {
  const daemon = new HandDaemon({
    config,
    configPath: '/tmp/test.yaml',
    handId: 'test-hand',
    token: 'test-token',
    eyasUrl: 'wss://example.com/api/v1/hand/ws',
  })
  const sent: HandMessage[] = []
  daemon.setSendFn((msg) => sent.push(msg))
  return { daemon, sent }
}

describe('HandDaemon — Computer Use', () => {
  describe('when computer use is disabled', () => {
    it('rejects screen:capture with error', async () => {
      const { daemon, sent } = makeDaemon(makeConfig(false))

      await daemon.handleMessage(
        createHandMessage(MSG.SCREEN_CAPTURE, {})
      )

      expect(sent).toHaveLength(1)
      expect(sent[0].type).toBe(MSG.INPUT_RESULT)
      expect((sent[0].payload as any).success).toBe(false)
      expect((sent[0].payload as any).error).toContain('disabled')
    })

    it('rejects input:mouse with error', async () => {
      const { daemon, sent } = makeDaemon(makeConfig(false))

      await daemon.handleMessage(
        createHandMessage(MSG.INPUT_MOUSE, { action: 'move', x: 100, y: 200 })
      )

      expect(sent).toHaveLength(1)
      expect(sent[0].type).toBe(MSG.INPUT_RESULT)
      expect((sent[0].payload as any).success).toBe(false)
    })

    it('rejects input:keyboard with error', async () => {
      const { daemon, sent } = makeDaemon(makeConfig(false))

      await daemon.handleMessage(
        createHandMessage(MSG.INPUT_KEYBOARD, { action: 'type', text: 'hello' })
      )

      expect(sent).toHaveLength(1)
      expect(sent[0].type).toBe(MSG.INPUT_RESULT)
      expect((sent[0].payload as any).success).toBe(false)
    })
  })

  describe('when computer use is enabled but not yet approved', () => {
    it('sends approval request for screen:capture', async () => {
      const { daemon, sent } = makeDaemon(makeConfig(true))

      await daemon.handleMessage(
        createHandMessage(MSG.SCREEN_CAPTURE, {})
      )

      expect(sent).toHaveLength(1)
      expect(sent[0].type).toBe(MSG.APPROVAL_REQUEST)
      expect((sent[0].payload as any).riskTier).toBe('red')
      expect((sent[0].payload as any).action).toContain('computer-use')
    })

    it('sends approval request for input:mouse', async () => {
      const { daemon, sent } = makeDaemon(makeConfig(true))

      await daemon.handleMessage(
        createHandMessage(MSG.INPUT_MOUSE, { action: 'click', x: 50, y: 50, button: 'left' })
      )

      expect(sent).toHaveLength(1)
      expect(sent[0].type).toBe(MSG.APPROVAL_REQUEST)
      expect((sent[0].payload as any).riskTier).toBe('red')
    })

    it('sends approval request for input:keyboard', async () => {
      const { daemon, sent } = makeDaemon(makeConfig(true))

      await daemon.handleMessage(
        createHandMessage(MSG.INPUT_KEYBOARD, { action: 'press', key: 'Return' })
      )

      expect(sent).toHaveLength(1)
      expect(sent[0].type).toBe(MSG.APPROVAL_REQUEST)
    })

    it('sends approval request for screen:info', async () => {
      const { daemon, sent } = makeDaemon(makeConfig(true))

      await daemon.handleMessage(
        createHandMessage(MSG.SCREEN_INFO, {})
      )

      expect(sent).toHaveLength(1)
      expect(sent[0].type).toBe(MSG.APPROVAL_REQUEST)
    })
  })

  describe('capabilities reporting', () => {
    it('reports computerUse: false when disabled', async () => {
      const { daemon } = makeDaemon(makeConfig(false))
      const caps = await daemon.buildCapabilities()
      expect(caps.capabilities.computerUse).toBe(false)
    })

    it('reports computerUse based on platform and config', async () => {
      const { daemon } = makeDaemon(makeConfig(true))
      const caps = await daemon.buildCapabilities()
      // On macOS: true; on other platforms: false
      if (process.platform === 'darwin') {
        expect(caps.capabilities.computerUse).toBe(true)
      } else {
        expect(caps.capabilities.computerUse).toBe(false)
      }
    })
  })
})
```

- [ ] **Step 13: Run all tests — verify everything passes**

```bash
cd ~/GitHub/eyas-hand && bun test
```

---

## Task 6: Risk classifier tests update

**Files:**
- Modify: `~/GitHub/eyas-hand/tests/core/risk-classifier.test.ts`

- [ ] **Step 1: Add computer use classification tests**

Add this import and test suite to the end of `tests/core/risk-classifier.test.ts`:

```typescript
import { classifyComputerUseAction } from '@eyas/hand-core'

describe('classifyComputerUseAction', () => {
  it('returns black when computer use is disabled', () => {
    const config = makeConfig()
    expect(classifyComputerUseAction('screen:capture', config)).toBe('black')
  })

  it('returns red when computer use is enabled', () => {
    const config: HandConfig = {
      ...makeConfig(),
      permissions: {
        ...makeConfig().permissions,
        computerUse: { enabled: true },
      },
    }
    expect(classifyComputerUseAction('screen:capture', config)).toBe('red')
    expect(classifyComputerUseAction('input:mouse', config)).toBe('red')
    expect(classifyComputerUseAction('input:keyboard', config)).toBe('red')
  })
})
```

- [ ] **Step 2: Run risk classifier tests**

```bash
cd ~/GitHub/eyas-hand && bun test tests/core/risk-classifier.test.ts
```

- [ ] **Step 3: Final full test run**

```bash
cd ~/GitHub/eyas-hand && bun test
```

---

## Summary

| Task | Description | New files | Modified files | Est. tests |
|------|-------------|-----------|----------------|------------|
| 1 | Protocol types — screen/input messages | 1 test | 1 (messages.ts) | 15 |
| 2 | ComputerUseAdapter types + interface | 1 | — | — |
| 3 | macOS screenshot + input adapter | 1 + 1 test | — | 18 |
| 4 | Platform stubs + factory | 3 + 1 test | — | 4 |
| 5 | Session guard + daemon integration | 1 + 2 tests | 3 (daemon, index, risk-classifier) | 14 |
| 6 | Risk classifier test update | — | 1 test | 3 |
| **Total** | | **7 source + 5 test** | **4 modified** | **~54 tests** |

### Key decisions
- **JXA (osascript -l JavaScript)** for CGEvent mouse/keyboard — no native addons needed, no brew dependency
- **System Events** as fallback for keyboard input — handles all Unicode correctly
- **screencapture** CLI for screenshots — built into macOS, supports regions and window IDs
- **execFile (not exec)** everywhere — arguments passed as array, no shell injection risk
- **SessionGuard** as simple approve/revoke state machine — per-session, not per-action
- **Factory pattern** with lazy imports — only loads darwin code on macOS
- **All Computer Use = red tier** — no exceptions, even after session approval it started as red
- **base64 PNG** over the wire — simple, universal, no streaming needed for screenshots
- **Temp file cleanup** — screenshots are written to `/tmp/eyas-screenshot-*.png` then immediately read and deleted

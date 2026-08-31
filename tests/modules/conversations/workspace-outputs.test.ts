// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, utimesSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  MAX_OUTPUTS,
  attachWorkspaceOutputs,
  collectWorkspaceOutputs,
  ensureConversationWorkspace,
} from '@modules/conversations/workspace-outputs'

let root: string
const SINCE = Date.now() - 60_000

function write(rel: string, content = 'x', mtimeMs = Date.now()) {
  const full = join(root, rel)
  mkdirSync(join(full, '..'), { recursive: true })
  writeFileSync(full, content)
  const s = mtimeMs / 1000
  utimesSync(full, s, s)
  return full
}

beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'eyas-wsout-')) })
afterEach(() => { rmSync(root, { recursive: true, force: true }) })

describe('collectWorkspaceOutputs', () => {
  it('finds what the turn wrote', async () => {
    write('mai-datum.html')
    const out = await collectWorkspaceOutputs(root, SINCE)
    expect(out.map((o) => o.relativePath)).toEqual(['mai-datum.html'])
  })

  it('keeps a file whose mtime the filesystem rounded just below the stamp', async () => {
    // Date.now() and the filesystem are two clocks. A strict comparison lost
    // the file a fast run had just written, and the symptom was a test that
    // passed alone and failed in a warm suite.
    const stamp = Date.now()
    write('instant.html', 'x', stamp - 900)
    expect((await collectWorkspaceOutputs(root, stamp)).map((o) => o.relativePath)).toEqual(['instant.html'])
  })

  it('still refuses a file that is genuinely older than the turn', async () => {
    const stamp = Date.now()
    write('old.html', 'x', stamp - 30_000)
    expect(await collectWorkspaceOutputs(root, stamp)).toEqual([])
  })

  it('ignores what was already there', async () => {
    // The whole point: a working directory can be a repository, and its
    // existing contents are not this turn's output.
    write('old.html', 'x', SINCE - 60_000)
    write('new.html')
    const out = await collectWorkspaceOutputs(root, SINCE)
    expect(out.map((o) => o.relativePath)).toEqual(['new.html'])
  })

  it('never walks into a build or a checkout', async () => {
    write('node_modules/pkg/index.html')
    write('dist/bundle.html')
    write('.git/x.html')
    write('report.html')
    const out = await collectWorkspaceOutputs(root, SINCE)
    expect(out.map((o) => o.relativePath)).toEqual(['report.html'])
  })

  it('looks two levels down, no further', async () => {
    write('a/report.html')
    write('a/b/c/deep.html')
    const found = (await collectWorkspaceOutputs(root, SINCE)).map((o) => o.relativePath)
    expect(found).toContain('a/report.html')
    expect(found.join()).not.toContain('deep.html')
  })

  it('keeps only what a person would open', async () => {
    write('page.html'); write('notes.md'); write('data.csv')
    write('build.o'); write('a.tmp'); write('.hidden.html'); write('binary.exe')
    const found = (await collectWorkspaceOutputs(root, SINCE)).map((o) => o.relativePath).sort()
    expect(found).toEqual(['data.csv', 'notes.md', 'page.html'])
  })

  it('skips an empty file and an oversized one', async () => {
    write('empty.html', '')
    write('huge.html', 'x'.repeat(3 * 1024 * 1024))
    write('fine.html', 'ok')
    expect((await collectWorkspaceOutputs(root, SINCE)).map((o) => o.relativePath)).toEqual(['fine.html'])
  })

  it('caps how many it reports, newest first', async () => {
    for (let i = 0; i < MAX_OUTPUTS + 5; i++) write(`f${i}.html`, 'x', Date.now() + i * 1000)
    const out = await collectWorkspaceOutputs(root, SINCE)
    expect(out).toHaveLength(MAX_OUTPUTS)
    expect(out[0].modifiedMs).toBeGreaterThan(out[out.length - 1].modifiedMs)
  })

  it('returns nothing rather than throwing on a directory that is not there', async () => {
    await expect(collectWorkspaceOutputs(join(root, 'nope'), SINCE)).resolves.toEqual([])
  })
})

describe('attachWorkspaceOutputs', () => {
  function fakeDocs() {
    const uploaded: string[] = []
    const linked: Array<[string, string, string]> = []
    return {
      uploaded, linked,
      upload: vi.fn(async ({ filename }: any) => { uploaded.push(filename); return { id: `doc-${uploaded.length}` } }),
      link: vi.fn((docId: string, mod: string, owner: string) => { linked.push([docId, mod, owner]) }),
    }
  }

  it('registers each output and links it to the conversation', async () => {
    write('report.html', 'hello')
    const outputs = await collectWorkspaceOutputs(root, SINCE)
    const docs = fakeDocs()
    const ids = await attachWorkspaceOutputs({ documents: docs as any }, 'conv-1', outputs)
    expect(ids).toEqual(['doc-1'])
    expect(docs.uploaded).toEqual(['report.html'])
    expect(docs.linked).toEqual([['doc-1', 'conversations', 'conv-1']])
  })

  it('records where it came from, so the panel entry is traceable', async () => {
    write('report.html', 'hello')
    const docs = fakeDocs()
    await attachWorkspaceOutputs({ documents: docs as any }, 'conv-1', await collectWorkspaceOutputs(root, SINCE))
    expect(docs.upload.mock.calls[0][0].metadata).toMatchObject({ source: 'agent-output', conversationId: 'conv-1' })
  })

  it('one unreadable file does not cost the others their place', async () => {
    write('a.html', 'a'); write('b.html', 'b')
    const outputs = await collectWorkspaceOutputs(root, SINCE)
    const docs = fakeDocs()
    docs.upload.mockImplementationOnce(async () => { throw new Error('disk') })
    const ids = await attachWorkspaceOutputs({ documents: docs as any }, 'conv-1', outputs)
    expect(ids).toHaveLength(1)
  })
})

describe('ensureConversationWorkspace', () => {
  it('creates a directory of its own, so the agent does not choose /tmp', () => {
    const dir = ensureConversationWorkspace(root, 'conv-1')
    expect(dir).toBe(join(root, 'workspaces', 'conv-1'))
    write('workspaces/conv-1/out.html')
    expect(dir.endsWith(join('workspaces', 'conv-1'))).toBe(true)
  })

  it('is idempotent', () => {
    expect(ensureConversationWorkspace(root, 'c')).toBe(ensureConversationWorkspace(root, 'c'))
  })
})

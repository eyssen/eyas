import { describe, it, expect, vi, afterEach } from 'vitest'
import { createGiteaPrProvider, createGitHubPrProvider } from '@modules/ops/actions/pr-provider'

function mockFetchSequence(responses: Array<{ status?: number; json?: any; text?: string }>) {
  const calls: Array<{ url: string; init?: any }> = []
  let i = 0
  vi.stubGlobal('fetch', vi.fn(async (url: any, init?: any) => {
    calls.push({ url: String(url), init })
    const r = responses[Math.min(i++, responses.length - 1)]
    return { ok: (r.status ?? 200) < 400, status: r.status ?? 200,
      json: async () => r.json ?? {}, text: async () => r.text ?? '' } as any
  }))
  return calls
}
afterEach(() => vi.unstubAllGlobals())

describe('Gitea multi-file PR', () => {
  it('creates a branch, commits each file, opens one draft PR', async () => {
    const calls = mockFetchSequence([
      { status: 200, json: { commit: { id: 'base' } } },   // base branch
      { status: 201, json: {} },                            // create branch
      { status: 404 },                                      // file A get (new)
      { status: 200, json: {} },                            // file A put
      { status: 200, json: { sha: 'shaB' } },               // file B get (exists)
      { status: 200, json: {} },                            // file B put
      { status: 201, json: { html_url: 'https://g/infra/r/pulls/3', number: 3 } }, // PR
    ])
    const res = await createGiteaPrProvider({ baseUrl: 'https://g', owner: 'infra', repo: 'r', baseBranch: 'main', token: 't' })
      .openMultiFilePullRequest({ branch: 'pipeline/x', title: 'feat', body: 'b', draft: true,
        files: [{ path: 'a.ts', action: 'add', content: 'A' }, { path: 'b.ts', action: 'modify', content: 'B' }] })
    expect(res).toEqual({ prUrl: 'https://g/infra/r/pulls/3', number: 3, status: 'draft' })
  })

  it('FIX I1: a rename PUTs the new path AND DELETEs renamedFrom (no duplicate left behind)', async () => {
    const calls = mockFetchSequence([
      { status: 200, json: { commit: { id: 'base' } } },   // base branch
      { status: 201, json: {} },                            // create branch
      { status: 404 },                                      // new path get (doesn't exist yet)
      { status: 200, json: {} },                            // new path put
      { status: 200, json: { sha: 'oldSha' } },             // renamedFrom get (exists)
      { status: 200, json: {} },                            // renamedFrom delete
      { status: 201, json: { html_url: 'https://g/infra/r/pulls/4', number: 4 } }, // PR
    ])
    const res = await createGiteaPrProvider({ baseUrl: 'https://g', owner: 'infra', repo: 'r', baseBranch: 'main', token: 't' })
      .openMultiFilePullRequest({ branch: 'pipeline/rename', title: 'rename', body: 'b', draft: true,
        files: [{ path: 'new.ts', action: 'rename', content: 'A', renamedFrom: 'old.ts' }] })
    expect(res).toEqual({ prUrl: 'https://g/infra/r/pulls/4', number: 4, status: 'draft' })

    const putCall = calls.find((c) => c.init?.method === 'PUT')!
    expect(putCall.url).toContain(encodeURIComponent('new.ts'))
    const deleteCall = calls.find((c) => c.init?.method === 'DELETE')!
    expect(deleteCall.url).toContain(encodeURIComponent('old.ts'))
    expect(JSON.parse(deleteCall.init.body).sha).toBe('oldSha')
  })

  it('FIX I1: a rename without renamedFrom degrades to a plain add (PUT only, no crash)', async () => {
    const calls = mockFetchSequence([
      { status: 200, json: { commit: { id: 'base' } } },   // base branch
      { status: 201, json: {} },                            // create branch
      { status: 404 },                                      // new path get (doesn't exist yet)
      { status: 200, json: {} },                            // new path put
      { status: 201, json: { html_url: 'https://g/infra/r/pulls/5', number: 5 } }, // PR
    ])
    const res = await createGiteaPrProvider({ baseUrl: 'https://g', owner: 'infra', repo: 'r', baseBranch: 'main', token: 't' })
      .openMultiFilePullRequest({ branch: 'pipeline/rename2', title: 'rename', body: 'b', draft: true,
        files: [{ path: 'new.ts', action: 'rename', content: 'A' }] })
    expect(res).toEqual({ prUrl: 'https://g/infra/r/pulls/5', number: 5, status: 'draft' })
    expect(calls.some((c) => c.init?.method === 'DELETE')).toBe(false)
  })
})

describe('GitHub multi-file PR', () => {
  it('creates a branch, commits files, opens a draft PR', async () => {
    mockFetchSequence([
      { status: 200, json: { object: { sha: 'base' } } },   // GET ref
      { status: 201, json: {} },                            // create ref
      { status: 404 },                                      // contents A (new)
      { status: 201, json: {} },                            // put A
      { status: 201, json: { html_url: 'https://github.com/o/r/pull/5', number: 5 } }, // PR (draft:true)
    ])
    const res = await createGitHubPrProvider({ owner: 'o', repo: 'r', baseBranch: 'main', token: 'gh' })
      .openMultiFilePullRequest({ branch: 'pipeline/y', title: 't', body: 'b', draft: true,
        files: [{ path: 'a.ts', action: 'add', content: 'A' }] })
    expect(res).toEqual({ prUrl: 'https://github.com/o/r/pull/5', number: 5, status: 'draft' })
  })

  it('FIX I1: a rename PUTs the new path AND DELETEs renamedFrom (no duplicate left behind)', async () => {
    const calls = mockFetchSequence([
      { status: 200, json: { object: { sha: 'base' } } },   // GET ref
      { status: 201, json: {} },                            // create ref
      { status: 404 },                                      // new path get (doesn't exist yet)
      { status: 201, json: {} },                            // new path put
      { status: 200, json: { sha: 'oldSha' } },             // renamedFrom get (exists)
      { status: 200, json: {} },                            // renamedFrom delete
      { status: 201, json: { html_url: 'https://github.com/o/r/pull/6', number: 6 } }, // PR
    ])
    const res = await createGitHubPrProvider({ owner: 'o', repo: 'r', baseBranch: 'main', token: 'gh' })
      .openMultiFilePullRequest({ branch: 'pipeline/rename', title: 'rename', body: 'b', draft: true,
        files: [{ path: 'new.ts', action: 'rename', content: 'A', renamedFrom: 'old.ts' }] })
    expect(res).toEqual({ prUrl: 'https://github.com/o/r/pull/6', number: 6, status: 'draft' })

    const putCall = calls.find((c) => c.init?.method === 'PUT')!
    expect(putCall.url).toContain(encodeURIComponent('new.ts'))
    const deleteCall = calls.find((c) => c.init?.method === 'DELETE')!
    expect(deleteCall.url).toContain(encodeURIComponent('old.ts'))
    expect(JSON.parse(deleteCall.init.body).sha).toBe('oldSha')
  })

  it('FIX I1: a rename without renamedFrom degrades to a plain add (PUT only, no crash)', async () => {
    const calls = mockFetchSequence([
      { status: 200, json: { object: { sha: 'base' } } },   // GET ref
      { status: 201, json: {} },                            // create ref
      { status: 404 },                                      // new path get (doesn't exist yet)
      { status: 201, json: {} },                            // new path put
      { status: 201, json: { html_url: 'https://github.com/o/r/pull/7', number: 7 } }, // PR
    ])
    const res = await createGitHubPrProvider({ owner: 'o', repo: 'r', baseBranch: 'main', token: 'gh' })
      .openMultiFilePullRequest({ branch: 'pipeline/rename2', title: 'rename', body: 'b', draft: true,
        files: [{ path: 'new.ts', action: 'rename', content: 'A' }] })
    expect(res).toEqual({ prUrl: 'https://github.com/o/r/pull/7', number: 7, status: 'draft' })
    expect(calls.some((c) => c.init?.method === 'DELETE')).toBe(false)
  })
})

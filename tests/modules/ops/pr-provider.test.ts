import { describe, it, expect, vi, afterEach } from 'vitest'
import { createGiteaPrProvider, createGitHubPrProvider, createPrProviderFromConfig } from '@modules/ops/actions/pr-provider'

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

describe('Gitea PrProvider', () => {
  const cfg = { baseUrl: 'https://gitea.internal', owner: 'infra', repo: 'gitops', baseBranch: 'main', token: 't0k' }

  it('getFileContent returns decoded content or null on 404', async () => {
    mockFetchSequence([{ status: 200, json: { content: Buffer.from('hello').toString('base64') } }])
    const p = createGiteaPrProvider(cfg)
    expect(await p.getFileContent('app.yaml')).toBe('hello')
    mockFetchSequence([{ status: 404 }])
    expect(await createGiteaPrProvider(cfg).getFileContent('missing.yaml')).toBeNull()
  })

  it('openPullRequest creates branch + file + PR and returns the url/number', async () => {
    const calls = mockFetchSequence([
      { status: 200, json: { commit: { sha: 'base-sha' } } }, // resolve base branch
      { status: 201, json: {} },                               // create branch
      { status: 200, json: { content: { sha: 'file-sha' } } }, // get existing file sha (may 404 → create)
      { status: 200, json: {} },                               // put file
      { status: 201, json: { html_url: 'https://gitea.internal/infra/gitops/pulls/7', number: 7 } }, // PR
    ])
    const res = await createGiteaPrProvider(cfg).openPullRequest({
      filePath: 'app.yaml', content: 'new: value', title: 'fix', body: 'why', branch: 'ops/fix-1',
    })
    expect(res).toEqual({ prUrl: 'https://gitea.internal/infra/gitops/pulls/7', number: 7 })
    expect(calls.some(c => c.init?.headers?.Authorization === 'token t0k')).toBe(true)
  })
})

describe('GitHub PrProvider', () => {
  it('uses Bearer auth and returns html_url/number', async () => {
    const calls = mockFetchSequence([
      { status: 200, json: { object: { sha: 'base-sha' } } }, // GET ref
      { status: 201, json: {} },                               // create ref
      { status: 404 },                                         // GET contents (new file)
      { status: 201, json: {} },                               // PUT contents
      { status: 201, json: { html_url: 'https://github.com/o/r/pull/9', number: 9 } },
    ])
    const res = await createGitHubPrProvider({ owner: 'o', repo: 'r', baseBranch: 'main', token: 'gh' })
      .openPullRequest({ filePath: 'k.yaml', content: 'x: 1', title: 't', body: 'b', branch: 'ops/x' })
    expect(res).toEqual({ prUrl: 'https://github.com/o/r/pull/9', number: 9 })
    expect(calls.some(c => c.init?.headers?.Authorization === 'Bearer gh')).toBe(true)
  })
})

describe('createPrProviderFromConfig', () => {
  it('returns null when provider is unset or token missing', async () => {
    expect(await createPrProviderFromConfig({ provider: null }, async () => 'x')).toBeNull()
    expect(await createPrProviderFromConfig({ provider: 'gitea', baseUrl: 'https://g', owner: 'o', repo: 'r' }, async () => null)).toBeNull()
  })
  it('builds a gitea provider when configured + token present', async () => {
    const p = await createPrProviderFromConfig({ provider: 'gitea', baseUrl: 'https://g', owner: 'o', repo: 'r', baseBranch: 'main' }, async () => 'tok')
    expect(p).not.toBeNull()
  })

  // FIX 4 (M-2): a non-https baseUrl must be honestly refused (return null),
  // never silently used over plaintext HTTP.
  it('returns null when a gitea baseUrl is provided but is not https', async () => {
    const p = await createPrProviderFromConfig(
      { provider: 'gitea', baseUrl: 'http://gitea.internal', owner: 'o', repo: 'r', baseBranch: 'main' },
      async () => 'tok',
    )
    expect(p).toBeNull()
  })

  it('returns null when a github baseUrl is provided but is not https', async () => {
    const p = await createPrProviderFromConfig(
      { provider: 'github', baseUrl: 'http://ghe.internal', owner: 'o', repo: 'r', baseBranch: 'main' },
      async () => 'tok',
    )
    expect(p).toBeNull()
  })

  it('github still works with no baseUrl at all (default api.github.com fallback)', async () => {
    const p = await createPrProviderFromConfig({ provider: 'github', owner: 'o', repo: 'r' }, async () => 'tok')
    expect(p).not.toBeNull()
  })
})

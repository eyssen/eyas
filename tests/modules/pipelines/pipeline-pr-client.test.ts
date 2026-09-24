// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, vi } from 'vitest'
import { createPipelinePrClient } from '@modules/pipelines/ticket-to-code/adapters/pipeline-pr-client'

describe('createPipelinePrClient', () => {
  it('maps PullRequestInput to a multi-file draft PR and resolves newContent to content', async () => {
    const openMultiFilePullRequest = vi.fn(async (_input: any) => ({ prUrl: 'https://g/pr/1', number: 1, status: 'draft' as const }))
    const provider: any = { getFileContent: async () => 'old\n', openMultiFilePullRequest }
    const client = createPipelinePrClient(provider)
    const res = await client.openPullRequest({
      title: 't',
      body: 'b',
      branch: 'pipeline/x',
      baseBranch: 'main',
      files: [{ path: 'a.ts', action: 'add', newContent: 'A' }],
    })
    expect(res).toMatchObject({ url: 'https://g/pr/1', number: 1, branch: 'pipeline/x', status: 'draft' })
    const passed = openMultiFilePullRequest.mock.calls[0][0]
    expect(passed.draft).toBe(true)
    expect(passed.files[0]).toMatchObject({ path: 'a.ts', action: 'add', content: 'A' })
  })

  it('resolves a patch against the current file content via applyPatch', async () => {
    const patch = [
      'Index: b.ts',
      '===================================================================',
      '--- b.ts',
      '+++ b.ts',
      '@@ -1,1 +1,1 @@',
      '-old',
      '+new',
    ].join('\n')
    const openMultiFilePullRequest = vi.fn(async (_input: any) => ({ prUrl: 'https://g/o/r/pulls/2', number: 2, status: 'draft' as const }))
    const provider: any = { getFileContent: async () => 'old', openMultiFilePullRequest }
    const client = createPipelinePrClient(provider)
    await client.openPullRequest({
      title: 't', body: 'b', branch: 'pipeline/y',
      files: [{ path: 'b.ts', action: 'modify', patch }],
    })
    const passed = openMultiFilePullRequest.mock.calls[0][0]
    expect(passed.files[0].content).toBe('new')
  })

  it('throws an honest failure when applyPatch cannot apply the patch (does not silently drop the file)', async () => {
    const badPatch = [
      'Index: c.ts',
      '===================================================================',
      '--- c.ts',
      '+++ c.ts',
      '@@ -1,1 +1,1 @@',
      '-this line does not exist in source',
      '+new',
    ].join('\n')
    const openMultiFilePullRequest = vi.fn(async () => ({ prUrl: 'https://g/pr/3', number: 3, status: 'draft' as const }))
    const provider: any = { getFileContent: async () => 'totally different content', openMultiFilePullRequest }
    const client = createPipelinePrClient(provider)
    await expect(
      client.openPullRequest({
        title: 't', body: 'b', branch: 'pipeline/z',
        files: [{ path: 'c.ts', action: 'modify', patch: badPatch }],
      }),
    ).rejects.toThrow(/c\.ts/)
    expect(openMultiFilePullRequest).not.toHaveBeenCalled()
  })

  it('passes delete actions through without requiring content or patch', async () => {
    const openMultiFilePullRequest = vi.fn(async (_input: any) => ({ prUrl: 'https://g/pr/4', number: 4, status: 'open' as const }))
    const provider: any = { getFileContent: async () => null, openMultiFilePullRequest }
    const client = createPipelinePrClient(provider)
    await client.openPullRequest({
      title: 't', body: 'b', branch: 'pipeline/d',
      files: [{ path: 'gone.ts', action: 'delete' }],
    })
    const passed = openMultiFilePullRequest.mock.calls[0][0]
    expect(passed.files[0]).toMatchObject({ path: 'gone.ts', action: 'delete' })
  })

  it('derives provider "github" from a GitHub-shaped PR URL (/pull/N)', async () => {
    const openMultiFilePullRequest = vi.fn(async () => ({ prUrl: 'https://github.com/o/r/pull/5', number: 5, status: 'draft' as const }))
    const provider: any = { getFileContent: async () => null, openMultiFilePullRequest }
    const client = createPipelinePrClient(provider)
    const res = await client.openPullRequest({
      title: 't', body: 'b', branch: 'pipeline/gh',
      files: [{ path: 'a.ts', action: 'add', newContent: 'A' }],
    })
    expect(res.provider).toBe('github')
  })

  it('derives provider "gitea" from a Gitea-shaped PR URL (/pulls/N)', async () => {
    const openMultiFilePullRequest = vi.fn(async () => ({ prUrl: 'https://git.example.com/o/r/pulls/6', number: 6, status: 'draft' as const }))
    const provider: any = { getFileContent: async () => null, openMultiFilePullRequest }
    const client = createPipelinePrClient(provider)
    const res = await client.openPullRequest({
      title: 't', body: 'b', branch: 'pipeline/gt',
      files: [{ path: 'a.ts', action: 'add', newContent: 'A' }],
    })
    expect(res.provider).toBe('gitea')
  })
})

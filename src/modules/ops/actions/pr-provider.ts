// Part of eYssen. See LICENSE file for full copyright and licensing details.

export interface OpenPrInput { filePath: string; content: string; title: string; body: string; branch: string }
export interface MultiFilePr {
  branch: string; baseBranch?: string; title: string; body: string; draft?: boolean
  files: Array<{ path: string; action: 'add' | 'modify' | 'delete' | 'rename'; content?: string; renamedFrom?: string }>
}
export interface PrProvider {
  getFileContent(filePath: string): Promise<string | null>
  openPullRequest(input: OpenPrInput): Promise<{ prUrl: string; number: number }>
  openMultiFilePullRequest(input: MultiFilePr): Promise<{ prUrl: string; number: number; status: 'open' | 'draft' }>
}

async function jsonOrThrow(res: any, ctx: string): Promise<any> {
  if (!res.ok) throw new Error(`${ctx}: ${res.status} ${await res.text().catch(() => '')}`.trim())
  return res.json()
}

// ── Gitea (token <t>, header "Authorization: token <t>") ──
export function createGiteaPrProvider(cfg: { baseUrl: string; owner: string; repo: string; baseBranch: string; token: string }): PrProvider {
  const base = cfg.baseUrl.replace(/\/$/, '')
  const api = `${base}/api/v1/repos/${cfg.owner}/${cfg.repo}`
  const h = { Authorization: `token ${cfg.token}`, 'Content-Type': 'application/json' }
  return {
    async getFileContent(filePath) {
      const res = await fetch(`${api}/contents/${encodeURIComponent(filePath)}?ref=${cfg.baseBranch}`, { headers: h })
      if (res.status === 404) return null
      const data = await jsonOrThrow(res, 'gitea getFileContent')
      return data.content ? Buffer.from(data.content, 'base64').toString('utf8') : null
    },
    async openPullRequest(input) {
      const br = await jsonOrThrow(await fetch(`${api}/branches/${cfg.baseBranch}`, { headers: h }), 'gitea baseBranch')
      const baseSha = br.commit?.id ?? br.commit?.sha
      await jsonOrThrow(await fetch(`${api}/branches`, { method: 'POST', headers: h,
        body: JSON.stringify({ new_branch_name: input.branch, old_branch_name: cfg.baseBranch }) }), 'gitea createBranch')
      // existing sha (needed for update; 404 → create)
      let sha: string | undefined
      const cur = await fetch(`${api}/contents/${encodeURIComponent(input.filePath)}?ref=${input.branch}`, { headers: h })
      if (cur.ok) sha = (await cur.json()).sha
      await jsonOrThrow(await fetch(`${api}/contents/${encodeURIComponent(input.filePath)}`, { method: 'PUT', headers: h,
        body: JSON.stringify({ branch: input.branch, message: input.title, content: Buffer.from(input.content).toString('base64'), sha }) }), 'gitea putFile')
      const pr = await jsonOrThrow(await fetch(`${api}/pulls`, { method: 'POST', headers: h,
        body: JSON.stringify({ head: input.branch, base: cfg.baseBranch, title: input.title, body: input.body }) }), 'gitea createPr')
      return { prUrl: pr.html_url, number: pr.number }
    },
    async openMultiFilePullRequest(input) {
      await jsonOrThrow(await fetch(`${api}/branches/${input.baseBranch ?? cfg.baseBranch}`, { headers: h }), 'gitea baseBranch')
      await jsonOrThrow(await fetch(`${api}/branches`, { method: 'POST', headers: h,
        body: JSON.stringify({ new_branch_name: input.branch, old_branch_name: input.baseBranch ?? cfg.baseBranch }) }), 'gitea createBranch')
      for (const f of input.files) {
        const path = encodeURIComponent(f.path)
        if (f.action === 'delete') {
          const cur = await fetch(`${api}/contents/${path}?ref=${input.branch}`, { headers: h })
          if (cur.ok) {
            const sha = (await cur.json()).sha
            await jsonOrThrow(await fetch(`${api}/contents/${path}`, { method: 'DELETE', headers: h,
              body: JSON.stringify({ branch: input.branch, message: input.title, sha }) }), 'gitea deleteFile')
          }
          continue
        }
        let sha: string | undefined
        const cur = await fetch(`${api}/contents/${path}?ref=${input.branch}`, { headers: h })
        if (cur.ok) sha = (await cur.json()).sha
        await jsonOrThrow(await fetch(`${api}/contents/${path}`, { method: 'PUT', headers: h,
          body: JSON.stringify({ branch: input.branch, message: input.title, content: Buffer.from(f.content ?? '').toString('base64'), sha }) }), 'gitea putFile')

        // FIX I1: a rename must also delete the old path, otherwise the PR
        // adds the new file and leaves a duplicate at renamedFrom. Missing
        // renamedFrom degrades to a plain add (PUT only) — never crashes.
        if (f.action === 'rename' && f.renamedFrom) {
          const oldPath = encodeURIComponent(f.renamedFrom)
          const oldCur = await fetch(`${api}/contents/${oldPath}?ref=${input.branch}`, { headers: h })
          if (oldCur.ok) {
            const oldSha = (await oldCur.json()).sha
            await jsonOrThrow(await fetch(`${api}/contents/${oldPath}`, { method: 'DELETE', headers: h,
              body: JSON.stringify({ branch: input.branch, message: input.title, sha: oldSha }) }), 'gitea deleteRenamedFrom')
          }
        }
      }
      const pr = await jsonOrThrow(await fetch(`${api}/pulls`, { method: 'POST', headers: h,
        body: JSON.stringify({ head: input.branch, base: input.baseBranch ?? cfg.baseBranch, title: input.title, body: input.body }) }), 'gitea createPr')
      return { prUrl: pr.html_url, number: pr.number, status: input.draft ? 'draft' as const : 'open' as const }
    },
  }
}

// ── GitHub (header "Authorization: Bearer <t>") ──
export function createGitHubPrProvider(cfg: { baseUrl?: string; owner: string; repo: string; baseBranch: string; token: string }): PrProvider {
  const base = (cfg.baseUrl ?? 'https://api.github.com').replace(/\/$/, '')
  const api = `${base}/repos/${cfg.owner}/${cfg.repo}`
  const h = { Authorization: `Bearer ${cfg.token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' }
  return {
    async getFileContent(filePath) {
      const res = await fetch(`${api}/contents/${encodeURIComponent(filePath)}?ref=${cfg.baseBranch}`, { headers: h })
      if (res.status === 404) return null
      const data = await jsonOrThrow(res, 'github getFileContent')
      return data.content ? Buffer.from(data.content, 'base64').toString('utf8') : null
    },
    async openPullRequest(input) {
      const ref = await jsonOrThrow(await fetch(`${api}/git/ref/heads/${cfg.baseBranch}`, { headers: h }), 'github baseRef')
      const baseSha = ref.object?.sha
      await jsonOrThrow(await fetch(`${api}/git/refs`, { method: 'POST', headers: h,
        body: JSON.stringify({ ref: `refs/heads/${input.branch}`, sha: baseSha }) }), 'github createRef')
      let sha: string | undefined
      const cur = await fetch(`${api}/contents/${encodeURIComponent(input.filePath)}?ref=${input.branch}`, { headers: h })
      if (cur.ok) sha = (await cur.json()).sha
      await jsonOrThrow(await fetch(`${api}/contents/${encodeURIComponent(input.filePath)}`, { method: 'PUT', headers: h,
        body: JSON.stringify({ branch: input.branch, message: input.title, content: Buffer.from(input.content).toString('base64'), sha }) }), 'github putFile')
      const pr = await jsonOrThrow(await fetch(`${api}/pulls`, { method: 'POST', headers: h,
        body: JSON.stringify({ head: input.branch, base: cfg.baseBranch, title: input.title, body: input.body }) }), 'github createPr')
      return { prUrl: pr.html_url, number: pr.number }
    },
    async openMultiFilePullRequest(input) {
      const ref = await jsonOrThrow(await fetch(`${api}/git/ref/heads/${input.baseBranch ?? cfg.baseBranch}`, { headers: h }), 'github baseRef')
      const baseSha = ref.object?.sha
      await jsonOrThrow(await fetch(`${api}/git/refs`, { method: 'POST', headers: h,
        body: JSON.stringify({ ref: `refs/heads/${input.branch}`, sha: baseSha }) }), 'github createRef')
      for (const f of input.files) {
        const path = encodeURIComponent(f.path)
        if (f.action === 'delete') {
          const cur = await fetch(`${api}/contents/${path}?ref=${input.branch}`, { headers: h })
          if (cur.ok) {
            const sha = (await cur.json()).sha
            await jsonOrThrow(await fetch(`${api}/contents/${path}`, { method: 'DELETE', headers: h,
              body: JSON.stringify({ branch: input.branch, message: input.title, sha }) }), 'github deleteFile')
          }
          continue
        }
        let sha: string | undefined
        const cur = await fetch(`${api}/contents/${path}?ref=${input.branch}`, { headers: h })
        if (cur.ok) sha = (await cur.json()).sha
        await jsonOrThrow(await fetch(`${api}/contents/${path}`, { method: 'PUT', headers: h,
          body: JSON.stringify({ branch: input.branch, message: input.title, content: Buffer.from(f.content ?? '').toString('base64'), sha }) }), 'github putFile')

        // FIX I1: a rename must also delete the old path, otherwise the PR
        // adds the new file and leaves a duplicate at renamedFrom. Missing
        // renamedFrom degrades to a plain add (PUT only) — never crashes.
        if (f.action === 'rename' && f.renamedFrom) {
          const oldPath = encodeURIComponent(f.renamedFrom)
          const oldCur = await fetch(`${api}/contents/${oldPath}?ref=${input.branch}`, { headers: h })
          if (oldCur.ok) {
            const oldSha = (await oldCur.json()).sha
            await jsonOrThrow(await fetch(`${api}/contents/${oldPath}`, { method: 'DELETE', headers: h,
              body: JSON.stringify({ branch: input.branch, message: input.title, sha: oldSha }) }), 'github deleteRenamedFrom')
          }
        }
      }
      const pr = await jsonOrThrow(await fetch(`${api}/pulls`, { method: 'POST', headers: h,
        body: JSON.stringify({ head: input.branch, base: input.baseBranch ?? cfg.baseBranch, title: input.title, body: input.body, draft: !!input.draft }) }), 'github createPr')
      return { prUrl: pr.html_url, number: pr.number, status: input.draft ? 'draft' as const : 'open' as const }
    },
  }
}

export interface OpsPrConfig { provider: 'gitea' | 'github' | null; baseUrl?: string | null; owner?: string | null; repo?: string | null; baseBranch?: string }
export async function createPrProviderFromConfig(cfg: OpsPrConfig, getToken: () => Promise<string | null>): Promise<PrProvider | null> {
  if (!cfg.provider || !cfg.owner || !cfg.repo) return null
  // FIX 4 (M-2): a baseUrl, when provided, must be https — otherwise the
  // provider is honestly disabled (null) rather than silently talking
  // plaintext HTTP. GitHub's own default (api.github.com, no baseUrl set)
  // is unaffected since this only fires when baseUrl is present.
  if (cfg.baseUrl && !cfg.baseUrl.startsWith('https://')) return null
  const token = await getToken()
  if (!token) return null
  const baseBranch = cfg.baseBranch ?? 'main'
  if (cfg.provider === 'gitea') {
    if (!cfg.baseUrl) return null
    return createGiteaPrProvider({ baseUrl: cfg.baseUrl, owner: cfg.owner, repo: cfg.repo, baseBranch, token })
  }
  return createGitHubPrProvider({ baseUrl: cfg.baseUrl ?? undefined, owner: cfg.owner, repo: cfg.repo, baseBranch, token })
}

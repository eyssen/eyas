// Part of eYssen. See LICENSE file for full copyright and licensing details.

export const DEFAULT_GITHUB_REPO = 'eyssen/eyas'
export const DEFAULT_GITHUB_API = 'https://api.github.com'
export const DEFAULT_RAW_BASE = 'https://raw.githubusercontent.com'

export interface RemoteRelease {
  tag: string
  name: string
  prerelease: boolean
  draft: boolean
  htmlUrl: string
  body: string
  publishedAt: string | null
  source: 'release' | 'tag'
}

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'eyas-system-update',
    'X-GitHub-Api-Version': '2022-11-28',
  }
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN
  if (token) headers.Authorization = `Bearer ${token}`
  return headers
}

async function ghJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, {
      headers: authHeaders(),
      signal: AbortSignal.timeout(12_000),
    })
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  }
}

async function fetchText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: authHeaders(),
      signal: AbortSignal.timeout(12_000),
    })
    if (!res.ok) return null
    return await res.text()
  } catch {
    return null
  }
}

/**
 * Fetch latest version candidates from GitHub Releases, falling back to tags.
 * Prefer non-draft releases; include prereleases while product is still beta.
 */
export async function fetchRemoteReleases(
  repo = DEFAULT_GITHUB_REPO,
  apiBase = DEFAULT_GITHUB_API,
): Promise<RemoteRelease[]> {
  const releases = await ghJson<any[]>(
    `${apiBase}/repos/${repo}/releases?per_page=15`,
  )

  if (releases && Array.isArray(releases) && releases.length > 0) {
    return releases
      .filter((r) => !r.draft)
      .map((r) => ({
        tag: String(r.tag_name ?? ''),
        name: String(r.name || r.tag_name || ''),
        prerelease: !!r.prerelease,
        draft: !!r.draft,
        htmlUrl: String(r.html_url ?? `https://github.com/${repo}/releases`),
        body: String(r.body ?? ''),
        publishedAt: r.published_at ? String(r.published_at) : null,
        source: 'release' as const,
      }))
      .filter((r) => r.tag.length > 0)
  }

  // No GitHub Releases yet — use tags + CHANGELOG snippet
  const tags = await ghJson<Array<{ name: string }>>(
    `${apiBase}/repos/${repo}/tags?per_page=15`,
  )
  if (!tags || tags.length === 0) return []

  const out: RemoteRelease[] = []
  for (const t of tags.slice(0, 8)) {
    const tag = t.name
    const body = await fetchChangelogForRef(repo, tag)
    out.push({
      tag,
      name: tag,
      prerelease: /beta|alpha|rc/i.test(tag),
      draft: false,
      htmlUrl: `https://github.com/${repo}/releases/tag/${encodeURIComponent(tag)}`,
      body: body ?? `Tag ${tag} — see CHANGELOG.md on GitHub.`,
      publishedAt: null,
      source: 'tag',
    })
  }
  return out
}

export async function fetchChangelogForRef(
  repo: string,
  ref: string,
  rawBase = DEFAULT_RAW_BASE,
): Promise<string | null> {
  const text = await fetchText(`${rawBase}/${repo}/${encodeURIComponent(ref)}/CHANGELOG.md`)
  if (!text) return null
  // Return first ~8KB for UI
  return text.length > 8_000 ? `${text.slice(0, 8_000)}\n…` : text
}

export async function fetchRemoteVersionJson(
  repo: string,
  ref: string,
  rawBase = DEFAULT_RAW_BASE,
): Promise<{ version?: string } | null> {
  const text = await fetchText(`${rawBase}/${repo}/${encodeURIComponent(ref)}/version.json`)
  if (!text) return null
  try {
    return JSON.parse(text) as { version?: string }
  } catch {
    return null
  }
}

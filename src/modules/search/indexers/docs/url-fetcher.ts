// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { Readability } from '@mozilla/readability'
import TurndownService from 'turndown'
import { JSDOM } from 'jsdom'
import { safeFetch } from '@modules/research/ssrf-guard.js'

export interface FetchedDoc {
  title: string
  content: string
  url: string
}

const MAX_PAGES = 500
const CONCURRENCY = 5
const SKIP_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.pdf', '.zip', '.tar', '.gz', '.mp4', '.mp3', '.woff', '.woff2', '.ttf', '.eot', '.ico'])

export async function fetchAndExtract(url: string): Promise<FetchedDoc> {
  // SSRF-guarded: validates the URL + re-validates every redirect hop, and
  // rejects private/loopback/link-local targets (cloud metadata).
  const response = await safeFetch(url)
  if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.status}`)

  const html = await response.text()
  const dom = new JSDOM(html, { url })
  const reader = new Readability(dom.window.document)
  const article = reader.parse()

  if (!article) throw new Error(`Could not extract content from ${url}`)

  const turndown = new TurndownService({ headingStyle: 'atx' })
  const markdown = turndown.turndown(article.content ?? '')

  return {
    title: article.title || '',
    content: markdown,
    url,
  }
}

/**
 * Crawl a documentation site starting from a seed URL.
 * Follows same-origin links within the same path prefix, up to MAX_PAGES.
 */
export async function crawlAndExtract(seedUrl: string): Promise<FetchedDoc[]> {
  const seed = new URL(seedUrl)
  const basePath = seed.pathname.replace(/\/[^/]*$/, '/') // e.g. /hu/
  const visited = new Set<string>()
  const queue: string[] = [seedUrl]
  const results: FetchedDoc[] = []

  function normalizeUrl(raw: string): string | null {
    try {
      const u = new URL(raw, seedUrl)
      // Same origin only
      if (u.origin !== seed.origin) return null
      // Must be under the same base path
      if (!u.pathname.startsWith(basePath)) return null
      // Skip static assets
      const ext = u.pathname.match(/\.[a-z0-9]+$/i)?.[0]?.toLowerCase()
      if (ext && SKIP_EXTENSIONS.has(ext)) return null
      // Strip hash and query for dedup
      u.hash = ''
      u.search = ''
      return u.href
    } catch {
      return null
    }
  }

  function extractLinks(html: string, pageUrl: string): string[] {
    const dom = new JSDOM(html, { url: pageUrl })
    const anchors = dom.window.document.querySelectorAll('a[href]')
    const links: string[] = []
    for (const a of anchors) {
      const href = a.getAttribute('href')
      if (!href) continue
      const normalized = normalizeUrl(href)
      if (normalized && !visited.has(normalized)) {
        links.push(normalized)
      }
    }
    return links
  }

  async function processPage(pageUrl: string): Promise<string[]> {
    // SSRF-guarded: a crawled link cannot redirect into an internal target.
    const response = await safeFetch(pageUrl)
    if (!response.ok) return []
    const contentType = response.headers.get('content-type') ?? ''
    if (!contentType.includes('text/html')) return []

    const html = await response.text()
    const newLinks = extractLinks(html, pageUrl)

    // Extract content with Readability
    const dom = new JSDOM(html, { url: pageUrl })
    const reader = new Readability(dom.window.document)
    const article = reader.parse()
    if (article?.textContent?.trim()) {
      const turndown = new TurndownService({ headingStyle: 'atx' })
      const markdown = turndown.turndown(article.content ?? '')
      if (markdown.trim().length > 50) {
        results.push({ title: article.title || '', content: markdown, url: pageUrl })
      }
    }

    return newLinks
  }

  while (queue.length > 0 && visited.size < MAX_PAGES) {
    // Process batch with concurrency limit
    const batch = queue.splice(0, CONCURRENCY).filter((u) => !visited.has(u))
    for (const u of batch) visited.add(u)

    const batchResults = await Promise.allSettled(batch.map(processPage))
    for (const result of batchResults) {
      if (result.status === 'fulfilled') {
        for (const link of result.value) {
          if (!visited.has(link) && visited.size + queue.length < MAX_PAGES) {
            queue.push(link)
          }
        }
      }
    }
  }

  return results
}

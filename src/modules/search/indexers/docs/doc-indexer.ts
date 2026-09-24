// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { generateId } from '@shared/crypto'
import { readDocFiles, chunkMarkdown } from './file-reader.js'
import { crawlAndExtract } from './url-fetcher.js'
import type { ContentIndexer, Chunk, SearchSource } from '../../types.js'

export function createDocIndexer(): ContentIndexer {
  return {
    name: 'docs',

    supports(source: SearchSource): boolean {
      return source.type === 'docs'
    },

    async index(source: SearchSource): Promise<Chunk[]> {
      const chunks: Chunk[] = []

      // Paths can contain both local directories and URLs
      const paths = (source.config.paths ?? []) as string[]
      const localDirs: string[] = []
      const urlList: string[] = []

      for (const p of paths) {
        if (p.startsWith('http://') || p.startsWith('https://')) {
          urlList.push(p)
        } else {
          localDirs.push(p)
        }
      }

      // Also support explicit urls config key
      const explicitUrls = (source.config.urls ?? []) as string[]
      for (const u of explicitUrls) {
        if (!urlList.includes(u)) urlList.push(u)
      }

      // Index local files
      for (const dir of localDirs) {
        const files = readDocFiles(dir)
        for (const file of files) {
          const docChunks = chunkMarkdown(file.content, file.filePath)
          for (const dc of docChunks) {
            chunks.push({
              id: generateId(),
              sourceId: source.id,
              collection: 'docs',
              content: dc.content,
              metadata: {
                filePath: dc.filePath,
                title: dc.title || undefined,
                section: dc.section || undefined,
              },
            })
          }
        }
      }

      // Crawl & index URLs (follows same-origin links from seed URL)
      for (const url of urlList) {
        try {
          const docs = await crawlAndExtract(url)
          for (const doc of docs) {
            const docChunks = chunkMarkdown(doc.content, doc.url)
            for (const dc of docChunks) {
              chunks.push({
                id: generateId(),
                sourceId: source.id,
                collection: 'docs',
                content: dc.content,
                metadata: {
                  url: doc.url,
                  title: doc.title || dc.title || undefined,
                  section: dc.section || undefined,
                },
              })
            }
          }
        } catch (err) {
          console.warn('[docs-indexer] Failed to crawl URL: %s %o', url, err)
        }
      }

      return chunks
    },
  }
}

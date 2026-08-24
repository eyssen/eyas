#!/usr/bin/env bun
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const repo = join(dirname(fileURLToPath(import.meta.url)), '../../..')
const pagesRoot = join(repo, 'src/web/src/pages')
const out = join(dirname(fileURLToPath(import.meta.url)), '../field-catalog.json')

function flatten(d, p = '') {
  const out = {}
  if (!d || typeof d !== 'object') return out
  for (const [k, v] of Object.entries(d)) {
    const key = p ? `${p}.${k}` : k
    if (v && typeof v === 'object' && !Array.isArray(v)) Object.assign(out, flatten(v, key))
    else out[key] = String(v)
  }
  return out
}

const catalog = {}
for (const name of readdirSync(pagesRoot)) {
  const locales = join(pagesRoot, name, 'locales')
  if (!existsSync(locales) || !statSync(locales).isDirectory()) continue
  const by = {}
  for (const lang of ['en', 'hu', 'de', 'es', 'fr', 'tlh']) {
    const f = join(locales, `${lang}.json`)
    if (!existsSync(f)) continue
    by[lang] = flatten(JSON.parse(readFileSync(f, 'utf8')))
  }
  if (!by.en) continue
  catalog[name] = Object.keys(by.en).sort().map((key) => ({
    key,
    en: by.en[key],
    hu: by.hu?.[key] || '',
    de: by.de?.[key] || '',
    es: by.es?.[key] || '',
  }))
}
writeFileSync(out, JSON.stringify(catalog, null, 2) + '\n')
const n = Object.values(catalog).reduce((a, b) => a + b.length, 0)
console.log(`Wrote ${out} (${Object.keys(catalog).length} pages, ${n} fields)`)

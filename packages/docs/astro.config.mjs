// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * EYAS user documentation (Starlight).
 *
 * - Source of truth: Markdown under src/content/docs/{en,hu,de,es}/
 * - Sidebar IA: sidebar.generated.json (from scripts/generate-skeleton.mjs)
 * - Default base path `/docs` so the same dist is served by the main EYAS server
 * - Standalone root deploy: DOCS_BASE=/ bun run build
 * - Contextual UI help: help-map.json
 */
const base = process.env.DOCS_BASE ?? '/docs';
const here = dirname(fileURLToPath(import.meta.url));
const sidebar = JSON.parse(
  readFileSync(join(here, 'sidebar.generated.json'), 'utf8'),
);

export default defineConfig({
  site: process.env.DOCS_SITE ?? 'https://docs.eyas.local',
  base,
  integrations: [
    starlight({
      title: 'EYAS Docs',
      description: 'User and admin documentation for the EYAS personal AI platform.',
      customCss: ['./src/styles/eyas.css'],
      defaultLocale: 'en',
      locales: {
        en: { label: 'English', lang: 'en' },
        hu: { label: 'Magyar', lang: 'hu' },
        de: { label: 'Deutsch', lang: 'de' },
        es: { label: 'Español', lang: 'es' },
      },
      social: [
        {
          icon: 'github',
          label: 'GitHub',
          href: 'https://github.com/eyssen/eyas',
        },
      ],
      sidebar,
    }),
  ],
});

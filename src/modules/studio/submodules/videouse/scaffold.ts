// Part of eYssen. See LICENSE file for full copyright and licensing details.

export function scaffoldProjectMd(title: string): string {
  return `# ${title}

Edit footage with videouse_* tools. Confirm a cut strategy with the user before writing edl.json ranges.

## Session 0 — new project

**Strategy:** (none yet)
**Outstanding:** ingest sources, inventory, transcribe if an ElevenLabs key is present
`
}

export function scaffoldEdl(): string {
  return JSON.stringify(
    {
      version: 1,
      sources: {},
      ranges: [],
      grade: 'none',
      overlays: [],
    },
    null,
    2,
  ) + '\n'
}

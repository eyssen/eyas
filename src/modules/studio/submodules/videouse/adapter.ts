// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { copyFile, mkdir, readdir, readFile, writeFile, stat } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import type { Logger } from 'pino'
import type { CliRunner } from '../../cli-runner.js'
import { assertAllowedWrite, MAX_WRITE_CHARS, resolveProjectPath } from '../../path-safety.js'
import type { StudioSettings } from '../../settings-store.js'
import type { StudioEngine, StudioEngineStatus, StudioJob, StudioProject } from '../../types.js'
import { parseEdl } from './edl.js'
import { packTranscripts, type TranscriptFile } from './pack.js'
import { renderEdl } from './render.js'
import { scaffoldEdl, scaffoldProjectMd } from './scaffold.js'
import { transcribeSource } from './transcribe.js'

const SOURCE_EXT = new Set(['.mp4', '.mov', '.mkv', '.webm', '.m4v', '.wav', '.mp3', '.m4a'])
const DOCTOR_TIMEOUT_MS = 8_000
const RENDER_TIMEOUT_MS = 600_000

export interface VideoUseAdapterDeps {
  runner: CliRunner
  logger: Logger
  getSettings: () => StudioSettings
  getApiKey?: () => Promise<string | null>
  fetchImpl?: typeof fetch
}

export interface VideoUseEngine extends StudioEngine {
  ingest(project: StudioProject, absPaths: string[]): Promise<{ files: string[] }>
  inventory(project: StudioProject): Promise<{ sources: Array<{ name: string; path: string; duration?: number; error?: string }> }>
  transcribe(project: StudioProject): Promise<{ transcripts: string[] }>
  pack(project: StudioProject): Promise<{ path: string; chars: number }>
}

function editDir(project: StudioProject): string {
  return join(project.dir, 'edit')
}

function sourcesDir(project: StudioProject): string {
  return join(project.dir, 'sources')
}

export function createVideoUseAdapter(deps: VideoUseAdapterDeps): VideoUseEngine {
  const { runner, logger, getSettings } = deps

  async function ffmpegBin(): Promise<string | null> {
    return runner.which('ffmpeg')
  }

  async function ffprobeBin(): Promise<string | null> {
    return runner.which('ffprobe')
  }

  const engine: VideoUseEngine = {
    id: 'videouse',
    name: 'Video Use',
    description: 'Cut raw footage to MP4 from an EDL (transcript-first)',
    enabled: true,

    async status(): Promise<StudioEngineStatus> {
      const settings = getSettings()
      const checks: StudioEngineStatus['checks'] = []
      const ffmpeg = await ffmpegBin()
      if (ffmpeg) checks.push({ id: 'ffmpeg', label: 'FFmpeg', status: 'ok', detail: ffmpeg })
      else {
        checks.push({
          id: 'ffmpeg',
          label: 'FFmpeg',
          status: 'missing',
          remedy: 'Install FFmpeg (macOS: brew install ffmpeg) and ensure it is on PATH.',
        })
      }
      const ffprobe = await ffprobeBin()
      if (ffprobe) checks.push({ id: 'ffprobe', label: 'ffprobe', status: 'ok', detail: ffprobe })
      else {
        checks.push({
          id: 'ffprobe',
          label: 'ffprobe',
          status: 'missing',
          remedy: 'ffprobe ships with FFmpeg. Install FFmpeg.',
        })
      }
      const key = deps.getApiKey ? await deps.getApiKey() : null
      if (key) checks.push({ id: 'elevenlabs', label: 'ElevenLabs Scribe', status: 'ok' })
      else {
        checks.push({
          id: 'elevenlabs',
          label: 'ElevenLabs Scribe',
          status: 'warn',
          detail: 'No API key — inventory and render still work; transcribe does not',
          remedy: 'Store secret videouse-elevenlabs-api-key or set ELEVENLABS_API_KEY.',
        })
      }
      const available = checks.every((c) => c.status !== 'missing') && settings.videouse.enabled
      return {
        engineId: 'videouse',
        name: 'Video Use',
        enabled: settings.videouse.enabled,
        available,
        checks,
      }
    },

    async createProject(input) {
      await mkdir(sourcesDir({ dir: input.dir } as StudioProject), { recursive: true })
      const edit = join(input.dir, 'edit')
      await mkdir(join(edit, 'transcripts'), { recursive: true })
      await mkdir(join(edit, 'animations'), { recursive: true })
      await writeFile(join(edit, 'project.md'), scaffoldProjectMd(input.title), 'utf8')
      await writeFile(join(edit, 'edl.json'), scaffoldEdl(), 'utf8')
      await writeFile(join(edit, 'takes_packed.md'), '', 'utf8')
    },

    async writeFile(project, relativePath, content) {
      if (content.length > MAX_WRITE_CHARS) {
        throw new Error(`File too large (${content.length} chars, max ${MAX_WRITE_CHARS})`)
      }
      assertAllowedWrite(relativePath)
      const full = resolveProjectPath(project.dir, relativePath)
      await mkdir(dirname(full), { recursive: true })
      await writeFile(full, content, 'utf8')
      return { path: relativePath, bytes: Buffer.byteLength(content) }
    },

    async lint(project) {
      const path = join(editDir(project), 'edl.json')
      let raw = ''
      try {
        raw = await readFile(path, 'utf8')
      } catch {
        return { ok: false, engine: 'videouse', findings: [{ level: 'error', message: 'edit/edl.json is missing' }] }
      }
      const { edl, findings } = parseEdl(raw)
      if (!edl) return { ok: false, engine: 'videouse', findings }
      if (edl.ranges.length === 0) {
        findings.push({ level: 'error', message: 'edl.json has no ranges — confirm a strategy, then write cuts' })
      }
      const ok = findings.every((f) => f.level !== 'error')
      return { ok, engine: 'videouse', findings }
    },

    async render(project, _job: StudioJob) {
      const ffmpeg = await ffmpegBin()
      if (!ffmpeg) throw new Error('FFmpeg not found. Install FFmpeg and retry.')
      const raw = await readFile(join(editDir(project), 'edl.json'), 'utf8')
      const { edl, findings } = parseEdl(raw)
      if (!edl) throw new Error(findings.map((f) => f.message).join('; ') || 'Invalid EDL')
      if (edl.ranges.length === 0) throw new Error('edl.json has no ranges')
      const outputPath = join(editDir(project), 'final.mp4')
      await renderEdl({
        edl,
        editDir: editDir(project),
        outputPath,
        runner,
        ffmpeg,
        timeoutMs: RENDER_TIMEOUT_MS,
      })
      return { outputPath }
    },

    async ingest(project, absPaths) {
      const destRoot = sourcesDir(project)
      await mkdir(destRoot, { recursive: true })
      const files: string[] = []
      for (const abs of absPaths) {
        const ext = extname(abs).toLowerCase()
        if (!SOURCE_EXT.has(ext)) {
          throw new Error(`Unsupported source type ${ext || '(none)'}`)
        }
        const st = await stat(abs)
        if (!st.isFile()) throw new Error(`Not a file: ${abs}`)
        const destName = basename(abs).replace(/[^A-Za-z0-9._-]/g, '_')
        const dest = join(destRoot, destName)
        await copyFile(abs, dest)
        files.push(`sources/${destName}`)
      }
      return { files }
    },

    async inventory(project) {
      const srcDir = sourcesDir(project)
      let names: string[] = []
      try {
        names = await readdir(srcDir)
      } catch {
        return { sources: [] }
      }
      const ffprobe = await ffprobeBin()
      const sources = []
      for (const name of names) {
        if (name.startsWith('.')) continue
        const path = join(srcDir, name)
        const row: { name: string; path: string; duration?: number; error?: string } = {
          name,
          path: `sources/${name}`,
        }
        if (ffprobe) {
          const probed = await runner.run(ffprobe, [
            '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', path,
          ], { timeoutMs: DOCTOR_TIMEOUT_MS })
          const n = Number(probed.stdout.trim())
          if (Number.isFinite(n)) row.duration = n
          else if (probed.code !== 0) row.error = probed.stderr.trim() || 'ffprobe failed'
        }
        sources.push(row)
      }
      return { sources }
    },

    async transcribe(project) {
      const key = deps.getApiKey ? await deps.getApiKey() : null
      if (!key) {
        throw new Error('ElevenLabs API key missing. Store videouse-elevenlabs-api-key or set ELEVENLABS_API_KEY.')
      }
      const { sources } = await engine.inventory(project)
      if (sources.length === 0) throw new Error('No files in sources/. Use videouse_ingest first.')
      const outDir = join(editDir(project), 'transcripts')
      await mkdir(outDir, { recursive: true })
      const transcripts: string[] = []
      for (const src of sources) {
        const stem = src.name.replace(/\.[^.]+$/, '')
        const outRel = `edit/transcripts/${stem}.json`
        const outFull = join(project.dir, outRel)
        try {
          await stat(outFull)
          transcripts.push(outRel)
          continue
        } catch {
          /* not cached */
        }
        const json = await transcribeSource(join(project.dir, src.path), {
          apiKey: key,
          fetchImpl: deps.fetchImpl,
        })
        await writeFile(outFull, JSON.stringify(json, null, 2), 'utf8')
        transcripts.push(outRel)
      }
      return { transcripts }
    },

    async pack(project) {
      const trDir = join(editDir(project), 'transcripts')
      let names: string[] = []
      try {
        names = (await readdir(trDir)).filter((n) => n.endsWith('.json'))
      } catch {
        throw new Error('No transcripts yet. Run videouse_transcribe first.')
      }
      const files = []
      for (const name of names) {
        const raw = JSON.parse(await readFile(join(trDir, name), 'utf8')) as TranscriptFile
        files.push({ name: name.replace(/\.json$/, ''), transcript: raw })
      }
      const packed = packTranscripts(files)
      const rel = 'edit/takes_packed.md'
      const full = join(project.dir, rel)
      await writeFile(full, packed, 'utf8')
      return { path: rel, chars: packed.length }
    },
  }

  engine.enabled = getSettings().videouse.enabled
  logger.debug('Video Use adapter ready')
  return engine
}

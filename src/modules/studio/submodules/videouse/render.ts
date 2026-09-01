// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// video-use hard rules, TypeScript:
//  2. per-segment extract → lossless concat
//  3. 30ms audio fades at every cut
//  1. subtitles LAST
//  4. overlay PTS shift so frame 0 lands at start_in_output

import { mkdir, writeFile, unlink } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import type { CliRunner } from '../../cli-runner.js'
import type { VideoUseEdl } from './edl.js'
import { resolveGradeFilter } from './edl.js'

const FADE = 0.03

function resolvePath(maybe: string, base: string): string {
  return isAbsolute(maybe) ? maybe : resolve(base, maybe)
}

async function runOrThrow(
  runner: CliRunner,
  command: string,
  args: string[],
  timeoutMs: number,
): Promise<void> {
  const result = await runner.run(command, args, { timeoutMs })
  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || `${command} exited ${result.code}`)
  }
}

export async function renderEdl(input: {
  edl: VideoUseEdl
  editDir: string
  outputPath: string
  runner: CliRunner
  ffmpeg: string
  preview?: boolean
  timeoutMs?: number
}): Promise<{ outputPath: string }> {
  const { edl, editDir, outputPath, runner, ffmpeg } = input
  const timeoutMs = input.timeoutMs ?? 600_000
  const clipsDir = join(editDir, input.preview ? 'clips_preview' : 'clips_graded')
  await mkdir(clipsDir, { recursive: true })

  const grade = resolveGradeFilter(edl.grade)
  const scale = 'scale=1920:-2'
  const segPaths: string[] = []

  for (const [i, range] of edl.ranges.entries()) {
    const src = resolvePath(edl.sources[range.source], editDir)
    const duration = range.end - range.start
    const fadeOut = Math.max(0, duration - FADE)
    const vf = [scale, grade].filter(Boolean).join(',')
    const af = `afade=t=in:st=0:d=${FADE},afade=t=out:st=${fadeOut.toFixed(3)}:d=${FADE}`
    const outSeg = join(clipsDir, `seg_${String(i).padStart(2, '0')}_${range.source}.mp4`)
    const preset = input.preview ? 'medium' : 'fast'
    const crf = input.preview ? '22' : '20'
    await runOrThrow(runner, ffmpeg, [
      '-y', '-ss', range.start.toFixed(3), '-i', src, '-t', duration.toFixed(3),
      '-vf', vf, '-af', af,
      '-c:v', 'libx264', '-preset', preset, '-crf', crf,
      '-pix_fmt', 'yuv420p', '-r', '24',
      '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
      '-movflags', '+faststart', outSeg,
    ], timeoutMs)
    segPaths.push(outSeg)
  }

  const concatList = join(editDir, '_concat.txt')
  await writeFile(concatList, segPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n') + '\n')
  const basePath = join(editDir, input.preview ? 'base_preview.mp4' : 'base.mp4')
  await runOrThrow(runner, ffmpeg, [
    '-y', '-f', 'concat', '-safe', '0', '-i', concatList, '-c', 'copy', '-movflags', '+faststart', basePath,
  ], timeoutMs)
  await unlink(concatList).catch(() => undefined)

  const overlays = edl.overlays ?? []
  const subs = edl.subtitles ? resolvePath(edl.subtitles, editDir) : null
  if (overlays.length === 0 && !subs) {
    await mkdir(dirname(outputPath), { recursive: true })
    await runOrThrow(runner, ffmpeg, ['-y', '-i', basePath, '-c', 'copy', outputPath], timeoutMs)
    return { outputPath }
  }

  const args: string[] = ['-y', '-i', basePath]
  for (const ov of overlays) {
    args.push('-i', resolvePath(ov.file, editDir))
  }

  const filterParts: string[] = []
  overlays.forEach((ov, idx) => {
    const n = idx + 1
    filterParts.push(`[${n}:v]setpts=PTS-STARTPTS+${ov.start_in_output}/TB[a${n}]`)
  })
  let current = '[0:v]'
  overlays.forEach((ov, idx) => {
    const n = idx + 1
    const end = ov.start_in_output + ov.duration
    const next = `[v${n}]`
    filterParts.push(
      `${current}[a${n}]overlay=enable='between(t,${ov.start_in_output.toFixed(3)},${end.toFixed(3)})'${next}`,
    )
    current = next
  })
  let outLabel = current
  if (subs) {
    const escaped = subs.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'")
    filterParts.push(
      `${current}subtitles='${escaped}':force_style='FontName=Helvetica,FontSize=18,Bold=1,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=2,Alignment=2,MarginV=90'[outv]`,
    )
    outLabel = '[outv]'
  } else if (overlays.length > 0) {
    filterParts.push(`${current}null[outv]`)
    outLabel = '[outv]'
  }

  await mkdir(dirname(outputPath), { recursive: true })
  await runOrThrow(runner, ffmpeg, [
    ...args,
    '-filter_complex', filterParts.join(';'),
    '-map', outLabel,
    '-map', '0:a',
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '18',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'copy',
    '-movflags', '+faststart',
    outputPath,
  ], timeoutMs)
  return { outputPath }
}

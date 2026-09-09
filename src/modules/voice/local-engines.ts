// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Spawns local STT/TTS binaries. No cloud APIs — operator installs
// faster-whisper / whisper.cpp / Piper and points config.voice at them.
// Commands use shell-safe arg arrays after placeholder expansion.

import { spawn } from 'node:child_process'
import { mkdirSync, existsSync, writeFileSync, unlinkSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import type { Logger } from 'pino'
import type { SttResult, TtsResult, VoiceConfig } from './types.js'

function expand(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? '')
}

/** Split a command string into argv without a shell (quotes not supported — keep templates simple). */
function toArgv(cmd: string): string[] {
  return cmd.trim().split(/\s+/).filter(Boolean)
}

function runCommand(argv: string[], timeoutMs: number, cwd?: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    if (argv.length === 0) return reject(new Error('empty command'))
    const child = spawn(argv[0]!, argv.slice(1), {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`command timed out after ${timeoutMs}ms: ${argv[0]}`))
    }, timeoutMs)
    child.stdout?.on('data', (d) => { stdout += String(d) })
    child.stderr?.on('data', (d) => { stderr += String(d) })
    child.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code: code ?? 1, stdout, stderr })
    })
  })
}

export function createLocalVoiceEngines(config: VoiceConfig, logger: Logger) {
  mkdirSync(config.workDir, { recursive: true })

  function tempPath(ext: string): string {
    return join(config.workDir, `v_${Date.now()}_${randomBytes(4).toString('hex')}.${ext}`)
  }

  return {
    async probe(): Promise<{ stt: boolean; tts: boolean }> {
      // Probe first token of each command with --help / -h (best-effort).
      const probeOne = async (template: string): Promise<boolean> => {
        const bin = toArgv(template)[0]
        if (!bin) return false
        try {
          await runCommand([bin, '--help'], 5_000)
          return true
        } catch {
          try {
            // Binary exists on PATH even if --help fails.
            await runCommand(['which', bin], 3_000)
            return true
          } catch {
            return false
          }
        }
      }
      const [stt, tts] = await Promise.all([
        probeOne(config.stt.command),
        probeOne(config.tts.command),
      ])
      return { stt, tts }
    },

    async transcribe(audioPath: string): Promise<SttResult> {
      if (!existsSync(audioPath)) throw new Error(`STT input missing: ${audioPath}`)
      const outTxt = tempPath('txt')
      const cmd = expand(config.stt.command, {
        input: audioPath,
        output: outTxt,
        language: config.stt.language,
      })
      const started = Date.now()
      logger.debug({ cmd }, 'voice STT spawn')
      const result = await runCommand(toArgv(cmd), config.stt.timeoutMs)
      if (result.code !== 0) {
        throw new Error(`STT failed (exit ${result.code}): ${result.stderr.slice(0, 400)}`)
      }
      let text = ''
      if (existsSync(outTxt)) {
        text = readFileSync(outTxt, 'utf-8').trim()
        try { unlinkSync(outTxt) } catch { /* ignore */ }
      } else {
        // Some tools print transcript on stdout.
        text = result.stdout.trim()
      }
      return { text, durationMs: Date.now() - started }
    },

    async synthesize(text: string, opts?: { voice?: string }): Promise<TtsResult> {
      const clean = text.trim()
      if (!clean) throw new Error('TTS: empty text')
      const outAudio = tempPath('ogg')
      const inTxt = tempPath('in.txt')
      writeFileSync(inTxt, clean, 'utf-8')
      const cmd = expand(config.tts.command, {
        input: inTxt,
        output: outAudio,
        text: clean,
        voice: opts?.voice ?? config.tts.voice,
      })
      const started = Date.now()
      logger.debug({ cmd }, 'voice TTS spawn')
      try {
        const result = await runCommand(toArgv(cmd), config.tts.timeoutMs)
        if (result.code !== 0 || !existsSync(outAudio)) {
          throw new Error(`TTS failed (exit ${result.code}): ${result.stderr.slice(0, 400)}`)
        }
        return { audioPath: outAudio, durationMs: Date.now() - started }
      } finally {
        try { unlinkSync(inTxt) } catch { /* ignore */ }
      }
    },
  }
}

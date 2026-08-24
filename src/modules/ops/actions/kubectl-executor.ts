// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { ALLOWED_KUBECTL_COMMANDS, sanitizeArg } from './kubectl-generator.js'

export interface KubectlExecResult { ok: boolean; output?: string; error?: string; durationMs: number }
export interface KubectlExecutor { exec(command: string, args: string[]): Promise<KubectlExecResult> }
export type SpawnFn = (argv: string[], opts: { env?: Record<string, string> }) => {
  exited: Promise<number>; exitCode: number | null; stdout: ReadableStream | null; stderr: ReadableStream | null; kill: () => void
}

async function drain(s: ReadableStream | null): Promise<string> {
  if (!s) return ''
  return await new Response(s).text()
}

export function createKubectlExecutor(cfg: {
  enabled: boolean; kubeconfigPath?: string | null; binary?: string; spawn?: SpawnFn; timeoutMs?: number
}): KubectlExecutor {
  const binary = cfg.binary ?? 'kubectl'
  const timeoutMs = cfg.timeoutMs ?? 15_000
  const spawn: SpawnFn = cfg.spawn ?? ((argv, opts) => Bun.spawn(argv, { stdout: 'pipe', stderr: 'pipe', env: { ...process.env, ...(opts.env ?? {}) } }) as unknown as ReturnType<SpawnFn>)
  return {
    async exec(command, args) {
      const started = Date.now()
      if (!cfg.enabled) return { ok: false, error: 'kubectl execution disabled', durationMs: 0 }
      if (!ALLOWED_KUBECTL_COMMANDS.has(command)) return { ok: false, error: `command '${command}' not allowed`, durationMs: 0 }
      const safe: string[] = []
      for (const a of args) { const s = sanitizeArg(a); if (s === null) return { ok: false, error: `argument '${a}' rejected`, durationMs: 0 }; safe.push(s) }
      const env: Record<string, string> = cfg.kubeconfigPath ? { KUBECONFIG: cfg.kubeconfigPath } : {}
      try {
        const proc = spawn([binary, command, ...safe], { env })
        const timer = setTimeout(() => proc.kill(), timeoutMs)
        const [code, out, err] = await Promise.all([proc.exited, drain(proc.stdout), drain(proc.stderr)])
        clearTimeout(timer)
        const durationMs = Date.now() - started
        if (code !== 0) return { ok: false, error: (err || `exit ${code}`).trim(), durationMs }
        return { ok: true, output: out.slice(0, 64_000), durationMs }
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e), durationMs: Date.now() - started }
      }
    },
  }
}

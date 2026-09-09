// Part of eYssen. See LICENSE file for full copyright and licensing details.

/**
 * Wave 3 — SSH remote execution for remote-node invoke.
 * Uses the `ssh2` package (already a dependency). Secrets never logged.
 */

export interface SshExecRequest {
  host: string
  port?: number
  username: string
  /** Password or private key PEM — never log. */
  password?: string
  privateKey?: string
  command: string
  /** Default 60s */
  timeoutMs?: number
  cwd?: string
}

export interface SshExecResult {
  code: number | null
  stdout: string
  stderr: string
  durationMs: number
}

export async function sshExec(req: SshExecRequest): Promise<SshExecResult> {
  const { Client } = await import('ssh2')
  const start = Date.now()
  const timeoutMs = req.timeoutMs ?? 60_000

  return new Promise((resolve, reject) => {
    const conn = new Client()
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      try { conn.end() } catch { /* */ }
      reject(new Error(`SSH timed out after ${timeoutMs}ms`))
    }, timeoutMs)

    conn
      .on('ready', () => {
        const cmd = req.cwd ? `cd ${shellQuote(req.cwd)} && ${req.command}` : req.command
        conn.exec(cmd, (err, stream) => {
          if (err) {
            clearTimeout(timer)
            if (!settled) {
              settled = true
              conn.end()
              reject(err)
            }
            return
          }
          let stdout = ''
          let stderr = ''
          stream
            .on('close', (code: number | null) => {
              clearTimeout(timer)
              if (settled) return
              settled = true
              conn.end()
              resolve({
                code: code ?? null,
                stdout: stdout.slice(0, 200_000),
                stderr: stderr.slice(0, 50_000),
                durationMs: Date.now() - start,
              })
            })
            .on('data', (d: Buffer) => { stdout += d.toString('utf8') })
          stream.stderr.on('data', (d: Buffer) => { stderr += d.toString('utf8') })
        })
      })
      .on('error', (err: Error) => {
        clearTimeout(timer)
        if (!settled) {
          settled = true
          reject(err)
        }
      })
      .connect({
        host: req.host,
        port: req.port ?? 22,
        username: req.username,
        password: req.password,
        privateKey: req.privateKey,
        readyTimeout: Math.min(timeoutMs, 20_000),
      })
  })
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}

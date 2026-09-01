// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { createProcessRunner } from '@modules/studio/cli-runner'

describe('process runner', () => {
  it('strips --no-sandbox even if a caller passes it', async () => {
    const runner = createProcessRunner()
    const node = process.execPath
    const result = await runner.run(node, ['-e', 'process.stdout.write(JSON.stringify(process.argv))', '--no-sandbox'], {
      timeoutMs: 5_000,
    })
    expect(result.code).toBe(0)
    expect(result.stdout).not.toContain('--no-sandbox')
  })

  it('pipes stdin when input is set', async () => {
    const runner = createProcessRunner()
    const node = process.execPath
    const result = await runner.run(node, ['-e', 'let s=""; process.stdin.on("data",d=>s+=d); process.stdin.on("end",()=>process.stdout.write(s))'], {
      input: 'hello-stdin',
      timeoutMs: 5_000,
    })
    expect(result.code).toBe(0)
    expect(result.stdout).toBe('hello-stdin')
  })
})

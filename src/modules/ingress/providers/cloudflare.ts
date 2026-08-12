// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { spawn, type ChildProcess } from 'child_process'
import type { IngressProvider } from '../types.js'

export function createCloudflareProvider(): IngressProvider {
  let process: ChildProcess | null = null
  let tunnelUrl: string | undefined

  return {
    id: 'cloudflare',

    async start(config) {
      if (process) {
        throw new Error('Cloudflare tunnel is already running')
      }

      const args = ['tunnel', 'run']
      if (config.token) {
        args.push('--token', config.token)
      }

      process = spawn('cloudflared', args, {
        stdio: ['ignore', 'pipe', 'pipe'],
      })

      // Try to capture tunnel URL from stderr output
      process.stderr?.on('data', (data: Buffer) => {
        const output = data.toString()
        const match = output.match(/https?:\/\/[^\s]+\.trycloudflare\.com/)
        if (match) {
          tunnelUrl = match[0]
        }
      })

      process.on('exit', () => {
        process = null
        tunnelUrl = undefined
      })

      // Give cloudflared a moment to start
      await new Promise((resolve) => setTimeout(resolve, 1000))
    },

    async stop() {
      if (process) {
        process.kill('SIGTERM')
        process = null
        tunnelUrl = undefined
      }
    },

    getStatus() {
      return {
        running: process !== null,
        url: tunnelUrl,
      }
    },
  }
}

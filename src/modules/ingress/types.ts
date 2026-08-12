// Part of eYssen. See LICENSE file for full copyright and licensing details.

export interface IngressProvider {
  id: string
  start(config: { token?: string; hostname?: string }): Promise<void>
  stop(): Promise<void>
  getStatus(): { running: boolean; url?: string }
}

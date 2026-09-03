// Part of eYssen. See LICENSE file for full copyright and licensing details.

export interface IngressStatus {
  running: boolean
  /** Alias of running — used by the Ingress settings UI. */
  active: boolean
  url?: string
  hostname?: string
  connectedAt?: string | null
  lastError?: string | null
}

export interface IngressProvider {
  id: string
  start(config: { token?: string; hostname?: string }): Promise<IngressStatus>
  stop(): Promise<void>
  getStatus(): IngressStatus
}

export function publicIngressStatus(status: IngressStatus): IngressStatus & { status: IngressStatus } {
  return { ...status, status }
}

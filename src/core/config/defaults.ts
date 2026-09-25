// Part of eYssen. See LICENSE file for full copyright and licensing details.

/**
 * Canonical default HTTP port for EYAS.
 *
 * 3100 (not 3000): 3000 is commonly taken by Grafana, Create-React-App,
 * Next.js, and other local stacks. EYAS intentionally defaults aside from that.
 *
 * Override via: config `server.port` → EYAS_PORT → CLI `--port`.
 */
export const DEFAULT_SERVER_PORT = 3100

export const DEFAULT_SERVER_HOST = '0.0.0.0'

// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { SubmoduleManifest } from '@core/types'

// Off by default: this submodule publishes EYAS's tool surface to outside
// clients. Exposing it is an operator decision, not a default.
export const mcpServerManifest: SubmoduleManifest = {
  id: 'communication.mcp-server',
  name: 'MCP Server',
  parentModule: 'communication',
  enabled: false,
}

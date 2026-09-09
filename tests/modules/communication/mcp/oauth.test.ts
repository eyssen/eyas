// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { generatePkce, buildAuthorizationUrl, mcpResourceUrl } from '@modules/communication/submodules/mcp-client/oauth'
import { mcpOAuthReturnPath } from '@modules/communication/submodules/mcp-client/oauth-flow'

describe('MCP OAuth PKCE', () => {
  it('generatePkce returns a 43+ char verifier and S256 challenge', async () => {
    const { verifier, challenge } = await generatePkce()
    expect(verifier.length).toBeGreaterThanOrEqual(43)
    expect(challenge.length).toBeGreaterThan(20)
    expect(verifier).not.toBe(challenge)
  })

  it('buildAuthorizationUrl includes client params and S256', () => {
    const url = buildAuthorizationUrl({
      authorizationEndpoint: 'https://auth.example.com/authorize',
      clientId: 'eyas',
      redirectUri: 'http://127.0.0.1:3100/api/v1/mcp/oauth/callback',
      challenge: 'abc',
      state: 'st',
      resource: 'https://mcp.example.com',
    })
    const u = new URL(url)
    expect(u.searchParams.get('code_challenge_method')).toBe('S256')
    expect(u.searchParams.get('code_challenge')).toBe('abc')
    expect(u.searchParams.get('state')).toBe('st')
    expect(u.searchParams.get('resource')).toBe('https://mcp.example.com')
    expect(u.searchParams.get('response_type')).toBe('code')
  })

  it('mcpResourceUrl keeps the MCP path (not origin)', () => {
    expect(mcpResourceUrl('https://mcp.higgsfield.ai/mcp')).toBe('https://mcp.higgsfield.ai/mcp')
    expect(mcpResourceUrl('https://mcp.fal.ai/mcp')).toBe('https://mcp.fal.ai/mcp')
    expect(mcpResourceUrl('https://mcp.magnific.com')).toBe('https://mcp.magnific.com')
    expect(mcpResourceUrl('  https://mcp.higgsfield.ai/mcp  ')).toBe('https://mcp.higgsfield.ai/mcp')
  })

  it('buildAuthorizationUrl resource may include a path', () => {
    const url = buildAuthorizationUrl({
      authorizationEndpoint: 'https://auth.example.com/authorize',
      clientId: 'eyas',
      redirectUri: 'http://127.0.0.1:3100/api/v1/mcp/oauth/callback',
      challenge: 'abc',
      state: 'st',
      resource: 'https://mcp.higgsfield.ai/mcp',
    })
    expect(new URL(url).searchParams.get('resource')).toBe('https://mcp.higgsfield.ai/mcp')
  })

  it('mcpOAuthReturnPath sends media-owned servers back to /media', () => {
    expect(mcpOAuthReturnPath('media')).toBe('/media')
    expect(mcpOAuthReturnPath(null)).toBe('/mcp-settings')
    expect(mcpOAuthReturnPath(undefined)).toBe('/mcp-settings')
  })
})

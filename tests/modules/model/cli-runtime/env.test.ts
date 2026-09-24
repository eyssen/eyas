// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { buildCliEnv } from '@modules/model/cli-runtime/env.js'

const ROOT = '/srv/eyas-workspaces'

/** A server environment as EYAS might inherit it from a developer shell. */
const HOST: NodeJS.ProcessEnv = {
  PATH: '/usr/local/bin:/usr/bin',
  HOME: '/home/operator',
  LANG: 'en_US.UTF-8',
  LC_ALL: 'en_US.UTF-8',
  LC_CTYPE: 'UTF-8',
  TZ: 'UTC',
  TMPDIR: '/tmp/x',
  TERM: 'xterm',
  USER: 'operator',
  HTTPS_PROXY: 'http://proxy:3128',
  no_proxy: 'localhost',
  NODE_EXTRA_CA_CERTS: '/etc/ca.pem',
  ANTHROPIC_API_KEY: 'sk-ant',
  ANTHROPIC_BASE_URL: 'https://gw.example',
  CLAUDE_CODE_OAUTH_TOKEN: 'oauth',
  CLAUDE_CODE_USE_BEDROCK: '1',
  AWS_REGION: 'eu-west-1',
  AWS_PROFILE: 'bedrock',
  CLOUD_ML_REGION: 'europe-west4',
  ANTHROPIC_VERTEX_PROJECT_ID: 'proj',
  // Everything below must never reach a CLI child.
  CLAUDECODE: '1',
  CLAUDE_CODE_SIMPLE: '1',
  CLAUDE_CODE_ENTRYPOINT: 'cli',
  CLAUDE_CONFIG_DIR: '/home/operator/.claude',
  GROK_MEMORY: '1',
  GROK_FOLDER_TRUST: '0',
  GROK_HOME: '/home/operator/.grok',
  KIMI_SHARE_DIR: '/home/operator/.kimi',
  OPENCODE_CONFIG: '/x',
  XAI_API_KEY: 'xai',
  OPENAI_API_KEY: 'sk-openai',
  GEMINI_API_KEY: 'g',
  EYAS_MASTER_KEY: 'secret',
  EYAS_DATA_DIR: '/srv/eyas/data',
  XDG_CONFIG_HOME: '/home/operator/.config',
  XDG_DATA_HOME: '/home/operator/.local/share',
  NODE_OPTIONS: '--require /tmp/evil.js',
  SOME_UNKNOWN_VAR: 'x',
}

describe('buildCliEnv — base allowlist', () => {
  it('keeps PATH, locale, time zone, proxies and CA bundles for every profile', () => {
    for (const profile of ['claude-code', 'grok-cli', 'kimi-cli', 'opencode'] as const) {
      const env = buildCliEnv(profile, { source: HOST, workspacesRoot: ROOT })
      expect(env.PATH).toBe(HOST.PATH)
      expect(env.LANG).toBe('en_US.UTF-8')
      expect(env.LC_ALL).toBe('en_US.UTF-8')
      expect(env.LC_CTYPE).toBe('UTF-8')
      expect(env.TZ).toBe('UTC')
      expect(env.TMPDIR).toBe('/tmp/x')
      expect(env.HTTPS_PROXY).toBe('http://proxy:3128')
      expect(env.no_proxy).toBe('localhost')
      expect(env.NODE_EXTRA_CA_CERTS).toBe('/etc/ca.pem')
    }
  })

  it('strips host CLI switches, provider keys, EYAS and XDG variables even when set', () => {
    for (const profile of ['claude-code', 'grok-cli', 'kimi-cli', 'opencode'] as const) {
      const env = buildCliEnv(profile, { source: HOST, workspacesRoot: ROOT })
      for (const key of [
        'CLAUDECODE', 'CLAUDE_CODE_SIMPLE', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CONFIG_DIR',
        'GROK_MEMORY', 'GROK_FOLDER_TRUST', 'GROK_HOME', 'KIMI_SHARE_DIR', 'OPENCODE_CONFIG',
        'XAI_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY',
        'EYAS_MASTER_KEY', 'EYAS_DATA_DIR', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'NODE_OPTIONS',
      ]) {
        expect(env[key], `${profile} ${key}`).toBeUndefined()
      }
    }
  })

  it('drops variables it does not know', () => {
    const env = buildCliEnv('grok-cli', { source: HOST, workspacesRoot: ROOT })
    expect(env.SOME_UNKNOWN_VAR).toBeUndefined()
  })

  it('sets GIT_CEILING_DIRECTORIES to the workspaces root', () => {
    expect(buildCliEnv('kimi-cli', { source: HOST, workspacesRoot: ROOT }).GIT_CEILING_DIRECTORIES).toBe(ROOT)
  })

  it('defaults the ceiling to the instance workspaces root', () => {
    const env = buildCliEnv('grok-cli', { source: HOST })
    expect(env.GIT_CEILING_DIRECTORIES).toBe(process.env.EYAS_WORKSPACES_DIR)
  })
})

describe('buildCliEnv — profiles', () => {
  it('gives Claude Code the host HOME and its auth variables (shared login)', () => {
    const env = buildCliEnv('claude-code', { source: HOST, workspacesRoot: ROOT })
    expect(env.HOME).toBe('/home/operator')
    expect(env.ANTHROPIC_API_KEY).toBe('sk-ant')
    expect(env.ANTHROPIC_BASE_URL).toBe('https://gw.example')
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe('oauth')
    expect(env.CLAUDE_CODE_USE_BEDROCK).toBe('1')
    expect(env.AWS_REGION).toBe('eu-west-1')
    expect(env.AWS_PROFILE).toBe('bedrock')
    expect(env.CLOUD_ML_REGION).toBe('europe-west4')
    expect(env.ANTHROPIC_VERTEX_PROJECT_ID).toBe('proj')
  })

  it('gives Grok, Kimi and OpenCode neither the host HOME nor Anthropic or AWS credentials', () => {
    for (const profile of ['grok-cli', 'kimi-cli', 'opencode'] as const) {
      const env = buildCliEnv(profile, { source: HOST, workspacesRoot: ROOT })
      expect(env.HOME, profile).toBeUndefined()
      expect(env.ANTHROPIC_API_KEY, profile).toBeUndefined()
      expect(env.CLAUDE_CODE_OAUTH_TOKEN, profile).toBeUndefined()
      expect(env.AWS_REGION, profile).toBeUndefined()
    }
  })

  it('points HOME at the EYAS-owned home when one is given', () => {
    const env = buildCliEnv('grok-cli', { source: HOST, workspacesRoot: ROOT, home: '/srv/eyas/data/cli-homes/grok-cli' })
    expect(env.HOME).toBe('/srv/eyas/data/cli-homes/grok-cli')
    expect(env.USERPROFILE).toBeUndefined()
  })

  it('also sets USERPROFILE for an EYAS-owned home on Windows', () => {
    const env = buildCliEnv('kimi-cli', { source: {}, workspacesRoot: ROOT, home: 'C:\\eyas\\cli-homes\\kimi-cli', platform: 'win32' })
    expect(env.USERPROFILE).toBe('C:\\eyas\\cli-homes\\kimi-cli')
  })

  it('matches Windows variable names case-insensitively', () => {
    const env = buildCliEnv('grok-cli', {
      source: { Path: 'C:\\bin', SystemRoot: 'C:\\Windows', ComSpec: 'cmd.exe', xai_api_key: 'x' },
      workspacesRoot: ROOT,
      platform: 'win32',
    })
    expect(env.Path).toBe('C:\\bin')
    expect(env.SystemRoot).toBe('C:\\Windows')
    expect(env.ComSpec).toBe('cmd.exe')
    expect(env.xai_api_key).toBeUndefined()
  })
})

describe('buildCliEnv — extra', () => {
  it('applies extra variables last', () => {
    const env = buildCliEnv('grok-cli', {
      source: HOST,
      workspacesRoot: ROOT,
      extra: { GROK_SANDBOX: 'eyas', GROK_MEMORY: '0', LANG: 'C' },
    })
    expect(env.GROK_SANDBOX).toBe('eyas')
    expect(env.GROK_MEMORY).toBe('0')
    expect(env.LANG).toBe('C')
  })

  it('removes a key whose extra value is undefined', () => {
    const env = buildCliEnv('claude-code', { source: HOST, workspacesRoot: ROOT, extra: { ANTHROPIC_BASE_URL: undefined } })
    expect(env.ANTHROPIC_BASE_URL).toBeUndefined()
    expect('ANTHROPIC_BASE_URL' in env).toBe(false)
  })

  it('reads process.env by default and never mutates it', () => {
    const before = { ...process.env }
    const env = buildCliEnv('claude-code', { workspacesRoot: ROOT, extra: { EYAS_TEST_MARK: '1' } })
    expect(env.EYAS_TEST_MARK).toBe('1')
    expect(process.env).toEqual(before)
  })
})

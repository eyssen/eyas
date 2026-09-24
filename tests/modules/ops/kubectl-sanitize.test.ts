// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, it, expect } from 'vitest'
import { sanitizeArg } from '@modules/ops/actions/kubectl-generator'

describe('sanitizeArg — identity/connection-override flag denylist (M-3 hardening)', () => {
  it('rejects flags that override auth identity or cluster connection', () => {
    expect(sanitizeArg('--as=system:admin')).toBeNull()
    expect(sanitizeArg('--as-group=system:masters')).toBeNull()
    expect(sanitizeArg('--as-uid=0')).toBeNull()
    expect(sanitizeArg('--kubeconfig=/x')).toBeNull()
    expect(sanitizeArg('--token=abc')).toBeNull()
    expect(sanitizeArg('--server=https://evil')).toBeNull()
    expect(sanitizeArg('-s')).toBeNull()
    expect(sanitizeArg('-s=https://evil')).toBeNull()
    expect(sanitizeArg('--insecure-skip-tls-verify')).toBeNull()
    expect(sanitizeArg('--username=admin')).toBeNull()
    expect(sanitizeArg('--password=hunter2')).toBeNull()
    expect(sanitizeArg('-u')).toBeNull()
    expect(sanitizeArg('--client-certificate=/x')).toBeNull()
    expect(sanitizeArg('--client-key=/x')).toBeNull()
    expect(sanitizeArg('--certificate-authority=/x')).toBeNull()
    expect(sanitizeArg('--tls-server-name=evil')).toBeNull()
    expect(sanitizeArg('--cluster=other')).toBeNull()
    expect(sanitizeArg('--context=other')).toBeNull()
    expect(sanitizeArg('--user=other')).toBeNull()
    expect(sanitizeArg('--password-stdin')).toBeNull()
    expect(sanitizeArg('--cache-dir=/x')).toBeNull()
  })

  it('matches denied flag names case-insensitively', () => {
    expect(sanitizeArg('--AS=system:admin')).toBeNull()
    expect(sanitizeArg('--KubeConfig=/x')).toBeNull()
    expect(sanitizeArg('--TOKEN=abc')).toBeNull()
  })

  it('rejects the bare (no =value) form of a denied flag too', () => {
    expect(sanitizeArg('--as')).toBeNull()
    expect(sanitizeArg('--kubeconfig')).toBeNull()
    expect(sanitizeArg('--server')).toBeNull()
  })

  it('still allows legitimate read-only diagnostic flags', () => {
    expect(sanitizeArg('-n')).toBe('-n')
    expect(sanitizeArg('--namespace=default')).toBe('--namespace=default')
    expect(sanitizeArg('-o')).toBe('-o')
    expect(sanitizeArg('wide')).toBe('wide')
    expect(sanitizeArg('-l')).toBe('-l')
    expect(sanitizeArg('--tail=100')).toBe('--tail=100')
    expect(sanitizeArg('--previous')).toBe('--previous')
    expect(sanitizeArg('--since=5m')).toBe('--since=5m')
    expect(sanitizeArg('--since-time=2026-07-09T00:00:00Z')).toBe('--since-time=2026-07-09T00:00:00Z')
    expect(sanitizeArg('-c')).toBe('-c')
    expect(sanitizeArg('--container=app')).toBe('--container=app')
    expect(sanitizeArg('-A')).toBe('-A')
    expect(sanitizeArg('--all-namespaces')).toBe('--all-namespaces')
    expect(sanitizeArg('-f')).toBe('-f')
    expect(sanitizeArg('--follow')).toBe('--follow')
    expect(sanitizeArg('--field-selector=status.phase=Running')).toBe('--field-selector=status.phase=Running')
    expect(sanitizeArg('--show-labels')).toBe('--show-labels')
    expect(sanitizeArg('--sort-by=.metadata.name')).toBe('--sort-by=.metadata.name')
    expect(sanitizeArg('--limit=50')).toBe('--limit=50')
    expect(sanitizeArg('--chunk-size=100')).toBe('--chunk-size=100')
    expect(sanitizeArg('pods')).toBe('pods')
    expect(sanitizeArg('my-pod')).toBe('my-pod')
  })

  it('allows a positional value that merely contains "=" (e.g. a selector value)', () => {
    // -l app=web: '-l' is the flag, 'app=web' arrives as its own arg and does
    // not start with '-', so it must pass even though it contains '='.
    expect(sanitizeArg('app=web')).toBe('app=web')
  })

  it('does not reject an arg merely for starting with "-"', () => {
    expect(sanitizeArg('-n')).toBe('-n')
    expect(sanitizeArg('--namespace')).toBe('--namespace')
  })
})

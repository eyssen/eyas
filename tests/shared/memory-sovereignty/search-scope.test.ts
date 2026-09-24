// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// K1: the effective search set of a tool call — its folder and the include
// globs that narrow it — read from native search tools and shell command
// lines, and the conservative "may this glob reach that folder" matcher.

import { describe, expect, it } from 'vitest'
import {
  argvSearchScopes,
  compileSearchGlobs,
  embeddedShellScripts,
  nativeSearchKind,
  searchScopesOf,
  shellSearchScopes,
  splitIncludeGlobs,
} from '@shared/memory-sovereignty/search-scope.js'
import { expandBraces, shellSimpleCommands } from '@shared/memory-sovereignty/shell-paths.js'

const home = '/home/u'
const base = '/work/proj'
const opts = { base, homeDir: home }
const roots = (scopes: Array<{ root: string }>) => scopes.map((s) => s.root)

describe('native search tools', () => {
  it('(+) Claude Code, Grok and OpenCode search tools are searches; EYAS\'s own grep/glob and other tools are not', () => {
    expect(nativeSearchKind('Grep', {})).toBe('grep')
    expect(nativeSearchKind('Glob', {})).toBe('glob')
    expect(nativeSearchKind('LS', {})).toBe('list')
    expect(nativeSearchKind('AcpUnmappedTool', { variant: 'ListDir' })).toBe('list')
    expect(nativeSearchKind('Grep', { variant: 'Grep' })).toBe('grep')
    expect(nativeSearchKind('grep', {})).toBeNull()
    expect(nativeSearchKind('glob', {})).toBeNull()
    expect(nativeSearchKind('Read', { file_path: '/x' })).toBeNull()
  })

  it('(+) the folder comes from path / target_directory / directory, else the working directory', () => {
    expect(searchScopesOf('Grep', { pattern: 'x', path: '~/notes', glob: '*.md' }, opts)).toEqual([
      { field: 'path', root: '/home/u/notes', globs: ['*.md'], anywhere: true },
    ])
    expect(searchScopesOf('Grep', { pattern: 'x' }, opts)).toEqual([{ field: 'cwd', root: base, globs: [], anywhere: true }])
    expect(searchScopesOf('X', { variant: 'ListDir', target_directory: 'sub' }, opts)).toEqual([
      { field: 'target_directory', root: '/work/proj/sub', globs: [], anywhere: true },
    ])
    expect(searchScopesOf('Glob', { pattern: '**/*.ts', directory: '/abs' }, opts)).toEqual([
      { field: 'directory', root: '/abs', globs: ['**/*.ts'], anywhere: true },
    ])
  })

  it('(+) an absolute Glob pattern searches from its literal folder', () => {
    expect(searchScopesOf('Glob', { pattern: '/home/u/**/MEMORY.md' }, opts)).toEqual([
      { field: 'pattern', root: '/home/u', globs: ['**/MEMORY.md'], anywhere: true },
    ])
    expect(searchScopesOf('Glob', { pattern: '/home/u/notes/today.md' }, opts)).toEqual([
      { field: 'pattern', root: '/home/u/notes', globs: ['today.md'], anywhere: true },
    ])
  })

  it('(−) a relative folder without a working directory opens no scope', () => {
    expect(searchScopesOf('Grep', { pattern: 'x', path: 'sub' }, { homeDir: home })).toEqual([])
    expect(searchScopesOf('Grep', { pattern: 'x' }, { homeDir: home })).toEqual([])
  })

  it('(+) Claude Code\'s glob splitting (whitespace, commas outside braces) plus the whole value', () => {
    expect(splitIncludeGlobs('*.ts, *.tsx')).toEqual(expect.arrayContaining(['*.ts', '*.tsx']))
    expect(splitIncludeGlobs('*.{ts,tsx}')).toEqual(['*.{ts,tsx}'])
  })
})

describe('shell command lines', () => {
  it('(+) recursive programs: grep -r, rg, find, fd, tree, du, ls -R, recursive copies and archives', () => {
    expect(roots(shellSearchScopes('grep -rn token ~/notes', opts))).toEqual(['/home/u/notes'])
    expect(roots(shellSearchScopes('grep -R -e token -A 3 src docs', opts))).toEqual(['/work/proj/src', '/work/proj/docs'])
    expect(roots(shellSearchScopes('grep --recursive token', opts))).toEqual([base])
    expect(roots(shellSearchScopes('grep -d recurse token ~', opts))).toEqual([home])
    expect(roots(shellSearchScopes('rg -g "*.md" token ~', opts))).toEqual([home])
    expect(roots(shellSearchScopes('rg --files', opts))).toEqual([base])
    expect(roots(shellSearchScopes('find -L ~ /tmp -name x', opts))).toEqual([home, '/tmp'])
    expect(roots(shellSearchScopes('fd MEMORY --search-path ~', opts))).toEqual([home])
    expect(roots(shellSearchScopes('tree -L 2', opts))).toEqual([base])
    expect(roots(shellSearchScopes('ls -laR ~', opts))).toEqual([home])
    expect(roots(shellSearchScopes('cp -a ~ /tmp/x', opts))).toEqual([home])
    expect(roots(shellSearchScopes('tar czf out.tgz ~', opts))).toEqual(expect.arrayContaining([home]))
    expect(roots(shellSearchScopes('zip -r out.zip ~/Documents', opts))).toEqual(expect.arrayContaining(['/home/u/Documents']))
    expect(roots(shellSearchScopes('locate MEMORY.md', opts))).toEqual(['/'])
    expect(roots(shellSearchScopes('mdfind -onlyin ~/proj token', opts))).toEqual(['/home/u/proj'])
    expect(roots(shellSearchScopes('git grep --no-index token', opts))).toEqual([base])
  })

  it('(+) wrappers, assignments, sh -c scripts and substitutions are looked through', () => {
    expect(roots(shellSearchScopes('FOO=1 nice -n 5 timeout 10 grep -r x ~', opts))).toEqual([home])
    expect(roots(shellSearchScopes('sudo -u other grep -r x ~', opts))).toEqual([home])
    expect(roots(shellSearchScopes("bash -c 'rg x ~'", opts))).toEqual([home])
    expect(roots(shellSearchScopes('echo "$(grep -r x ~)"', opts))).toEqual([home])
    expect(roots(shellSearchScopes('echo $(rg x ~)', opts))).toEqual([home])
  })

  it('(+) a cd moves later relative searches; every folder it may have moved to is kept', () => {
    expect(roots(shellSearchScopes('cd ~ && grep -r x .', opts))).toEqual([base, home])
    expect(roots(shellSearchScopes('cd && rg x', opts))).toEqual([base, home])
  })

  it('(+) glob words list what they match below their literal prefix, anchored', () => {
    expect(shellSearchScopes('cat ~/.*/projects/*/memory/*.md', opts)).toEqual([
      { field: 'command', root: home, globs: ['.*/projects/*/memory/*.md'], anywhere: false },
    ])
    expect(shellSearchScopes('ls *.md', opts)).toEqual([{ field: 'command', root: base, globs: ['*.md'], anywhere: false }])
  })

  it('(−) not searches: non-recursive programs, quoted globs, options, patterns', () => {
    expect(shellSearchScopes('ls ~', opts)).toEqual([])
    expect(shellSearchScopes('cat ~/notes/today.md', opts)).toEqual([])
    expect(shellSearchScopes("find . -name '*.md'", opts).map((s) => s.globs)).toEqual([[]])
    expect(shellSearchScopes('grep token file.txt', opts)).toEqual([])
    expect(shellSearchScopes('git grep token', opts)).toEqual([])
    expect(shellSearchScopes('cp a.txt b.txt', opts)).toEqual([])
    expect(shellSearchScopes('rg --type-add "web:*.{html,css}" -tweb x src', opts).map((s) => s.root)).toEqual(['/work/proj/src'])
  })

  it('(+) run_command: program and argv, nothing expanded', () => {
    expect(argvSearchScopes('grep', ['-r', 'token', '/home/u'], opts)).toEqual([{ field: 'args', root: home, globs: [], anywhere: false }])
    expect(argvSearchScopes('rg', ['token'], opts)).toEqual([{ field: 'args', root: base, globs: [], anywhere: false }])
    expect(argvSearchScopes('cat', ['a.txt'], opts)).toEqual([])
    expect(searchScopesOf('run_command', { command: 'find', args: ['/home/u', '-name', 'x'] }, opts).map((s) => s.field)).toEqual(['args'])
  })
})

describe('shell command lines — grammar the search check must not be fooled by', () => {
  const none = (command: string) => expect(shellSearchScopes(command, opts), command).toEqual([])

  it('(−) here-document lines are data: no glob word, no command (JSDoc, CSS comments, commit messages, scripts for other programs)', () => {
    none("cat > src/foo.ts <<'EOF'\n/**\n * Doc\n */\nexport const a = 1\nEOF")
    none("cat > src/a.css <<'EOF'\n/* header */\nbody { color: red }\nEOF")
    none('git commit -m "$(cat <<\'EOF\'\nfix: thing (scope)\n\n* bullet\n1) first\nEOF\n)"')
    none("python3 - <<'EOF'\nimport os\nprint(os.listdir('/'))\nEOF")
    none("cat > s.sh <<'EOF'\nfind / -name x\ngrep -r x ~\nEOF")
    none('cat <<-EOF > notes.md\n\t* one\n\tEOF')
    none("cat <<'EOF' > out.txt\n$(grep -r token ~)\nEOF")
  })

  it('(+) what the shell does run around a here-document is still read', () => {
    expect(roots(shellSearchScopes("cat > a.md <<'EOF'\ndon't\nEOF\ngrep -r token ~", opts))).toEqual([home])
    // An unquoted delimiter: the body's substitutions run.
    expect(roots(shellSearchScopes('cat <<EOF > out.txt\n$(grep -r token ~)\nEOF', opts))).toEqual([home])
    // A delimiter that never comes: the lines are read as commands (conservative).
    expect(roots(shellSearchScopes('cat <<Z\ngrep -r token ~\nZZ', opts))).toEqual([home])
    // `<<` in arithmetic is a shift, not a here-document; arithmetic that never closes hides nothing.
    expect(roots(shellSearchScopes('x=$((1 << 2))\ngrep -r token ~', opts))).toEqual([home])
    expect(roots(shellSearchScopes('((1 << Z))\ngrep -r token ~\nZ', opts))).toEqual([home])
    expect(roots(shellSearchScopes('echo $[ ; grep -r token ~', opts))).toContain(home)
    expect(roots(shellSearchScopes('echo $(( ; grep -r token ~', opts))).toContain(home)
    // The delimiter closing a substitution on its own line.
    expect(roots(shellSearchScopes('echo "$(cat <<EOF\nx\nEOF)"; grep -r token ~', opts))).toEqual([home])
  })

  it('(+) a shell that reads its script from a here-document, a here-string or a pipe runs those lines', () => {
    expect(roots(shellSearchScopes("bash <<'EOF'\ngrep -r token ~\nEOF", opts))).toEqual([home])
    expect(roots(shellSearchScopes("cat <<'EOF' | sh\nfind ~ -name x\nEOF", opts))).toEqual([home])
    expect(roots(shellSearchScopes("bash <<< 'grep -r token ~'", opts))).toEqual([home])
    expect(roots(shellSearchScopes("bash -s <<'EOF'\nrg token ~\nEOF", opts))).toEqual([home])
    expect(roots(shellSearchScopes("bash -lc 'grep -r token ~'", opts))).toEqual([home])
    // A script file: what it holds is not on the line.
    none("bash build.sh <<'EOF'\ngrep -r token ~\nEOF")
  })

  it('(+) reserved words, groups, negation, coproc and eval stand before the search', () => {
    for (const command of [
      'if true; then grep -r token ~; fi',
      'if grep -rq token ~; then echo y; fi',
      '{ grep -r token ~; }',
      '! grep -r token ~',
      'while true; do grep -r token ~; break; done',
      'until false; do grep -r token ~; done',
      'coproc grep -r token ~',
      'coproc NAME { grep -r token ~; }',
      'eval grep -r token ~',
      'eval "grep -r token ~"',
    ]) {
      expect(roots(shellSearchScopes(command, opts)), command).toContain(home)
    }
  })

  it('(+) a redirection takes one word: the command goes on after its target, a descriptor number is not a path', () => {
    for (const command of [
      'grep -r token 2>/dev/null ~',
      'grep -r token &>/dev/null ~',
      'grep -r token &>>log ~',
      'grep -r token < /dev/null ~',
      '>/tmp/o grep -r token ~',
      'grep -r token 2>&1 ~',
      'grep -r token {fd}>/tmp/x ~',
    ]) {
      expect(roots(shellSearchScopes(command, opts)), command).toEqual([home])
    }
    // The trailing descriptor is not a search folder of its own.
    expect(roots(shellSearchScopes('grep -r token src 2>/dev/null', opts))).toEqual(['/work/proj/src'])
  })

  it('(+) a search run by xargs or parallel gets its folders from input: judged as a search of /', () => {
    expect(roots(shellSearchScopes('ls -d ~ | xargs grep -r token', opts))).toEqual(['/'])
    expect(roots(shellSearchScopes('find . -maxdepth 0 | xargs -I{} grep -r token {}/..', opts))).toEqual([base, '/'])
    expect(roots(shellSearchScopes('find . -print0 | xargs -0 grep -R x ~', opts))).toEqual([base, '/'])
    expect(roots(shellSearchScopes("ls -d ~ | xargs -I{} sh -c 'rg token {}'", opts))).toEqual(['/'])
    expect(roots(shellSearchScopes('parallel grep -r token ::: ~', opts))).toEqual(['/'])
    // xargs feeding files to a non-recursive grep adds no search (find is the search here).
    expect(roots(shellSearchScopes('find . -name "*.ts" | xargs grep -l token', opts))).toEqual([base])
  })

  it('(+) brace alternatives in a search folder are every folder they stand for', () => {
    expect(roots(shellSearchScopes('grep -r token ~/{.,}', opts))).toEqual([home, home])
    expect(roots(shellSearchScopes('rg token {src,docs}', opts)).sort()).toEqual(['/work/proj/docs', '/work/proj/src'])
    // Too many alternatives to list: the part before the first brace.
    expect(roots(shellSearchScopes('rg token ~/{a,b}{c,d}{e,f}{g,h}{i,j}{k,l}{m,n}', opts))).toContain(home)
    // A glob word with braces lists below each alternative.
    expect(shellSearchScopes('cat ~/{.claude,.grok}/*.md', opts).map((s) => s.root).sort()).toEqual(['/home/u/.claude', '/home/u/.grok'])
  })
})

describe('embeddedShellScripts', () => {
  it('(+) sh -c, eval and scripts a shell reads from stdin — nested too', () => {
    expect(embeddedShellScripts("bash -c 'cat ~/.claude/CLAUDE.md'")).toEqual(['cat ~/.claude/CLAUDE.md'])
    expect(embeddedShellScripts('eval "cat ~/x"')).toEqual(['cat ~/x'])
    expect(embeddedShellScripts("bash <<'EOF'\ncat ~/x\nEOF")).toEqual(['cat ~/x\n'])
    expect(embeddedShellScripts("sh -c \"bash -c 'cat ~/y'\"")).toEqual(["bash -c 'cat ~/y'", 'cat ~/y'])
  })

  it('(−) no script: a here-document for another program, plain commands, an empty line', () => {
    expect(embeddedShellScripts("python3 - <<'EOF'\nprint(1)\nEOF")).toEqual([])
    expect(embeddedShellScripts('ls -la src')).toEqual([])
    expect(embeddedShellScripts('')).toEqual([])
  })
})

describe('shellSimpleCommands', () => {
  const texts = (command: string) => shellSimpleCommands(command).map((c) => c.words.map((w) => w.text))

  it('(+) splits at pipes, lists and substitutions; redirections are not words and do not split', () => {
    expect(texts('a 1 | b "2 3" && c > out x; d "$(e 4)"')).toEqual([['a', '1'], ['b', '2 3'], ['c', 'x'], ['d', '$(e 4)'], ['e', '4']])
    const [cmd] = shellSimpleCommands('grep -r t 2>/dev/null ~ >> log')
    expect(cmd.words.map((w) => w.text)).toEqual(['grep', '-r', 't', '~'])
    expect(cmd.redirects.map((w) => w.text)).toEqual(['/dev/null', 'log'])
  })

  it('(+) here-document bodies and here-strings are the command\'s stdin, never its words', () => {
    const [cmd] = shellSimpleCommands("cat <<'EOF' > a.ts\n/** x */\nEOF")
    expect(cmd.words.map((w) => w.text)).toEqual(['cat'])
    expect(cmd.redirects.map((w) => w.text)).toEqual(['a.ts'])
    expect(cmd.stdin).toEqual(['/** x */\n'])
    expect(shellSimpleCommands("tr a b <<< 'x y'")[0].stdin).toEqual(['x y'])
  })

  it('(−) nothing for an empty line', () => {
    expect(shellSimpleCommands('')).toEqual([])
  })
})

describe('compileSearchGlobs', () => {
  const reach = (globs: string[], rel: string[], anywhere = true) => compileSearchGlobs(globs, anywhere, false).mayReach(rel)

  it('(+) no glob, only exclusions or an unreadable glob: everything is reachable', () => {
    expect(reach([], ['.claude'])).toBe(true)
    expect(reach(['!**/.claude/**'], ['.claude'])).toBe(true)
    expect(reach(['[z-a]'], ['x'], false)).toBe(true)
  })

  it('(−) an unclosed bracket is a literal character', () => {
    expect(reach(['[unclosed'], ['x'], false)).toBe(false)
    expect(reach(['[unclosed'], ['[unclosed'], false)).toBe(true)
  })

  it('(+) ripgrep globs without a slash match at any depth; with one they are anchored', () => {
    expect(reach(['*.md'], ['Documents', 'Vault'])).toBe(true)
    expect(reach(['src/**/*.ts'], ['data'])).toBe(false)
    expect(reach(['src/**/*.ts'], ['src', 'x'])).toBe(true)
    expect(reach(['data/vault/**'], ['data'])).toBe(true)
    expect(reach(['**/memory/*.md'], ['.claude'])).toBe(true)
    expect(reach(['/src/**'], ['data'])).toBe(false)
  })

  it('(+) shell globs are anchored; a glob that stops at an ancestor still reaches (its contents may be listed)', () => {
    expect(reach(['*.md'], ['data'], false)).toBe(false)
    expect(reach(['*'], ['Documents', 'Vault'], false)).toBe(true)
    expect(reach(['.*/projects/*/memory'], ['.claude'], false)).toBe(true)
    expect(reach(['Proj*'], ['.claude'], false)).toBe(false)
  })

  it('(+) character classes and brace alternatives', () => {
    expect(reach(['[.]c*/**'], ['.claude'], false)).toBe(true)
    expect(reach(['[!.]*/**'], ['.claude'], false)).toBe(false)
    expect(reach(['{src,docs}/**'], ['data'])).toBe(false)
    expect(reach(['{src,data}/**'], ['data'])).toBe(true)
  })

  it('(−) a pathological glob against a long crafted name stays linear (no regex backtracking)', () => {
    const glob = `${'*a'.repeat(30)}*b`
    const name = 'a'.repeat(250)
    const started = performance.now()
    expect(reach([glob], [name], false)).toBe(false)
    expect(performance.now() - started).toBeLessThan(50)
    // An overlong glob is not read at all: it reaches everything.
    expect(reach([`src/${'{a'.repeat(2000)}`], ['data'])).toBe(true)
  })

  it('(+) case-insensitive where the filesystem folds case', () => {
    expect(compileSearchGlobs(['DATA/**'], true, true).mayReach(['data'])).toBe(true)
    expect(compileSearchGlobs(['DATA/**'], true, false).mayReach(['data'])).toBe(false)
  })

  it('(+) brace expansion: alternatives, nesting, too many to judge', () => {
    expect(expandBraces('a{b,c}d')?.sort()).toEqual(['abd', 'acd'])
    expect(expandBraces('{a,{b,c}}')?.sort()).toEqual(['a', 'b', 'c'])
    expect(expandBraces('no{brace}')).toEqual(['no{brace}'])
    expect(expandBraces('{a,b}{c,d}{e,f}{g,h}{i,j}{k,l}{m,n}')).toBeNull()
    // Too many variants to judge: the matcher reaches everything.
    expect(compileSearchGlobs(['{a,b}{c,d}{e,f}{g,h}{i,j}{k,l}{m,n}'], true, false).mayReach(['x'])).toBe(true)
  })
})

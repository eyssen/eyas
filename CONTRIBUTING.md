# Contributing to EYAS

Thanks for looking. EYAS is in public beta, and the most valuable contribution
right now is a good bug report — see [what shipped](CHANGELOG.md) and
[the docs](https://eyssen.github.io/eyas/) first.

## Read this before you open a pull request

**This repository is a mirror.** Development happens in a private repository,
and each release replaces `main` here with a single fresh commit. A branch you
push here, and a pull request based on it, will be overwritten by the next
release rather than merged.

So:

- **Bugs and ideas → [issues](https://github.com/eyssen/eyas/issues).** That is
  the channel that works, and it is where feedback actually reaches the code.
- **Security problems → [private report](https://github.com/eyssen/eyas/security/advisories/new)**,
  never a public issue. See [SECURITY.md](SECURITY.md).
- **A patch you have already written?** Open an issue with the diff or a link to
  your fork. It will be applied upstream with attribution. Nothing is lost — it
  just cannot travel as a merge commit.

## A useful bug report

The [templates](.github/ISSUE_TEMPLATE) ask for these, and they are what makes a
report actionable: the version (`eyas version`), how you installed it (installer,
Bun, Docker), which AI provider, what you expected, what happened, and the
relevant lines from `data/eyas.log`. Redact your keys — the log tries not to
print them, but check.

## Running it locally

```bash
bun install
bun run dev          # backend, hot reload, :3100
bun run dev:web      # frontend, Vite :5173
bun vitest run       # the test suite
bun run lint         # tsc --noEmit
```

`./bin/eyas doctor` explains most "it will not start" situations.

## House rules for code

These are the conventions the codebase already follows; a change that ignores
them will need rewriting before it can be applied.

- **TypeScript strict, ESM, English** for code, comments and commit messages.
- **Tests come with the change.** Vitest, and a test that fails without the fix.
- **Every user-facing string is translated into all six languages** — English,
  Hungarian, German, Spanish, French and Klingon — through the module's `t()`
  helper. No hardcoded text in components.
- **No version bumps.** `version.json` and the package versions move only when a
  release is cut.
- **Dependencies must be MIT-compatible** (MIT, BSD-2, BSD-3, ISC, Apache-2.0).
  GPL, LGPL, AGPL, SSPL and CC-BY-SA are not acceptable — check before adding.
- **Modules talk over the event bus**, not by importing each other's internals.
  Platform-specific code lives in a provider or a submodule, never in core.

## License

Contributions are accepted under the [MIT License](LICENSE), the same terms the
project ships under.

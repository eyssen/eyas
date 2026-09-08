# Security Policy

EYAS is self-hosted: it runs on your machine, holds your credentials in your own
vault, and executes AI-authored code and browser automation on your behalf. That
makes security reports genuinely useful, and they are welcome.

## Supported versions

EYAS is in public beta and ships from a single branch. **Only the latest release
is supported** — fixes land in the next release rather than being backported.

| Version | Supported |
|---------|-----------|
| Latest `0.8.x-beta` release | ✅ |
| Anything older | ❌ |

## Reporting a vulnerability

**Please do not open a public issue for a security problem.**

Use GitHub's private reporting instead:
[**Report a vulnerability**](https://github.com/eyssen/eyas/security/advisories/new)
(Security → Advisories → Report a vulnerability). It is private to you and the
maintainer until a fix is published.

Helpful things to include, as far as you have them:

- what an attacker gains, and what access they need to start
- the version (`eyas version`) and how it was installed (installer, Bun, Docker)
- a minimal reproduction — a request, a config snippet, a sequence of steps
- anything that limits the impact, if you already know it

## What to expect

One maintainer, no service-level agreement. Realistically: an acknowledgement
within a few days, and a fix in the next release if the report holds up. You
will be credited in the advisory unless you ask not to be.

## Scope

In scope: this repository — the server, the modules, the CLI, the web UI, the
documentation site, and the install scripts.

Out of scope, because they are not ours to fix: vulnerabilities in third-party
AI providers or MCP servers you connect, and issues that require an attacker to
already have the operator's shell, `data/master.key`, or admin session — with any
of those, EYAS is already theirs.

## Two things worth knowing before you test

EYAS deliberately runs AI-authored code (skills, browser automation, sidecars)
that the operator has approved. "An agent can execute code the operator allowed
it to execute" is the design, not a vulnerability. What *is* a vulnerability is
anything that escapes the approval — a path that runs without the gate, an
agent reaching data its permissions exclude, or a way to make the operator
approve something other than what they were shown.

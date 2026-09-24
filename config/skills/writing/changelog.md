---
name: changelog
description: Writing and maintaining changelogs following Keep a Changelog conventions
trigger_patterns:
  - "changelog"
  - "release notes"
  - "what changed"
  - "version history"
  - "CHANGELOG"
capabilities:
  - changelog-writing
  - version-tracking
  - release-communication
version: "1.0.0"
---
# Changelog

## Format (Keep a Changelog)
```markdown
# Changelog

## [Unreleased]
### Added
- New feature description

### Changed
- Modified behavior description

### Fixed
- Bug fix description

## [1.2.0] - 2026-04-01
### Added
- User profile avatar upload
- Dark mode support

### Changed
- Improved search performance (3x faster)

### Deprecated
- Old authentication endpoint (use /api/v2/auth)

### Removed
- Legacy XML export (replaced by JSON)

### Fixed
- Login redirect loop on expired sessions

### Security
- Patched XSS vulnerability in markdown renderer
```

## Categories
- **Added:** new features
- **Changed:** changes to existing functionality
- **Deprecated:** features that will be removed
- **Removed:** features that were removed
- **Fixed:** bug fixes
- **Security:** vulnerability patches

## Writing Guidelines
- Write for humans, not machines
- Each entry is a complete sentence starting with a verb
- Include context: why the change matters, not just what changed
- Link to issues/PRs where relevant: `Fixed login loop (#234)`
- Most important changes first within each category
- Use plain language — avoid internal jargon

## Versioning (SemVer)
- MAJOR (X.0.0): breaking changes
- MINOR (0.X.0): new features, backward compatible
- PATCH (0.0.X): bug fixes, backward compatible
- Pre-release: 1.0.0-beta.1, 1.0.0-rc.1

## Process
- Update changelog with every PR (not retroactively)
- Keep [Unreleased] section at the top
- On release: move Unreleased items under new version heading
- Tag the release in git matching the version number
- Never modify entries for already-released versions

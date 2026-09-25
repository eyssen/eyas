---
name: documentation-review
description: Systematic review and analysis of technical documentation and API references
trigger_patterns:
  - "review documentation"
  - "read the docs"
  - "API reference"
  - "documentation analysis"
  - "check the manual"
capabilities:
  - documentation-analysis
  - api-review
  - gap-identification
version: "1.0.0"
---
# Documentation Review

## Review Approach

### Quick Assessment (5 minutes)
- Is there a getting started guide?
- Is the API reference complete?
- When was it last updated?
- Are there code examples?
- Is versioning clear?

### Thorough Review (30 minutes)
1. Read the introduction and overview
2. Follow the quickstart tutorial
3. Check API reference completeness
4. Look for migration/upgrade guides
5. Search for your specific use case
6. Check community resources (FAQ, forum, Discord)

## Documentation Quality Indicators
- **Good:** versioned, searchable, has examples, recently updated
- **Acceptable:** exists, mostly complete, some examples
- **Poor:** outdated, incomplete, no examples, hard to navigate
- **Red flag:** no docs at all, or only auto-generated without context

## What to Extract
- Installation and setup requirements
- Core concepts and mental model
- API surface area (methods, parameters, return types)
- Configuration options and defaults
- Error handling patterns
- Performance characteristics and limitations
- Breaking changes between versions

## Gap Analysis
Common documentation gaps to watch for:
- Edge cases and error scenarios
- Performance implications of different approaches
- Security considerations
- Deployment and production configuration
- Troubleshooting and debugging
- Integration with other tools

## Documentation for Decision-Making
When evaluating a library/framework:
- Does the documentation match the actual behavior?
- Are the examples copy-paste runnable?
- Is the TypeScript type documentation accurate?
- Are deprecated features clearly marked?
- Is there a clear migration path between versions?

## Creating Your Own Notes
- Document undocumented behavior you discover
- Keep a "gotchas" list for the team
- Note version-specific quirks
- Link to relevant GitHub issues for known problems

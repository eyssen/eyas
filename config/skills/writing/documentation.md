---
name: documentation
description: Software documentation standards including API docs, guides, and inline comments
trigger_patterns:
  - "documentation"
  - "API docs"
  - "JSDoc"
  - "inline comments"
  - "document this"
capabilities:
  - api-documentation
  - code-comments
  - documentation-standards
version: "1.0.0"
---
# Documentation

## Documentation Types

### API Reference
- Every public function, class, and type must be documented
- Include: description, parameters, return type, exceptions, example
- Use JSDoc/TSDoc for TypeScript:
  ```typescript
  /**
   * Calculate the total price including tax.
   * @param items - Array of line items
   * @param taxRate - Tax rate as decimal (e.g., 0.27 for 27%)
   * @returns Total price with tax applied
   * @throws {ValidationError} If items array is empty
   * @example
   * calculateTotal([{ price: 100, qty: 2 }], 0.27) // 254
   */
  ```

### Architecture Documentation
- System overview with component diagram
- Data flow between modules
- Key design decisions (ADRs)
- Deployment architecture
- Security model

### User Guides
- Task-oriented (how to accomplish X)
- Step-by-step with screenshots where helpful
- Organized by user workflow, not by feature

### Developer Guides
- Getting started / local setup
- Coding conventions and patterns
- Testing strategy and how to run tests
- Deployment process
- Troubleshooting common issues

## Inline Comments
- Comment WHY, not WHAT (code shows what, comments explain why)
- Mark workarounds: `// WORKAROUND: [issue-link] description`
- Mark technical debt: `// TODO: description`
- Never leave commented-out code — use version control
- Update comments when you change the code they describe

## Documentation as Code
- Store docs alongside code in the repository
- Review documentation changes in pull requests
- Automate API docs generation from source (TypeDoc, etc.)
- Version documentation with the code
- Run link checkers in CI

## Maintenance
- Review docs quarterly for accuracy
- Delete outdated documentation (wrong docs are worse than no docs)
- Track documentation coverage alongside code coverage
- Include "last updated" dates on user-facing docs

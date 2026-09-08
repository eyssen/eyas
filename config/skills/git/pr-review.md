---
name: git-pr-review
description: Pull request review best practices and code review guidelines
trigger_patterns:
  - "pull request"
  - "code review"
  - "PR review"
  - "review checklist"
  - "merge request"
capabilities:
  - code-review
  - pr-management
  - review-feedback
version: "1.0.0"
---
# Pull Request Review

## PR Author Checklist
Before requesting review:
- [ ] Self-review the diff — read your own changes first
- [ ] Tests pass locally
- [ ] No unrelated changes included
- [ ] PR description explains WHAT and WHY
- [ ] Breaking changes documented
- [ ] Screenshots for UI changes
- [ ] Linked to issue/ticket

## PR Description Template
```markdown
## What
Brief description of the change.

## Why
Business context or technical reason.

## How
Key implementation details (if non-obvious).

## Testing
How to test this change manually.

## Screenshots
(for UI changes)
```

## Reviewer Checklist

### Correctness
- Does the code do what the PR description says?
- Are edge cases handled?
- Are error paths covered?
- Is the logic correct for all inputs?

### Security
- No hardcoded secrets or credentials
- Input validation on external data
- SQL injection prevention (parameterized queries)
- XSS prevention (output encoding)
- Authorization checks present

### Performance
- No N+1 queries
- No unnecessary database calls in loops
- Appropriate indexing for new queries
- No memory leaks (event listeners, subscriptions)

### Maintainability
- Clear naming (variables, functions, classes)
- No duplication (DRY)
- Functions are focused (single responsibility)
- Comments explain WHY, not WHAT
- Tests cover the new code

### Style
- Consistent with codebase conventions
- No dead code or commented-out code
- Imports organized
- TypeScript types correct (no `any` without justification)

## Giving Feedback
- Be specific: point to the exact line
- Explain WHY something should change
- Suggest alternatives, don't just criticize
- Distinguish: blocking vs. nit vs. question
- Prefix: `nit:`, `question:`, `suggestion:`, `blocking:`
- Approve with nits if changes are minor

## Receiving Feedback
- Don't take it personally — it's about the code
- Respond to every comment (even with "Done")
- If you disagree, explain your reasoning
- Resolve conversations after addressing them

## Merge Criteria
- At least 1 approval (2 for critical paths)
- All CI checks pass
- No unresolved blocking comments
- Branch is up to date with base

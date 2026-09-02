---
name: user-stories
description: Writing effective user stories with acceptance criteria and story mapping
trigger_patterns:
  - "user story"
  - "user stories"
  - "acceptance criteria"
  - "story mapping"
  - "as a user"
capabilities:
  - story-writing
  - acceptance-criteria
  - story-mapping
version: "1.0.0"
---
# User Stories

## Story Format
Standard template: **As a [role], I want [action], so that [benefit].**

Example:
> As a project manager, I want to export task lists to CSV, so that I can share progress with stakeholders who don't have system access.

## INVEST Criteria
Good user stories are:
- **I**ndependent — can be developed in any order
- **N**egotiable — details discussed during sprint planning
- **V**aluable — delivers value to the user or business
- **E**stimable — team can size it with reasonable confidence
- **S**mall — fits within a single sprint
- **T**estable — clear pass/fail acceptance criteria

## Acceptance Criteria
Use Given/When/Then (Gherkin) format:
```
Given I am on the task list page
When I click "Export to CSV"
Then a CSV file downloads containing all visible tasks
And each row includes: task name, status, assignee, due date
```

## Story Splitting Techniques
- By workflow step (create, edit, delete)
- By data variation (simple case vs. edge case)
- By user role (admin vs. regular user)
- By business rule (happy path vs. error handling)
- By interface (API vs. UI)

## Story Mapping
1. Identify user activities (top row) — big goals
2. Break into user tasks (second row) — steps within activities
3. Add details as stories below each task
4. Draw horizontal line for MVP — everything above is release 1

## Common Mistakes
- Too vague: "As a user, I want the system to be fast" — not testable
- Too technical: "Implement Redis cache for session store" — not user-facing
- Missing "so that" — no clear business justification
- Epic disguised as story — needs splitting if > 8 story points

---
name: linear-integration
description: Linear API integration for issues, projects, cycles, and team management
type: integration
trigger_patterns:
  - "linear"
  - "linear issue"
  - "linear project"
  - "linear cycle"
capabilities:
  - api-access
version: "1.0.0"
sources:
  - name: Linear API
    url: https://developers.linear.app/docs
    license: MIT
integration_config:
  baseUrl: https://api.linear.app/graphql
  auth: bearer
  secretName: linear-api-key
  rateLimit: 1500
  operations:
    - name: create_issue
      method: POST
      path: /graphql
      description: Create a new issue
      parameters:
        teamId: { type: string, required: true, description: "Team UUID" }
        title: { type: string, required: true, description: "Issue title" }
        description: { type: string, description: "Issue description in markdown" }
        priority: { type: number, description: "Priority: 0=none, 1=urgent, 2=high, 3=medium, 4=low" }
        assigneeId: { type: string, description: "Assignee user UUID" }
        stateId: { type: string, description: "Workflow state UUID" }
    - name: list_issues
      method: POST
      path: /graphql
      description: List issues with filters
      parameters:
        teamId: { type: string, description: "Filter by team" }
        assigneeId: { type: string, description: "Filter by assignee" }
        state: { type: string, description: "Filter by state name" }
        first: { type: number, description: "Number of issues to return" }
    - name: update_issue
      method: POST
      path: /graphql
      description: Update an existing issue
      parameters:
        issueId: { type: string, required: true, description: "Issue UUID" }
        title: { type: string, description: "Updated title" }
        stateId: { type: string, description: "New workflow state" }
        priority: { type: number, description: "Updated priority" }
    - name: list_projects
      method: POST
      path: /graphql
      description: List projects
      parameters:
        first: { type: number, description: "Number of projects to return" }
    - name: list_cycles
      method: POST
      path: /graphql
      description: List cycles (sprints)
      parameters:
        teamId: { type: string, description: "Filter by team" }
        first: { type: number, description: "Number of cycles to return" }
    - name: create_comment
      method: POST
      path: /graphql
      description: Add a comment to an issue
      parameters:
        issueId: { type: string, required: true, description: "Issue UUID" }
        body: { type: string, required: true, description: "Comment body in markdown" }
    - name: list_teams
      method: POST
      path: /graphql
      description: List teams in the workspace
      parameters:
        first: { type: number, description: "Number of teams to return" }
---
# Linear Integration

Authentication uses a Personal API Key stored as `linear-api-key`. Create at Settings > API > Personal API keys.

Linear uses a GraphQL API (single endpoint). All operations are POST requests to the GraphQL endpoint. The operations listed above are abstractions — actual requests use GraphQL mutations and queries.

Rate limit is 1,500 requests per hour. Complexity-based limiting also applies. Use `pageInfo.endCursor` with `after` parameter for pagination. Issues have unique identifiers like `TEAM-123` (human-readable) and UUIDs (API).

Webhooks are available for real-time notifications on issue changes, comments, and project updates.

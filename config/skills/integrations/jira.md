---
name: jira-integration
description: Jira REST API integration for issues, projects, boards, and sprints
type: integration
trigger_patterns:
  - "jira"
  - "jira issue"
  - "jira ticket"
  - "sprint"
  - "jira board"
capabilities:
  - api-access
version: "1.0.0"
sources:
  - name: Jira REST API
    url: https://developer.atlassian.com/cloud/jira/platform/rest/v3/
    license: Apache-2.0
integration_config:
  baseUrl: https://{domain}.atlassian.net/rest/api/3
  auth: basic
  secretName: jira-credentials
  rateLimit: 100
  operations:
    - name: create_issue
      method: POST
      path: /issue
      description: Create a new Jira issue
      parameters:
        project_key: { type: string, required: true, description: "Project key (e.g., PROJ)" }
        summary: { type: string, required: true, description: "Issue summary" }
        issue_type: { type: string, required: true, description: "Issue type: Bug, Task, Story, Epic" }
        description: { type: string, description: "Issue description in ADF format" }
        priority: { type: string, description: "Priority: Highest, High, Medium, Low, Lowest" }
        assignee_id: { type: string, description: "Atlassian account ID of assignee" }
    - name: get_issue
      method: GET
      path: /issue/{issueIdOrKey}
      description: Get issue details
      parameters:
        issueIdOrKey: { type: string, required: true, description: "Issue key (e.g., PROJ-123)" }
        fields: { type: string, description: "Comma-separated field names to return" }
    - name: search_issues
      method: POST
      path: /search
      description: Search issues using JQL
      parameters:
        jql: { type: string, required: true, description: "JQL query string" }
        maxResults: { type: number, description: "Max results (default 50)" }
        fields: { type: array, description: "Fields to return" }
    - name: add_comment
      method: POST
      path: /issue/{issueIdOrKey}/comment
      description: Add a comment to an issue
      parameters:
        issueIdOrKey: { type: string, required: true, description: "Issue key" }
        body: { type: string, required: true, description: "Comment body in ADF format" }
    - name: transition_issue
      method: POST
      path: /issue/{issueIdOrKey}/transitions
      description: Transition an issue to a new status
      parameters:
        issueIdOrKey: { type: string, required: true, description: "Issue key" }
        transition_id: { type: string, required: true, description: "Transition ID" }
    - name: list_projects
      method: GET
      path: /project/search
      description: List accessible projects
      parameters:
        query: { type: string, description: "Search by project name" }
        maxResults: { type: number, description: "Max results" }
    - name: get_board
      method: GET
      path: /board/{boardId}
      description: Get board details (Agile API)
      parameters:
        boardId: { type: number, required: true, description: "Board ID" }
    - name: list_sprints
      method: GET
      path: /board/{boardId}/sprint
      description: List sprints for a board (Agile API)
      parameters:
        boardId: { type: number, required: true, description: "Board ID" }
        state: { type: string, description: "Filter: active, future, closed" }
---
# Jira Integration

Authentication uses Basic Auth with email and API token. Store as `jira-credentials` in format `email:api_token` (base64 encoded in the Authorization header).

The `domain` in baseUrl must be replaced with your Atlassian Cloud domain. Agile endpoints (board, sprint) use `/rest/agile/1.0` base path instead of `/rest/api/3`.

JQL (Jira Query Language) examples:
- `project = PROJ AND status = "In Progress"`
- `assignee = currentUser() AND sprint in openSprints()`
- `created >= -7d AND type = Bug`

Rate limit is approximately 100 requests per minute. Use `startAt` and `maxResults` for pagination.

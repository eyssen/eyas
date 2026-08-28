---
name: gitlab-integration
description: GitLab API integration for projects, issues, merge requests, and pipelines
type: integration
trigger_patterns:
  - "gitlab"
  - "merge request"
  - "gitlab pipeline"
  - "gitlab project"
capabilities:
  - api-access
version: "1.0.0"
sources:
  - name: GitLab API
    url: https://docs.gitlab.com/ee/api/rest/
    license: MIT
integration_config:
  baseUrl: https://gitlab.com/api/v4
  auth: bearer
  secretName: gitlab-token
  rateLimit: 2000
  operations:
    - name: create_issue
      method: POST
      path: /projects/{id}/issues
      description: Create a new issue in a project
      parameters:
        id: { type: string, required: true, description: "Project ID or URL-encoded path" }
        title: { type: string, required: true, description: "Issue title" }
        description: { type: string, description: "Issue description in markdown" }
        labels: { type: string, description: "Comma-separated label names" }
        assignee_ids: { type: array, description: "User IDs to assign" }
    - name: list_issues
      method: GET
      path: /projects/{id}/issues
      description: List issues in a project
      parameters:
        id: { type: string, required: true, description: "Project ID or URL-encoded path" }
        state: { type: string, description: "Filter: opened, closed, all" }
        labels: { type: string, description: "Comma-separated label names" }
        per_page: { type: number, description: "Results per page (max 100)" }
    - name: create_merge_request
      method: POST
      path: /projects/{id}/merge_requests
      description: Create a new merge request
      parameters:
        id: { type: string, required: true, description: "Project ID or URL-encoded path" }
        title: { type: string, required: true, description: "MR title" }
        source_branch: { type: string, required: true, description: "Source branch" }
        target_branch: { type: string, required: true, description: "Target branch" }
        description: { type: string, description: "MR description" }
    - name: list_merge_requests
      method: GET
      path: /projects/{id}/merge_requests
      description: List merge requests in a project
      parameters:
        id: { type: string, required: true, description: "Project ID or URL-encoded path" }
        state: { type: string, description: "Filter: opened, closed, merged, all" }
    - name: list_pipelines
      method: GET
      path: /projects/{id}/pipelines
      description: List pipelines in a project
      parameters:
        id: { type: string, required: true, description: "Project ID or URL-encoded path" }
        status: { type: string, description: "Filter: running, pending, success, failed" }
        ref: { type: string, description: "Branch or tag name" }
    - name: get_project
      method: GET
      path: /projects/{id}
      description: Get project details
      parameters:
        id: { type: string, required: true, description: "Project ID or URL-encoded path" }
    - name: list_projects
      method: GET
      path: /projects
      description: List accessible projects
      parameters:
        search: { type: string, description: "Search by name" }
        owned: { type: boolean, description: "Only owned projects" }
        per_page: { type: number, description: "Results per page (max 100)" }
---
# GitLab Integration

Authentication uses a Personal Access Token stored as `gitlab-token`. The token needs `api` scope for full access, or `read_api` for read-only.

For self-hosted GitLab instances, change `baseUrl` to your instance URL (e.g., `https://gitlab.example.com/api/v4`).

Rate limit is 2,000 requests per minute for authenticated users. Pagination uses `X-Page`, `X-Next-Page`, and `X-Total` headers. Default page size is 20, max is 100.

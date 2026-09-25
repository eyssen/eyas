---
name: github-integration
description: GitHub API integration for repos, issues, PRs, and releases
type: integration
trigger_patterns:
  - "github"
  - "create issue"
  - "pull request"
  - "github repo"
  - "github release"
capabilities:
  - api-access
version: "1.0.0"
sources:
  - name: GitHub REST API
    url: https://docs.github.com/en/rest
    license: MIT
integration_config:
  baseUrl: https://api.github.com
  auth: bearer
  secretName: github-token
  rateLimit: 5000
  operations:
    - name: create_issue
      method: POST
      path: /repos/{owner}/{repo}/issues
      description: Create a new GitHub issue
      parameters:
        owner: { type: string, required: true, description: "Repository owner" }
        repo: { type: string, required: true, description: "Repository name" }
        title: { type: string, required: true, description: "Issue title" }
        body: { type: string, description: "Issue body in markdown" }
        labels: { type: array, description: "Label names to apply" }
        assignees: { type: array, description: "Usernames to assign" }
    - name: list_issues
      method: GET
      path: /repos/{owner}/{repo}/issues
      description: List issues in a repository
      parameters:
        owner: { type: string, required: true, description: "Repository owner" }
        repo: { type: string, required: true, description: "Repository name" }
        state: { type: string, description: "Filter by state: open, closed, all" }
        labels: { type: string, description: "Comma-separated label names" }
        per_page: { type: number, description: "Results per page (max 100)" }
    - name: create_pull_request
      method: POST
      path: /repos/{owner}/{repo}/pulls
      description: Create a new pull request
      parameters:
        owner: { type: string, required: true, description: "Repository owner" }
        repo: { type: string, required: true, description: "Repository name" }
        title: { type: string, required: true, description: "PR title" }
        head: { type: string, required: true, description: "Branch with changes" }
        base: { type: string, required: true, description: "Branch to merge into" }
        body: { type: string, description: "PR description in markdown" }
    - name: list_pull_requests
      method: GET
      path: /repos/{owner}/{repo}/pulls
      description: List pull requests in a repository
      parameters:
        owner: { type: string, required: true, description: "Repository owner" }
        repo: { type: string, required: true, description: "Repository name" }
        state: { type: string, description: "Filter: open, closed, all" }
    - name: get_repo
      method: GET
      path: /repos/{owner}/{repo}
      description: Get repository details
      parameters:
        owner: { type: string, required: true, description: "Repository owner" }
        repo: { type: string, required: true, description: "Repository name" }
    - name: list_repos
      method: GET
      path: /users/{username}/repos
      description: List repositories for a user
      parameters:
        username: { type: string, required: true, description: "GitHub username" }
        sort: { type: string, description: "Sort by: created, updated, pushed, full_name" }
    - name: create_release
      method: POST
      path: /repos/{owner}/{repo}/releases
      description: Create a new release
      parameters:
        owner: { type: string, required: true, description: "Repository owner" }
        repo: { type: string, required: true, description: "Repository name" }
        tag_name: { type: string, required: true, description: "Git tag for the release" }
        name: { type: string, description: "Release title" }
        body: { type: string, description: "Release notes in markdown" }
        draft: { type: boolean, description: "Create as draft" }
        prerelease: { type: boolean, description: "Mark as pre-release" }
    - name: list_commits
      method: GET
      path: /repos/{owner}/{repo}/commits
      description: List commits in a repository
      parameters:
        owner: { type: string, required: true, description: "Repository owner" }
        repo: { type: string, required: true, description: "Repository name" }
        sha: { type: string, description: "Branch name or commit SHA" }
        per_page: { type: number, description: "Results per page (max 100)" }
    - name: add_comment
      method: POST
      path: /repos/{owner}/{repo}/issues/{issue_number}/comments
      description: Add a comment to an issue or PR
      parameters:
        owner: { type: string, required: true, description: "Repository owner" }
        repo: { type: string, required: true, description: "Repository name" }
        issue_number: { type: number, required: true, description: "Issue or PR number" }
        body: { type: string, required: true, description: "Comment body in markdown" }
    - name: create_label
      method: POST
      path: /repos/{owner}/{repo}/labels
      description: Create a label in a repository
      parameters:
        owner: { type: string, required: true, description: "Repository owner" }
        repo: { type: string, required: true, description: "Repository name" }
        name: { type: string, required: true, description: "Label name" }
        color: { type: string, required: true, description: "Hex color code without #" }
        description: { type: string, description: "Label description" }
---
# GitHub Integration

Authentication uses a Personal Access Token (PAT) stored as `github-token` in the secrets manager. The token needs `repo` scope for private repositories, or `public_repo` for public only.

Rate limit is 5,000 requests per hour for authenticated requests. The `X-RateLimit-Remaining` header shows remaining quota. Use conditional requests (`If-None-Match`) to avoid consuming rate limit for unchanged resources.

Pagination uses `Link` header with `rel="next"` and `rel="last"`. Default page size is 30, max is 100 (set via `per_page` parameter).

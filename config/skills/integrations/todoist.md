---
name: todoist-integration
description: Todoist API integration for tasks, projects, and comments
type: integration
trigger_patterns:
  - "todoist"
  - "todoist task"
  - "todo list"
  - "todoist project"
capabilities:
  - api-access
version: "1.0.0"
sources:
  - name: Todoist API
    url: https://developer.todoist.com/rest/v2
    license: MIT
integration_config:
  baseUrl: https://api.todoist.com/rest/v2
  auth: bearer
  secretName: todoist-token
  rateLimit: 450
  operations:
    - name: create_task
      method: POST
      path: /tasks
      description: Create a new task
      parameters:
        content: { type: string, required: true, description: "Task title" }
        description: { type: string, description: "Task description in markdown" }
        project_id: { type: string, description: "Project ID (default: Inbox)" }
        priority: { type: number, description: "Priority: 1 (normal) to 4 (urgent)" }
        due_string: { type: string, description: "Natural language due date (e.g., 'tomorrow 3pm')" }
        due_date: { type: string, description: "Due date in YYYY-MM-DD format" }
        labels: { type: array, description: "Label names" }
        parent_id: { type: string, description: "Parent task ID for subtasks" }
    - name: list_tasks
      method: GET
      path: /tasks
      description: List active tasks
      parameters:
        project_id: { type: string, description: "Filter by project" }
        label: { type: string, description: "Filter by label name" }
        filter: { type: string, description: "Todoist filter query (e.g., 'today | overdue')" }
    - name: update_task
      method: POST
      path: /tasks/{id}
      description: Update an existing task
      parameters:
        id: { type: string, required: true, description: "Task ID" }
        content: { type: string, description: "Updated title" }
        priority: { type: number, description: "Updated priority" }
        due_string: { type: string, description: "Updated due date" }
    - name: close_task
      method: POST
      path: /tasks/{id}/close
      description: Complete (close) a task
      parameters:
        id: { type: string, required: true, description: "Task ID" }
    - name: list_projects
      method: GET
      path: /projects
      description: List all projects
      parameters: {}
    - name: create_project
      method: POST
      path: /projects
      description: Create a new project
      parameters:
        name: { type: string, required: true, description: "Project name" }
        color: { type: string, description: "Color name (e.g., berry_red, blue)" }
        parent_id: { type: string, description: "Parent project for nesting" }
        is_favorite: { type: boolean, description: "Add to favorites" }
    - name: add_comment
      method: POST
      path: /comments
      description: Add a comment to a task or project
      parameters:
        task_id: { type: string, description: "Task ID (required if no project_id)" }
        project_id: { type: string, description: "Project ID (required if no task_id)" }
        content: { type: string, required: true, description: "Comment text in markdown" }
---
# Todoist Integration

Authentication uses a Personal API Token stored as `todoist-token`. Get it from Settings > Integrations > Developer in the Todoist app.

Rate limit is 450 requests per 15 minutes per user. The `due_string` parameter supports natural language dates in multiple languages (e.g., "every monday at 9am", "next friday").

Todoist uses a Sync API for batch operations and a REST API (v2) for simple CRUD. The REST API is recommended for most integrations. Filter syntax for `list_tasks` follows Todoist's filter language (e.g., `today`, `p1 & #Work`, `assigned to: me`).

---
name: notion-integration
description: Notion API integration for pages, databases, and blocks
type: integration
trigger_patterns:
  - "notion"
  - "notion page"
  - "notion database"
  - "notion block"
capabilities:
  - api-access
version: "1.0.0"
sources:
  - name: Notion API
    url: https://developers.notion.com
    license: MIT
integration_config:
  baseUrl: https://api.notion.com/v1
  auth: bearer
  secretName: notion-token
  rateLimit: 3
  operations:
    - name: get_page
      method: GET
      path: /pages/{page_id}
      description: Retrieve a page by ID
      parameters:
        page_id: { type: string, required: true, description: "Page UUID" }
    - name: create_page
      method: POST
      path: /pages
      description: Create a new page in a database or as child of another page
      parameters:
        parent_database_id: { type: string, description: "Parent database ID" }
        parent_page_id: { type: string, description: "Parent page ID" }
        properties: { type: object, required: true, description: "Page properties matching database schema" }
        children: { type: array, description: "Block content for the page body" }
    - name: update_page
      method: PATCH
      path: /pages/{page_id}
      description: Update page properties
      parameters:
        page_id: { type: string, required: true, description: "Page UUID" }
        properties: { type: object, required: true, description: "Properties to update" }
    - name: query_database
      method: POST
      path: /databases/{database_id}/query
      description: Query a database with filters and sorts
      parameters:
        database_id: { type: string, required: true, description: "Database UUID" }
        filter: { type: object, description: "Filter object" }
        sorts: { type: array, description: "Sort criteria" }
        page_size: { type: number, description: "Results per page (max 100)" }
    - name: create_database
      method: POST
      path: /databases
      description: Create a new database
      parameters:
        parent_page_id: { type: string, required: true, description: "Parent page ID" }
        title: { type: string, required: true, description: "Database title" }
        properties: { type: object, required: true, description: "Database property schema" }
    - name: append_block
      method: PATCH
      path: /blocks/{block_id}/children
      description: Append blocks as children
      parameters:
        block_id: { type: string, required: true, description: "Parent block or page ID" }
        children: { type: array, required: true, description: "Block objects to append" }
    - name: list_blocks
      method: GET
      path: /blocks/{block_id}/children
      description: List child blocks of a block or page
      parameters:
        block_id: { type: string, required: true, description: "Block or page ID" }
        page_size: { type: number, description: "Results per page (max 100)" }
    - name: search
      method: POST
      path: /search
      description: Search pages and databases
      parameters:
        query: { type: string, description: "Search query text" }
        filter: { type: object, description: "Filter by object type: page or database" }
        page_size: { type: number, description: "Results per page (max 100)" }
---
# Notion Integration

Authentication uses an internal integration token stored as `notion-token`. Create the integration at https://www.notion.so/my-integrations and share target pages/databases with the integration.

Rate limit is 3 requests per second per integration. Use `start_cursor` from response for pagination. All IDs are UUIDs (with or without dashes).

The API uses a versioned header: `Notion-Version: 2022-06-28`. Block content uses Notion's rich text format with type-specific properties.

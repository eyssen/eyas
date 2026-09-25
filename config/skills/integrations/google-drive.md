---
name: google-drive-integration
description: Google Drive API integration for file management, sharing, and search
type: integration
trigger_patterns:
  - "google drive"
  - "drive file"
  - "upload file"
  - "share file"
capabilities:
  - api-access
version: "1.0.0"
sources:
  - name: Google Drive API
    url: https://developers.google.com/drive/api
    license: Apache-2.0
integration_config:
  baseUrl: https://www.googleapis.com/drive/v3
  auth: oauth2
  secretName: google-oauth
  rateLimit: 1000
  operations:
    - name: list_files
      method: GET
      path: /files
      description: List files and folders
      parameters:
        q: { type: string, description: "Search query (Drive query syntax)" }
        pageSize: { type: number, description: "Max results (default 100, max 1000)" }
        fields: { type: string, description: "Fields to include in response" }
        orderBy: { type: string, description: "Sort by: name, modifiedTime, etc." }
    - name: get_file
      method: GET
      path: /files/{fileId}
      description: Get file metadata
      parameters:
        fileId: { type: string, required: true, description: "File ID" }
        fields: { type: string, description: "Fields to include" }
    - name: upload_file
      method: POST
      path: /upload/drive/v3/files
      description: Upload a new file
      parameters:
        name: { type: string, required: true, description: "File name" }
        mimeType: { type: string, description: "MIME type of the file" }
        parents: { type: array, description: "Parent folder IDs" }
        content: { type: string, required: true, description: "File content" }
    - name: create_folder
      method: POST
      path: /files
      description: Create a new folder
      parameters:
        name: { type: string, required: true, description: "Folder name" }
        parents: { type: array, description: "Parent folder IDs" }
    - name: share_file
      method: POST
      path: /files/{fileId}/permissions
      description: Share a file with users or groups
      parameters:
        fileId: { type: string, required: true, description: "File ID" }
        role: { type: string, required: true, description: "Role: reader, writer, commenter, owner" }
        type: { type: string, required: true, description: "Type: user, group, domain, anyone" }
        emailAddress: { type: string, description: "Email for user/group sharing" }
    - name: delete_file
      method: DELETE
      path: /files/{fileId}
      description: Delete a file (moves to trash)
      parameters:
        fileId: { type: string, required: true, description: "File ID" }
    - name: search_files
      method: GET
      path: /files
      description: Search files using Drive query syntax
      parameters:
        q: { type: string, required: true, description: "Query (e.g., \"name contains 'report'\")" }
        pageSize: { type: number, description: "Max results" }
---
# Google Drive Integration

Authentication uses OAuth 2.0 with `google-oauth` credentials. Required scope: `https://www.googleapis.com/auth/drive` (full) or `https://www.googleapis.com/auth/drive.file` (only files created by the app).

Drive query syntax for search: `name contains 'report'`, `mimeType = 'application/pdf'`, `'folderId' in parents`, `modifiedTime > '2026-01-01'`. Combine with `and`/`or`.

Folder MIME type: `application/vnd.google-apps.folder`. Rate limit is 1,000 queries per 100 seconds per user. Use `pageToken` for pagination. For large file uploads, use resumable upload protocol.

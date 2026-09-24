---
title: Documents
description: Upload files, browse them, and let agents retrieve the content.
---

**What this is for.** Documents is the file library: PDFs, images, archives, and other blobs you (or a conversation / knowledge page) attach. They are stored locally (optional S3 sync) and available for retrieval. This is not the Knowledge wiki and not a Memory vault note — it is the file itself.

## When to use it

- You have a PDF, image, or archive the agent should be able to open later.
- A headless `browser_download` just ingested a file from the web — it shows up here, linked to the conversation. See [Browser Use](/docs/en/automation/browser-use/).
- You want to see every file in one place, filtered by type, in grid or list view.
- You need to download or delete a file, or see where it is used.
- You are configuring local storage vs S3-compatible remote sync.

## Typical workflow

1. Open **Documents** in the sidebar (**Content** section) — route `/documents`.
2. Files arrive from conversation **Attach file**, knowledge **Attachments**, or an upload zone (*Drop files here* / *or click to browse*).
3. Filter **All / Images / PDFs / Archives / Other**, search by filename, switch grid/list.
4. Open **Settings → Documents** (`/documents-settings`) if you need stats or S3 credentials. You should see the file in the library and in search; the agent can retrieve it when the conversation has it attached or indexed.

## Features

Empty: *No documents yet.* Hint: *Files are attached from conversations and knowledge articles.* Filtered empty: *No files match your filter.*

### Library

| Control | Meaning |
|---------|---------|
| **Grid view / List view** | Layout |
| **Search files…** | Filename filter |
| **All · Images · PDFs · Archives · Other** | MIME categories |
| **Used in N location(s)** / **Unlinked** | Where the file is attached |
| Sync badge | **Synced · Sync pending · Sync error · Remote storage not configured** |
| **Download** | Save locally |
| **Delete** | Click again to confirm |

### Settings (`/documents-settings`)

Subtitle: *Storage configuration and statistics.*

| Area | Meaning |
|------|---------|
| **Storage Statistics** | Total files, local, synced, pending, errors |
| **Top File Types** | MIME breakdown |
| **Local Storage** | Files on the instance filesystem. **Storage Directory** is relative to the EYAS data root (read-only here — change in config) |
| **S3 Remote Storage** | Optional S3-compatible sync: endpoint, bucket, region, access key, secret key. **Save credentials** |

Do not confuse this with [Search Sources](/docs/en/daily/search/) (code/doc trees on disk) or [Memory](/docs/en/knowledge/memory/) (durable notes).

## Related

- [Search sources](/docs/en/daily/search/)
- [Conversations — attach file](/docs/en/daily/conversations/)
- [Knowledge base — attachments](/docs/en/knowledge/knowledge-base/)
- [Memory](/docs/en/knowledge/memory/)

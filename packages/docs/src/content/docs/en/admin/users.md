---
title: Users & permissions
description: Human users, roles, CASL permissions.
---

**Route:** `/users`.

| Concept | Meaning |
|---------|---------|
| **Root owner** | First admin from setup (`is_root_owner`) |
| Role | e.g. owner / operator / viewer (as defined) |
| Status | active / disabled |
| Agent users | Non-login identities linked to agents (`is_agent`) |

Create users for multi-user installs; permissions enforced via CASL on API routes.

## Related

- [Setup — root owner](/docs/en/setup-wizard/)
- [API keys](/docs/en/admin/secrets/)

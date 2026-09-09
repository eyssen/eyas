# Artifacts module

Structured, Zod-validated handoff payloads between agents in a team session.
Implements the MetaGPT pattern: each role (PM, Architect, Dev, QA, DevOps)
produces a typed artifact that the next role consumes as strongly-typed input.

## Kinds

| Kind              | Produced by     | Consumed by     | Summary                                    |
| ----------------- | --------------- | --------------- | ------------------------------------------ |
| `prd`             | Product Owner   | Architect       | Problem, personas, metrics, requirements   |
| `design-doc`      | Architect       | Developer       | Components, interfaces, data model, risks  |
| `task-list`       | Developer/Lead  | Impl agents     | Sequenced tasks with dependencies          |
| `code-diff`       | Developer       | QA, Reviewer    | File patches / rewrites with summary       |
| `test-plan`       | QA Engineer     | QA runners      | Cases with steps, severity, environments   |
| `deploy-manifest` | DevOps          | Deploy pipeline | Service, image, strategy, envs, rollback   |

## API (typed service)

```ts
const a = artifacts.create({
  sessionId: 'sess_42',
  kind: 'prd',
  title: 'Q3 Billing refresh',
  payload: { /* ...typed Prd... */ },
  producedBy: 'agent_pm',
})

artifacts.update(a.id, nextPayload, 'agent_pm', 'Tighten NFRs')
artifacts.markConsumedBy(a.id, 'agent_architect')
artifacts.link(designDoc.id, a.id, 'derives_from')
artifacts.backlinks(a.id)  // who points at me?
```

## HTTP

- `POST /api/v1/artifacts` — create (validates against kind's Zod schema)
- `GET /api/v1/artifacts/:id`
- `GET /api/v1/artifacts/:id/versions`
- `GET /api/v1/artifacts/by-session/:sessionId`
- `GET /api/v1/artifacts/by-kind/:kind?sessionId=...`
- `PUT /api/v1/artifacts/:id` — append new version (`{ payload, actor?, note? }`)
- `POST /api/v1/artifacts/:id/consume` — `{ agentId }`
- `POST /api/v1/artifacts/:id/link` — `{ toId, type }`
- `GET /api/v1/artifacts/:id/backlinks`
- `GET /api/v1/artifacts/:id/forward-links`

CASL subject: `Artifact` (read / create / update / manage).

## Validation failure shape

```json
{ "error": "ValidationError", "kind": "prd", "issues": [ /* zod issues */ ] }
```

Returned with HTTP 400 when a payload fails the kind's schema.

# Ticket-to-Code Pipeline (Phase 4D)

Deterministic multi-agent Flow that takes a customer ticket and drives it
through the canonical software-delivery stages, producing a typed
`Artifact` (Phase 3H) at each step.

## Stages

```
ingest → pm-clarify → architect-design → dev-implement → review → pr-open → deploy
```

Each stage:
- consumes the previous stage's artifact
- produces a new, Zod-validated artifact in the Artifacts module
- fails fast and is re-runnable via `resume`
- can be gated for approval (per-stage, per-run config)

## Ports

The pipeline is constructed with a `PipelineDeps` bag. Nothing imports
concrete services; everything is a port:

- `TicketSourcePort` — fetch a raw ticket. The only built-in implementation
  (`adapters/board-ticket-source.ts`) reads it from the internal EYAS board
  (a conversation); a custom adapter can wire an external tracker.
- `AgentRunnerPort` — run an EYAS agent with instructions + context
  (`adapters/agent-runner-port.ts`, over `ctx.agents.executeAgent`).
- `ArtifactServicePort` — narrow slice of the Artifacts service
  (`adapters/artifact-port.ts`).
- `CheckpointPort` — no-op today (`adapters/checkpoint-noop.ts`); pipeline
  state is already persisted in `pipeline_runs`/`pipeline_stage_runs`.
- `PRClientPort` — opens a real multi-file draft PR via an extended
  `PrProvider` (Gitea/GitHub, `adapters/pipeline-pr-client.ts`).

## HTTP API

| Method | Route                                                          | Permission |
| ------ | -------------------------------------------------------------- | ---------- |
| POST   | `/api/v1/pipelines/ticket-to-code/start`                       | create     |
| GET    | `/api/v1/pipelines/ticket-to-code`                             | read       |
| GET    | `/api/v1/pipelines/ticket-to-code/:id`                         | read       |
| POST   | `/api/v1/pipelines/ticket-to-code/:id/approve/:stageName`      | approve    |
| POST   | `/api/v1/pipelines/ticket-to-code/:id/cancel`                  | manage     |
| POST   | `/api/v1/pipelines/ticket-to-code/:id/resume`                  | manage     |

CASL subject: `Pipeline`, actions: `read | create | approve | manage`.

## Approval gates

`PipelineRunConfig.approvalGates[stage] = true` pauses AFTER that stage
completes. The pipeline persists `status: 'waiting_approval'` and the
stage row flips to `awaiting_approval`. POST `/approve/:stageName`
resumes from there.

## Resuming failures

If a stage throws, the run's status becomes `failed` and the stage row
carries the error message. `POST /resume` resets failed rows to
`pending` and re-executes from there. Succeeded stages are skipped.

## Enabling the pipeline

Off by default. The module's `onStart` wires the ports above and mounts the
HTTP routes only when ALL of the following hold:

1. `config.pipelines.ticketToCode.enabled === true`
2. A PR provider is fully configured: `prProvider` + `prOwner` + `prRepo`
   (and `prBaseUrl` for `gitea`)
3. The `pipeline-pr-token` secret is present (`ctx.secrets.get('pipeline-pr-token', 'system')`)

If any of these is missing the module logs why and stays inert (no routes,
no `ctx.pipelineDeps`) — see `index.ts`.

## Integration notes

- **A custom ticket source**: implement `TicketSourcePort` over any external
  tracker and pass it into `createTicketToCodePipeline(db, deps)` instead of
  (or alongside) `createBoardTicketSource`. Map the tracker's native fields
  to `TicketContext`.
- **A custom PR host**: `PRClientPort` is backed by `PrProvider`
  (`src/modules/ops/actions/pr-provider.ts`, Gitea/GitHub today); add a new
  `create<Host>PrProvider` factory there for another git host and wire it in
  `createPrProviderFromConfig`.

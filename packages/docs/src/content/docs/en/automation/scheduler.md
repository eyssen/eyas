---
title: Scheduler
description: Recurring jobs, agent routines, calendar and Gantt, and jobs that cannot run.
---

**What this is for.** The scheduler is the clock: recurring system handlers (backup, maintenance) and agent routines (an agent with a prompt on a cron). You create jobs, see when they last ran, and catch the ones that will never fire. It is not the Board — Board tracks work items; this page tracks timers.

**Route:** `/scheduler`. Title: **Schedule**. Subtitle: *Recurring jobs, agent routines, and run history.* Sidebar: **Scheduler**.

## When to use it

- You want an agent to run a prompt every morning without opening a conversation.
- A backup or other system handler should fire on a cron, and you need to see last/next.
- A job sits idle and you need the **No handler / Never fires / Not scheduled** badge, not a silent miss.
- A routine should reason harder (or more cheaply) than its agent usually does — set its **Effort**.
- You are checking cluster leadership, overdue jobs, or dead-letter on a multi-instance install.

## Typical workflow

1. Open **Scheduler** in the sidebar (`/scheduler`).
2. Pick **List**, **Gantt**, or **Calendar**. Use **Day / Week / Month** zoom on the timeline views.
3. **Create Job** — choose **System handler** or **Agent routine**, fill **Name** and **Schedule (cron)**, then the **Handler**, or for an agent routine the **Agent ID**, the **Prompt** and optionally the **Effort** — then **Create**.
4. Watch the health strip. A **cannot-run** badge means the job will not execute as configured; hover for the cause.
5. **Run Now** fires immediately (the only way an Event job ever runs). **Pause / Resume** change the live job; click a job to **Reschedule** it or change its **Effort**.

## Features

Three views share the same jobs: a table, a Gantt of past/next bars, and a calendar. **Show infrastructure jobs** includes internal infra jobs, but never hides a job that cannot run — a broken system job stays visible even with the filter off.

**Schedules.** A job fires on a cron expression, a fixed interval, or a bus event. The form takes a cron expression or one of the shorthands `hourly`, `daily` (09:00), `weekdays` (Monday–Friday 09:00), `weekly` (Monday 09:00) and `monthly` (the 1st, 09:00). An interval or an event trigger is set through the API or the `schedule_create` tool; **Reschedule** turns a job into an interval job when you enter a whole number of milliseconds. The row icon shows the trigger type.

<h3 id="agent-routines-run-in-a-conversation">Agent routines run in a conversation</h3>

Each execution of an agent routine (kind **Agent routine**, or a job created with the `schedule_create` tool) creates a conversation and runs the chosen agent in it as a supervised, autonomous background run — the same runner board cards and retries use: the agent's own model, full EYAS memory recall keyed on the job's prompt, attached designs, documents, durable-memory capture and the completeness critic. Sensitive tools are gated by the [autonomy](/docs/en/agents/autonomy/) ladder.

- The conversation belongs to the user who created the job; when an agent or the system created it, to the owner. Its title is the job name, or *Scheduled: &lt;prompt&gt;*.
- **Recent Executions** in the job's detail pane shows an **Open conversation** link for each run, including failed ones.
- A run that cannot start fails that execution with a reason that begins with a code: `agent_unavailable` (agent missing or disabled), `over_budget`, `invalid_config`, `conversation_busy`, `conversation_forbidden`, `runner_unavailable`, `owner_unavailable`. Failures count toward the job's consecutive-failure / dead-letter limit.
- **Effort.** An agent routine can have its own **Effort** (see [Create job](#create-job)). Every run writes the job's effort onto its run conversation, so the reply's effort chip shows the job's level with source *conversation*. A job on **Auto** writes none: the run takes the agent's effort (source *colleague*), else the model's default. The level is fitted to the model the run lands on.

**Upgrade note.** Agent routines created while scheduled agent runs did not work failed on every execution. After the upgrade they start executing — and spending tokens — on their next trigger. Review or pause them first.

**Advanced (API only).** A `handlerConfig` with `conversationPolicy: 'reuse'` and a `conversationId` re-runs the job in that conversation with the new prompt as goal; the conversation must belong to the same user and must not be running. With `reuse`, the job sets that conversation's effort on every run; with Auto, a level left on it by hand or by an earlier run is cleared. Creating or editing an agent routine whose `handlerConfig` lacks `agentId` or `prompt`, is not valid JSON, or carries an invalid `effort` is refused with `400`. `effort` is one of `none`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`, or `auto`/null (the agent's effort). The job's creator is always the signed-in user; a `createdBy` in the request body is ignored.

An invalid cron expression, or an interval under one second, is rejected — on **Create**, on **Reschedule** and through the API — with the reason on the form: *"That schedule is not valid, so the job would never run. Check the cron expression or the interval."* An **Event** trigger is accepted, but such a job cannot fire on its own yet — it gets the **Never fires** badge.

## Fields and controls

<h2 id="views">Views</h2>

| View | Meaning |
|------|---------|
| **List** | Job table |
| **Gantt** | Timeline bars |
| **Calendar** | Calendar layout |
| Zoom **Day / Week / Month** | Gantt/calendar scale |

<h2 id="create-job">Create job</h2>

**Create Job** opens the **New Scheduled Job** form:

| Field | Meaning |
|-------|---------|
| **System handler** / **Agent routine** | The job's kind |
| **Name** | Display name; an agent routine's run conversations are titled with it |
| **Schedule (cron)** | Cron expression or shorthand (`hourly`, `daily`, `weekdays`, `weekly`, `monthly`); defaults to `0 9 * * *` |
| **Handler** | System handlers only: pick a registered handler with **Select handler…** |
| **Agent ID** | Agent routines only: the agent to run |
| **Prompt** | Agent routines only: what the agent should do — it becomes the run's goal and its memory-recall query |
| **Effort** | Optional, agent routines only. The same **Effort** select as on conversations; it appears once **Agent ID** holds the id of an existing, enabled agent, and lists only the levels that agent's model offers. **Auto** (the default) shows what a run will use — the agent's own effort, e.g. *Auto · Low (colleague)*, else the model's default, e.g. *Auto · model default (Medium)*. A chosen level makes every run of the job use it, adjusted to the nearest level the model offers |
| **Create** / **Cancel** | Save the job / close the form |

<h2 id="job-kinds">Job kinds</h2>

| Kind | Meaning |
|------|---------|
| **System handler** | Built-in maintenance/automation handler |
| **Agent routine** | Runs an agent with a prompt on a schedule |

<h2 id="row-actions">Job rows and detail pane</h2>

| Control | Meaning |
|---------|---------|
| **Paused / Running** | Job enabled state |
| **Cannot-run badge** | Shown on the row as **No handler**, **Never fires**, or **Not scheduled** — no handler registered (its module is probably disabled), a trigger type that never fires on its own (Event), or a schedule that could not be armed (invalid cron, or interval under one second). Hover for the cause. |
| **Last: … / Next: …** | Last and next fire times |
| **N runs / N fails** | Counters |
| **Agent:** &lt;name&gt; | The agent an agent routine runs |
| **Run Now** | Fire immediately; disabled only when the job has no registered handler, or is disabled/dead-letter, with the reason in the tooltip. A job badged **Never fires** or **Not scheduled** can still be run this way — for an Event job it is the only way it ever runs |
| **Pause / Resume** | Toggle |
| **Delete** | Remove job + history (after *Delete this job and its history?*) |
| **Reschedule** + **Apply** (detail pane) | A new cron expression or shorthand, or a whole number of milliseconds for an interval; an invalid schedule is rejected and the reason appears under the field |
| **Effort** (detail pane) | Agent routines only. A change is saved immediately; if saving fails, *Failed to save* appears and nothing changes |
| **Search…** | Filter the list |
| **All sources** / **All statuses** | Restrict the list to one source or one status |
| **Show infrastructure jobs** | Include internal infra jobs |
| **Show only the jobs that cannot run** | Health-strip filter; **Show all jobs again** restores your previous filters |

<h2 id="recent-executions">Recent executions</h2>

**Recent Executions** in the job's detail pane lists past runs — start time, duration, and who triggered each one (*Triggered by:* `system` when a timer fired it, an agent, or a user id), and for an agent routine an **Open conversation** link to the run's conversation (failed runs included). Empty: *No executions yet.*

<h2 id="health">Health strip</h2>

| Metric | Meaning |
|--------|---------|
| **Leader / Follower** | Cluster leadership (multi-instance) |
| **N active** | Active jobs |
| **N running** | Currently executing |
| **N failed (24h)** | Failures in the last day |
| **N dead-letter** | Exhausted retries |
| **N overdue** | Missed schedule |
| **N cannot run** | Jobs that will not execute as configured |

<h2 id="legend">Legend (timeline)</h2>

past · running · next · future · runs · due

## Related

- [CLI / config](/docs/en/deploy/configuration/)
- [Agents](/docs/en/agents/overview/)
- [Autonomy](/docs/en/agents/autonomy/)
- [Providers — Reasoning effort](/docs/en/ai/providers/#reasoning-effort)
- [Backup](/docs/en/admin/backup/)
- [Home](/docs/en/daily/home/)

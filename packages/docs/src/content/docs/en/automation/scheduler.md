---
title: Scheduler
description: Recurring jobs, agent routines, calendar and Gantt, and jobs that cannot run.
---

**What this is for.** The scheduler is the clock: recurring system handlers (backup, maintenance) and agent routines (an agent with a prompt on a cron). You create jobs, see when they last ran, and catch the ones that will never fire. It is not the Board — Board tracks work items; this page tracks timers.

**Route:** `/scheduler`. Subtitle: *Recurring jobs, agent routines, and run history.* Sidebar: **Schedule**.

## When to use it

- You want an agent to run a prompt every morning without opening a conversation.
- A backup or other system handler should fire on a cron, and you need to see last/next.
- A job sits idle and you need the **No handler / Never fires / Not scheduled** badge, not a silent miss.
- You are checking cluster leadership, overdue jobs, or dead-letter on a multi-instance install.

## Typical workflow

1. Open **Schedule** in the sidebar (`/scheduler`).
2. Pick **List**, **Gantt**, or **Calendar**. Use **Day / Week / Month** zoom on the timeline views.
3. **Create Job** — name, kind (**System handler** or **Agent routine**), trigger (**Cron / Interval / Event**), then **Create**.
4. Watch the health strip. A **cannot-run** badge means the job will not execute as configured; hover for the cause.
5. **Run Now** fires immediately (the only way an Event job ever runs). **Pause / Resume** and **Reschedule** change the live job.

## Features

Three views share the same jobs: a table, a Gantt of past/next bars, and a calendar. **Show infrastructure jobs** includes internal infra jobs, but never hides a job that cannot run — a broken system job stays visible even with the filter off.

An invalid cron expression or an interval under one second is rejected when you press **Create**, with the reason shown on the form: *"That schedule is not valid, so the job would never run. Check the cron expression or the interval."* Previously such a job was created and silently never ran. An **Event** trigger is still accepted, but such a job cannot fire on its own yet — it is created with the **Never fires** badge.

## Fields and controls

<h2 id="views">Views</h2>

| View | Meaning |
|------|---------|
| **List** | Job table |
| **Gantt** | Timeline bars |
| **Calendar** | Calendar layout |
| Zoom **Day / Week / Month** | Gantt/calendar scale |

<h2 id="create-job">Create job</h2>

| Field | Meaning |
|-------|---------|
| **Job name** | Display name |
| **Handler** | System handler id (e.g. `backup.run`) or pick from list |
| **Trigger Type** | **Cron** · **Interval** · **Event** |
| **Schedule (cron)** | Cron expression when type=Cron |
| **Interval (ms)** | Period when type=Interval |
| **Event Name** | Bus event when type=Event (e.g. `conversation.completed`) |
| **Agent ID** | For agent routines |
| **Prompt** | Prompt text for agent_run jobs |
| **Create** | Persist job |

<h2 id="job-kinds">Job kinds</h2>

| Kind | Meaning |
|------|---------|
| **System handler** | Built-in maintenance/automation handler |
| **Agent routine** | Runs an agent with a prompt on a schedule |

<h2 id="row-actions">Job row actions / stats</h2>

| Control | Meaning |
|---------|---------|
| **Paused / Running** | Job enabled state |
| **Cannot-run badge** | Shown on the row as **No handler**, **Never fires**, or **Not scheduled** — no handler registered (its module is probably disabled), a trigger type that never fires on its own (Event), or a schedule that could not be armed (invalid cron, or interval under one second). Hover for the cause. |
| **Last / Next** | Last and next fire times |
| **N runs / N fails** | Counters |
| **Run Now** | Fire immediately; disabled only when the job has no registered handler, or is disabled/dead-letter, with the reason in the tooltip. A job badged **Never fires** or **Not scheduled** can still be run this way — for an Event job it is the only way it ever runs |
| **Pause / Resume** | Toggle |
| **Reschedule** + **Apply** | Change schedule; an invalid cron expression or a sub-second interval is rejected and the reason appears under the field |
| **Delete** | Remove job + history (confirm) |
| **Assigned Agent** | Agent name for routines |
| Search | Filter list |
| **Show infrastructure jobs** | Include internal infra jobs |
| **Show only the jobs that cannot run** | Health-strip filter; turning it off restores your previous filters |

## Recent executions

List of past runs — start time, duration, and who triggered each one (`system` when a timer fired it, an agent, or a user id); empty: *No executions yet.*

<h2 id="health">Health strip</h2>

| Metric | Meaning |
|--------|---------|
| **Leader / Follower** | Cluster leadership (multi-instance) |
| **N active** | Active jobs |
| **N running** | Currently executing |
| **N failed (24h)** | Failures last day |
| **N dead-letter** | Exhausted retries |
| **N overdue** | Missed schedule |
| **N cannot run** | Jobs that will not execute as configured |

## Legend (timeline)

past · running · next · future · runs · due

## Related

- [CLI / config](/docs/en/deploy/configuration/)
- [Agents](/docs/en/agents/overview/)
- [Backup](/docs/en/admin/backup/)
- [Home](/docs/en/daily/home/)

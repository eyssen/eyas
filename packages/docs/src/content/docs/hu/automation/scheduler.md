---
title: Ütemező
description: Jobok, triggerek, nézetek, health — minden mező.
---

**Útvonal:** `/scheduler`.

## Nézetek

List · Gantt · Calendar; zoom Day/Week/Month.

## Új job

| Mező | Jelentés |
|------|----------|
| **Job name** | Név |
| **Handler** | Rendszer handler (pl. `backup.run`) |
| **Trigger** | Cron / Interval / Event |
| **cron / interval ms / event name** | Ütemezés paraméter |
| **Agent ID + Prompt** | Agent routine-hoz |

## Műveletek

Run Now, Pause/Resume, Reschedule, Delete, Show infrastructure jobs.

## Health

Leader/Follower, active, running, failed 24h, dead-letter, overdue.

Fajták: **System handler** vs **Agent routine**.

---
name: scheduling
description: Scheduling patterns — cron, recurring events, and timezone handling
trigger_patterns:
  - "scheduling"
  - "cron"
  - "recurring"
  - "schedule task"
  - "timezone"
capabilities:
  - communication
version: "1.0.0"
---
# Scheduling Patterns

## Cron Expressions
```
┌─────── minute (0-59)
│ ┌───── hour (0-23)
│ │ ┌─── day of month (1-31)
│ │ │ ┌─ month (1-12)
│ │ │ │ ┌ day of week (0-7, 0=7=Sunday)
│ │ │ │ │
* * * * *
```

Common patterns:
- `0 9 * * 1-5` — weekdays at 9:00 AM
- `*/15 * * * *` — every 15 minutes
- `0 0 1 * *` — first day of each month at midnight
- `0 */6 * * *` — every 6 hours

## Timezone Handling
```typescript
// Always store in UTC, convert for display
const utcDate = new Date(); // always UTC internally

// Convert for display using Intl
const formatter = new Intl.DateTimeFormat('hu-HU', {
  timeZone: 'Europe/Budapest',
  dateStyle: 'medium',
  timeStyle: 'short',
});
const display = formatter.format(utcDate);
```

## Recurring Event Patterns
```typescript
interface RecurrenceRule {
  frequency: 'daily' | 'weekly' | 'monthly' | 'yearly';
  interval: number;        // every N frequency units
  byDayOfWeek?: number[];  // 0=Sun, 1=Mon, ...
  byDayOfMonth?: number[]; // 1-31
  until?: Date;            // end date
  count?: number;          // max occurrences
}

function getNextOccurrence(rule: RecurrenceRule, after: Date): Date {
  // Calculate the next occurrence based on the rule
  // Handle edge cases: DST transitions, month-end, leap years
}
```

## Scheduling Architecture
```
[Scheduler] → checks every minute
  ├── Cron jobs: match current time against cron expressions
  ├── One-time: fire and remove
  └── Recurring: fire and calculate next occurrence
```

## Timezone Edge Cases
- **DST transitions**: a 2:30 AM event may not exist (spring forward) or exist twice (fall back)
- **Month-end**: "monthly on the 31st" — handle months with fewer days
- **Leap years**: February 29th events
- **Time zone offset changes**: some zones change offset without DST

## Calendar Conflict Detection
```typescript
function hasConflict(
  eventStart: Date, eventEnd: Date,
  existingStart: Date, existingEnd: Date
): boolean {
  return eventStart < existingEnd && eventEnd > existingStart;
}
```

## Best Practices
- Store all times in UTC — convert to local timezone only for display
- Use `Intl.DateTimeFormat` or `Temporal` API for timezone conversions
- Handle DST transitions explicitly in recurring events
- Set a maximum recurrence count or end date to prevent infinite series
- Use a dedicated scheduler service rather than `setInterval` (crashes lose state)
- Persist scheduled jobs to database for durability across restarts

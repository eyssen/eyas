---
name: date-time-handling
description: Date and time manipulation, formatting, timezone handling, and duration calculations
trigger_patterns:
  - "date"
  - "time"
  - "timezone"
  - "duration"
  - "date format"
capabilities:
  - date-manipulation
  - timezone-conversion
  - duration-calculation
version: "1.0.0"
sources:
  - name: date-fns
    url: https://github.com/date-fns/date-fns
    license: MIT
  - name: luxon
    url: https://github.com/moment/luxon
    license: MIT
---
# Date & Time Handling

## date-fns (Functional, Tree-shakeable)
```typescript
import { format, addDays, differenceInDays, parseISO, isAfter } from 'date-fns';
import { hu } from 'date-fns/locale';

const now = new Date();
format(now, 'yyyy-MM-dd');                          // "2026-04-12"
format(now, 'yyyy. MMMM dd.', { locale: hu });      // "2026. aprilis 12."
addDays(now, 7);                                     // 7 days from now
differenceInDays(new Date('2026-12-31'), now);       // days until year end
isAfter(new Date('2026-05-01'), now);                // true
```

## Luxon (Full-featured, Timezone-aware)
```typescript
import { DateTime, Duration, Interval } from 'luxon';

const now = DateTime.now();
now.toISO();                                          // "2026-04-12T..."
now.setZone('America/New_York').toFormat('HH:mm z');  // "12:30 EDT"
now.setLocale('hu').toFormat('yyyy. MMMM dd.');       // "2026. aprilis 12."

// Duration
const dur = Duration.fromObject({ hours: 2, minutes: 30 });
dur.as('minutes');                                     // 150

// Interval
const interval = Interval.fromDateTimes(
  DateTime.fromISO('2026-04-01'),
  DateTime.fromISO('2026-04-30'),
);
interval.length('days');                               // 29
```

## ISO 8601 Format
- Date: `2026-04-12`
- DateTime: `2026-04-12T14:30:00Z`
- With timezone: `2026-04-12T14:30:00+02:00`
- Duration: `P1Y2M3DT4H5M6S` (1 year, 2 months, 3 days, 4h 5m 6s)
- Always store in UTC, display in user's timezone

## Common Operations
```typescript
// Time ago
import { formatDistanceToNow } from 'date-fns';
formatDistanceToNow(pastDate, { addSuffix: true });  // "3 days ago"

// Business days
import { addBusinessDays } from 'date-fns';
addBusinessDays(now, 5);  // Skip weekends

// Duration between dates
import { intervalToDuration } from 'date-fns';
intervalToDuration({ start: date1, end: date2 });
// { years: 0, months: 1, days: 15, hours: 3, ... }
```

## Hungarian Date Formatting
- Standard: `2026. aprilis 12.` (year. month day.)
- Short: `2026.04.12.`
- With day: `2026. aprilis 12., szombat`
- Time: `14:30` (24-hour format)

## Best Practices
- Store as UTC in database, convert to local for display
- Use ISO 8601 for API communication
- Never parse dates with `new Date(string)` — use a library
- Account for daylight saving time transitions
- Use `date-fns` for tree-shaking, `luxon` for timezone-heavy work
- Test with dates near DST boundaries and year boundaries

---
name: ical-generation
description: iCalendar (.ics) file generation with ical-generator
trigger_patterns:
  - "ical"
  - "ics file"
  - "calendar event"
  - "calendar invite"
  - "ical generation"
capabilities:
  - communication
version: "1.0.0"
sources:
  - name: ical-generator
    url: https://github.com/sebbo2002/ical-generator
    license: MIT
---
# iCalendar Generation

## Creating a Calendar
```typescript
import ical, { ICalCalendarMethod } from 'ical-generator';

const calendar = ical({
  name: 'EYAS Calendar',
  timezone: 'Europe/Budapest',
  method: ICalCalendarMethod.PUBLISH,
});
```

## Adding Events
```typescript
calendar.createEvent({
  start: new Date('2026-04-15T10:00:00'),
  end: new Date('2026-04-15T11:00:00'),
  summary: 'Sprint Planning',
  description: 'Bi-weekly sprint planning meeting.',
  location: 'Conference Room A',
  url: 'https://meet.example.com/sprint',
  organizer: { name: 'EYAS', email: 'calendar@example.com' },
  attendees: [
    { name: 'Alice', email: 'alice@example.com', rsvp: true },
    { name: 'Bob', email: 'bob@example.com', rsvp: true },
  ],
});
```

## Recurring Events
```typescript
calendar.createEvent({
  start: new Date('2026-04-15T09:00:00'),
  end: new Date('2026-04-15T09:30:00'),
  summary: 'Daily Standup',
  repeating: {
    freq: 'WEEKLY',
    byDay: ['MO', 'TU', 'WE', 'TH', 'FR'],
    until: new Date('2026-12-31'),
  },
});
```

## Alarms/Reminders
```typescript
const event = calendar.createEvent({ /* ... */ });
event.createAlarm({
  type: 'display',
  trigger: -600, // 10 minutes before (seconds)
  description: 'Meeting starts in 10 minutes',
});
```

## Serving as HTTP Response
```typescript
app.get('/calendar/events.ics', (c) => {
  return c.body(calendar.toString(), 200, {
    'Content-Type': 'text/calendar; charset=utf-8',
    'Content-Disposition': 'attachment; filename="events.ics"',
  });
});
```

## Sending Calendar Invites via Email
```typescript
await transporter.sendMail({
  from: '"EYAS" <calendar@example.com>',
  to: 'user@example.com',
  subject: 'Meeting Invitation: Sprint Planning',
  html: '<p>You are invited to Sprint Planning.</p>',
  icalEvent: {
    method: 'REQUEST',
    content: calendar.toString(),
  },
});
```

## Best Practices
- Always include timezone information in events
- Use unique UIDs for each event (for updates and cancellations)
- Set METHOD to REQUEST for invitations, CANCEL for cancellations
- Include both start and end times (do not rely on duration alone)
- Test generated .ics files in multiple calendar clients (Google, Outlook, Apple)
- Use VTIMEZONE components for timezone-aware recurring events

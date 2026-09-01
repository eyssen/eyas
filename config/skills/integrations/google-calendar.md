---
name: google-calendar-integration
description: Google Calendar API integration for events, calendars, and free/busy queries
type: integration
trigger_patterns:
  - "google calendar"
  - "calendar event"
  - "schedule meeting"
  - "free busy"
capabilities:
  - api-access
version: "1.0.0"
sources:
  - name: Google Calendar API
    url: https://developers.google.com/calendar/api
    license: Apache-2.0
integration_config:
  baseUrl: https://www.googleapis.com/calendar/v3
  auth: oauth2
  secretName: google-oauth
  rateLimit: 500
  operations:
    - name: list_events
      method: GET
      path: /calendars/{calendarId}/events
      description: List events in a calendar
      parameters:
        calendarId: { type: string, required: true, description: "Calendar ID (use 'primary' for default)" }
        timeMin: { type: string, description: "Start of time range (RFC3339)" }
        timeMax: { type: string, description: "End of time range (RFC3339)" }
        maxResults: { type: number, description: "Max events to return" }
        singleEvents: { type: boolean, description: "Expand recurring events" }
        orderBy: { type: string, description: "Sort by: startTime, updated" }
    - name: create_event
      method: POST
      path: /calendars/{calendarId}/events
      description: Create a new calendar event
      parameters:
        calendarId: { type: string, required: true, description: "Calendar ID" }
        summary: { type: string, required: true, description: "Event title" }
        start: { type: object, required: true, description: "Start time {dateTime, timeZone}" }
        end: { type: object, required: true, description: "End time {dateTime, timeZone}" }
        description: { type: string, description: "Event description" }
        attendees: { type: array, description: "Attendee email addresses" }
        location: { type: string, description: "Event location" }
    - name: update_event
      method: PUT
      path: /calendars/{calendarId}/events/{eventId}
      description: Update an existing event
      parameters:
        calendarId: { type: string, required: true, description: "Calendar ID" }
        eventId: { type: string, required: true, description: "Event ID" }
        summary: { type: string, description: "Updated title" }
        start: { type: object, description: "Updated start time" }
        end: { type: object, description: "Updated end time" }
    - name: delete_event
      method: DELETE
      path: /calendars/{calendarId}/events/{eventId}
      description: Delete a calendar event
      parameters:
        calendarId: { type: string, required: true, description: "Calendar ID" }
        eventId: { type: string, required: true, description: "Event ID" }
    - name: list_calendars
      method: GET
      path: /users/me/calendarList
      description: List calendars the user has access to
      parameters:
        showHidden: { type: boolean, description: "Include hidden calendars" }
    - name: get_freebusy
      method: POST
      path: /freeBusy
      description: Check free/busy status for calendars
      parameters:
        timeMin: { type: string, required: true, description: "Start of range (RFC3339)" }
        timeMax: { type: string, required: true, description: "End of range (RFC3339)" }
        items: { type: array, required: true, description: "Calendar IDs to check" }
---
# Google Calendar Integration

Authentication uses OAuth 2.0 with the `google-oauth` credentials in the secrets manager. Required scopes: `https://www.googleapis.com/auth/calendar` (full access) or `https://www.googleapis.com/auth/calendar.events` (events only).

All datetime values use RFC 3339 format (e.g., `2026-04-12T14:00:00+02:00`). Use `primary` as calendarId for the user's default calendar. Set `singleEvents=true` and `orderBy=startTime` for a chronological list.

Rate limit is approximately 500 queries per 100 seconds per user. Use `syncToken` for incremental sync instead of full re-fetch.

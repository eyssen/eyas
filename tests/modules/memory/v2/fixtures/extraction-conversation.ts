// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// A 30-message task (15 user / 15 assistant) with five key: value lines,
// decision markers, a ticket, a mention and dates — the Phase 1 acceptance
// replay: "raw/gist/tag rows with zero model calls".

export const EXTRACTION_FIXTURE: Array<{ role: 'user' | 'assistant'; content: string }> = [
  { role: 'user', content: 'Please plan the invoice module rollout for Werth Kft.\nCustomer: Werth Kft\nTicket: #1293' },
  { role: 'assistant', content: 'Understood. I will start with the staging rehearsal and list the blockers.' },
  { role: 'user', content: 'The customer wants the corrective invoice declaration on every credit note.' },
  { role: 'assistant', content: 'Noted. The declaration text will be printed under the totals block.' },
  { role: 'user', content: 'Deadline: 2026-10-01\nEnvironment = staging' },
  { role: 'assistant', content: 'The deadline is recorded. Staging is the rehearsal environment.' },
  { role: 'user', content: 'We decided to keep the tax group skew fix out of this release.' },
  { role: 'assistant', content: 'Agreed, the skew fix stays parked; I noted it as a follow-up.' },
  { role: 'user', content: 'Can you check whether the Kubernetes ingress certificate on staging is still valid?' },
  { role: 'assistant', content: 'The staging certificate expires in nine days; I will renew it before the rehearsal.' },
  { role: 'user', content: 'Good. Also the backup job must run before the migration.' },
  { role: 'assistant', content: 'The nightly backup runs at 02:00; I will trigger a manual one right before the migration.' },
  { role: 'user', content: 'Who signs off the release on the customer side?' },
  { role: 'assistant', content: 'Sign-off comes from the finance lead at Werth Kft, per the last kickoff notes.' },
  { role: 'user', content: 'Reviewer: @krisz' },
  { role: 'assistant', content: 'Reviewer recorded.' },
  { role: 'user', content: 'What about the report translations, are the Hungarian strings complete?' },
  { role: 'assistant', content: 'Two Hungarian strings on the credit note report are missing; I will add them to hu.po.' },
  { role: 'user', content: 'Approved. Please also document the rollback steps.' },
  { role: 'assistant', content: 'The rollback is a database restore plus a module downgrade; documented in the runbook.' },
  { role: 'user', content: 'Is the staging database a fresh copy of production?' },
  { role: 'assistant', content: 'It was refreshed on 2026-09-01, so it is two days old.' },
  { role: 'user', content: 'Fine. Remind me to warn the warehouse team about the downtime.' },
  { role: 'assistant', content: 'Reminder set for the day before the migration.' },
  { role: 'user', content: 'The go-live window is Saturday morning.' },
  { role: 'assistant', content: 'Saturday morning window recorded; the migration itself takes about forty minutes.' },
  { role: 'user', content: 'One more thing: the PDF footer must show the new company address.' },
  { role: 'assistant', content: 'The footer template will be updated with the new address before the rehearsal.' },
  { role: 'user', content: 'Thanks, that covers everything for today.' },
  { role: 'assistant', content: 'Great, deadline confirmed for October first; rehearsal on staging next week.' },
]

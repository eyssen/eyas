---
name: roadmap-planning
description: Product and project roadmap creation, prioritization, and communication
trigger_patterns:
  - "roadmap"
  - "product roadmap"
  - "feature prioritization"
  - "release planning"
  - "quarterly planning"
capabilities:
  - prioritization
  - timeline-planning
  - release-management
version: "1.0.0"
---
# Roadmap Planning

## Roadmap Types
- **Feature-based:** lists specific features by timeline (risky — implies commitment)
- **Theme-based:** groups work into themes/objectives (recommended — flexible)
- **Now/Next/Later:** no dates, just priority buckets (best for early-stage products)
- **Timeline-based:** quarters or months with milestones (best for stakeholder communication)

## Prioritization Frameworks

### RICE Score
- **R**each: how many users affected per quarter
- **I**mpact: effect per user (3 = massive, 0.25 = minimal)
- **C**onfidence: how sure are we (100%, 80%, 50%)
- **E**ffort: person-months required
- Score = (Reach x Impact x Confidence) / Effort

### MoSCoW
- **Must Have:** core functionality, launch blockers
- **Should Have:** important but not critical for launch
- **Could Have:** nice-to-have, include if time permits
- **Won't Have:** explicitly out of scope for this release

### Value vs. Effort Matrix
- Quick Wins: high value, low effort — do first
- Big Bets: high value, high effort — plan carefully
- Fill-ins: low value, low effort — do when convenient
- Money Pit: low value, high effort — avoid

## Release Planning
- Define release cadence (weekly, bi-weekly, monthly)
- Each release should have a theme or goal
- Include buffer for bugs and unplanned work (20-30%)
- Feature flags for gradual rollout
- Rollback plan for every release

## Communication
- Internal roadmap: detailed, with effort estimates
- External roadmap: high-level themes, no specific dates
- Update quarterly at minimum
- Track delivery vs. plan — adjust based on velocity
- Celebrate completed milestones

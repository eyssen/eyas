---
name: estimation
description: Software effort estimation techniques including story points, T-shirt sizing, and planning poker
trigger_patterns:
  - "estimation"
  - "story points"
  - "how long will it take"
  - "effort estimate"
  - "planning poker"
capabilities:
  - effort-estimation
  - sizing
  - forecasting
version: "1.0.0"
---
# Estimation

## Estimation Techniques

### Story Points (Fibonacci)
- Relative sizing: 1, 2, 3, 5, 8, 13, 21
- Compare to a reference story the team agrees on
- Factors: complexity, uncertainty, effort
- Do NOT equate points to hours — they measure relative difficulty

### T-Shirt Sizing
- XS, S, M, L, XL — quick and intuitive
- Best for early roadmap planning and backlog grooming
- Map to rough ranges: S = 1-2 days, M = 3-5 days, L = 1-2 weeks

### Planning Poker
1. Product owner presents the story
2. Team discusses briefly (2 minutes max)
3. Everyone reveals their estimate simultaneously
4. Discuss outliers — highest and lowest explain reasoning
5. Re-vote until convergence (usually 2 rounds)

### Three-Point Estimation
- Optimistic (O), Most Likely (M), Pessimistic (P)
- Expected = (O + 4M + P) / 6
- Standard deviation = (P - O) / 6
- Useful for communicating uncertainty to stakeholders

## Velocity Tracking
- Track story points completed per sprint
- Use rolling average of last 3-5 sprints
- Forecast: remaining points / average velocity = sprints remaining
- Never compare velocity between teams

## Common Pitfalls
- Anchoring: first person to speak biases everyone
- Padding: adding buffer at each level compounds into massive overestimate
- Ignoring unknowns: spike stories first for research tasks
- Not re-estimating: estimates should be updated as understanding grows
- Precision theater: false accuracy in estimates (3.5 days vs. "about a week")

## When Estimates Are Wrong
- Track actual vs. estimated to calibrate
- If consistently underestimating: add a spike story or break into smaller pieces
- Communicate ranges, not single numbers to stakeholders

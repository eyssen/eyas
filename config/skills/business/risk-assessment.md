---
name: risk-assessment
description: Project risk identification, analysis, and mitigation planning
trigger_patterns:
  - "risk assessment"
  - "risk register"
  - "risk mitigation"
  - "project risks"
  - "what could go wrong"
capabilities:
  - risk-identification
  - risk-analysis
  - mitigation-planning
version: "1.0.0"
---
# Risk Assessment

## Risk Identification
Common risk categories in software projects:
- **Technical:** new technology, performance unknowns, integration complexity
- **Resource:** key person dependency, skill gaps, hiring delays
- **Schedule:** unrealistic deadlines, scope creep, external dependencies
- **Budget:** underestimation, vendor costs, infrastructure scaling
- **Quality:** insufficient testing, technical debt, security vulnerabilities
- **External:** regulatory changes, vendor lock-in, market shifts

## Risk Analysis Matrix

| Probability \ Impact | Low | Medium | High |
|---------------------|-----|--------|------|
| High                | Medium | High | Critical |
| Medium              | Low | Medium | High |
| Low                 | Low | Low | Medium |

Score each risk on probability (1-5) and impact (1-5). Risk score = P x I.

## Risk Register Template
For each risk, document:
- **ID:** RISK-001
- **Description:** clear statement of the risk
- **Category:** technical, resource, schedule, etc.
- **Probability:** 1 (rare) to 5 (almost certain)
- **Impact:** 1 (negligible) to 5 (catastrophic)
- **Score:** P x I
- **Mitigation strategy:** what we will do to reduce the risk
- **Contingency plan:** what we will do if the risk materializes
- **Owner:** person responsible for monitoring
- **Status:** open, mitigated, materialized, closed

## Mitigation Strategies
- **Avoid:** change plan to eliminate the risk entirely
- **Mitigate:** reduce probability or impact (e.g., spike research, prototyping)
- **Transfer:** shift to third party (insurance, outsourcing, SaaS)
- **Accept:** acknowledge and monitor (for low-score risks)

## Review Cadence
- Review risk register at every sprint planning
- Escalate critical risks immediately
- Update scores as project progresses — risks evolve
- Close risks that are no longer relevant

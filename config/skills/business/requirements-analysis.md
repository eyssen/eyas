---
name: requirements-analysis
description: Techniques for gathering, analyzing, and documenting software requirements
trigger_patterns:
  - "requirements"
  - "functional requirements"
  - "non-functional requirements"
  - "business requirements"
  - "requirement analysis"
capabilities:
  - elicitation
  - documentation
  - validation
version: "1.0.0"
---
# Requirements Analysis

## Types of Requirements

### Functional Requirements
- What the system should do — features, behaviors, inputs/outputs
- Example: "The system shall allow users to export reports as PDF"
- Must be testable and verifiable

### Non-Functional Requirements (NFRs)
- Performance: response time < 200ms for 95th percentile
- Scalability: support 10,000 concurrent users
- Security: OWASP Top 10 compliance
- Availability: 99.9% uptime SLA
- Accessibility: WCAG 2.1 AA compliance

### Business Requirements
- High-level goals: increase revenue, reduce churn, improve efficiency
- Constraints: budget, timeline, regulatory compliance

## Elicitation Techniques
- Stakeholder interviews: structured questions, open-ended exploration
- Workshops: collaborative sessions with cross-functional teams
- Observation: shadow users in their workflow
- Prototyping: build throwaway UIs to validate understanding
- Document analysis: review existing systems, processes, contracts

## Documentation Standards
- Use SMART criteria: Specific, Measurable, Achievable, Relevant, Time-bound
- Each requirement gets a unique ID (REQ-001, FR-042)
- Priority levels: Must Have, Should Have, Could Have, Won't Have (MoSCoW)
- Traceability matrix: link requirements to tests and deliverables

## Validation Checklist
- Is it unambiguous? (one interpretation only)
- Is it testable? (clear pass/fail criteria)
- Is it feasible? (technically and financially)
- Is it consistent? (no conflicts with other requirements)
- Is it complete? (all scenarios covered, including edge cases)

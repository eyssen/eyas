---
name: report-generation
description: Generating structured reports for status updates, analysis, and reviews
trigger_patterns:
  - "generate report"
  - "status report"
  - "weekly report"
  - "analysis report"
  - "write a report"
capabilities:
  - report-creation
  - data-presentation
  - executive-reporting
version: "1.0.0"
---
# Structured Reports

## Types

### Status (Weekly/Bi-weekly)
Structure: Summary, Completed, In Progress, Risks/Blockers, Metrics, Next Period Plan.
Include velocity, bug counts, test coverage as key metrics.
Use RAG indicators for quick health assessment.

### Analysis
Structure: Executive summary, Methodology, Findings (data-driven with charts), Recommendations (prioritized), Appendix.

### Incident
Structure: Timeline, Root cause, Impact assessment, Remediation, Prevention measures.

## Status Template Fields
- Period and author
- Completed items with PR/ticket references
- In-progress items with percentage and ETA
- Risks with mitigation strategies
- Blockers with escalation targets
- Key metrics (velocity, bugs, coverage)
- Next period priorities

## Formatting Best Practices
- Consistent heading hierarchy throughout
- Data tables for quantitative information
- Charts for trends (bar, line, pie as appropriate)
- Bold for key numbers and critical findings
- RAG status indicators for executive audiences

## Automation Tips
- Template-based generation with dynamic data injection
- Pull metrics from project management tools (API integration)
- Generate charts from data sources programmatically
- Schedule distribution on regular cadence
- Version-control templates

## Quality Checklist
- Every claim backed by data or reference
- Clear distinction between facts and opinions
- Actionable recommendations with assigned owners
- Appropriate length for the target audience
- Proofread and spell-checked before distribution
- All links and references verified

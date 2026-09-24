---
name: budgeting
description: Project budgeting, cost estimation, and financial tracking for software projects
trigger_patterns:
  - "budget"
  - "cost estimation"
  - "project costs"
  - "financial planning"
  - "TCO"
capabilities:
  - cost-estimation
  - budget-tracking
  - financial-reporting
version: "1.0.0"
---
# Budgeting

## Cost Categories

### People Costs (typically 60-80% of budget)
- Salaries / contractor rates
- Benefits and overhead (multiply salary by 1.3-1.5 for fully loaded cost)
- Training and conferences
- Recruitment costs

### Infrastructure Costs
- Cloud hosting (compute, storage, networking)
- SaaS tools and licenses (IDE, CI/CD, monitoring, project management)
- Domain and SSL certificates
- Third-party APIs and services

### Operational Costs
- Support and maintenance
- Security audits and compliance
- Documentation and training materials
- Legal and accounting

## Estimation Approaches

### Bottom-Up
- Estimate each task individually, sum up
- Most accurate but time-consuming
- Best for well-defined projects

### Top-Down
- Start with total budget, allocate to phases/teams
- Faster but less precise
- Best for early-stage planning

### Analogous
- Compare to similar past projects
- Adjust for differences in scope and complexity
- Good when historical data is available

## Total Cost of Ownership (TCO)
Include in your TCO calculation:
- Initial development cost
- Ongoing maintenance (15-20% of initial cost per year)
- Infrastructure scaling costs
- Training and onboarding
- Technical debt repayment
- End-of-life / migration costs

## Budget Tracking
- Track actual vs. planned spending weekly
- Earned Value Management (EVM): planned value, earned value, actual cost
- Forecast at completion = actual cost + estimate to complete
- Flag variances > 10% immediately
- Maintain a contingency reserve (10-15% of total budget)

## Reporting
- Monthly budget report to stakeholders
- Burn rate visualization (planned vs. actual)
- Forecast completion cost with confidence interval
- Highlight cost-saving opportunities

---
name: technology-evaluation
description: Systematic evaluation of technologies, libraries, and frameworks for adoption decisions
trigger_patterns:
  - "evaluate technology"
  - "should I use"
  - "library comparison"
  - "framework selection"
  - "tech stack"
capabilities:
  - technology-assessment
  - risk-analysis
  - adoption-recommendation
version: "1.0.0"
---
# Technology Evaluation

## Evaluation Criteria

### Technical Fit
- Does it solve our specific problem?
- Compatible with existing tech stack?
- Performance characteristics match our requirements?
- Security track record and vulnerability response time?

### Maturity and Stability
- Version number and release history (pre-1.0 = higher risk)
- Breaking changes frequency between versions
- Deprecation policy and migration support
- Production usage by notable companies

### Community and Ecosystem
- GitHub stars and recent activity (not just stars — check commit frequency)
- npm weekly downloads trend (growing, stable, or declining)
- Stack Overflow questions and answer quality
- Plugin/extension ecosystem
- Number of active maintainers (bus factor)

### License Compatibility
- Must be MIT-compatible for EYAS (MIT, BSD-2, BSD-3, ISC, Apache-2.0)
- FORBIDDEN: GPL, LGPL, AGPL, SSPL, CC-BY-SA
- Check transitive dependencies for license contamination

### Developer Experience
- Documentation quality and completeness
- TypeScript support (native types or @types package)
- API design and ergonomics
- Learning curve and onboarding time
- Error messages and debugging support

## Evaluation Process
1. Define requirements and constraints clearly
2. Identify 3-5 candidates
3. Score each on the criteria above (1-5 scale)
4. Build a small proof-of-concept with top 2 candidates
5. Make decision based on PoC results and scores

## Red Flags
- Single maintainer with no succession plan
- No tests or CI in the repository
- Last commit > 6 months ago (for actively used libraries)
- Frequent breaking changes without migration guides
- License change history (e.g., from MIT to SSPL)
- Excessive dependency count (supply chain risk)

## Decision Documentation
Record the decision using an ADR (Architecture Decision Record):
- Context: why we needed this technology
- Options considered: brief summary of each
- Decision: what we chose and why
- Consequences: trade-offs and risks accepted

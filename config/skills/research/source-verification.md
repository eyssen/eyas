---
name: source-verification
description: Techniques for verifying information accuracy and source reliability
trigger_patterns:
  - "verify source"
  - "fact check"
  - "is this true"
  - "source reliability"
  - "credibility"
capabilities:
  - fact-checking
  - source-evaluation
  - cross-referencing
version: "1.0.0"
---
# Source Verification

## Verification Framework

### CRAAP Test
- **C**urrency: When was it published/updated? Is it still relevant?
- **R**elevance: Does it address your specific question?
- **A**uthority: Who is the author? What are their credentials?
- **A**ccuracy: Is it supported by evidence? Can you verify claims?
- **P**urpose: Why was it written? Is there bias or agenda?

### Cross-Reference Strategy
1. Find the original/primary source (not a summary or quote)
2. Verify with at least 2 independent sources
3. Check if sources are truly independent (not citing each other)
4. Look for contradicting evidence actively
5. Note the date of each source

## Source Hierarchy (most to least reliable)
1. Official documentation and specifications
2. Peer-reviewed research papers
3. Official blog posts from project maintainers
4. Reputable tech publications (with editorial review)
5. Stack Overflow answers (check votes and date)
6. Personal blog posts (check author credentials)
7. Social media and forum posts (lowest reliability)

## Red Flags for Unreliable Information
- No author attribution
- No date or very old date
- Emotional language or sensationalism
- No references or citations
- Conflicts with multiple reliable sources
- Published on a site with known bias
- AI-generated content without human review

## Technical Fact-Checking
- API claims: verify against official documentation
- Performance claims: look for reproducible benchmarks
- Security claims: check CVE databases and security advisories
- Compatibility claims: test in your specific environment
- License claims: verify in the actual LICENSE file, not third-party summaries

## When You Cannot Verify
- Clearly state the uncertainty level
- Present the best available evidence with caveats
- Recommend further investigation or testing
- Never present unverified information as fact
